# Factech AI — launch all dev services, each in its own window. Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File scripts\dev_start.ps1
# Open http://localhost:5173 once they're up (~40-60s while models load).
$root = Split-Path -Parent $PSScriptRoot   # repo root (scripts\..)
Set-Location $root

function Start-Svc($title, $cmd) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command",
        "`$Host.UI.RawUI.WindowTitle='$title'; Set-Location '$root'; $cmd"
    Write-Host "  started: $title"
}

Write-Host "Launching Factech AI services from $root ..."
Start-Svc "Factech: Backend 8010"    "venv\Scripts\python.exe -m uvicorn app.main:app --port 8010"
Start-Svc "Factech: Model3D 8800"    "venv\Scripts\python.exe -m uvicorn model_service.app:app --port 8800"
Start-Svc "Factech: OpenVoice 8811"  "voice_service_ov\.venv\Scripts\python.exe -m uvicorn voice_service_ov.app:app --port 8811"
Start-Svc "Factech: XTTS 8810"       "voice_service\.venv\Scripts\python.exe -m uvicorn voice_service.app:app --port 8810"
Start-Svc "Factech: Frontend 5173"   "Set-Location frontend; npm run dev"

Write-Host ""
Write-Host "All 5 services launching in separate windows."
Write-Host "Give them ~40-60s (models load), then open  http://localhost:5173"
Write-Host "Health checks: 8010/health  8800/health  8810/health  8811/health"
