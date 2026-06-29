"""XTTS-v2 voice-cloning engine — fully local, CPU, no API key.

Zero-shot cloning: we never *train* a voice. We keep a short, clean reference
clip per persona; XTTS conditions on it at synthesis time to speak any text in
that voice. So here "clone" == decode + validate + store the reference, and
"synth" == speak new text conditioned on it.

Audio in/out is normalized with a bundled ffmpeg (imageio-ffmpeg), so the
browser can hand us whatever MediaRecorder produced (webm/opus, mp3, m4a, wav)
and the rest of the app keeps receiving MP3 — no system ffmpeg required.
"""
import io
import os
import re
import json
import hashlib
import subprocess
import threading

# XTTS ships under Coqui's CPML license; agreeing here (before TTS is imported)
# avoids an interactive y/n prompt that would otherwise hang this headless
# service the first time the model loads.
os.environ.setdefault("COQUI_TOS_AGREED", "1")
# Pin BLAS/OMP to the 4 performance cores. XTTS's autoregressive GPT2 loop is latency-bound;
# spilling onto the 8 efficiency cores of this i5-1240P actually slows it down. Set before torch.
os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("MKL_NUM_THREADS", "4")

import numpy as np
import soundfile as sf
import imageio_ffmpeg

from .config import cfg

_FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
XTTS_SR = 24000  # XTTS-v2 synthesizes at 24kHz.

_model = None
_load_lock = threading.Lock()
_infer_lock = threading.Lock()  # XTTS inference isn't reentrant — serialize it.
_latents = {}  # voice_id -> (gpt_cond_latent, speaker_embedding); extracted once, reused every line.


def is_loaded() -> bool:
    return _model is not None


def _load_model():
    """Lazy, thread-safe load of XTTS-v2 (downloads ~1.8GB on first call)."""
    global _model
    if _model is not None:
        return _model
    with _load_lock:
        if _model is not None:
            return _model
        import torch

        # torch>=2.6 defaults torch.load(weights_only=True), which rejects the
        # non-tensor config objects baked into the XTTS checkpoint. Allowlist
        # them so the official weights load unchanged.
        try:
            from TTS.tts.configs.xtts_config import XttsConfig
            from TTS.tts.models.xtts import XttsAudioConfig, XttsArgs
            from TTS.config.shared_configs import BaseDatasetConfig

            torch.serialization.add_safe_globals(
                [XttsConfig, XttsAudioConfig, XttsArgs, BaseDatasetConfig]
            )
        except Exception:
            pass

        from TTS.api import TTS

        try:
            torch.set_num_threads(4)  # match OMP_NUM_THREADS -> pin to the P-cores
        except Exception:
            pass
        _model = TTS(cfg.MODEL).to(cfg.DEVICE)
        return _model


def warmup():
    """Load the model now (used at startup) so the first user request is fast."""
    try:
        _load_model()
    except Exception as e:  # never crash the service on a warmup hiccup
        print(f"[voice] warmup failed (will retry on first request): {e}")


def _ffmpeg(args, raw: bytes, what: str) -> bytes:
    p = subprocess.run(
        [_FFMPEG, "-hide_banner", "-loglevel", "error", *args],
        input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if p.returncode != 0 or not p.stdout:
        raise RuntimeError(f"{what} failed: {p.stderr.decode('utf-8', 'ignore')[:300]}")
    return p.stdout


def _to_wav_16k_mono(raw: bytes) -> bytes:
    """Decode any container the browser recorded -> 16kHz mono PCM wav."""
    return _ffmpeg(
        ["-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"],
        raw, "audio decode",
    )


def _wav_to_mp3(wav_bytes: bytes) -> bytes:
    return _ffmpeg(
        ["-i", "pipe:0", "-codec:a", "libmp3lame", "-qscale:a", "4", "-f", "mp3", "pipe:1"],
        wav_bytes, "mp3 encode",
    )


def _detect_language(text: str) -> str:
    # Devanagari -> Hindi; everything else (incl. Latin-script Hinglish) -> English.
    return "hi" if re.search(r"[ऀ-ॿ]", text or "") else "en"


def clone(audio_raw: bytes, name: str = "") -> str:
    """Store a reference clip; return a stable voice_id (sha1 of the clean wav)."""
    wav = _to_wav_16k_mono(audio_raw)
    data, sr = sf.read(io.BytesIO(wav))
    if len(data) < sr * 1.0:
        raise RuntimeError("Sample too short — record a few seconds of clear speech.")

    voice_id = hashlib.sha1(wav).hexdigest()[:16]
    os.makedirs(cfg.VOICES_DIR, exist_ok=True)
    with open(os.path.join(cfg.VOICES_DIR, f"{voice_id}.wav"), "wb") as f:
        f.write(wav)
    with open(os.path.join(cfg.VOICES_DIR, f"{voice_id}.json"), "w", encoding="utf-8") as f:
        json.dump({"voice_id": voice_id, "name": name}, f, ensure_ascii=False)
    return voice_id


def synth(text: str, voice_id: str, language: str = None) -> bytes:
    """Speak `text` in the cloned voice. Returns MP3 bytes."""
    ref = os.path.join(cfg.VOICES_DIR, f"{voice_id}.wav")
    if not os.path.exists(ref):
        raise FileNotFoundError(f"unknown voice_id {voice_id}")

    lang = language or _detect_language(text)
    model = _load_model()
    xtts = model.synthesizer.tts_model  # the underlying Xtts model (low-level inference API)
    with _infer_lock:
        # Extract the speaker conditioning ONCE per voice (the slow part) and cache it; every
        # subsequent line reuses it instead of re-deriving from the wav -> big CPU speedup.
        if voice_id not in _latents:
            _latents[voice_id] = xtts.get_conditioning_latents(audio_path=[ref])
        gpt_cond_latent, speaker_embedding = _latents[voice_id]
        out = xtts.inference(text, lang, gpt_cond_latent, speaker_embedding, enable_text_splitting=True)
        wav = out["wav"]

    buf = io.BytesIO()
    sf.write(buf, np.asarray(wav, dtype="float32"), XTTS_SR, format="WAV")
    return _wav_to_mp3(buf.getvalue())
