import os
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2" # Suppress TF Info/Warnings
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from app.core.config import settings

# print("DEBUG: Importing API Router...", flush=True)
from app.api.endpoints import router as api_router 
# print("DEBUG: Importing Chat Endpoint...", flush=True)
from app.api import chat_endpoint
from app.api import persona_endpoint
from app.api import mesh_endpoint
from app.api import auth_endpoint
from app.api import reminders_endpoint
from app.db import init_db
# print("DEBUG: Imports Done.", flush=True)

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)


@app.on_event("startup")
def _startup():
    # Create the accounts/state tables if they don't exist yet (non-destructive).
    init_db()

# CORS — restricted allowlist (set ALLOWED_ORIGINS in .env). Wildcard "*" with
# credentials is both invalid per spec and unsafe for a health-data product.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files (for dashboard)
app.mount("/static", StaticFiles(directory="static", html=True), name="static")

# Include API router
app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(chat_endpoint.router, prefix=settings.API_V1_STR)
app.include_router(persona_endpoint.router, prefix=settings.API_V1_STR)
app.include_router(mesh_endpoint.router, prefix=settings.API_V1_STR)
app.include_router(auth_endpoint.router, prefix=settings.API_V1_STR)
app.include_router(reminders_endpoint.router, prefix=settings.API_V1_STR)


# Liveness + readiness. Registered before the SPA catch-all so it always wins.
@app.get("/health")
@app.get(f"{settings.API_V1_STR}/health")
def health():
    return {
        "status": "ok",
        "service": settings.PROJECT_NAME,
        "groq_configured": bool(settings.GROQ_API_KEY),
        "qdrant_mode": settings.QDRANT_MODE,
        "model_3d_provider": settings.MODEL_3D_PROVIDER,
    }

# --- Frontend Serving (Deployment) ---
# Check if frontend build exists (Render/Production)
if os.path.exists("frontend/dist"):
    app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="assets")
    _DIST = os.path.realpath("frontend/dist")
    _INDEX = os.path.join(_DIST, "index.html")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Let API calls fall through (they're handled by the routers above).
        if full_path.startswith("api"):
            return JSONResponse({"error": "Not Found"}, status_code=404)

        # Resolve the requested file and confirm it stays INSIDE dist (block path traversal
        # like ../../etc/passwd); otherwise serve index.html for SPA client-side routing.
        if "." in full_path:
            target = os.path.realpath(os.path.join(_DIST, full_path))
            if (target == _DIST or target.startswith(_DIST + os.sep)) and os.path.isfile(target):
                return FileResponse(target)
        return FileResponse(_INDEX)

@app.get("/")
def root():
    # If build exists, serve it
    if os.path.exists("frontend/dist/index.html"):
        return FileResponse("frontend/dist/index.html")
    return {"message": "Memory for the Forgotten API is running (Dev Mode)"}

@app.get("/report", response_class=HTMLResponse)
async def get_report_page():
    if os.path.exists("app/templates/report.html"):
        with open("app/templates/report.html", "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return {"error": "Report template not found"}
