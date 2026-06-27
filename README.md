# REFUGIO Starter Kit

This zip is the local development toolset for the REFUGIO Warehouse Challenge.
It contains the same Python simulation engine, layout validation, submission
loader, and evaluation entrypoint used by the official evaluator.

The only intentional difference is the seed list: this kit uses public local
seeds (`round-0`, `round-1`, `round-2`). The official leaderboard uses hidden
organizer seeds.

## What You Submit

Submit one `.py` file containing both functions:

```python
def create_layout() -> dict[str, object]:
    ...

def act(observation):
    ...
```

`create_layout()` returns your shelf layout. `act(observation)` returns one
robot action for one robot at one tick.

## Quick Setup

Recommended Python: 3.13, because the official evaluator runs Python 3.13.
Python 3.11+ should work for the local simulator.

Windows PowerShell:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e . -r requirements.txt
```

macOS/Linux:

```bash
python3.13 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e . -r requirements.txt
```

If installing the optional scientific packages is slow, `python -m pip install
-e .` is enough to run the bundled examples. The official evaluator does include
the packages listed in `requirements.txt`.

## Main Commands

Check that a submission imports, defines `create_layout()` and `act()`, returns a
valid deterministic layout, and fits the setup budget:

```bash
python tools/check_submission.py examples/basic_greedy_submission.py
```

Run a local evaluation on the public seeds:

```bash
python -m warehouse.local_runner examples/basic_greedy_submission.py --seeds round-0,round-1,round-2 --ticks 300 --policy-budget-seconds 180
```

Generate official-format result and replay JSON:

```bash
python -m warehouse.eval_runner examples/basic_greedy_submission.py --submission-id local --team-name local --seeds round-0,round-1,round-2 --ticks 300 --replay-seed round-0 --policy-budget-seconds 180 --result-out outputs/result.json --replay-out outputs/replay.json
```

Validate a standalone layout JSON:

```bash
python -m warehouse.validate_layout layouts/canonical_layout.json --normalized-out outputs/canonical.normalized.json
```

## Convenience Scripts

Windows:

```bat
tools\check_submission.bat examples\basic_greedy_submission.py
tools\run_local.bat examples\basic_greedy_submission.py
tools\\make_replay.bat examples\\basic_greedy_submission.py
tools\\serve_viewer.bat
tools\validate_layout_json.bat layouts\canonical_layout.json
```

macOS/Linux:

```bash
./tools/check_submission.sh examples/basic_greedy_submission.py
./tools/run_local.sh examples/basic_greedy_submission.py
./tools/make_replay.sh examples/basic_greedy_submission.py
./tools/serve_viewer.sh
./tools/validate_layout_json.sh layouts/canonical_layout.json
```

## Replay Viewer

After running `make_replay`, start the local viewer server:

Windows:

```bat
tools\\make_replay.bat examples\\basic_greedy_submission.py
tools\\serve_viewer.bat
python tools\serve_viewer.py
```

macOS/Linux:

```bash
./tools/make_replay.sh examples/basic_greedy_submission.py
./tools/serve_viewer.sh
python tools/serve_viewer.py
```

Then open the printed URL. By default it is:

```text
http://127.0.0.1:8765/viewer/index.html?replay=/runtime/replays/replay.json
```

The local viewer uses the same canvas renderer and replay controls as the hosted
REFUGIO replay page. It is served over localhost because the official replay
viewer loads replay JSON through `fetch`, which is not reliable from `file://`.

You can also use the `Load JSON` button in the viewer to inspect another replay
file manually.

## Layout Rules

A valid `create_layout()` must return:

```python
{"schema_version": 1, "shelves": [[x, y], ...]}
```

Rules:

- exactly 960 shelf coordinates;
- every coordinate is unique;
- shelf coordinates are inside the walkable interior: `1 <= x <= 50`,
  `1 <= y <= 50`;
- fixed base entry cells must remain open;
- every shelf must have at least one orthogonally adjacent empty pickup cell;
- all non-shelf walkable cells must form one connected region;
- `create_layout()` must be deterministic. The evaluator calls it more than
  once.

The order of shelves does not matter for geometry. The evaluator normalizes them
before running targets.

## Observation Fields

Your policy receives an immutable `Observation`:

```python
Observation(
    tick: int,
    robot_id: int,
    position: tuple[int, int],
    base_position: tuple[int, int],
    target_item_position: tuple[int, int],
    carrying_item: bool,
    grid: tuple[tuple[CellType, ...], ...],
    all_robot_positions: Mapping[int, tuple[int, int]],
)
```

You know your own target and base. You see all robot positions. You do not see
other robots' targets.

Actions:

```python
Action.WAIT
Action.UP
Action.DOWN
Action.LEFT
Action.RIGHT
Action.PICKUP
Action.DROP
```

## Official Run Shape

The local evaluator mirrors the official run shape:

- 96 robots;
- 300 ticks per seed;
- 3 official seeds on the leaderboard;
- 180 seconds cumulative policy/setup budget per submission;
- one replay seed saved per job;
- raw delivery score is the sum of deliveries across seeds.

The official platform also performs upload checks and safety review before the
sandboxed evaluation. This zip is for local development and does not include
team tokens, hidden seeds, admin infra, Vercel/Supabase code, or the LLM safety
service.

