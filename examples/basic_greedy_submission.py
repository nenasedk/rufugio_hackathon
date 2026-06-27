"""Very simple local-development baseline.

This is deliberately not clever: no BFS, no graph precomputation, no global
plan. It moves greedily toward a nearby pickup/drop cell and waits if the next
step is blocked by a shelf or another robot.
"""

from __future__ import annotations

from warehouse_api import Action, CellType, Observation, Position


DIRECTIONS: tuple[tuple[Action, Position], ...] = (
    (Action.RIGHT, (1, 0)),
    (Action.LEFT, (-1, 0)),
    (Action.DOWN, (0, 1)),
    (Action.UP, (0, -1)),
)
DELTA_BY_ACTION: dict[Action, Position] = dict(DIRECTIONS)


def create_layout() -> dict[str, object]:
    shelves: list[list[int]] = []
    for x0 in range(3, 48, 4):
        for y0, y1 in ((3, 12), (15, 24), (27, 36), (39, 48)):
            for x in (x0, x0 + 1):
                for y in range(y0, y1 + 1):
                    shelves.append([x, y])
    return {"schema_version": 1, "shelves": shelves}


def act(observation: Observation) -> Action:
    if not observation.carrying_item and _adjacent(
        observation.position,
        observation.target_item_position,
    ):
        return Action.PICKUP

    drop_cell = _drop_cell_for_base(observation.base_position)
    if observation.carrying_item and observation.position == drop_cell:
        return Action.DROP

    goal = drop_cell if observation.carrying_item else _nearest_pickup_cell(observation)
    if goal is None:
        return Action.WAIT

    return _greedy_step(observation, goal)


def _adjacent(a: Position, b: Position) -> bool:
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1


def _drop_cell_for_base(base: Position) -> Position:
    x, y = base
    if y == 0:
        return (x, 1)
    if y == 51:
        return (x, 50)
    if x == 0:
        return (1, y)
    return (50, y)


def _nearest_pickup_cell(observation: Observation) -> Position | None:
    tx, ty = observation.target_item_position
    candidates = ((tx + 1, ty), (tx - 1, ty), (tx, ty + 1), (tx, ty - 1))
    free = [cell for cell in candidates if _is_empty(observation, cell)]
    if not free:
        return None
    px, py = observation.position
    return min(
        free,
        key=lambda cell: (abs(px - cell[0]) + abs(py - cell[1]), cell[1], cell[0]),
    )


def _greedy_step(observation: Observation, goal: Position) -> Action:
    x, y = observation.position
    gx, gy = goal
    preferred: list[Action] = []

    if gx > x:
        preferred.append(Action.RIGHT)
    elif gx < x:
        preferred.append(Action.LEFT)

    if gy > y:
        preferred.append(Action.DOWN)
    elif gy < y:
        preferred.append(Action.UP)

    for action in preferred:
        if _can_move(observation, action):
            return action
    return Action.WAIT


def _can_move(observation: Observation, action: Action) -> bool:
    dx, dy = DELTA_BY_ACTION[action]
    x, y = observation.position
    target = (x + dx, y + dy)
    if not _is_empty(observation, target):
        return False
    occupied = set(observation.all_robot_positions.values())
    return target not in occupied


def _is_empty(observation: Observation, cell: Position) -> bool:
    x, y = cell
    return (
        0 <= y < len(observation.grid)
        and 0 <= x < len(observation.grid[y])
        and observation.grid[y][x] == CellType.EMPTY
    )
