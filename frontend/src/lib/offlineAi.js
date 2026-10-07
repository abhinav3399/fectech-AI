import { pipeline, env } from '@huggingface/transformers';

// Small Apache-2.0 text-to-text model. Weights are downloaded once on first use
// and cached by Transformers.js in the WebView's private storage.
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

export async function generateOfflineReply({ text, persona, memories = [], history = [] }) {
    const generator = await getGenerator();
    const memoryText = memories.slice(0, 5).map((memory) => memory.caption || memory.text).filter(Boolean).join('; ');
    const historyText = history.slice(-4).map((turn) => `${turn.role}: ${turn.text}`).join('\n');
    const prompt = [
        `You are ${persona?.name || 'a warm companion'}, the user's ${persona?.relationship || 'loved one'}.`,
        `Speak gently and briefly in ${persona?.language || 'English'}.`,
        memoryText ? `Relevant memories: ${memoryText}` : '',
        historyText ? `Recent conversation:\n${historyText}` : '',
        `User: ${text}\nAssistant:`,
    ].filter(Boolean).join('\n');
    const result = await generator(prompt, { max_new_tokens: 96, temperature: 0.7, do_sample: true });
    const reply = result?.[0]?.generated_text?.trim();
    if (!reply) throw new Error('Offline model returned an empty response');
    return reply.replace(/^assistant\s*:\s*/i, '').trim();
}
