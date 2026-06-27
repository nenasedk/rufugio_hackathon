"""Local submission checker for REFUGIO starter kit.

This imports the submitted file and calls the same Python loader used by the
official evaluator. It does not run the hosted LLM safety review.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from warehouse.submission_loader import (
    SubmissionLoadError,
    load_submission_with_layout,
    sanitized_submission_argv,
)

MAX_SUBMISSION_BYTES = 256_000
ACT_FUNCTION_RE = re.compile(r"^\s*def\s+act\s*\(", re.MULTILINE)
CREATE_LAYOUT_FUNCTION_RE = re.compile(r"^\s*def\s+create_layout\s*\(", re.MULTILINE)


def main() -> None:
    parser = argparse.ArgumentParser(description="Check a REFUGIO submission locally.")
    parser.add_argument("submission", type=Path)
    parser.add_argument("--setup-budget-seconds", type=float, default=180.0)
    parser.add_argument("--layout-out", type=Path, help="Optional normalized layout JSON output path.")
    args = parser.parse_args()

    try:
        _check_basic_upload_shape(args.submission)
        with sanitized_submission_argv(args.submission):
            loaded = load_submission_with_layout(
                args.submission,
                setup_budget_seconds=args.setup_budget_seconds,
            )
    except (OSError, SubmissionLoadError, ValueError) as exc:
        raise SystemExit(f"INVALID: {exc}") from exc

    if args.layout_out:
        args.layout_out.parent.mkdir(parents=True, exist_ok=True)
        args.layout_out.write_text(
            json.dumps(loaded.layout, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    print("VALID submission")
    print(f"layout shelves: {loaded.layout['shelf_count']}")
    print(f"setup/layout time: {loaded.setup_time_seconds:.6f}s")


def _check_basic_upload_shape(path: Path) -> None:
    if path.suffix != ".py":
        raise ValueError("submission must be a single .py file")
    raw = path.read_bytes()
    if not raw:
        raise ValueError("submission cannot be empty")
    if len(raw) > MAX_SUBMISSION_BYTES:
        raise ValueError(f"submission is too large ({len(raw)} bytes > {MAX_SUBMISSION_BYTES})")
    code = raw.decode("utf-8")
    if not ACT_FUNCTION_RE.search(code):
        raise ValueError("submission must define act(observation)")
    if not CREATE_LAYOUT_FUNCTION_RE.search(code):
        raise ValueError("submission must define create_layout()")


if __name__ == "__main__":
    main()
