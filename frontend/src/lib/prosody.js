// Patient-VOICE prosody for the Distress Watch. A SEPARATE microphone AnalyserNode — NOT the
// TTS-output analyser in audiolevel.js (that one reads the avatar's own voice). Returns smoothed
// features only; raw audio is never recorded or stored. Runs at ~20Hz (cheap) during live calls.
let ctx = null, analyser = null, stream = null, td = null;
let running = false, sr = 44100, timer = 0;
let pitchBuf = [];
let voicedFrames = 0, totalFrames = 0, pauseFrames = 0;
let sm = { rms: 0, pitchHz: 0, pitchVar: 0, speechRate: 0, longPauseRatio: 0 };

export async function startProsody() {
    if (running) return true;
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || !navigator.mediaDevices?.getUserMedia) return false;
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        ctx = new AC(); sr = ctx.sampleRate;
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.4;
        td = new Float32Array(analyser.fftSize);
        ctx.createMediaStreamSource(stream).connect(analyser); // NOT connected to destination (no echo)
        running = true;
        tick();
        return true;
    } catch (e) { running = false; return false; }
}

export function stopProsody() {
    running = false;
    if (timer) { clearTimeout(timer); timer = 0; }
    try { stream?.getTracks().forEach((t) => t.stop()); } catch (e) { /* noop */ }
    try { ctx?.close(); } catch (e) { /* noop */ }
    ctx = analyser = stream = null;
    pitchBuf = []; voicedFrames = totalFrames = pauseFrames = 0;
    sm = { rms: 0, pitchHz: 0, pitchVar: 0, speechRate: 0, longPauseRatio: 0 };
}

export function getProsody() { return { ...sm }; }

// Reset the voiced/pause counters so speechRate/pauses reflect the LATEST utterance (call per turn).
export function resetProsodyWindow() { voicedFrames = totalFrames = pauseFrames = 0; }

function rms(buf) { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); }

// Autocorrelation fundamental-frequency estimate (70–400 Hz); 0 when unvoiced/quiet.
function pitchOf(buf) {
    if (rms(buf) < 0.01) return 0;
    const minLag = Math.floor(sr / 400), maxLag = Math.floor(sr / 70);
    let best = -1, bestLag = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let sum = 0;
        for (let i = 0; i < buf.length - lag; i += 2) sum += buf[i] * buf[i + lag]; // stride 2 = faster, fine for F0
        if (sum > best) { best = sum; bestLag = lag; }
    }
    return bestLag > 0 ? sr / bestLag : 0;
}

function tick() {
    if (!running || !analyser) { running = false; return; }
    analyser.getFloatTimeDomainData(td);
    const r = rms(td);
    const voiced = r > 0.015;
    totalFrames++; voiced ? voicedFrames++ : pauseFrames++;
    if (voiced) { const p = pitchOf(td); if (p > 0) { pitchBuf.push(p); if (pitchBuf.length > 40) pitchBuf.shift(); } }
    let pv = 0;
    if (pitchBuf.length > 4) {
        const m = pitchBuf.reduce((a, b) => a + b, 0) / pitchBuf.length;
        pv = Math.sqrt(pitchBuf.reduce((a, b) => a + (b - m) * (b - m), 0) / pitchBuf.length);
    }
    const target = {
        rms: Math.min(1, r * 6),
        pitchHz: pitchBuf.length ? pitchBuf[pitchBuf.length - 1] : 0,
        pitchVar: Math.min(1, pv / 60),
        speechRate: totalFrames ? voicedFrames / totalFrames : 0,
        longPauseRatio: totalFrames ? pauseFrames / totalFrames : 0,
    };
    for (const k of Object.keys(sm)) {
        const a = target[k] > sm[k] ? 0.4 : 0.08; // fast attack, slow release
        sm[k] += (target[k] - sm[k]) * a;
    }
    timer = setTimeout(tick, 50);
}
