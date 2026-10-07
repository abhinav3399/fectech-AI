@echo off
echo ===================================================
echo   Factech AI - Local Services Setup & Runner
echo ===================================================

echo.
echo [1] Starting 3D Model Service (using root venv)...
start cmd /k "venv\Scripts\python.exe -m uvicorn model_service.app:app --port 8800"

echo.
echo [2] Checking Voice Service (XTTS-v2)...
if not exist "voice_service\.venv" (
    echo Creating virtual environment for Voice Service...
    python -m venv voice_service\.venv
    echo Installing Voice Service dependencies...
    voice_service\.venv\Scripts\python.exe -m pip install -r voice_service\requirements.txt
)
echo Starting Voice Service...
start cmd /k "voice_service\.venv\Scripts\python.exe -m uvicorn voice_service.app:app --port 8810"

echo.
echo [3] Starting Main Backend on port 8010...
rem Expose only the API on LAN/VPN; keep the 3D worker loopback-only on port 8800.
set "MODEL_3D_PROVIDER=local"
set "MODEL_3D_URL=http://127.0.0.1:8800"
start cmd /k "venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8010"

echo.
echo [4] Starting Frontend...
cd frontend
start cmd /k "npm run dev"
cd ..

echo.
echo All services started in separate windows!
echo - Backend: http://localhost:8010
echo - Frontend: http://localhost:5173
echo - 3D Model Service: http://localhost:8800
echo - Voice Service: http://localhost:8810
pause
