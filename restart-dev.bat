@echo off
echo === Quran Digital Dev Restart ===
echo.

echo [1/3] Killing old processes...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/3] Starting backend (port 8787)...
cd /d "%~dp0backend"
start "QuranDigital-Backend" cmd /c "npm run dev"

echo [3/3] Starting frontend (port 4200)...
cd /d "%~dp0frontend"
start "QuranDigital-Frontend" cmd /c "npm start"

echo.
echo ✓ Done! Open http://localhost:4200
echo.
pause
