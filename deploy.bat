@echo off
echo ==========================================
echo   Deploying Quran Digital to Cloudflare
echo ==========================================

echo.
echo [1/2] Deploying Backend (Workers)...
cd backend
call npm run deploy
if %ERRORLEVEL% NEQ 0 (
    echo Backend deployment failed!
    exit /b %ERRORLEVEL%
)
cd ..

echo.
echo [2/2] Building & Deploying Frontend (Pages)...
cd frontend
call npx ng build --configuration production
if %ERRORLEVEL% NEQ 0 (
    echo Frontend build failed!
    exit /b %ERRORLEVEL%
)

call npx wrangler pages deploy dist/frontend/browser --project-name=quran-digital
if %ERRORLEVEL% NEQ 0 (
    echo Frontend deployment failed!
    exit /b %ERRORLEVEL%
)
cd ..

echo.
echo ==========================================
echo   ✅ Deployment Success!
echo ==========================================
pause
