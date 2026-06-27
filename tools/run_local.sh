#!/usr/bin/env sh
set -eu
SUBMISSION="${1:-examples/basic_greedy_submission.py}"
SEEDS="${REFUGIO_SEEDS:-round-0,round-1,round-2}"
TICKS="${REFUGIO_TICKS:-300}"
BUDGET="${REFUGIO_POLICY_BUDGET_SECONDS:-180}"
python -m warehouse.local_runner "$SUBMISSION" --seeds "$SEEDS" --ticks "$TICKS" --policy-budget-seconds "$BUDGET"
