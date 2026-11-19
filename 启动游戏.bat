@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 serve.py --open
goto finished
:use_python
where python >nul 2>nul
if errorlevel 1 goto missing
python serve.py --open
goto finished
:missing
echo 请先安装 Python 3.9 或更新版本，并勾选 Add Python to PATH。
:finished
pause
