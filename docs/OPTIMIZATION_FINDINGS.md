# REFUGIO Warehouse Challenge — Optimization Findings

Reference notes on optimizing `submission.py` for the REFUGIO Warehouse Challenge.
Captures the final solution, the analytical ceiling, every technique tried (with
results), and the literature/library assessment — so the work doesn't have to be
re-derived.

**Status (last updated):** shipped solution scores **873 deliveries** across the 3
public seeds (`round-0/1/2` = 287/300/286), `status=succeeded`, ~9.4s of the 180s
budget. That is **23.6× the greedy reference baseline (37)**.

---

## 1. Problem mechanics that shaped the design (verified from the engine)

- **Score = total deliveries** = `Σ robot.deliveries` (`warehouse/evaluation.py`).
  Tie-breakers (`blocked_moves`, `remaining_distance`) are reported but not scored.
- **Fixed grid:** 52×52, walkable interior cells 1..50; 96 bases on the perimeter,
  each with one fixed entry/drop cell. `create_layout()` only chooses where the
  **exactly 960 shelves** go (blocks must be ≤2 cells thick — every shelf needs an
  adjacent empty pickup cell).
- **Delivery loop:** base entry → cell adjacent to target shelf → `PICKUP` → back to
  the *same* base entry → `DROP` → new target. Each leg is 1 cell/tick.
- **MAPF rules:** one robot/cell/tick; head-on edge swaps forbidden; vertex conflicts
  revert *both* movers (fixpoint). A blocked move becomes a WAIT in place.
- **Assignment is NOT a lever:** each robot's target sequence is
  `sorted_shelves[ sha256(seed|robot_id|deliveries) % 960 ]` (`warehouse/targets.py`).
  Tasks cannot be reassigned between robots; the hidden seed makes future targets
  unpredictable, but the *current* target is always in the observation.
- **One `act()` controls all 96 robots**, called robot 0..95 each tick; **module
  globals persist across ticks and seeds** (single process). → enables a *centralized*
  planner with shared state, planned once per tick on robot 0's call.
- **Budget:** one shared ~180s pool for import + `create_layout()` (×2) + every
  `act()` call. ~900 tick-plans → ~150–199 ms/tick available.
- **Constraints:** no wall-clock timing in the submission (safety filter); import only
  `warehouse_api` + numpy + safe stdlib. Never import `warehouse.state` / `.simulation`.

---

## 2. Shipped solution architecture

Single self-contained `submission.py`, numpy + stdlib only.

- **`create_layout()`** — canonical 960-shelf layout (2-thick vertical blocks, 4 row
  bands). Empirically the best of all layouts tried (see §4).
- **`act()`** — centralized, stateful, plan-once-per-tick:
  - Static precompute (once): passable mask, neighbor lists, **cached BFS distance
    fields** per goal cell (reused across ticks/seeds).
  - Per-robot belief table; positions read from `all_robot_positions`; other robots'
    targets/carrying tracked from prior ticks + predicted from commanded PICKUP/DROP
    (≤1-tick staleness only for just-delivered robots).
  - **Prioritized windowed cooperative A\*** (WHCA\*-style) over a space-time
    reservation table (cell + edge/anti-swap), `WINDOW=20`, exact BFS-distance
    heuristic, `NODE_CAP=4000`.
  - Priority: **deadline-aware** (robots that can still deliver before tick 300 first),
    then carriers, then starvation boost, then shortest remaining distance.
  - Final **priority-biased conflict-resolution pass** mirrors the simulator's
    collision rules but lets the higher-priority robot win instead of reverting both —
    this removes the wasted/blocked moves that gridlock greedy policies.
  - Just-delivered robots (unknown new target for 1 tick) take a coordinated greedy
    step; everything wraps in try/except → WAIT.

---

## 3. The ceiling analysis (why we're near the wall)

Deliveries ≈ `Σ_robots 300 / (2·distance + 2)`, so there are only two levers:
**distance** and **congestion**. Both are nearly exhausted.

- **Zero-congestion upper bound (canonical layout): 921** (per-seed 295/314/312).
  We achieve **873 = 94.8%** of it.
- **Absolute Manhattan-floor ceiling: 954** (perfect aisles). We're at ~91% of that.
- **Distance is ~layout-invariant.** Bases ring all four sides symmetrically, so mean
  shelf↔base distance barely changes with shelf placement. Canonical's **detour ratio
  is 1.034** (graph distance ≈ Manhattan) — aisles are already near-perfect.
- **Congestion is already negligible.** Instrumented run (round-0, 28,800
  action-ticks): robots **move 96.4%**, **WAIT 1.4%** (411 ticks), 33 blocked moves;
  occupancy evenly spread (central 20×20 = 15.7% ≈ its 16% area). Agent density ~6.2%.
- Therefore the remaining ~5% gap is mostly **unavoidable end-of-horizon partial
  trips**, not addressable congestion.

---

## 4. Everything tried (results)

Baseline greedy reference = **37**.

### Layout (offline search)
| Layout | Deliveries | Note |
|---|---|---|
| **Canonical (shipped)** | **873** | best |
| more cross-aisles | 851–855 | narrower aisles hurt |
| central-clustered | 828 | lowers distance bound to 945 but congestion eats it |
| wide_avenues (example) | 187 | no horizontal cross-aisles → gridlock |

Conclusion: the 2-thick constraint forces near-uniform interior fill, so distance is
locked and canonical (low distance + wide 2-wide aisles) is the sweet spot.

### Planner / priority
| Change | Result |
|---|---|
| Greedy → centralized cooperative planner | 37 → 858 |
| Honor deliberate WAITs (don't greedy-override) | 858 → big drop in blocked moves |
| `WINDOW` sweep (10–32) | plateau; W=20 → 871 |
| **Deadline-aware endgame priority (shipped)** | **871 → 873** (+3 over 9 seeds, 0 regressions) |

### Techniques that REGRESS (do not adopt)
| Technique (source) | Result vs 873 |
|---|---|
| Weighted A\* `f=g+w·h`, w=1.3 / 2.0 (Qian et al. 2026) | −13 / −18 |
| Distance-adaptive heuristic `f=g+(1+r/R)h` (Qian et al.) | −24 |
| Cubic B-spline smoothing (Qian et al.) | N/A — discrete grid, no kinematics |
| Fairness priority (longest-remaining first) | −10 |
| Guidance-graph / congestion-aware edge costs (IJCAI'24) | −16 to −46, +up to 10× plan time |

Why they fail here: they optimize **search speed** (we're compute-rich with an exact
heuristic) or **fairness / high-density congestion** (we have ~1.4% waits). All trade
away path optimality — our actual bottleneck.

---

## 5. Allowed-libraries assessment

Binding constraint is travel **distance** (geometric floor), not search speed — so no
library helps throughput:
- **numpy** — used (distance fields, masks).
- **scipy** (`csgraph`) — could speed distance fields, but they're cached; no effect.
- **networkx** — slower pure-Python graph algos; no benefit.
- **sortedcontainers** — `SortedList` open set no better than `heapq`.
- **numba** — would cut the 9.4s further, but we use only 5% of budget; extra speed only
  helps if a more-expensive algorithm helped, and every one tested regressed.

---

## 6. SOTA literature (researched) and verdict

- **RHCR** (AAAI'21) — highest-throughput LMAPF via windowed replanning. *We already
  implement this family.*
- **PIBT** (AIJ'22) — fast rule-based; RHCR beats it ~24% on throughput. Would regress.
- **LaCAM\*** — massive-scale/speed; solves scalability we don't have.
- **Guidance-graph optimization** (IJCAI'24) — *the* throughput lever; tested, regresses
  here (low density).
- **CBS/EECBS/MAPF-LNS** — optimize sum-of-cost for fixed start-goals, not lifelong
  throughput; cannot exceed the 921 single-agent bound.

All SOTA throughput methods target high-density congestion collapse — a regime our
6.2%-density instance is far from.

Sources:
- RHCR: https://arxiv.org/pdf/2005.07371
- PIBT: https://www.sciencedirect.com/science/article/pii/S0004370222000923 · https://arxiv.org/abs/1901.11282
- Guidance Graph Optimization: https://www.ijcai.org/proceedings/2024/0035.pdf · https://arxiv.org/abs/2402.01446
- Online Guidance Graph Optimization: https://arxiv.org/pdf/2411.16506
- Learn to Follow (decentralized LMAPF): https://arxiv.org/pdf/2310.01207

---

## 7. What's left (honest)

- **Best-of-K priority orderings (PBS-style)** — the only untested theoretical avenue.
  Upside is bounded by the 1.4% wait rate (≈1–3 deliveries) and the related
  fairness-ordering test already regressed. Not implemented; expected ≈0.
- Otherwise the algorithm is no longer the bottleneck — **physics is**. Improvements
  beyond ~+1% are not available without changing the fixed grid/assignment/rules.

---

## 8. Reproduce

```bash
python tools/check_submission.py submission.py
python -m warehouse.local_runner submission.py --seeds round-0,round-1,round-2 \
    --ticks 300 --policy-budget-seconds 180
# replay:
python -m warehouse.eval_runner submission.py --submission-id local --team-name local \
    --seeds round-0,round-1,round-2 --ticks 300 --replay-seed round-0 \
    --policy-budget-seconds 180 --result-out outputs/result.json --replay-out outputs/replay.json
python tools/serve_viewer.py
```
