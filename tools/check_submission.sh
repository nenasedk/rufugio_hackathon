#!/usr/bin/env sh
set -eu
SUBMISSION="${1:-examples/basic_greedy_submission.py}"
mkdir -p outputs
python tools/check_submission.py "$SUBMISSION" --layout-out outputs/submission_layout.normalized.json
