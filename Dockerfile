# --- Stage 1: build the React/Vite frontend ---
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Python backend that ALSO serves the built frontend ---
FROM python:3.11-slim
WORKDIR /app

# System libs needed by OpenCV / ffmpeg (Whisper) / pygame
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Python deps (heavy: TensorFlow + PyTorch + YOLO + Whisper)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Backend code + assets
COPY app/ ./app/
COPY static/ ./static/
COPY model.glb ./model.glb

# Built frontend from stage 1 (FastAPI serves it single-origin)
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Local embedded Qdrant (no external DB needed)
ENV QDRANT_MODE=local
ENV QDRANT_PATH=/app/qdrant_storage
# GROQ_API_KEY must be set as a platform secret/env var (never committed).

# Hugging Face Spaces defaults to 7860; Render/Railway inject $PORT.
ENV PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
