// Shared chat text hygiene.
//
// Small instruction-tuned models (and occasionally hosted ones) echo the role
// labels from their prompt template. That is how replies like
// "User: User: Time assistant User: Abhinav Panwar, Task Assistant." appear.
// These helpers remove template leakage and accidental duplication without
// rewriting legitimate content.

const LEADING_ROLE = /^\s*(?:user|assistant|ai|human|system|bot|time\s+assistant|task\s+assistant)\s*:\s*/i;
const SENTENCE_SPLIT = /(?<=[.!?।])\s+/;

export function sanitizeReply(raw) {
    let value = String(raw ?? '').trim();
    if (!value) return '';

    // Severe template leakage: several labels in one short reply means the model
    // echoed the prompt. Return nothing so the caller can retry or explain.
    const labelCount = (value.match(/\b(?:user|assistant|time\s+assistant|task\s+assistant)\s*:/gi) || []).length;
    if (labelCount >= 3 && value.length < 240) return '';

    // Strip a run of stacked role labels, e.g. "User: Assistant: User: ...".
    let previous;
    do {
        previous = value;
        value = value.replace(LEADING_ROLE, '').trim();
    } while (value !== previous && value);

    // Remove a trailing dangling label the model started to emit ("... Assistant:").
    value = value.replace(/\s*(?:user|assistant|bot)\s*:\s*$/i, '').trim();
    if (!value) return '';

    // Collapse consecutive duplicate sentences (case/whitespace-insensitive).
    const sentences = value.split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean);
    const out = [];
    let last = null;
    for (const sentence of sentences) {
        const key = sentence.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?।]+$/, '').trim();
        if (key && key === last) continue;
        out.push(sentence);
        last = key;
    }
    return out.join(' ').trim();
}

// True when the "reply" is really an echo of the prompt rather than an answer.
export function isPromptEcho(reply) {
    const text = String(reply || '').toLowerCase();
    return /the user'?s name is|you are the user'?s|reply in (english|hindi|hinglish)|context: memory:/.test(text)
        && text.length < 220;
}

// True when the same transcript arrived again within a short window (an Android
// SpeechRecognizer can fire both a result and a restart echo).
export function isDuplicateTranscript(candidate, last, nowMs, withinMs = 4000) {
    const text = String(candidate || '').trim();
    const previous = String(last?.text || '').trim();
    if (!text || !previous) return false;
    if (text !== previous) return false;
    return Math.abs(Number(nowMs) - Number(last?.at || 0)) < withinMs;
}

// Remove the microphone echo of the avatar's own last line.
export function isEchoOfSpoken(candidate, spoken) {
    const said = String(spoken || '').toLowerCase().trim();
    const heard = String(candidate || '').toLowerCase().trim();
    if (!said || !heard) return false;
    return heard.length >= 4 && heard.length <= 40 && said.includes(heard);
}

export function normalizeUserText(value, max = 4000) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
