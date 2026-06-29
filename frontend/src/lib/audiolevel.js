// Live speech amplitude (0..1) from the avatar's TTS audio, so the 3D head can
// "talk" — its motion is driven by the actual voice while it speaks.
// One shared AudioContext + AnalyserNode; each TTS <audio> element is routed
// through it (source -> analyser -> destination, so it stays audible).
let ctx = null;
let analyser = null;
let data = null;
let level = 0;
let running = false;
const attached = new WeakSet();

function ensure() {
    if (ctx) return true;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    try {
        ctx = new AC();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.65;
        data = new Uint8Array(analyser.frequencyBinCount);
        analyser.connect(ctx.destination);
        return true;
    } catch (e) { ctx = null; return false; }
}

function loop() {
    if (!analyser) { running = false; return; }
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / (data.length * 255); // 0..1
    level = level * 0.7 + avg * 0.3;        // smooth; decays to 0 on silence
    requestAnimationFrame(loop);
}

// Route a TTS <audio> element through the analyser so we can read its level.
export function attachAudio(audioEl) {
    try {
        if (!audioEl || attached.has(audioEl) || !ensure()) return;
        if (ctx.state === 'suspended') ctx.resume();
        ctx.createMediaElementSource(audioEl).connect(analyser);
        attached.add(audioEl);
        if (!running) { running = true; requestAnimationFrame(loop); }
    } catch (e) { /* unsupported, or element already connected — ignore */ }
}

export function getLevel() { return level; }

// --- Lip-sync signal -------------------------------------------------------
// Turn the live voice into a mouth shape: `open` (how far the jaw drops, from
// low/voiced energy) and `wide` (lip spread, from high/formant energy). Smoothed
// with a fast-attack / slower-release envelope so the mouth doesn't buzz.
let mOpen = 0, mWide = 0, mRound = 0, mLast = 0;

export function getMouthSignal() {
    if (!analyser || !data || !ctx) return { open: 0, wide: 0, round: 0 };
    const binHz = ctx.sampleRate / analyser.fftSize;           // Hz per FFT bin
    const bin = (hz) => Math.max(1, Math.min(data.length - 1, Math.round(hz / binHz)));
    const band = (lo, hi) => {
        let s = 0, c = 0;
        for (let i = bin(lo); i <= bin(hi); i++) { s += data[i]; c++; }
        return c ? s / (c * 255) : 0;                          // 0..1
    };
    const lowE = band(280, 1400);                              // vowels / voiced -> open
    const highE = band(1600, 3600);                            // fricatives / spread

    // voiced energy -> open: subtract noise floor, apply gain, hard clamp to 1, then a
    // DEADZONE so a quiet/closed mouth stays FULLY closed (no idle flutter or buzz).
    let openT = (lowE - 0.05) * 2.6;
    openT = openT < 0 ? 0 : openT > 1 ? 1 : openT;
    const DEAD = 0.06;
    openT = openT < DEAD ? 0 : (openT - DEAD) / (1 - DEAD);
    const tot = lowE + highE;
    let wideT = tot > 0.08 ? highE / tot : 0;
    wideT = (wideT > 1 ? 1 : wideT) * openT;                   // spread (ee/s), 0 when closed
    // ROUND (oo/m/w): voiced energy concentrated LOW with little high-band -> pursed lips.
    let roundT = (lowE - highE) * 3;
    roundT = roundT < 0 ? 0 : roundT > 1 ? 1 : roundT;
    roundT *= openT;                                           // only when the mouth is open

    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = mLast ? Math.min(100, now - mLast) : 16; mLast = now;
    const kAttack = 1 - Math.exp(-dt / 30);                    // ~30ms open
    const kRelease = 1 - Math.exp(-dt / 120);                  // ~120ms close
    mOpen += (openT - mOpen) * (openT > mOpen ? kAttack : kRelease);
    mWide += (wideT - mWide) * (wideT > mWide ? kAttack : kRelease);
    mRound += (roundT - mRound) * (roundT > mRound ? kAttack : kRelease);
    return { open: mOpen, wide: mWide, round: mRound };
}
