@echo off
setlocal
set SUBMISSION=%~1
if "%SUBMISSION%"=="" set SUBMISSION=examples\basic_greedy_submission.py
if "%REFUGIO_SEEDS%"=="" set REFUGIO_SEEDS=round-0,round-1,round-2
if "%REFUGIO_TICKS%"=="" set REFUGIO_TICKS=300
if "%REFUGIO_POLICY_BUDGET_SECONDS%"=="" set REFUGIO_POLICY_BUDGET_SECONDS=180
python -m warehouse.local_runner "%SUBMISSION%" --seeds "%REFUGIO_SEEDS%" --ticks "%REFUGIO_TICKS%" --policy-budget-seconds "%REFUGIO_POLICY_BUDGET_SECONDS%"
