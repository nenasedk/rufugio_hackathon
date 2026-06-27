@echo off
setlocal
set LAYOUT=%~1
if "%LAYOUT%"=="" set LAYOUT=layouts\canonical_layout.json
if not exist outputs mkdir outputs
python -m warehouse.validate_layout "%LAYOUT%" --normalized-out outputs\layout.normalized.json
