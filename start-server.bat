@echo off
cd /d "%~dp0"
start "Design Mode Server :5601" python -m http.server 5601
