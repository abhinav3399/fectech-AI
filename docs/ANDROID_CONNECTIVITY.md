# Factech AI Android connectivity

## Configure the APK

Open **More → Settings → Backend connection**. Enter the base address of the FastAPI backend, tap **Test connection**, then **Save address**. The value is persisted in this app's local settings and takes precedence over the build-time `VITE_API_BASE_URL` default.

- For secure remote access, enter your HTTPS backend URL, e.g. `https://api.example.com`.
- For your own PC over a private VPN, enter the VPN-reachable PC address and API port, e.g. `http://100.x.y.z:8010` only if your VPN routes to it and permits this private HTTP traffic.
- A normal home-LAN address only works while the phone can route to the same LAN. The app does not create a public endpoint, VPN, tunnel, or hosted backend.

The **Test connection** action checks `GET /health`. It confirms the API is reachable; it does not check credentials/providers or start optional workers.

## Run without public hosting

On the Windows PC, run `start_local.bat`. It starts the main FastAPI API on port 8010 and the local 3D/voice workers. The main API binds to `0.0.0.0` so LAN/VPN clients can reach it; the 3D worker remains loopback-only and is contacted by the main API at `127.0.0.1:8800`. Keep port 8800 private; only route port 8010 through your private VPN. Windows Firewall must allow the API port on the relevant private network profile.

The launcher configures `MODEL_3D_PROVIDER=local` and `MODEL_3D_URL=http://127.0.0.1:8800` for the backend. The local image-to-3D service runs on the PC, not inside the APK. Its default pipeline is CPU-capable and produces an approximate model; the face-landmarker model, fallback pipeline, and optional Blender/AI dependencies affect quality and setup.

## Speech and service boundaries

When reachable, Factech AI continues to use backend neural/cloned TTS. If that request or audio playback fails, the APK speaks locally through the Android system TTS engine; enable/download a device voice under Android's text-to-speech settings if necessary. Local phone speech needs no backend. AI replies, memory operations, face recognition, family services, and image-to-3D still need a reachable API; the bundled small Transformers.js model can answer Talk messages after its first model download.

A hosted HTTPS endpoint or private VPN solves network reachability only. It does not install or configure the FastAPI service, an LLM provider, or the 3D provider.
