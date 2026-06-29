"""OpenVoice v2 engine — MeloTTS base voice + tone-color converter.

The FAST local clone path (~4s/sentence on CPU, ~4x quicker than XTTS and scales
linearly — no autoregressive blow-up). English only (incl. Indian accent); Hindi
stays on the XTTS worker. Same worker contract as voice_service:
  clone(audio_bytes, name) -> voice_id      (extract the reference's tone-color embedding)
  synth(text, voice_id)    -> mp3 bytes      (MeloTTS speaks, converter morphs to the clone)

Audio in/out normalized with the bundled imageio-ffmpeg, so no system ffmpeg needed.
"""
import io
import os
import json
import hashlib
import subprocess
import threading

import numpy as np
import soundfile as sf
import imageio_ffmpeg

from .config import cfg

_FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

_conv = None          # ToneColorConverter
_melo = None          # MeloTTS base
_spk_id = None        # base speaker id
_src_se = None        # base voice's source speaker-embedding (constant — precomputed once)
_load_lock = threading.Lock()
_infer_lock = threading.Lock()   # serialize inference (not reentrant)
_se_cache = {}        # voice_id -> target speaker-embedding tensor


def is_loaded() -> bool:
    return _conv is not None and _melo is not None


def _load():
    """Lazy, thread-safe load of the converter + MeloTTS (+ precompute the base SE)."""
    global _conv, _melo, _spk_id, _src_se
    if is_loaded():
        return
    with _load_lock:
        if is_loaded():
            return
        import openvoice_cli
        from openvoice_cli.api import ToneColorConverter
        from openvoice_cli.downloader import download_checkpoint

        pkg = os.path.dirname(openvoice_cli.__file__)
        ck = os.path.join(pkg, "checkpoints", "converter")
        if not os.path.exists(os.path.join(ck, "checkpoint.pth")):
            os.makedirs(ck, exist_ok=True)
            download_checkpoint(ck)
        conv = ToneColorConverter(os.path.join(ck, "config.json"), device=cfg.DEVICE)
        conv.load_ckpt(os.path.join(ck, "checkpoint.pth"))

        from melo.api import TTS as Melo

        melo = Melo(language="EN", device=cfg.DEVICE)
        s2i = melo.hps.data.spk2id
        keys = list(s2i.keys())
        spk_id = s2i[cfg.SPEAKER] if cfg.SPEAKER in keys else s2i[keys[0]]

        # The base voice never changes, so its source embedding is constant — compute once.
        os.makedirs(cfg.VOICES_DIR, exist_ok=True)
        base = os.path.join(cfg.VOICES_DIR, "_base.wav")
        melo.tts_to_file("Hello, this is a short calibration line.", spk_id, base, speed=1.0)
        src_se = conv.extract_se([base])

        _conv, _melo, _spk_id, _src_se = conv, melo, spk_id, src_se


def warmup():
    try:
        _load()
    except Exception as e:  # never crash the service on a warmup hiccup
        print(f"[ov] warmup failed (will retry on first request): {e}")


def _ffmpeg(args, raw: bytes, what: str) -> bytes:
    p = subprocess.run(
        [_FFMPEG, "-hide_banner", "-loglevel", "error", *args],
        input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if p.returncode != 0 or not p.stdout:
        raise RuntimeError(f"{what} failed: {p.stderr.decode('utf-8', 'ignore')[:300]}")
    return p.stdout


def _to_wav_16k_mono(raw: bytes) -> bytes:
    return _ffmpeg(["-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"], raw, "audio decode")


def clone(audio_raw: bytes, name: str = "") -> str:
    """Extract + store the reference's tone-color embedding; return a stable voice_id."""
    import torch

    _load()
    wav = _to_wav_16k_mono(audio_raw)
    data, sr = sf.read(io.BytesIO(wav))
    if len(data) < sr * 1.0:
        raise RuntimeError("Sample too short — record a few seconds of clear speech.")

    voice_id = hashlib.sha1(wav).hexdigest()[:16]
    os.makedirs(cfg.VOICES_DIR, exist_ok=True)
    wpath = os.path.join(cfg.VOICES_DIR, f"{voice_id}.wav")
    with open(wpath, "wb") as f:
        f.write(wav)
    with _infer_lock:
        se = _conv.extract_se([wpath])
    torch.save(se, os.path.join(cfg.VOICES_DIR, f"{voice_id}.se.pth"))
    with open(os.path.join(cfg.VOICES_DIR, f"{voice_id}.json"), "w", encoding="utf-8") as f:
        json.dump({"voice_id": voice_id, "name": name}, f, ensure_ascii=False)
    _se_cache[voice_id] = se
    return voice_id


def synth(text: str, voice_id: str, language: str = None) -> bytes:
    """Speak `text` in the cloned voice. Returns MP3 bytes."""
    import torch

    _load()
    if voice_id not in _se_cache:
        sep = os.path.join(cfg.VOICES_DIR, f"{voice_id}.se.pth")
        if not os.path.exists(sep):
            raise FileNotFoundError(f"unknown voice_id {voice_id}")
        _se_cache[voice_id] = torch.load(sep)
    tgt_se = _se_cache[voice_id]

    base = os.path.join(cfg.VOICES_DIR, f"_b_{voice_id}.wav")
    out = os.path.join(cfg.VOICES_DIR, f"_o_{voice_id}.wav")
    with _infer_lock:
        _melo.tts_to_file(text, _spk_id, base, speed=1.0)
        _conv.convert(audio_src_path=base, src_se=_src_se, tgt_se=tgt_se, output_path=out)
    with open(out, "rb") as f:
        wav_bytes = f.read()
    return _wav_to_mp3(wav_bytes)


def _wav_to_mp3(wav_bytes: bytes) -> bytes:
    return _ffmpeg(
        ["-i", "pipe:0", "-codec:a", "libmp3lame", "-qscale:a", "4", "-f", "mp3", "pipe:1"],
        wav_bytes, "mp3 encode",
    )
