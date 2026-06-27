# Quickstart

From this folder:

```bash
python -m pip install -e .
python tools/check_submission.py examples/basic_greedy_submission.py
python -m warehouse.local_runner examples/basic_greedy_submission.py --seeds round-0,round-1,round-2 --ticks 300 --policy-budget-seconds 180
python -m warehouse.eval_runner examples/basic_greedy_submission.py --submission-id local --team-name local --seeds round-0,round-1,round-2 --ticks 300 --replay-seed round-0 --policy-budget-seconds 180 --result-out outputs/result.json --replay-out outputs/replay.json
```

Then run `python tools/serve_viewer.py` and open the printed localhost URL.

