@echo off
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5601 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo Servidor :5601 desligado.
timeout /t 1 >nul
