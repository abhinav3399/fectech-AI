# Factech AI Desktop Architecture

Factech AI remains the existing React/Vite frontend and Python/FastAPI application. Electron is only the Windows shell.

## Runtime

- Electron main process starts two existing local services on free loopback ports: `app.main` and `model_service.app`.
- FastAPI serves `frontend/dist` as the production single-origin UI, so the existing `/api/v1` calls and `/static` model URLs remain unchanged.
- `MODEL_3D_URL` is assigned to the dynamically selected model-service port.
- The existing voice workers, Ollama, and optional DECA remain external/optional services. Their existing configuration is preserved; this shell does not bundle restricted DECA checkpoints or Ollama.
- User data and desktop logs use Electron's `%APPDATA%/Factech AI` directory.

## Security

`contextIsolation`, `sandbox`, and `nodeIntegration: false` are enabled. The preload bridge exposes only backend URL, service status, and retry operations. Renderer code receives no filesystem, process, shell, or child-process API.

## Packaging

`desktop/build-python.ps1` creates `backend.exe` and `model.exe` with PyInstaller. `electron-builder` then produces NSIS and portable Windows artifacts. `.env` is never packaged. DECA assets remain user-provided because their checkpoints have separate licensing/distribution requirements.

## Development

```powershell
npm install
npm run frontend:dev
npm run desktop:dev
```

## Windows release

```powershell
npm run desktop:build
npm run desktop:dist
```

The output is written to `release/`. A clean release machine needs the packaged Python executables and model assets; Ollama and optional voice/DECA workers are detected through their existing local configuration.