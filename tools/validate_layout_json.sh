#!/usr/bin/env sh
set -eu
LAYOUT="${1:-layouts/canonical_layout.json}"
mkdir -p outputs
python -m warehouse.validate_layout "$LAYOUT" --normalized-out outputs/layout.normalized.json
