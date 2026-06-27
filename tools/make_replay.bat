@echo off
setlocal
set SUBMISSION=%~1
if "%SUBMISSION%"=="" set SUBMISSION=examples\basic_greedy_submission.py
if "%REFUGIO_SEEDS%"=="" set REFUGIO_SEEDS=round-0,round-1,round-2
if "%REFUGIO_TICKS%"=="" set REFUGIO_TICKS=300
if "%REFUGIO_POLICY_BUDGET_SECONDS%"=="" set REFUGIO_POLICY_BUDGET_SECONDS=180
if not exist outputs mkdir outputs
if not exist runtime\replays mkdir runtime\replays
python -m warehouse.eval_runner "%SUBMISSION%" --submission-id local --team-name local --seeds "%REFUGIO_SEEDS%" --ticks "%REFUGIO_TICKS%" --replay-seed round-0 --policy-budget-seconds "%REFUGIO_POLICY_BUDGET_SECONDS%" --result-out outputs\result.json --replay-out runtime\replays\replay.json
copy /Y runtime\replays\replay.json outputs\replay.json >nul
echo Wrote outputs\result.json, outputs\replay.json, and runtime\replays\replay.json
echo Run: python tools\serve_viewer.py
