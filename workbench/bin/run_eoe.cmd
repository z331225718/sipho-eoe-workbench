@echo off
setlocal
set HPEESOF_DIR=C:\Program Files\Keysight\ADS2027
set PYTHONPATH=C:\Program Files\Keysight\ADS2027\tools\python\Lib\site-packages
set PY=%HPEESOF_DIR%\tools\python\python.exe
if not exist "%PY%" set PY=C:\Users\z3312\AppData\Local\Python\bin\python.exe
cd /d "%~dp0.."
"%PY%" run_eoe.py %*
endlocal
