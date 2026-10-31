import { pipeline, env } from '@huggingface/transformers';
import { sanitizeReply, isPromptEcho, normalizeUserText } from './chatText';

// Small Apache-2.0 text-to-text model. Weights are downloaded once on first use
// and cached by Transformers.js in the WebView's private storage. This is real
// on-device inference (WASM), not a canned reply — but it is a 77M model, so
// answers are short and less capable than a local Ollama model.
export const OFFLINE_MODEL = 'Xenova/LaMini-Flan-T5-77M';
export const OFFLINE_MODEL_LICENSE = 'Apache-2.0';

let generatorPromise = null;
let progressListener = null;

env.allowLocalModels = false;
env.useBrowserCache = true;

defaultProgressHandler();

function defaultProgressHandler() {
    env.progress_callback = (event) => {
        if (event?.status === 'progress' && progressListener) {
            progressListener({
                file: event.file || '',
                progress: Math.max(0, Math.min(100, Number(event.progress) || 0)),
            });
        }
    };
}

export function setOfflineModelProgressListener(listener) {
    progressListener = listener;
    return () => { if (progressListener === listener) progressListener = null; };
}

export function resetOfflineModel() {
    generatorPromise = null;
}

async function getGenerator() {
    if (!generatorPromise) {
        generatorPromise = pipeline('text2text-generation', OFFLINE_MODEL, { device: 'wasm' })
            .catch((error) => {
                generatorPromise = null;
                throw error;
            });
    }
    return generatorPromise;
}

/**
 * Build a clean instruction prompt.
 *
 * Flan-style models expect an instruction + input, not a chat transcript with
 * "User:"/"Assistant:" prefixes. Those prefixes are exactly what leaked into the
 * visible reply ("User: User: Time assistant ..."), so history is expressed as
 * plain narration and the output is sanitized.
 */
function buildPrompt({ text, persona, memories, history }) {
    const name = persona?.name || 'a warm companion';
    const relationship = persona?.relationship || 'loved one';
    const language = persona?.language || 'English';
    const memoryText = (memories || []).slice(0, 4)
        .map((memory) => memory?.caption || memory?.text)
        .filter(Boolean)
        .join('; ');
    const recent = (history || []).slice(-4).map((turn) => {
        const words = normalizeUserText(turn?.text, 240);
        if (!words) return '';
        return turn.role === 'user' ? `They said: ${words}` : `You replied: ${words}`;
    }).filter(Boolean).join('\n');

    return [
        'Below is an instruction for a warm, in-character reply, with context.',
        '',
        '### Instruction:',
        `You are ${name}, the user's ${relationship}. Speak in first person, warmly and briefly.`,
        `Reply in ${language}. Never mention being an AI, a model or an assistant.`,
        memoryText ? `Shared memories you may gently use: ${memoryText}` : '',
        '### Input:',
        recent,
        `They just said: ${normalizeUserText(text, 800)}`,
        '',
        '### Response:',
    ].filter((line) => line !== '').join('\n');
}

export async function generateOfflineReply({ text, persona, memories = [], history = [] }) {
    const clean = normalizeUserText(text, 800);
    if (!clean) throw new Error('Empty message');
    const generator = await getGenerator();
    const prompt = buildPrompt({ text: clean, persona, memories, history });
    const result = await generator(prompt, { max_new_tokens: 96, temperature: 0.7, do_sample: true });
    const raw = result?.[0]?.generated_text?.trim();
    const reply = sanitizeReply(raw);
    if (!reply || isPromptEcho(reply)) {
        throw new Error('The on-device model could not produce a usable reply. Try a shorter message.');
    }
    return reply;
}
