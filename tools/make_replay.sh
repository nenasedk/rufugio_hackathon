#!/usr/bin/env sh
set -eu
SUBMISSION="${1:-examples/basic_greedy_submission.py}"
SEEDS="${REFUGIO_SEEDS:-round-0,round-1,round-2}"
TICKS="${REFUGIO_TICKS:-300}"
BUDGET="${REFUGIO_POLICY_BUDGET_SECONDS:-180}"
mkdir -p outputs runtime/replays
python -m warehouse.eval_runner "$SUBMISSION" --submission-id local --team-name local --seeds "$SEEDS" --ticks "$TICKS" --replay-seed round-0 --policy-budget-seconds "$BUDGET" --result-out outputs/result.json --replay-out runtime/replays/replay.json
cp runtime/replays/replay.json outputs/replay.json
echo "Wrote outputs/result.json, outputs/replay.json, and runtime/replays/replay.json"
echo "Run: python tools/serve_viewer.py"
