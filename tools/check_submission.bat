@echo off
setlocal
set SUBMISSION=%~1
if "%SUBMISSION%"=="" set SUBMISSION=examples\basic_greedy_submission.py
if not exist outputs mkdir outputs
python tools\check_submission.py "%SUBMISSION%" --layout-out outputs\submission_layout.normalized.json
