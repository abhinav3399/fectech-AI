import axios from 'axios';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { sanitizeReply, isPromptEcho, normalizeUserText } from './chatText';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'llama3.2:3b';

export function isNativeCapacitor() {
    return Capacitor.isNativePlatform();
}

function normalizeBaseUrl(baseUrl) {
    const value = String(baseUrl || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, '');
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error('Enter a valid Ollama server URL, such as http://127.0.0.1:11434.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Ollama URL must use http:// or https://.');
    }
    return value;
}

function responseData(response) {
    if (typeof response.data === 'string') {
        try { return JSON.parse(response.data); } catch { return {}; }
    }
    return response.data || {};
}

async function requestJson({ url, method = 'GET', data, timeout = 2500 }) {
    if (isNativeCapacitor()) {
        const response = await CapacitorHttp.request({
            url,
            method,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            data,
            connectTimeout: timeout,
            readTimeout: timeout,
        });
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Ollama returned HTTP ${response.status}.`);
        }
        return responseData(response);
    }

    const response = await axios.request({ url, method, data, timeout });
    return response.data || {};
}

function installedModelNames(data) {
    return Array.isArray(data?.models)
        ? data.models.map((entry) => String(entry?.name || entry?.model || '').trim()).filter(Boolean)
        : [];
}

function hasModel(installed, requested) {
    const model = String(requested || DEFAULT_OLLAMA_MODEL).trim();
    return installed.some((name) => name === model
        || name === `${model}:latest`
        || (model.endsWith(':latest') && name === model.slice(0, -7)));
}

export async function checkOllama({ baseUrl = DEFAULT_OLLAMA_URL, model = DEFAULT_OLLAMA_MODEL } = {}) {
    const endpoint = normalizeBaseUrl(baseUrl);
    const data = await requestJson({ url: `${endpoint}/api/tags`, timeout: 2500 });
    const models = installedModelNames(data);
    return {
        endpoint,
        models,
        model: String(model || DEFAULT_OLLAMA_MODEL).trim(),
        modelInstalled: hasModel(models, model),
    };
}

export async function generateOllamaReply({
    baseUrl = DEFAULT_OLLAMA_URL,
    model = DEFAULT_OLLAMA_MODEL,
    text,
    persona,
    userName,
    memories = [],
    history = [],
    distress = 0,
}) {
    const status = await checkOllama({ baseUrl, model });
    if (!status.modelInstalled) {
        throw new Error(`Ollama is reachable, but “${status.model}” is not installed. Pull that model in your phone’s Ollama runtime, or choose a model that is already installed.`);
    }

    const personaName = persona?.name || 'your companion';
    const relationship = persona?.relationship || 'loved one';
    const language = persona?.language || 'English';
    const care = persona?.carePlan || {};
    const careLines = [
        ...(Array.isArray(care.avoidTopics) && care.avoidTopics.length ? [`Avoid these topics and gently redirect: ${care.avoidTopics.join(', ')}.`] : []),
        ...(Array.isArray(care.comfortTopics) && care.comfortTopics.length ? [`Comforting topics: ${care.comfortTopics.join(', ')}.`] : []),
        ...(care.triggers ? [`Avoid upsetting triggers: ${care.triggers}.`] : []),
        ...(care.strategies ? [`If they seem distressed, reassure them this way: ${care.strategies}.`] : []),
        ...(care.routine ? [`Daily routine: ${care.routine}.`] : []),
        ...(care.dosAndDonts ? [`Care guidance: ${care.dosAndDonts}.`] : []),
    ];
    if (Number(distress) >= 0.6) {
        careLines.push('The user sounds distressed right now. Give one short, slow, validating and reassuring response. Do not argue, correct, or quiz them.');
    }
    const memoryText = memories.slice(0, 5)
        .map((memory) => typeof memory === 'string' ? memory : (memory?.caption || memory?.text))
        .filter(Boolean)
        .join('; ');
    const system = [
        `You are ${personaName}, the user's ${relationship}. The user's name is ${userName || 'dear'}.`,
        `Speak in first person as ${personaName}; never say you are an AI or assistant. Be warm, patient, gentle and natural. Reply in ${language}. Keep the answer concise and conversational.`,
        persona?.personality ? `Personality and shared history: ${persona.personality}` : '',
        memoryText ? `Relevant shared memories: ${memoryText}` : '',
        ...careLines,
    ].filter(Boolean).join('\n');
    const clean = normalizeUserText(text, 4000);
    if (!clean) throw new Error('Empty message.');
    const historyMessages = [];
    let lastKey = null;
    for (const turn of history.slice(-8)) {
        const content = normalizeUserText(turn?.text, 2000);
        if (!content) continue;
        const role = turn?.role === 'bot' || turn?.role === 'assistant' ? 'assistant' : 'user';
        const key = `${role}:${content}`;
        if (key === lastKey) continue;
        if (role === 'user' && content === clean) continue;
        historyMessages.push({ role, content });
        lastKey = key;
    }
    const messages = [
        { role: 'system', content: system },
        ...historyMessages,
        { role: 'user', content: clean },
    ];

    const data = await requestJson({
        url: `${status.endpoint}/api/chat`,
        method: 'POST',
        data: {
            model: status.model,
            messages,
            stream: false,
            options: { temperature: 0.7, num_predict: 180 },
        },
        timeout: 120000,
    });
    const reply = sanitizeReply(data?.message?.content);
    if (!reply || isPromptEcho(reply)) {
        throw new Error('The local model returned an unusable reply. Try rephrasing your message.');
    }
    return reply;
}
