# Factech AI — Android APK Implementation Plan

**Generated**: 2026-09-25  
**Status**: Diagnosis complete, ready for implementation

---

## A. Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Android APK                           │
│  Capacitor WebView (ai.factech.android)                 │
│  minSdk=24  compileSdk=36  targetSdk=36                 │
│                                                         │
│  React 19 / Vite SPA (frontend/dist → assets/public)   │
│  ├── App.jsx            — router + reminder checker     │
│  ├── AvatarPage.jsx     — main chat + avatar UI         │
│  ├── lib/offlineAi.js   — Transformers.js WASM fallback │
│  ├── lib/localDb.js     — CapacitorSQLite local storage │
│  └── lib/store.js       — Zustand global state          │
│                                                         │
│  MainActivity.java = BridgeActivity (zero custom code)  │
└────────────────────────────┬────────────────────────────┘
                             │ HTTP (LAN WiFi)
                             │ VITE_API_BASE_URL=http://10.x.x.x:8010/api/v1
                             ▼
┌─────────────────────────────────────────────────────────┐
│              FastAPI Backend (PC, port 8010)             │
│  app/api/persona_endpoint.py  — /persona/chat           │
│  app/api/chat_endpoint.py     — /chat/query             │
│  app/services/llm_service.py  — Groq + Ollama           │
│  app/services/mesh_service.py — Meshy/Replicate/Local   │
│  app/services/tts_service.py  — Edge-TTS neural voices  │
│  app/services/voice_clone_service.py — XTTS/ElevenLabs  │
│  factech.db (SQLite)                                     │
└─────────────────────────────────────────────────────────┘
```

### Key Files

| File | Role |
|------|------|
| `frontend/src/pages/AvatarPage.jsx` | Chat UI (1354 lines), all voice/TTS logic |
| `frontend/src/lib/offlineAi.js` | Transformers.js fallback (`LaMini-Flan-T5-77M`) |
| `frontend/src/lib/localDb.js` | CapacitorSQLite wrapper — state persistence |
| `frontend/src/lib/store.js` | Zustand — profile/persona/reminders/memories |
| `app/services/llm_service.py` | Groq (cloud, free tier) + Ollama (local PC) |
| `app/services/mesh_service.py` | 3D: Meshy/Replicate/Local (all cloud or local PC) |
| `capacitor.config.json` | `webDir=dist`, `androidScheme=http` |
| `frontend/.env.android` | `VITE_API_BASE_URL=http://10.39.126.205:8010/api/v1` |

---

## B. Why Chat Is Currently Not Working on Android

### Root Cause #1 — Network Dependency (PRIMARY)

The APK calls the backend at a **hardcoded LAN IP**: `http://10.39.126.205:8010/api/v1`

This works ONLY when:
- The phone and PC are on **the exact same WiFi network**
- The PC is running the FastAPI backend on port 8010
- The PC's IP happens to be `10.39.126.205`

**On any other network, at any other location, or with no backend running → chat fails silently.**  
The error appears as: `"AI service unavailable. Please try again."`

### Root Cause #2 — Missing Groq API Key

```python
# app/services/llm_service.py
self.api_key = settings.GROQ_API_KEY or os.getenv("GROQ_API_KEY")
```

`.env` shows: `GROQ_API_KEY=`  (empty)

Without a key, `self.client = None`. The code then tries Ollama:

```python
OLLAMA_URL: str = "http://127.0.0.1:11434"
OLLAMA_ENABLED: bool = True
```

Ollama is on `127.0.0.1` — which on the Android phone resolves to the **phone itself**, not the PC. **Ollama is never reachable from the phone.**

### Root Cause #3 — Offline Fallback Fails to Download

The offline fallback `LaMini-Flan-T5-77M` (via `@huggingface/transformers`) downloads from HuggingFace on first use. This requires internet. The model is ~77M but the WebView cache in Capacitor may have storage/CORS issues depending on device.

```javascript
// offlineAi.js
env.useBrowserCache = true;
// pipeline('text2text-generation', OFFLINE_MODEL, { device: 'wasm' })
```

This works in browser but on Android WebView the WASM device + large file download can fail or be very slow.

### Root Cause #4 — TTS Also Fails Without Backend

The `speak()` function calls `${API_BASE}/tts` → same LAN-only issue. The browser SpeechSynthesis fallback **does** work on Android (using device TTS) so the avatar will eventually say something, but only after the network timeout.

### Root Cause #5 — The `AvatarPage` mode defaults to `'3d'` without a face image

```javascript
// AvatarPage.jsx line 39
const [mode, setMode] = useState(persona?.faceImage ? 'talk' : '3d');
```

Without a generated `.glb` model, `Avatar3D` shows: *"No generated 3D model yet."* — the chat still works below, but the avatar area is broken.

### Summary of Failures

| Issue | Impact |
|-------|--------|
| Hardcoded LAN IP in `.env.android` | Chat fails off home network |
| No Groq API key | Cloud LLM unavailable |
| Ollama on 127.0.0.1 | Never reachable from phone |
| WASM download on first use | Offline fallback slow/fails |
| TTS backend dependency | Voice fails same as chat |
| No `.glb` model | Avatar 3D area broken |

---

## C. Recommended Free/Local LLM Architecture

### Immediate Fix (Phase 1): Add Free Groq Key

Groq offers a **completely free tier** with high rate limits:
- `llama-3.3-70b-versatile`: 6000 tokens/min free
- `llama-3.1-8b-instant`: 30000 tokens/min free

The backend already has all Groq code. Just needs `GROQ_API_KEY=gsk_...` in `.env`.

**The APK will work from any network** as long as the PC backend is reachable, OR we deploy the backend to the cloud (Render/Railway free tier).

### Long-term (Phase 2): True On-Device LLM via Transformers.js

The project already has `@huggingface/transformers` v3.7.2. Upgrade the offline model:

```
Current:  Xenova/LaMini-Flan-T5-77M   — too small, poor conversation
Upgrade:  Xenova/Qwen2.5-1.5B-Instruct — 1.5B, excellent chat, ~900MB
          Xenova/SmolLM2-1.7B-Instruct  — 1.7B, fast, ~1GB
          Xenova/Phi-3-mini-4k-instruct  — 3.8B, best quality, ~2.3GB (warn user)
```

Architecture:
```
React UI (AvatarPage)
    ↓ navigator.onLine check
    ├── Online → API_BASE/persona/chat (backend)
    └── Offline / aiMode=offline
            ↓
        offlineAi.js (Transformers.js WASM)
            ↓
        Qwen2.5-1.5B-Instruct (cached in WebView IndexedDB)
            ↓
        Streaming tokens → chat display
```

### Phase 3: Ollama Local LAN Bridge (Optional)

For power users who run Ollama on their PC:

```
Settings → AI Provider → "Local (Ollama)"
    ↓
Enter PC IP (auto-discover via mDNS)
    ↓
http://<PC_IP>:11434/api/chat
    ↓
Any Ollama model (llama3.2, mistral, etc.)
```

---

## D. Local Storage Architecture

Already partially implemented via `@capacitor-community/sqlite`. Needs expansion:

### Current Schema (localDb.js)
- `app_state` — full Zustand state blob (JSON)
- `users`, `personas`, `conversations`, `messages`
- `memories`, `reminders`, `family_contacts`
- `settings`, `sync_queue`

### New Tables Required

```sql
-- Downloaded AI models registry
CREATE TABLE ai_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hf_id TEXT NOT NULL,           -- HuggingFace model ID
  size_bytes INTEGER,
  status TEXT DEFAULT 'not_installed',  -- downloading|installed|failed
  progress_pct REAL DEFAULT 0,
  downloaded_at TEXT,
  is_default INTEGER DEFAULT 0
);

-- Generated 3D avatars (file paths, not blobs)
CREATE TABLE avatars (
  id TEXT PRIMARY KEY,
  name TEXT,
  original_image_path TEXT,      -- /data/user/0/.../files/avatars/original/<id>.jpg
  model_path TEXT,               -- /data/user/0/.../files/avatars/models/<id>.glb
  thumbnail_path TEXT,           -- /data/user/0/.../files/avatars/thumbnails/<id>.jpg
  model_type TEXT DEFAULT 'glb',
  processing_mode TEXT,          -- on-device | local-network | cloud
  created_at TEXT,
  updated_at TEXT,
  is_active INTEGER DEFAULT 0
);

-- Per-conversation chat history (not just state blob)
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT,
  updated_at TEXT,
  message_count INTEGER DEFAULT 0
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES chat_sessions(id),
  role TEXT NOT NULL,            -- user | assistant
  content TEXT NOT NULL,
  model_used TEXT,
  tokens INTEGER,
  created_at TEXT
);
```

### File Storage Layout

```
/data/user/0/ai.factech.android/files/
├── avatars/
│   ├── original/      ← full resolution input photos
│   ├── generated/     ← generated .glb model files
│   └── thumbnails/    ← 256x256 JPG previews
├── memories/          ← attached images from memory cards
├── voice/             ← recorded voice samples
├── models/            ← downloaded AI model shards (GGUF or WASM)
└── exports/           ← user-requested data exports
```

Access via `@capacitor/filesystem` (already in Capacitor ecosystem).

---

## E. Image → 3D Avatar Architecture

### Current State

The backend has `mesh_service.py` with three providers:
- **Meshy** — needs paid `MESHY_API_KEY`
- **Replicate** — needs paid `REPLICATE_API_TOKEN`
- **Local** — needs self-hosted GPU at `MODEL_3D_URL`

**None of these work without payment or a GPU server.**

### Recommended Architecture

#### Option A: Free Replicate Trial Credits (Quick Win)

Replicate gives free credits on signup (~$5-10). The `ndreca/hunyuan3d-2` model is already configured. This is the fastest path.

```
User selects image
    ↓
Backend: POST /api/v1/mesh/submit (data-URI)
    ↓
Replicate API → HunyuanD-2 (GPU cloud)
    ↓
GLB URL returned
    ↓
Backend downloads GLB → /static/models/<id>.glb
    ↓
APK renders via Avatar3D.jsx (Three.js/R3F already working)
```

#### Option B: On-Device Lightweight 3D (No Cloud Needed)

Use **TripoSR** or **Zero123++** via Transformers.js (WebAssembly):

```
User Photo
    ↓
Foreground segmentation (MediaPipe Selfie Segmentation — already used in project)
    ↓
Depth estimation (MiDaS small — ~50MB ONNX via @huggingface/transformers)
    ↓
Point cloud → mesh reconstruction (custom Three.js geometry)
    ↓
Texture projection from original photo
    ↓
Export as in-memory GLB (three-mesh-bvh + GLTFExporter)
    ↓
Save to device storage
    ↓
Avatar3D renders it
```

This produces a lower-quality mesh but works **100% offline** with no API keys.

#### Option C: Hybrid (Recommended for Production)

```
"Generate Avatar" button
    ↓
Check settings.avatarMode:
    ├── "on-device"   → Option B (offline, fast, lower quality)
    ├── "cloud"       → Option A (Replicate, needs internet+key)
    └── "auto"        → try cloud if available, fall back to on-device
    
Always show: 🔒 On Device | ☁ Cloud indicator
Never silently send photos to cloud.
```

### New Frontend Component: AvatarCreator.jsx

```
AvatarCreator
├── Step 1: ImagePicker (gallery / camera)
├── Step 2: ImageCropper (crop to face)
├── Step 3: ProcessingMode selector (On-Device / Cloud)
├── Step 4: Progress (Preparing → Segmenting → Generating → Loading)
├── Step 5: Preview (Three.js viewer — rotate/zoom)
└── Step 6: Save / Set as Active
```

---

## F. Android Dependencies Required

### Already Present (no changes needed)
```
@capacitor/core ^8.5.0
@capacitor/android ^8.5.0
@capacitor/app ^8.1.1
@capacitor-community/sqlite ^8.1.1
@react-three/fiber ^9.5.0
@react-three/drei ^10.7.7
three ^0.182.0
@huggingface/transformers ^3.7.2
@mediapipe/tasks-vision ^0.10.x  (recently added)
framer-motion ^12.27.5
```

### New npm Packages Needed

```json
"@capacitor/filesystem": "^8.x",
"@capacitor/camera": "^8.x",
"@capacitor/preferences": "^8.x",
"three-mesh-bvh": "^0.8.x"
```

### New Android Gradle Dependencies
None — Capacitor handles everything via WebView.

### AndroidManifest Changes Needed
```xml
<!-- Already present, verify: -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />

<!-- Add for file access: -->
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
    android:maxSdkVersion="28"/>
```

---

## G. Files That Need Modification

### Priority 1 — Fix Chat (1-2 hours)

| File | Change |
|------|--------|
| `frontend/.env.android` | Make `VITE_API_BASE_URL` configurable at runtime, not build-time |
| `frontend/src/pages/SettingsPage.jsx` | Add "Server Address" field — user enters their PC's IP |
| `frontend/src/lib/store.js` | Store `serverUrl` in persistent state |
| `frontend/src/pages/AvatarPage.jsx` | Read `serverUrl` from store for API calls |
| `app/.env` | Add real `GROQ_API_KEY=gsk_...` |

### Priority 2 — Better Offline AI (2-4 hours)

| File | Change |
|------|--------|
| `frontend/src/lib/offlineAi.js` | Upgrade model + add streaming + progress UI |
| `frontend/src/pages/SettingsPage.jsx` | Add "AI Models" section with download manager |
| `frontend/src/lib/localDb.js` | Add `ai_models` table |

### Priority 3 — 3D Avatar Creation (4-8 hours)

| File | Change |
|------|--------|
| `frontend/src/components/AvatarCreator.jsx` | **NEW** — full image→3D workflow |
| `frontend/src/components/OnDeviceMesh.jsx` | **NEW** — depth+mesh on device |
| `frontend/src/lib/localDb.js` | Add `avatars` table |
| `frontend/src/pages/SettingsPage.jsx` | Add "Avatar Library" section |
| `frontend/src/pages/AvatarPage.jsx` | Hook up AvatarCreator |

### Priority 4 — Persistent Chat History (2-3 hours)

| File | Change |
|------|--------|
| `frontend/src/lib/localDb.js` | Add `chat_sessions` + `chat_messages` tables |
| `frontend/src/components/ChatHistory.jsx` | **NEW** — session list + search |
| `frontend/src/pages/AvatarPage.jsx` | Save/load chat sessions |

### Priority 5 — Storage Management (1-2 hours)

| File | Change |
|------|--------|
| `frontend/src/pages/SettingsPage.jsx` | Add Storage section with usage breakdown |
| `frontend/src/lib/storageManager.js` | **NEW** — calculate usage, clear cache |

---

## H. Files That Should NOT Be Modified

| File | Reason |
|------|--------|
| `frontend/android/app/src/main/java/ai/factech/android/MainActivity.java` | Capacitor handles everything, no custom code needed |
| `frontend/android/app/build.gradle` | Working, no changes unless adding native libs |
| `frontend/android/variables.gradle` | SDK versions are correct |
| `frontend/android/app/src/main/AndroidManifest.xml` | Only add storage permission if needed |
| `app/services/llm_service.py` | Already well-architected; just add Groq key |
| `app/services/mesh_service.py` | Well-designed pluggable architecture |
| `app/api/persona_endpoint.py` | Fully working on backend side |
| `frontend/src/components/Avatar3D.jsx` | Works correctly; Three.js/R3F |
| `frontend/src/components/TalkingPhoto.jsx` | Works correctly; custom WebGL |
| `frontend/src/lib/audiolevel.js` | Audio analysis working |
| `frontend/src/lib/prosody.js` | Prosody/distress working |
| `frontend/capacitor.config.json` | Working configuration |

---

## I. Build & Testing Plan

### Phase 1 — Fix Chat NOW (Today)

**Step 1**: Get free Groq API key from [console.groq.com](https://console.groq.com)

**Step 2**: Add to `.env`:
```
GROQ_API_KEY=gsk_YOUR_KEY_HERE
```

**Step 3**: Add runtime-configurable server URL in Settings:
```javascript
// Settings → "Backend Server" → text field
// Default: http://<last-used-ip>:8010/api/v1
// Stored in localStorage + SQLite
```

**Step 4**: Build and deploy:
```powershell
cd frontend
npm run build:android
npx cap sync android
# Open Android Studio → Run on device
```

**Step 5**: On phone: Settings → Backend Server → enter PC IP → Chat works.

### Phase 2 — Better Offline LLM (This Week)

```powershell
# Frontend: upgrade offline model
npm run build:android && npx cap sync android
```

Test: Enable "Offline Mode" in settings → Chat should work without backend.

### Phase 3 — 3D Avatar Creation (Next Week)

```powershell
# Install new packages
cd frontend
npm install @capacitor/filesystem @capacitor/camera

# Build and test
npm run build:android && npx cap sync android
```

Test: Avatar tab → "Create 3D Avatar" → select photo → generates mesh → saves to device.

### Phase 4 — Full APK Build

```powershell
cd frontend
npm run build:android
npx cap sync android
# In Android Studio: Build → Generate Signed APK
```

### Testing Checklist

```
[ ] App launches without crash
[ ] Onboarding completes successfully
[ ] Avatar page opens with talking photo / 3D head
[ ] Chat: type message → AI responds
[ ] Chat: works on WiFi with backend running
[ ] Chat: works offline with downloaded local model
[ ] Voice: mic → STT → chat → TTS speaks back
[ ] Reminders: create → notification fires
[ ] Memories: add photo → saved locally
[ ] Settings: change server URL → chat uses new URL
[ ] Avatar: create 3D from photo → saves → displays
[ ] App restarts → all data preserved
[ ] No crash on screen rotation
[ ] Keyboard opens → chat input remains visible
[ ] Back button: goes to home → second press exits
[ ] Offline banner shows when no network
```

---

## Quick Fix Summary

The single fastest fix to make chat work on Android:

1. **Add Groq API key to `.env`** — free from console.groq.com
2. **Add a "Server URL" field in Settings** — user types their PC's IP once
3. **Build APK** — chat works on any WiFi

Total time: ~2 hours.

The offline LLM upgrade (Transformers.js with Qwen2.5-1.5B) will make chat work anywhere, any time, with no backend required — but requires ~1GB download on first use.

