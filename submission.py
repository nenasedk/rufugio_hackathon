"""REFUGIO Warehouse Challenge submission.

Centralized cooperative multi-agent pathfinding for 96 warehouse robots.

A single ``act()`` controls every robot. The simulator calls ``act()`` once per
robot per tick (robot 0..95) and module globals persist across ticks and seeds,
so we run ONE centralized planner per tick (on the first robot's call of the
tick) and serve the resulting move to every robot. Pathing is windowed
prioritized cooperative A* with space-time (cell + edge) reservations, plus a
final conflict-resolution pass that mirrors the simulator's collision rules but
lets higher-priority robots win instead of reverting both -- this removes the
wasted/blocked moves that gridlock greedy policies.

Only the public ``warehouse_api`` plus numpy and the standard library are used.
"""

from __future__ import annotations

import heapq
from collections import deque

import numpy as np

from warehouse_api import Action, CellType, Observation

# --- static geometry (redefined locally; never import simulator internals) ---
GRID = 52
WALK_MIN = 1
WALK_MAX = 50
INF = 1 << 29

# Tunable planner constants (no wall-clock guard; compute is bounded by these).
WINDOW = 12          # space-time reservation horizon (ticks)
NODE_CAP = 1200      # max A* expansions per robot before greedy fallback
WAIT_CAP = 25        # cap on starvation boost in the priority key

_DIRS = (
    (Action.UP, 0, -1),
    (Action.DOWN, 0, 1),
    (Action.LEFT, -1, 0),
    (Action.RIGHT, 1, 0),
)


def _node(x: int, y: int) -> int:
    return y * GRID + x


def create_layout() -> dict[str, object]:
    """Canonical 960-shelf layout (2-cell-thick blocks, 4 row bands).

    Deterministic and pure: the evaluator calls this more than once and requires
    identical output. Traffic-topology tuning happens offline; the canonical
    layout is the validated fallback.
    """
    shelves: list[list[int]] = []
    for x0 in range(3, 48, 4):
        for y0, y1 in ((3, 12), (15, 24), (27, 36), (39, 48)):
            for x in (x0, x0 + 1):
                for y in range(y0, y1 + 1):
                    shelves.append([x, y])
    return {"schema_version": 1, "shelves": shelves}


def _base_entry(bx: int, by: int) -> tuple[int, int]:
    """Walkable interior cell adjacent to an external base (== drop cell)."""
    if bx == 0:
        return (1, by)
    if bx == GRID - 1:
        return (GRID - 2, by)
    if by == 0:
        return (bx, 1)
    return (bx, GRID - 2)


def _adjacent(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1


class _World:
    """Static grid structures: passable mask, neighbor lists, distance cache."""

    __slots__ = ("passable", "nbrs", "dist_cache")

    def __init__(self, grid) -> None:
        self.passable = np.zeros(GRID * GRID, dtype=bool)
        for y in range(WALK_MIN, WALK_MAX + 1):
            row = grid[y]
            for x in range(WALK_MIN, WALK_MAX + 1):
                if row[x] == CellType.EMPTY:
                    self.passable[_node(x, y)] = True

        nbrs: dict[int, tuple[tuple[Action, int], ...]] = {}
        passable = self.passable
        for y in range(WALK_MIN, WALK_MAX + 1):
            for x in range(WALK_MIN, WALK_MAX + 1):
                n = _node(x, y)
                if not passable[n]:
                    continue
                lst = []
                for action, dx, dy in _DIRS:
                    nx, ny = x + dx, y + dy
                    if WALK_MIN <= nx <= WALK_MAX and WALK_MIN <= ny <= WALK_MAX:
                        m = _node(nx, ny)
                        if passable[m]:
                            lst.append((action, m))
                nbrs[n] = tuple(lst)
        self.nbrs = nbrs
        self.dist_cache: dict[tuple, np.ndarray] = {}

    def _bfs(self, sources: list[int]) -> np.ndarray:
        dist = np.full(GRID * GRID, INF, dtype=np.int32)
        dq: deque[int] = deque()
        for s in sources:
            if dist[s] != 0:
                dist[s] = 0
                dq.append(s)
        nbrs = self.nbrs
        while dq:
            u = dq.popleft()
            du = dist[u] + 1
            for _action, v in nbrs[u]:
                if dist[v] > du:
                    dist[v] = du
                    dq.append(v)
        return dist

    def base_field(self, entry_node: int) -> np.ndarray:
        key = ("B", entry_node)
        field = self.dist_cache.get(key)
        if field is None:
            field = self._bfs([entry_node])
            self.dist_cache[key] = field
        return field

    def shelf_field(self, shelf: tuple[int, int]) -> np.ndarray:
        key = ("S", shelf)
        field = self.dist_cache.get(key)
        if field is None:
            sx, sy = shelf
            sources = []
            for _action, dx, dy in _DIRS:
                nx, ny = sx + dx, sy + dy
                if WALK_MIN <= nx <= WALK_MAX and WALK_MIN <= ny <= WALK_MAX:
                    m = _node(nx, ny)
                    if self.passable[m]:
                        sources.append(m)
            field = self._bfs(sources)
            self.dist_cache[key] = field
        return field


class _Brain:
    """Dynamic, per-episode planner state shared across all robots."""

    __slots__ = (
        "world", "cur_tick", "pos", "base", "entry", "target", "carrying",
        "wait_streak", "moves", "locked", "occupied", "need_greedy",
    )

    def __init__(self) -> None:
        self.world: _World | None = None
        self.cur_tick: int | None = None
        self.pos: dict[int, tuple[int, int]] = {}
        self.base: dict[int, tuple[int, int]] = {}
        self.entry: dict[int, int] = {}            # rid -> base entry node
        self.target: dict[int, tuple[int, int] | None] = {}
        self.carrying: dict[int, bool] = {}
        self.wait_streak: dict[int, int] = {}
        self.moves: dict[int, Action] = {}
        self.locked: frozenset[tuple[int, int]] = frozenset()
        self.occupied: frozenset[tuple[int, int]] = frozenset()
        self.need_greedy: frozenset[int] = frozenset()

    def reset_episode(self) -> None:
        self.cur_tick = None
        self.pos.clear()
        self.base.clear()
        self.entry.clear()
        self.target.clear()
        self.carrying.clear()
        self.wait_streak.clear()
        self.moves.clear()
        self.locked = frozenset()
        self.occupied = frozenset()
        self.need_greedy = frozenset()


_BRAIN = _Brain()


def act(observation: Observation) -> Action:
    try:
        return _act(observation)
    except Exception:
        return Action.WAIT


def _act(obs: Observation) -> Action:
    brain = _BRAIN
    if brain.world is None:
        brain.world = _World(obs.grid)

    new_tick = brain.cur_tick is None or obs.tick != brain.cur_tick
    if new_tick:
        if brain.cur_tick is None or obs.tick < brain.cur_tick:
            brain.reset_episode()
        brain.cur_tick = obs.tick
        try:
            _plan(brain, obs)
        except Exception:
            brain.moves = {}

    return _action_for(brain, obs)


def _plan(brain: _Brain, obs0: Observation) -> None:
    """Run the centralized plan for this tick (called on the first robot)."""
    world = brain.world
    positions = obs0.all_robot_positions

    # Seed the first caller's (robot 0's) ground truth into belief.
    r0 = obs0.robot_id
    brain.pos[r0] = obs0.position
    brain.base[r0] = obs0.base_position
    brain.entry[r0] = _node(*_base_entry(*obs0.base_position))
    brain.target[r0] = obs0.target_item_position
    brain.carrying[r0] = obs0.carrying_item

    for rid, xy in positions.items():
        brain.pos[rid] = (xy[0], xy[1])

    rids = sorted(positions)
    brain.occupied = frozenset(brain.pos[rid] for rid in rids)
    brain.locked = frozenset(
        t for rid in rids
        if brain.carrying.get(rid) and (t := brain.target.get(rid)) is not None
    )

    # Classify robots: STAY (pickup/drop/unknown) vs MOVE, and pick goals.
    stayers: list[int] = []
    movers: list[int] = []
    need_greedy: list[int] = []
    goal_field: dict[int, np.ndarray] = {}
    for rid in rids:
        cur = brain.pos[rid]
        node = _node(*cur)
        carrying = brain.carrying.get(rid, False)
        if carrying:
            entry = brain.entry.get(rid)
            if entry is None:
                stayers.append(rid)
                continue
            field = world.base_field(entry)
            if node == entry:
                stayers.append(rid)  # will DROP
                continue
        else:
            target = brain.target.get(rid)
            if target is None:
                # Unknown target (just delivered / not yet seen): let its own
                # call this tick take a greedy step toward the revealed goal.
                stayers.append(rid)
                need_greedy.append(rid)
                continue
            field = world.shelf_field(target)
            if int(field[node]) == 0:
                stayers.append(rid)  # at access cell -> will PICKUP (or wait if locked)
                continue
        if int(field[node]) >= INF:
            stayers.append(rid)      # unreachable goal
            continue
        goal_field[rid] = field
        movers.append(rid)

    brain.need_greedy = frozenset(need_greedy)

    cell_res: dict[tuple[int, int], int] = {}
    edge_res: dict[tuple[int, int, int], int] = {}

    # Stationary robots block their cell for the whole window so movers avoid them.
    for rid in stayers:
        n = _node(*brain.pos[rid])
        for t in range(WINDOW + 1):
            cell_res[(t, n)] = rid

    def priority(rid: int):
        carrying = brain.carrying.get(rid, False)
        node = _node(*brain.pos[rid])
        remaining = int(goal_field[rid][node])
        boost = min(brain.wait_streak.get(rid, 0), WAIT_CAP)
        return (0 if carrying else 1, -boost, remaining, rid)

    movers.sort(key=priority)

    desired: dict[int, int] = {rid: _node(*brain.pos[rid]) for rid in rids}
    for rid in movers:
        start = _node(*brain.pos[rid])
        path = _astar(world, start, goal_field[rid], cell_res, edge_res)
        if path is None or len(path) < 2:
            desired[rid] = start
            for t in range(WINDOW + 1):
                cell_res.setdefault((t, start), rid)
            continue
        desired[rid] = path[1]
        last = len(path) - 1
        for i in range(min(last, WINDOW) + 1):
            cell_res[(i, path[i])] = rid
        for i in range(min(last, WINDOW)):
            edge_res[(i, path[i], path[i + 1])] = rid
        for t in range(last + 1, WINDOW + 1):
            cell_res[(t, path[last])] = rid

    order = stayers + movers
    final = _resolve_first_moves(brain, desired, order)

    moves: dict[int, Action] = {}
    for rid in rids:
        u = _node(*brain.pos[rid])
        v = final[rid]
        moves[rid] = _delta_action(u, v)
        brain.wait_streak[rid] = 0 if v != u else brain.wait_streak.get(rid, 0) + 1
    brain.moves = moves


def _astar(world, start, field, cell_res, edge_res):
    """Windowed space-time A*; returns node path start..goal or None."""
    if int(field[start]) >= INF:
        return None
    if int(field[start]) == 0:
        return [start]

    nbrs = world.nbrs
    open_heap = [(int(field[start]), 0, start, 0)]
    came: dict[tuple[int, int], tuple[int, int]] = {}
    gbest: dict[tuple[int, int], int] = {(start, 0): 0}
    expansions = 0
    goal_state = None
    while open_heap:
        f, g, n, t = heapq.heappop(open_heap)
        if g > gbest.get((n, t), INF):
            continue
        if int(field[n]) == 0:
            goal_state = (n, t)
            break
        expansions += 1
        if expansions > NODE_CAP:
            break
        nt = t + 1
        within = nt <= WINDOW
        ng = g + 1
        for action, m in nbrs[n]:
            if within and ((nt, m) in cell_res or (t, m, n) in edge_res):
                continue
            key = (m, nt)
            if ng < gbest.get(key, INF):
                gbest[key] = ng
                came[key] = (n, t)
                heapq.heappush(open_heap, (ng + int(field[m]), ng, m, nt))
        # WAIT in place
        if not (within and (nt, n) in cell_res):
            key = (n, nt)
            if ng < gbest.get(key, INF):
                gbest[key] = ng
                came[key] = (n, t)
                heapq.heappush(open_heap, (ng + int(field[n]), ng, n, nt))

    if goal_state is None:
        return None
    path = []
    state = goal_state
    while state in came:
        path.append(state[0])
        state = came[state]
    path.append(start)
    path.reverse()
    return path


def _resolve_first_moves(brain, desired, order):
    """Priority-biased version of the simulator's collision resolution."""
    cur = {rid: _node(*brain.pos[rid]) for rid in desired}
    final = dict(desired)
    by_cur = {cur[rid]: rid for rid in desired}

    # Head-on edge swaps: neither robot can pass, both wait.
    for rid in order:
        u, v = cur[rid], final[rid]
        if v == u:
            continue
        other = by_cur.get(v)
        if other is not None and other != rid and final.get(other) == u:
            final[rid] = u
            final[other] = cur[other]

    # Vertex conflicts: first claimer (highest priority) keeps the cell.
    changed = True
    guard = 0
    while changed and guard < 256:
        changed = False
        guard += 1
        occ: dict[int, int] = {}
        for rid in order:
            v = final[rid]
            if v in occ:
                if final[rid] != cur[rid]:
                    final[rid] = cur[rid]
                    changed = True
            else:
                occ[v] = rid
    return final


def _delta_action(u: int, v: int) -> Action:
    if u == v:
        return Action.WAIT
    dx = (v % GRID) - (u % GRID)
    if dx == 1:
        return Action.RIGHT
    if dx == -1:
        return Action.LEFT
    return Action.DOWN if (v // GRID) - (u // GRID) == 1 else Action.UP


def _action_for(brain: _Brain, obs: Observation) -> Action:
    rid = obs.robot_id
    pos = obs.position
    target = obs.target_item_position
    carrying = obs.carrying_item

    # Refresh ground truth for this robot (improves next tick's plan).
    brain.pos[rid] = pos
    brain.base[rid] = obs.base_position
    entry_xy = _base_entry(*obs.base_position)
    brain.entry[rid] = _node(*entry_xy)
    brain.target[rid] = target
    brain.carrying[rid] = carrying

    # Interactions are decided from ground truth and update predicted next state.
    if carrying:
        if pos == entry_xy:
            brain.carrying[rid] = False
            brain.target[rid] = None  # next target unknown until revealed
            return Action.DROP
    else:
        if _adjacent(pos, target) and target not in brain.locked:
            brain.carrying[rid] = True
            return Action.PICKUP

    move = brain.moves.get(rid)
    if move is None or (move == Action.WAIT and rid in brain.need_greedy):
        # Only robots the planner could not route (just delivered / unseen) take
        # an uncoordinated greedy step; deliberate WAITs are honored so we don't
        # recreate the conflicts the planner just resolved.
        move = _greedy_step(brain, obs)
    return move


def _greedy_step(brain: _Brain, obs: Observation) -> Action:
    world = brain.world
    x, y = obs.position
    if obs.carrying_item:
        field = world.base_field(_node(*_base_entry(*obs.base_position)))
    else:
        target = obs.target_item_position
        if target is None:
            return Action.WAIT
        field = world.shelf_field(target)

    occupied = brain.occupied
    best_action = Action.WAIT
    best_key = (int(field[_node(x, y)]), y, x)
    for action, dx, dy in _DIRS:
        nx, ny = x + dx, y + dy
        if not (WALK_MIN <= nx <= WALK_MAX and WALK_MIN <= ny <= WALK_MAX):
            continue
        m = _node(nx, ny)
        if not world.passable[m] or (nx, ny) in occupied:
            continue
        key = (int(field[m]), ny, nx)
        if key < best_key:
            best_key = key
            best_action = action
    return best_action
