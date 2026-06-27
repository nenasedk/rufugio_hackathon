# Allowed Packages

This document defines the package policy for participant submissions. The goal
is to avoid surprise dependency failures during evaluation while still giving
teams enough room to implement serious routing/pathfinding algorithms.

## Rule of Thumb

Official submissions must be a single Python file with:

```python
from warehouse_api import Action, Observation

def act(observation: Observation) -> Action:
    ...
```

The evaluation environment should be prebuilt with a fixed Python version and a
pinned set of packages. Teams may use only the packages listed here inside
submitted code.

## Always Available

The challenge API:

- `warehouse_api`

Safe and useful Python standard-library modules:

- `array`
- `bisect`
- `collections`
- `copy`
- `dataclasses`
- `enum`
- `functools`
- `hashlib`
- `heapq`
- `itertools`
- `math`
- `operator`
- `queue`
- `random`
- `statistics`
- `typing`

Notes:

- Randomness must be deterministic and derived from the observation, seed-like
  constants, robot id, or tick. Wall-clock randomness is not allowed.
- Import time counts toward evaluation cost.

## Third-Party Packages Allowed In Official Submissions

These packages are good candidates for the official worker image:

| Package | Why allow it |
|---------|--------------|
| `numpy` | Fast arrays, vectorized grid operations, numeric heuristics |
| `scipy` | Sparse matrices, graph/search utilities, distance transforms |
| `networkx` | Graph modeling and pathfinding prototypes |
| `sortedcontainers` | Efficient priority queues/maps for search |
| `numba` | Optional CPU JIT for hot loops; compilation time counts |

Recommended v0 pinned environment:

```text
numpy
scipy
networkx
sortedcontainers
numba
```

Do not allow teams to add arbitrary `pip install` dependencies at submission
time. If a package is missing, the submission should fail locally and in the
official worker in the same way.

## Local Development Only

These are useful for notebooks, analysis, plotting or offline experiments, but
should not be imported by the submitted `act()` file unless explicitly promoted
to the official allowlist:

- `ipython`
- `jupyter`
- `matplotlib`
- `pandas`
- `plotly`
- `scikit-learn`
- `seaborn`
- `tqdm`

## Explicitly Not Allowed In Submissions

The safety filter and worker sandbox should reject submissions that use:

- filesystem access: `open`, `pathlib`, broad `os` usage, file writes
- network access: `socket`, `http.client`, `urllib`, `requests`, `aiohttp`
- subprocess execution: `subprocess`, `os.system`
- parallel process/thread spawning: `multiprocessing`, `threading`, `concurrent.futures`
- wall-clock dependent logic: `time.time`, `datetime.now`, timers used for decisions
- package installation or dynamic imports to bypass the allowlist
- hidden simulator internals such as `warehouse.simulation` or `warehouse.state`

Some standard-library modules may be acceptable in narrow contexts, but the
submission contract should stay simple: if it is not listed above, do not rely
on it for the official run.

## Infra Notes

The worker image should:

- install the exact allowed package versions before the event,
- expose that package list to teams in the starter docs,
- run the same image for local smoke tests if possible,
- block network access so packages cannot fetch data at runtime,
- treat import errors as failed attempts.

