// On-device distress estimate (0..1) from voice prosody + conversation content. Pure function —
// hysteresis/cooldown live in the caller (AvatarPage). Multilingual cue sets (English / Hinglish-Latin / Devanagari).
const FEAR = [
    // English
    /want(?:ed)? to go home/i, /where am i/i, /who are you/i, /i'?m (?:scared|frightened|afraid)/i,
    /help me/i, /leave me alone/i, /it hurts|i'?m in pain/i, /don'?t leave/i, /i can'?t/i,
    // Hinglish (Latin)
    /ghar ja(?:ana|na)/i, /mujhe dar/i, /kaun ho tum/i, /madad/i, /dard ho/i, /akela|akeli/i,
    // Hindi (Devanagari)
    /घर जा/, /डर लग/, /कौन हो/, /मदद/, /दर्द/, /अकेल/,
];

export function scoreDistress({ prosody = {}, text = '', recentUserTexts = [], hour = null } = {}) {
    // 1) Prosody: anxious voice = louder + higher pitch + more jitter + broken/paused speech.
    const pros = clamp01(
        0.35 * (prosody.rms || 0) +
        0.30 * (prosody.pitchVar || 0) +
        0.20 * pitchHigh(prosody.pitchHz) +
        0.15 * (prosody.longPauseRatio || 0)
    );
    // 2) Content: fear/pain words (any language) + repeating the same thing over and over.
    let kw = 0;
    for (const re of FEAR) { if (re.test(text)) { kw = 1; break; } }
    const content = clamp01(0.7 * kw + 0.5 * repetition(text, recentUserTexts));
    // 3) Fuse, then weight up in the late-afternoon/evening "sundowning" window.
    let score = clamp01(0.55 * content + 0.45 * pros);
    const h = (hour == null ? new Date().getHours() : hour);
    if (h >= 16 && h <= 23) score = clamp01(score * 1.25);
    return score;
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function pitchHigh(hz) { return hz ? clamp01((hz - 180) / 160) : 0; } // trends anxious above ~180Hz

function repetition(text, recent) {
    const t = norm(text);
    if (!t || t.length < 6) return 0;
    let hits = 0;
    for (const r of (recent || []).slice(-5)) if (similar(t, norm(r))) hits++;
    return clamp01(hits / 2);
}
function norm(s) { return (s || '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim(); }
function similar(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const sa = new Set(a.split(/\s+/)), sb = new Set(b.split(/\s+/));
    let inter = 0; for (const w of sa) if (sb.has(w)) inter++;
    return inter / Math.max(sa.size, sb.size) > 0.7;
}
