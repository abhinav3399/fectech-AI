import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Send, Pencil, Volume2, X, User, Box, Phone, PhoneOff, Mic, Images, Captions, Video, ShieldCheck, Pause, Play } from 'lucide-react';
import Avatar3D from '../components/Avatar3D';
import PhotoAvatar from '../components/PhotoAvatar';
import TalkingPhoto from '../components/TalkingPhoto';
import PersonaEditor from '../components/PersonaEditor';
import { useAppState, setPersona, addTurn, addDistressEpisode } from '../lib/store';
import { API_BASE } from '../lib/apiConfig';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { Capacitor } from '@capacitor/core';
import { generateOfflineReply } from '../lib/offlineAi';
import { DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL, generateOllamaReply, isNativeCapacitor } from '../lib/ollama';
import { attachAudio } from '../lib/audiolevel';
import { startProsody, stopProsody, getProsody, resetProsodyWindow } from '../lib/prosody';
import { scoreDistress } from '../lib/distress';

// Split a reply into sentence-ish chunks so TTS can play the first words fast and stream the
// rest. Handles ., !, ?, and the Hindi danda (।); merges ultra-short fragments into the prior chunk.
function splitSentences(text) {
    const s = String(text || '').trim();
    if (!s) return [];
    const parts = (s.match(/[^.!?।]+[.!?।]+|\S[^.!?।]*$/g) || [s]).map((p) => p.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
        if (out.length && p.length < 14) out[out.length - 1] += ' ' + p;
        else out.push(p);
    }
    return out.length ? out : [s];
}

export default function AvatarPage() {
    const { persona, profile, memories, transcript = [], settings = {} } = useAppState();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [editing, setEditing] = useState(false);
    // Default to the ANIMATED talking-photo (lip-syncs to the voice) when there's a face,
    // not the static photo; fall back to the 3D head when there's no photo.
    const [mode, setMode] = useState(persona?.faceImage ? 'talk' : '3d'); // 'talk' | 'photo' | '3d'
    const [callMode, setCallMode] = useState(false);
    const [listening, setListening] = useState(false);
    const [voiceError, setVoiceError] = useState(null);
    const [reminisce, setReminisce] = useState(null); // active "Remember when…" overlay
    // Large captions of what the companion says (for hearing-impaired elderly). Persisted; on by default.
    const [captionsOn, setCaptionsOn] = useState(() => {
        try { return localStorage.getItem('factech_captions') !== 'off'; } catch (e) { return true; }
    });
    const [spokenText, setSpokenText] = useState(''); // the line currently / last spoken
    // Real voice: speak in the cloned voice everywhere (incl. live talk) vs fast neural. Persisted, default ON.
    const [realVoice, setRealVoiceState] = useState(() => {
        try { return localStorage.getItem('factech_realvoice') !== 'off'; } catch (e) { return true; }
    });
    const [voicePrep, setVoicePrep] = useState(false); // cloned synth in flight -> show "preparing voice…"
    const scrollRef = useRef(null);
    const audioRef = useRef(null);
    const recognitionRef = useRef(null);
    const callModeRef = useRef(false);   // mirror of callMode for async callbacks
    const messagesRef = useRef([]);      // latest messages (avoid stale-closure history)
    const busyRef = useRef(false);       // thinking or speaking -> ignore the mic
    const startListenRef = useRef(null); // always the freshest startListening
    const lastSpokenRef = useRef('');    // filter the avatar's own voice echo
    const lastActivityRef = useRef(Date.now()); // last time the user spoke/typed
    const nudgeCountRef = useRef(0);     // cap proactive check-ins per session
    const lastNudgeRef = useRef(0);      // timestamp of the last check-in (cooldown)
    const proactiveCheckInRef = useRef(null); // freshest proactive opener fn for the interval
    const reminisceRef = useRef(false);  // pause proactive check-ins while reminiscing
    const flushedCountRef = useRef(0);   // messages already saved as long-term memory
    const flushSessionRef = useRef(null);// freshest flushSession for unmount cleanup
    const userSpokeRef = useRef(false);  // no proactive check-in until the user engages once
    const speakIdRef = useRef(0);        // single-flight token so only the latest voice plays
    const realVoiceRef = useRef(realVoice); // freshest realVoice for async/timer-driven speak()
    const ttsAbortRef = useRef(null);    // abort the previous in-flight TTS so requests never pile up
    const conversationIdRef = useRef(null);
    realVoiceRef.current = realVoice;
    if (!conversationIdRef.current) {
        conversationIdRef.current = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    const distressRef = useRef(0);          // 0..1 live distress estimate sent to the persona brain
    const distressStreakRef = useRef(0);    // consecutive high-distress turns (hysteresis)
    const calmRef = useRef(false);          // currently in validation-therapy calm-mode
    const recentUserTextsRef = useRef([]);  // recent user turns, for repetition detection

    const SpeechRec = typeof window !== 'undefined'
        ? (window.SpeechRecognition || window.webkitSpeechRecognition)
        : null;

    // STT language follows the persona: Hindi -> hi-IN, Hinglish/Indian -> en-IN.
    const personaLang = (persona?.language || '').toLowerCase();
    const personaAccent = (persona?.accent || '').toLowerCase();
    const sttLang = personaLang === 'hindi' ? 'hi-IN'
        : personaLang === 'hinglish' ? 'en-IN'
        : /india|hindi|desi/.test(personaAccent) ? 'en-IN' : 'en-US';
    const ttsLang = (personaLang === 'hindi' || personaLang === 'hinglish') ? 'hi-IN' : sttLang;

    // Use the FIRST name only — repeating the full name in every line sounds robotic.
    const firstName = (profile?.name || 'dear').trim().split(/\s+/)[0] || 'dear';

    // Prefer the REAL photo — it's the faithful likeness (the patient must recognise
    // them). The generated 3D is only an approximation, so it's opt-in via the toggle.
    // Fall back to the generic 3D head only when there's no photo at all.
    useEffect(() => {
        // Default to the Talking Photo when there's a face (it's static when idle, talks
        // while speaking — a strict upgrade), else the 3D head.
        setMode(persona?.faceImage ? 'talk' : '3d');
    }, [persona?.modelUrl, persona?.faceImage]);

    // Tear down mic + audio if we leave the page — and first save this
    // session's durable memories so the companion remembers next time.
    useEffect(() => () => {
        flushSessionRef.current?.();
        callModeRef.current = false;
        speakIdRef.current += 1;
        try { ttsAbortRef.current?.abort(); } catch (e) { /* noop */ }
        try { recognitionRef.current?.stop(); } catch (e) { /* noop */ }
        window.speechSynthesis?.cancel();
        if (Capacitor.isNativePlatform()) TextToSpeech.stop().catch(() => {});
    }, []);

    // Warm greeting from the persona on first open (localized). This also re-fires
    // if the persona's name/language is edited mid-session, which resets the chat —
    // so first persist any pending turns to memory, then reset the flush pointer to
    // stay in sync with the rebuilt (length-1) message array.
    useEffect(() => {
        if (persona) {
            flushSessionRef.current?.(); // save pending turns before the array resets
            const u = firstName;
            const lang = (persona.language || '').toLowerCase();
            const greet = lang === 'hindi'
                ? `नमस्ते ${u}, मैं ${persona.name} हूँ। तुमसे मिलकर बहुत खुशी हुई। कैसे हो तुम?`
                : lang === 'hinglish'
                    ? `Arre ${u}! Main ${persona.name}. Tumse milke bahut khushi hui. Kaise ho?`
                    : `Hello ${u}, it's ${persona.name}. I'm so glad you're here. How are you feeling?`;
            const saved = transcript.filter((turn) => turn?.text).slice(-40).map((turn) => ({ role: turn.role === 'user' ? 'user' : 'bot', text: turn.text }));
            setMessages(saved.length ? saved : [{ role: 'bot', text: greet }]);
            flushedCountRef.current = saved.length;
            lastActivityRef.current = Date.now(); // greeting counts as activity (don't nag)
            nudgeCountRef.current = 0;
            userSpokeRef.current = false;      // stay quiet until the user speaks first
        }
    }, [persona?.name, persona?.language]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, isThinking]);

    // Keep a live ref of messages so async voice callbacks send real history.
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // Proactive companion: if the patient goes quiet (including on first open), the
    // companion GENTLY starts the conversation with an in-character, time-aware opener
    // — so they never face a blank screen. The carer can switch this off
    // (persona.proactiveCheckins), and a cooldown means it never nags.
    useEffect(() => {
        const id = setInterval(() => {
            if (persona?.proactiveCheckins === false) return;        // carer turned it off
            if (callModeRef.current || busyRef.current || editing || reminisceRef.current) return;
            const now = Date.now();
            if (now - lastActivityRef.current < 40000) return;       // they were active recently
            if (now - lastNudgeRef.current < 180000) return;         // cooldown: ~once per 3 min
            if (nudgeCountRef.current >= 8) return;                  // hard safety cap per session
            lastNudgeRef.current = now;
            lastActivityRef.current = now;
            nudgeCountRef.current += 1;
            proactiveCheckInRef.current?.();
        }, 5000);
        return () => clearInterval(id);
    }, [persona?.language, persona?.proactiveCheckins, editing]);

    if (!persona) return null;

    // Avatar appearance modes available for this companion (Talking photo / Photo / 3D).
    const MODE_META = { talk: { label: 'Talking', Icon: Video }, photo: { label: 'Photo', Icon: User }, '3d': { label: '3D', Icon: Box } };
    // Appearance options: Talking photo + Photo (when there's a face) and 3D head — 3D is
    // always offered (uses the generated model if present, else a generic head fallback).
    const avModes = [...(persona.faceImage ? ['talk', 'photo'] : []), '3d'];
    const nextMode = avModes.length > 1 ? avModes[(avModes.indexOf(mode) + 1) % avModes.length] : null;

    // preferFast: skip the cloned voice and use the quick neural voice. The local
    // clone (XTTS on CPU) takes ~30s/line — fine for on-demand playback, but it
    // stalls LIVE conversation and proactive lines, so those pass preferFast.
    const speak = async (text, { preferFast = false, rate = null } = {}) => {
        // Single-flight: hard-stop anything already speaking so two voices never stack.
        // Detach the old clip's handlers first so its afterSpeak can't clobber the new one.
        const myId = ++speakIdRef.current;
        if (audioRef.current) {
            try { audioRef.current.pause(); } catch (e) { /* noop */ }
            audioRef.current.onended = null;
            audioRef.current.onerror = null;
            audioRef.current = null;
        }
        try { window.speechSynthesis?.cancel(); } catch (e) { /* noop */ }
        if (Capacitor.isNativePlatform()) TextToSpeech.stop().catch(() => {});
        // Cancel any prior in-flight TTS so slow cloned syntheses never pile up on the worker.
        try { ttsAbortRef.current?.abort(); } catch (e) { /* noop */ }
        const controller = new AbortController();
        ttsAbortRef.current = controller;

        lastSpokenRef.current = (text || '').toLowerCase();
        setSpokenText(text || ''); // show it as a large caption (hearing-accessible)
        // After the avatar finishes speaking, resume listening if we're in a live call.
        // The 700ms gap lets the speaker audio settle so the mic doesn't catch the tail.
        const afterSpeak = () => {
            if (speakIdRef.current !== myId) return; // a newer utterance owns the state now
            setIsSpeaking(false);
            busyRef.current = false;
            if (callModeRef.current) setTimeout(() => startListenRef.current?.(), 700);
        };
        // Real-voice mode -> clone for EVERYTHING; else clone only on-demand (preferFast = neural).
        const useClone = persona.voiceCloneId && (realVoiceRef.current || !preferFast);
        const cloneId = useClone ? persona.voiceCloneId : null;

        // Synthesize ONE chunk -> base64 mp3 (or null). Shares the abort signal so a newer line
        // cancels every pending synth at once.
        const synth = async (chunk) => {
            const reqBody = { text: chunk, voice: persona.voiceId };
            if (cloneId) reqBody.clone_voice_id = cloneId;
            else if (persona.voicePitch) reqBody.pitch = `${persona.voicePitch >= 0 ? '+' : ''}${persona.voicePitch}Hz`; // tune the fast voice
            if (rate) reqBody.rate = rate; // slower delivery in calm-mode (neural path only)
            const r = await axios.post(`${API_BASE}/tts`, reqBody, { timeout: useClone ? 10000 : 4500, signal: controller.signal });
            const audio = r.data?.audio_base64;
            if (!audio) throw new Error('Backend returned no playable audio.');
            return audio;
        };
        // Play ONE clip; surface decode/play errors so the native speech path can take over.
        const playClip = (b64) => new Promise((resolve, reject) => {
            const audio = new Audio(`data:audio/mpeg;base64,${b64}`);
            audioRef.current = audio;
            attachAudio(audio); // feed the voice level so the 3D head / photo "talks"
            setIsSpeaking(true);
            let settled = false;
            const settle = (callback, value) => {
                if (settled) return;
                settled = true;
                audio.onended = null;
                audio.onerror = null;
                callback(value);
            };
            audio.onended = () => settle(resolve);
            audio.onerror = () => settle(reject, new Error('Backend audio could not play on this device.'));
            controller.signal.addEventListener('abort', () => settle(resolve), { once: true });
            audio.play().catch((error) => { audioRef.current = null; settle(reject, error); });
        });

        // Stream the reply sentence-by-sentence: play the first chunk as soon as it's synthesized
        // (a few seconds, not the whole ~20s reply) while the next chunk synthesizes in the
        // background -> the cloned voice starts fast and flows continuously.
        const chunks = splitSentences(text);
        try {
            if (useClone) setVoicePrep(true);
            if (Capacitor.isNativePlatform() && !navigator.onLine) throw new Error('Device is offline.');
            let nextAudio = synth(chunks[0]);
            for (let i = 0; i < chunks.length; i++) {
                const b64 = await nextAudio;                  // wait for THIS chunk's audio
                if (speakIdRef.current !== myId) return;       // superseded -> stop quietly
                setVoicePrep(false);
                nextAudio = (i + 1 < chunks.length) ? synth(chunks[i + 1]).catch(() => null) : null; // prefetch next
                if (!b64) continue;                            // this chunk failed -> keep going
                await playClip(b64);
                if (speakIdRef.current !== myId) return;
            }
            afterSpeak();
            return;
        } catch (e) {
            setVoicePrep(false);
            // An intentional cancel (a newer line started) must NOT fall back to local speech.
            if (axios.isCancel?.(e) || e.code === 'ERR_CANCELED' || e.name === 'CanceledError' || e.name === 'AbortError') return;
            console.warn('[TTS] Backend speech unavailable; switching to device speech:', e.message);
        }
        if (speakIdRef.current !== myId) return; // superseded before the fallback
        // Prefer Android's installed system TTS; it does not need the API or WebView voice packs.
        if (Capacitor.isNativePlatform()) {
            setIsSpeaking(true);
            try {
                await TextToSpeech.speak({ text, lang: ttsLang, rate: 0.95, pitch: 1, volume: 1, queueStrategy: 0 });
            } catch (nativeError) {
                console.warn('[TTS] Android system speech failed:', nativeError?.message || nativeError);
                setVoiceError('Phone speech is unavailable. Install or enable a text-to-speech voice in Android settings.');
            }
            afterSpeak();
            return;
        }
        // Browser fallback: wait briefly for Web Speech voices to populate before speaking.
        if (window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
            const speakInBrowser = () => new Promise((resolve, reject) => {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = ttsLang;
                const voices = window.speechSynthesis.getVoices();
                const base = ttsLang.split('-')[0];
                const match = voices.find((voice) => voice.lang === ttsLang) || voices.find((voice) => voice.lang?.startsWith(base));
                if (match) utterance.voice = match;
                utterance.onend = resolve;
                utterance.onerror = (event) => reject(new Error(event.error || 'Browser speech failed.'));
                setIsSpeaking(true);
                window.speechSynthesis.speak(utterance);
            });
            try { await speakInBrowser(); } catch (browserError) { console.warn('[TTS] Browser speech failed:', browserError?.message || browserError); }
        }
        afterSpeak();
    };

    // Fetch a warm, in-character opener from the persona and speak it. The directive
    // is NOT shown as a user turn — only the reply is. Falls back to a gentle localized
    // line if the LLM is unreachable, so it works offline too.
    const proactiveCheckIn = async () => {
        if (busyRef.current || callModeRef.current) return;
        const actAt = lastActivityRef.current; // bail later if the user engages meanwhile
        const lang = (persona.language || '').toLowerCase();
        const fallback = lang === 'hindi'
            ? `मैं यहीं हूँ, ${firstName}। कैसा महसूस हो रहा है?`
            : lang === 'hinglish'
                ? `Main yahin hoon, ${firstName}. Sab theek? Kaise ho?`
                : `I'm right here, ${firstName}. How are you feeling?`;
        let line = '';
        try {
            const r = await axios.post(`${API_BASE}/persona/opener`, {
                persona: { name: persona.name, relationship: persona.relationship, personality: persona.personality, gender: persona.gender, age: persona.age, accent: persona.accent, language: persona.language, style: persona.style, carePlan: persona.carePlan },
                user: { name: firstName },
            }, { timeout: 20000 });
            line = (r.data?.text || '').trim();
        } catch (e) { /* offline / LLM down -> fallback */ }
        if (!line) line = fallback;
        // Don't talk over the patient if they started typing/speaking while we fetched.
        if (busyRef.current || callModeRef.current || lastActivityRef.current !== actAt) return;
        busyRef.current = true; // claimed only now; afterSpeak() clears it
        setMessages((p) => [...p, { role: 'bot', text: line }]);
        addTurn('bot', line);
        speak(line, { preferFast: true }); // automatic check-in -> respond instantly, don't wait on the clone
    };
    proactiveCheckInRef.current = proactiveCheckIn; // keep the freshest closure for the interval

    const playRealVoice = () => {
        if (!persona.voiceSample) return;
        const audio = new Audio(persona.voiceSample);
        setIsSpeaking(true);
        audio.onended = () => setIsSpeaking(false);
        audio.play().catch(() => setIsSpeaking(false));
    };

    // "Their voice": make the avatar SPEAK a warm line in the CLONED voice (lip-syncs
    // via speak()), not replay the raw clip. Falls back to the recording if no clone yet.
    const hearTheirVoice = () => {
        if (persona.voiceCloneId) speak(`Hello ${firstName}, it's ${persona.name}. It's so good to hear your voice.`);
        else playRealVoice();
    };

    // One conversational turn: user text -> persona reply -> speak it.
    const runTurn = async (text) => {
        const q = (text ?? '').trim();
        if (!q) return;
        busyRef.current = true; // block the mic until we've finished replying + speaking
        lastActivityRef.current = Date.now();
        userSpokeRef.current = true; // the user has engaged -> proactive check-in now allowed
        nudgeCountRef.current = 0; // user responded -> allow future proactive check-ins
        const history = messagesRef.current.slice(-8);
        console.info('[CHAT] user message:', q);
        console.info('[CHAT] conversation ID:', conversationIdRef.current);
        console.info('[CHAT] API endpoint:', `${API_BASE}/persona/chat`);
        setMessages((p) => [...p, { role: 'user', text: q }]);
        addTurn('user', q); // persist for the wellbeing evaluation
        setIsThinking(true);
        // Distress Watch — estimate from live voice prosody + this message; hysteresis (enter after
        // 2 high turns, exit below 0.35) so a normal lively chat never trips it. Patient sees nothing.
        try {
            const score = scoreDistress({ prosody: getProsody(), text: q, recentUserTexts: recentUserTextsRef.current });
            recentUserTextsRef.current = [...recentUserTextsRef.current, q].slice(-6);
            distressStreakRef.current = score >= 0.6 ? distressStreakRef.current + 1 : 0;
            if (!calmRef.current && distressStreakRef.current >= 2) {
                calmRef.current = true;
                addDistressEpisode({ peak: score, trigger: q }); // caregiver-only log
            } else if (calmRef.current && score < 0.35) {
                calmRef.current = false;
            }
            distressRef.current = calmRef.current ? Math.max(score, 0.6) : score;
            resetProsodyWindow();
        } catch (e) { /* never block the chat on the distress calc */ }
        try {
            const aiMode = settings.aiMode || 'auto';
            const ollamaOptions = {
                baseUrl: settings.ollamaUrl || DEFAULT_OLLAMA_URL,
                model: settings.ollamaModel || DEFAULT_OLLAMA_MODEL,
                text: q,
                persona,
                userName: firstName,
                memories,
                history,
                distress: distressRef.current,
            };
            const askBackend = async (timeout) => (await axios.post(`${API_BASE}/persona/chat`, {
                text: q,
                persona: { name: persona.name, relationship: persona.relationship, personality: persona.personality, gender: persona.gender, age: persona.age, accent: persona.accent, language: persona.language, style: persona.style, carePlan: persona.carePlan },
                user: { name: firstName },
                conversation_id: conversationIdRef.current,
                history,
                distress: distressRef.current,
            }, { timeout })).data?.text?.trim();

            let reply = '';
            if (aiMode === 'offline') {
                reply = await generateOfflineReply({ text: q, persona, memories, history });
            } else if (aiMode === 'ollama') {
                reply = await generateOllamaReply(ollamaOptions);
            } else if (aiMode === 'online') {
                reply = await askBackend(30000);
            } else {
                // On Android, first use a phone-local Ollama-compatible runtime. Native HTTP
                // bypasses WebView CORS and localhost correctly resolves to the phone itself.
                if (isNativeCapacitor()) {
                    try { reply = await generateOllamaReply(ollamaOptions); }
                    catch (localError) { console.info('[CHAT] phone-local Ollama unavailable; falling back:', localError.message); }
                }
                // The API's baked-in LAN address may be unreachable away from home Wi-Fi, so
                // keep the auto-mode network attempt short and continue to local inference.
                if (!reply && navigator.onLine) {
                    try { reply = await askBackend(5000); }
                    catch (networkError) { console.info('[CHAT] backend unavailable; falling back:', networkError.message); }
                }
                if (!reply) {
                    try { reply = await generateOfflineReply({ text: q, persona, memories, history }); }
                    catch (offlineError) {
                        throw new Error(`Online AI is unavailable and the offline model could not start (${offlineError.message}). Connect once to download the offline model, then try again.`);
                    }
                }
            }
            if (!reply) throw new Error('AI service returned an empty response');
            console.info('[CHAT] AI response:', reply);
            setMessages((p) => [...p, { role: 'bot', text: reply }]);
            addTurn('bot', reply);
            setIsThinking(false);
            // Live mic conversation needs to be snappy -> fast neural voice; a typed chat reply can
            // wait for the richer cloned voice. In calm-mode, slow the delivery for a soothing tone.
            speak(reply, { preferFast: callModeRef.current, rate: calmRef.current ? '-18%' : null }); // busyRef stays true until afterSpeak
        } catch (e) {
            const detail = e.response?.data?.detail;
            const aiMode = settings.aiMode || 'auto';
            const errorText = aiMode === 'ollama'
                ? e.message || 'Could not connect to Ollama. Check its server address and that the selected model is installed.'
                : aiMode === 'offline'
                    ? `Offline AI could not start (${e.message}). Connect once to download the model, then try again.`
                    : aiMode === 'online'
                        ? (typeof detail === 'string' ? detail : 'Online AI service unavailable. Check the backend address or choose Auto for local fallback.')
                        : (typeof detail === 'string' ? detail : e.message || 'AI service unavailable. Please try again.');
            console.error('[CHAT] request failed:', e.message);
            setMessages((p) => [...p, { role: 'bot', text: errorText }]);
            setIsThinking(false);
            busyRef.current = false;
            if (callModeRef.current) setTimeout(() => startListenRef.current?.(), 500);
        }
    };

    // After a session, distill the new turns into durable memories the companion
    // can recall next time. Sends only the tail since the last flush (no repeats).
    // Fire-and-forget — never blocks the UI or the voice loop.
    const flushSession = () => {
        const msgs = messagesRef.current || [];
        const fresh = msgs.slice(flushedCountRef.current);
        const turns = fresh
            .filter((m) => (m.text || '').trim())
            .map((m) => ({ role: m.role === 'user' ? 'user' : 'bot', text: m.text }));
        // Worth storing only if there was a real exchange (>=2 turns incl. a user turn).
        if (turns.length < 2 || !turns.some((t) => t.role === 'user')) return;
        flushedCountRef.current = msgs.length;
        const body = {
            transcript: turns,
            persona: { name: persona.name, relationship: persona.relationship, personality: persona.personality, gender: persona.gender, age: persona.age, accent: persona.accent, language: persona.language, style: persona.style },
            user: { name: firstName },
        };
        try {
            const url = `${API_BASE}/remember`;
            // sendBeacon returns false if it couldn't queue (e.g. payload over the
            // beacon budget) — fall back to axios in that case, not just when absent.
            const beaconOk = navigator.sendBeacon
                ? navigator.sendBeacon(url, new Blob([JSON.stringify(body)], { type: 'application/json' }))
                : false;
            if (!beaconOk) {
                axios.post(url, body, { timeout: 30000 }).catch(() => { });
            }
        } catch (e) { /* memory is best-effort; never block */ }
    };
    flushSessionRef.current = flushSession;

    const send = (raw) => {
        const q = (typeof raw === 'string' ? raw : input).trim();
        if (!q || isThinking) return;
        setInput('');
        runTurn(q);
    };

    // ---- Live voice ("auto-talk"): speech-in -> reply -> speech-out -> repeat ----
    const restartSoon = (ms) => {
        if (callModeRef.current && !busyRef.current) setTimeout(() => startListenRef.current?.(), ms);
    };

    const startListening = () => {
        // Never run two recognizers, and never listen while we're talking/thinking.
        if (!SpeechRec || !callModeRef.current || busyRef.current) return;
        try { recognitionRef.current?.abort(); } catch (e) { /* noop */ }
        try {
            const rec = new SpeechRec();
            rec.lang = sttLang;
            rec.interimResults = false;
            rec.continuous = false;
            rec.maxAlternatives = 1;
            rec.onresult = (e) => {
                const t = (e.results?.[0]?.[0]?.transcript || '').trim();
                setListening(false);
                if (busyRef.current) return;                 // ignore mic while busy (echo guard)
                if (t.length < 2) { restartSoon(300); return; }
                // Skip if it's basically an echo of what the avatar just said.
                const last = lastSpokenRef.current;
                if (last && t.length < 30 && last.includes(t.toLowerCase())) { restartSoon(300); return; }
                runTurn(t);
            };
            rec.onerror = (e) => {
                setListening(false);
                if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                    setVoiceError('Microphone permission was blocked. Allow mic access to talk live.');
                    endCall();
                } else if (['no-speech', 'aborted', 'network'].includes(e.error)) {
                    restartSoon(500);
                }
            };
            rec.onend = () => setListening(false);
            recognitionRef.current = rec;
            rec.start();
            setListening(true);
        } catch (e) {
            setListening(false);
            restartSoon(600);
        }
    };
    startListenRef.current = startListening; // keep the freshest closure for async restarts

    const startCall = () => {
        setVoiceError(null);
        if (!SpeechRec) {
            setVoiceError('Live voice needs Google Chrome or Microsoft Edge.');
            return;
        }
        busyRef.current = false;
        callModeRef.current = true;
        setCallMode(true);
        startProsody(); // begin listening to the patient's VOICE prosody for the Distress Watch
        startListening();
    };

    const endCall = () => {
        flushSession(); // save durable memories when a live call ends
        speakIdRef.current += 1;
        try { ttsAbortRef.current?.abort(); } catch (e) { /* noop */ }
        callModeRef.current = false;
        busyRef.current = false;
        setCallMode(false);
        setListening(false);
        try { recognitionRef.current?.abort(); } catch (e) { /* noop */ }
        try { stopProsody(); } catch (e) { /* noop */ }
        calmRef.current = false; distressRef.current = 0; distressStreakRef.current = 0;
        window.speechSynthesis?.cancel();
        if (Capacitor.isNativePlatform()) TextToSpeech.stop().catch(() => {});
        if (audioRef.current) { try { audioRef.current.pause(); } catch (e) { /* noop */ } }
        setIsSpeaking(false);
    };

    // Barge-in: cut the avatar off mid-sentence and hand the mic straight back to
    // the user. Bumping speakIdRef neutralizes the in-flight speak()'s afterSpeak so
    // it can't fight us, then we resume listening quickly in call mode.
    const stopSpeaking = () => {
        speakIdRef.current += 1;
        try { audioRef.current?.pause(); } catch (e) { /* noop */ }
        if (audioRef.current) { audioRef.current.onended = null; audioRef.current.onerror = null; audioRef.current = null; }
        try { window.speechSynthesis?.cancel(); } catch (e) { /* noop */ }
        if (Capacitor.isNativePlatform()) TextToSpeech.stop().catch(() => {});
        setIsSpeaking(false);
        busyRef.current = false;
        if (callModeRef.current) setTimeout(() => startListenRef.current?.(), 150);
    };

    // ---- Reminiscence mode: show a saved memory; the companion warmly relives it ----
    const memPool = memories || [];
    reminisceRef.current = !!reminisce; // mirror so proactive check-ins pause while open

    const reminisceLine = async (mem) => {
        const cap = (mem?.caption || '').trim();
        const lang = (persona.language || '').toLowerCase();
        const fallback = lang === 'hindi'
            ? `यह पल मुझे बहुत प्यारा है${cap ? ' — ' + cap : ''}। हम साथ थे, और मैं बहुत खुश था।`
            : lang === 'hinglish'
                ? `Yeh pal bahut pyara hai${cap ? ' — ' + cap : ''}. Hum saath the, dil khush ho gaya.`
                : `I love this moment of ours${cap ? ' — ' + cap : ''}. We were together, and it made me so happy.`;
        try {
            const r = await axios.post(`${API_BASE}/persona/reminisce`, {
                persona: { name: persona.name, relationship: persona.relationship, personality: persona.personality, gender: persona.gender, age: persona.age, accent: persona.accent, language: persona.language, style: persona.style, carePlan: persona.carePlan },
                user: { name: firstName },
                memory: cap,
            }, { timeout: 20000 });
            return (r.data?.text || '').trim() || fallback;
        } catch (e) { return fallback; }
    };

    const showMemoryAt = async (idx) => {
        if (!memPool.length) { setReminisce({ empty: true }); return; }
        const i = ((idx % memPool.length) + memPool.length) % memPool.length;
        const mem = memPool[i];
        reminisceRef.current = true;
        busyRef.current = true;                 // block mic / proactive while we speak
        lastActivityRef.current = Date.now();
        setReminisce({ idx: i, mem, line: '' });
        const line = await reminisceLine(mem);
        setReminisce((r) => (r && !r.empty && r.idx === i ? { ...r, line } : r));
        setMessages((p) => [...p, { role: 'bot', text: line }]);
        addTurn('bot', line);
        speak(line);
    };

    const startReminisce = () => showMemoryAt(Math.floor(Math.random() * (memPool.length || 1)));
    const nextMemory = () => { if (reminisce && !reminisce.empty) showMemoryAt(reminisce.idx + 1); };
    const closeReminisce = () => {
        reminisceRef.current = false;
        lastActivityRef.current = Date.now();
        stopSpeaking();
        setReminisce(null);
    };

    const toggleCaptions = () => setCaptionsOn((v) => {
        const next = !v;
        try { localStorage.setItem('factech_captions', next ? 'on' : 'off'); } catch (e) { /* ignore */ }
        return next;
    });

    const toggleRealVoice = () => setRealVoiceState((v) => {
        const next = !v;
        try { localStorage.setItem('factech_realvoice', next ? 'on' : 'off'); } catch (e) { /* ignore */ }
        return next;
    });

    const saveEdit = (p) => { setPersona({ ...persona, ...p }); setEditing(false); };

    return (
        <div className="av">
            {/* Stage: the companion's face (real photo) or the 3D head */}
            <div className="av-stage">
                {mode === '3d'
                    ? <Avatar3D isSpeaking={isSpeaking} src={persona.modelUrl} />
                    : mode === 'talk' && persona.faceImage
                        ? <TalkingPhoto src={persona.faceImage} isSpeaking={isSpeaking} name={persona.name} />
                        : persona.faceImage
                            ? <PhotoAvatar src={persona.faceImage} isSpeaking={isSpeaking} name={persona.name} />
                            : <Avatar3D isSpeaking={isSpeaking} src={persona.modelUrl} />}

                {/* Live call banner */}
                {callMode && (
                    <div className="av-call">
                        <span className={`av-call-dot ${listening ? 'live' : ''}`} />
                        <span className="av-call-text">
                            {isSpeaking ? `${persona.name} is speaking — tap to interrupt` : isThinking ? 'Thinking…' : listening ? 'Listening — speak now' : 'Connecting…'}
                        </span>
                        {isSpeaking && (
                            <button className="av-call-interrupt" onClick={stopSpeaking} title="Stop and talk now"><Mic size={14} /> Interrupt</button>
                        )}
                        <button className="av-call-end" onClick={endCall}><PhoneOff size={15} /> End</button>
                    </div>
                )}

                {/* While the avatar speaks in a live call, a tap anywhere on the stage
                    interrupts it (barge-in). Sits above the avatar, below the banner/tools. */}
                {callMode && isSpeaking && (
                    <div className="av-bargein" onClick={stopSpeaking} title="Tap to interrupt" />
                )}
                {voiceError && <div className="av-voice-err" onClick={() => setVoiceError(null)}>{voiceError}</div>}

                {/* Reminiscence: a saved memory, with the companion warmly reliving it */}
                {reminisce && (
                    <div className="av-rem">
                        <button className="av-rem-close" onClick={closeReminisce} aria-label="Close memory"><X size={18} /></button>
                        {reminisce.empty ? (
                            <div className="av-rem-card av-rem-empty">
                                <Images size={42} />
                                <p>No memories saved yet. Add a photo and a note in <b>Memories</b>, and {persona.name} can look back on it with you.</p>
                            </div>
                        ) : (
                            <div className="av-rem-card">
                                {reminisce.mem.image
                                    ? <img className="av-rem-photo" src={reminisce.mem.image} alt={reminisce.mem.caption || 'a happy memory'} />
                                    : <div className="av-rem-photo av-rem-noimg"><Images size={48} /></div>}
                                {reminisce.mem.caption && <div className="av-rem-cap">{reminisce.mem.caption}</div>}
                                <div className="av-rem-line">{reminisce.line ? `“${reminisce.line}”` : `${persona.name} is remembering…`}</div>
                                <button className="av-rem-next" onClick={nextMemory}>Next memory</button>
                            </div>
                        )}
                    </div>
                )}

                {captionsOn && spokenText && (
                    <div className={`av-cc ${isSpeaking ? 'live' : ''}`} aria-live="polite">{spokenText}</div>
                )}

                <div className={`av-caption ${callMode ? 'with-controls' : ''}`}>
                    <div className="av-name">{persona.name}</div>
                    <div className="av-rel">your {persona.relationship}</div>
                    <div className={`av-state ${voicePrep || isThinking ? 'thinking' : isSpeaking ? 'speaking' : ''}`}>
                        {voicePrep ? `Preparing ${persona.name}'s voice…` : isSpeaking ? 'Speaking…' : isThinking ? 'Thinking…' : 'Listening'}
                    </div>
                    {isSpeaking && (
                        <div className="av-waves" aria-hidden="true">
                            {[0, 1, 2, 3, 4, 5, 6].map((i) => <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}
                        </div>
                    )}
                </div>

                {/* Live-call control bar: mic (talk now) · play/pause · end. Uses the
                    existing call handlers so behaviour matches the top banner. */}
                {callMode && (
                    <div className="av-controls">
                        <button className={`av-ctl ${listening ? 'live' : ''}`} onClick={stopSpeaking} title="Talk now" aria-label="Talk now">
                            <Mic size={22} />
                        </button>
                        <button className="av-ctl primary" onClick={() => (isSpeaking ? stopSpeaking() : startListenRef.current?.())}
                            title={isSpeaking ? 'Pause' : 'Resume listening'} aria-label={isSpeaking ? 'Pause' : 'Resume listening'}>
                            {isSpeaking ? <Pause size={26} /> : <Play size={26} />}
                        </button>
                        <button className="av-ctl end" onClick={endCall} title="End call" aria-label="End call">
                            <PhoneOff size={22} />
                        </button>
                    </div>
                )}

                {/* Privacy reassurance — dementia-care users are told their data stays on-device. */}
                <div className="av-privacy" title="Your conversations are processed privately">
                    <ShieldCheck size={14} /> Private connection · on-device
                </div>

                {/* Desktop tools (top-right absolute) */}
                <div className="av-tools">
                    {!callMode && (
                        <button className="av-tool call" onClick={startCall} title="Talk hands-free, voice to voice">
                            <Phone size={16} /> Auto-talk
                        </button>
                    )}
                    {nextMode && (
                        <button className="av-tool" onClick={() => setMode(nextMode)} title="Switch how they appear (Talking photo / Photo / 3D)">
                            {React.createElement(MODE_META[nextMode].Icon, { size: 16 })} {MODE_META[nextMode].label}
                        </button>
                    )}
                    {(persona.voiceCloneId || persona.voiceSample) && (
                        <button className="av-tool" onClick={hearTheirVoice}
                            title={persona.voiceCloneId ? `Hear ${persona.name} speak in their cloned voice` : 'Play their real recorded voice'}>
                            <Volume2 size={16} /> Their voice
                        </button>
                    )}
                    {!callMode && (
                        <button className="av-tool" onClick={startReminisce} title="Look back on a happy memory together">
                            <Images size={16} /> Remember when…
                        </button>
                    )}
                    <button className={`av-tool ${captionsOn ? 'on' : ''}`} onClick={toggleCaptions} title="Show large captions of what they say" aria-pressed={captionsOn}>
                        <Captions size={16} /> Captions
                    </button>
                    {persona.voiceCloneId && (
                        <button className={`av-tool ${realVoice ? 'on' : ''}`} onClick={toggleRealVoice}
                            title={realVoice ? `Speaking in ${persona.name}'s real cloned voice (slower)` : 'Using the quick neural voice — tap for the real cloned voice'}
                            aria-pressed={realVoice}>
                            <Volume2 size={16} /> Real voice
                        </button>
                    )}
                    <button className="av-tool" onClick={() => setEditing(true)} title="Edit companion">
                        <Pencil size={16} /> Edit
                    </button>
                </div>

                {/* Compact icon controls flank the enlarged mobile avatar. */}
                <div className="av-mob-left" aria-label="Talk controls">
                    {!callMode && (
                        <button className="av-mob-tool call" onClick={startCall} title="Auto-talk" aria-label="Auto-talk">
                            <Phone size={18} />
                        </button>
                    )}
                    <button className="av-mob-tool" onClick={startReminisce} title="Remember when" aria-label="Remember when">
                        <Images size={18} />
                    </button>
                    <button className={`av-mob-tool ${captionsOn ? 'on' : ''}`} onClick={toggleCaptions} title="Captions" aria-label="Captions" aria-pressed={captionsOn}>
                        <Captions size={18} />
                    </button>
                </div>

                <div className="av-mob-ring">
                    {persona.faceImage
                        ? <img src={persona.faceImage} alt={persona.name} />
                        : <span className="av-mob-initial">{(persona.name || '?').charAt(0)}</span>}
                    <span className="av-mob-online" />
                </div>

                <div className="av-mob-right" aria-label="Companion controls">
                    <button className="av-mob-tool" onClick={() => setEditing(true)} title="Photo" aria-label="Photo">
                        <User size={18} />
                    </button>
                    <button className="av-mob-tool" onClick={() => setEditing(true)} title="Edit" aria-label="Edit">
                        <Pencil size={18} />
                    </button>
                    <button className="av-mob-tool" onClick={() => setEditing(true)} title="Personality" aria-label="Personality">
                        <Volume2 size={18} />
                    </button>
                </div>
            </div>

            {/* Chat */}
            <div className="av-chat">
                <div className="av-messages" ref={scrollRef}>
                    {messages.map((m, i) => (
                        <div key={i} className={`av-bubble ${m.role}`}>
                            {m.text}
                            {m.role === 'bot' && (m.text || '').trim() && (
                                <button className="av-again" onClick={() => speak(m.text)} disabled={voicePrep || isSpeaking} title="Say it again" aria-label="Say it again">
                                    <Volume2 size={13} /> Say it again
                                </button>
                            )}
                        </div>
                    ))}
                    {isThinking && <div className="av-bubble bot av-typing"><span /><span /><span /></div>}
                    {voicePrep && !isThinking && (
                        <div className="av-bubble bot av-prep"><Volume2 size={14} /> Preparing {persona.name}'s voice…</div>
                    )}
                </div>
                <div className="av-suggestions">
                    {['Tell me about us', 'I miss you', 'What should I do today?'].map((s) => (
                        <button key={s} onClick={() => send(s)} disabled={isThinking}>{s}</button>
                    ))}
                </div>
                <div className="av-input">
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
                        placeholder={`Talk to ${persona.name}…`}
                    />
                    <button onClick={() => send()} disabled={isThinking || !input.trim()} aria-label="Send"><Send size={18} /></button>
                </div>
            </div>

            {/* Edit modal */}
            {editing && (
                <div className="av-modal" onClick={(e) => e.target === e.currentTarget && setEditing(false)}>
                    <div className="av-modal-card">
                        <div className="av-modal-head">
                            <h3>Edit {persona.name}</h3>
                            <button onClick={() => setEditing(false)} aria-label="Close"><X size={18} /></button>
                        </div>
                        <PersonaEditor initial={{ ...persona, userName: profile?.name }} onSave={saveEdit} onCancel={() => setEditing(false)} saveLabel="Save changes" />
                    </div>
                </div>
            )}

            <style>{`
        .av {
            display: flex; height: 100%; width: 100%; overflow: hidden;
            background:
                radial-gradient(900px 520px at 18% -10%, rgba(139,92,246,0.20), transparent 60%),
                radial-gradient(820px 560px at 90% 6%, rgba(59,130,246,0.16), transparent 55%),
                var(--bg);
            color: var(--text);
        }
        .av-stage { flex: 1 1 auto; position: relative; min-width: 0; min-height: 0; overflow: hidden; }
        .av-caption { position: absolute; bottom: var(--s-8); left: 0; right: 0; text-align: center; pointer-events: none; }
        .av-name { font-size: var(--fs-2xl); font-weight: 800; letter-spacing: -0.01em; color: var(--text); text-shadow: 0 2px 14px rgba(0,0,0,0.18); }
        .av-rel {
            color: transparent; font-size: var(--fs-sm); margin-top: 4px; font-weight: 600;
            background: var(--grad-text); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
        }
        .av-state {
            display: inline-block; margin-top: var(--s-3); font-size: var(--fs-xs); letter-spacing: 0.12em;
            text-transform: uppercase; font-weight: 700; color: var(--brand-3);
            padding: 6px 16px; border: 1px solid rgba(59,130,246,0.4); border-radius: var(--r-pill);
            background: rgba(59,130,246,0.12); backdrop-filter: blur(8px);
        }
        .av-state.speaking { color: var(--success); border-color: rgba(52,211,153,0.5); background: rgba(52,211,153,0.12); }
        .av-state.thinking { color: var(--brand-1); border-color: rgba(139,92,246,0.5); background: rgba(139,92,246,0.12); }
        /* Voice waves — animated bars while the companion speaks (design-system motion). */
        .av-waves { display: flex; align-items: center; justify-content: center; gap: 4px; height: 34px; margin-top: var(--s-3); }
        .av-waves span { width: 4px; height: 8px; border-radius: var(--r-pill); background: var(--success); animation: av-wave 1.2s ease-in-out infinite; }
        @keyframes av-wave { 0%,100% { height: 8px; opacity: 0.55; } 50% { height: 30px; opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .av-waves span { animation: none; height: 16px; } }
        /* Privacy reassurance badge (bottom-left of the stage). */
        .av-privacy {
            position: absolute; bottom: var(--s-5); left: var(--s-5); z-index: 6;
            display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; border-radius: var(--r-pill);
            background: var(--glass); border: 1px solid var(--border); backdrop-filter: blur(12px);
            color: var(--text-muted); font-size: var(--fs-xs); font-weight: 600; box-shadow: var(--shadow-sm);
        }
        .av-privacy > svg { color: var(--success); flex-shrink: 0; }
        @media (max-width: 820px) { .av-privacy { display: none; } }
        /* Live-call control bar (mic / play-pause / end). */
        .av-caption.with-controls { bottom: 122px; }
        .av-controls { position: absolute; bottom: var(--s-6); left: 50%; transform: translateX(-50%); z-index: 7;
            display: flex; align-items: center; gap: var(--s-4); padding: 10px var(--s-5); border-radius: var(--r-pill);
            background: var(--glass-strong); border: 1px solid var(--border-strong); backdrop-filter: blur(16px); box-shadow: var(--shadow-lg); }
        .av-ctl { width: 58px; height: 58px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
            border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text); cursor: pointer;
            transition: transform var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .av-ctl:hover { transform: translateY(-2px); background: var(--surface-3); }
        .av-ctl.live { border-color: rgba(52,211,153,0.6); box-shadow: 0 0 0 4px rgba(52,211,153,0.18); color: #6ee7b7; }
        .av-ctl.primary { width: 68px; height: 68px; background: var(--grad-brand); color: var(--text-on-brand); border-color: transparent; box-shadow: var(--glow-brand); }
        .av-ctl.primary:hover { box-shadow: 0 14px 44px rgba(124,58,237,0.5); }
        .av-ctl.end { background: linear-gradient(135deg, #f43f5e, #e11d48); color: #fff; border-color: transparent; box-shadow: 0 8px 24px rgba(225,29,72,0.4); }
        .av-tools { position: absolute; top: var(--s-5); right: var(--s-5); display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--s-2); max-width: min(94%, 900px); z-index: 6; }
        .av-tool {
            display: flex; align-items: center; gap: 6px; padding: 10px 15px; border-radius: var(--r-md);
            border: 1px solid var(--border); background: var(--glass); backdrop-filter: blur(14px);
            color: var(--text); cursor: pointer; font-size: var(--fs-sm); font-weight: 600; font-family: inherit;
            box-shadow: var(--shadow-sm);
            transition: transform var(--dur) var(--ease), background var(--dur) var(--ease), border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .av-tool:hover { background: var(--surface-3); border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow-md); }
        .av-tool.call { border-color: rgba(52,211,153,0.5); background: rgba(52,211,153,0.16); color: #6ee7b7; box-shadow: 0 8px 26px rgba(52,211,153,0.22); }
        .av-tool.call:hover { background: rgba(52,211,153,0.26); }

        /* ── Mobile-only elements: hidden on desktop ── */
        .av-mob-left, .av-mob-ring, .av-mob-right { display: none; }

        @media (max-width: 640px) {
            /* Icon-only controls keep both columns narrow around the avatar. */
            .av-mob-left,
            .av-mob-right {
                grid-row: 1 !important;
                display: flex !important;
                flex-direction: column;
                align-items: center;
                justify-self: center;
                align-self: start;
                width: 44px;
                min-width: 44px;
                gap: 6px;
            }
            .av-mob-left { grid-column: 1 !important; }
            .av-mob-right { grid-column: 3 !important; }
            /* Larger portrait stays centered between compact icon controls. */
            .av-mob-ring {
                grid-column: 2 !important;
                grid-row: 1 !important;
                display: flex !important;
                position: relative;
                align-self: start;
                justify-self: center;
                width: min(40vw, 128px); height: min(40vw, 128px); border-radius: 50%;
                border: 3px solid #7c3aed;
                box-shadow: 0 0 0 4px rgba(124,58,237,0.18), 0 8px 28px rgba(100,80,200,0.2);
                overflow: visible;
                align-items: center; justify-content: center;
                background: rgba(124,58,237,0.08);
                flex-shrink: 0;
            }
            .av-mob-ring img {
                width: 100%; height: 100%; border-radius: 50%;
                object-fit: cover; object-position: center top;
            }
            .av-mob-initial {
                font-size: 3.4rem; font-weight: 900; color: #7c3aed;
            }
            .av-mob-online {
                position: absolute; bottom: 7px; right: 7px;
                width: 20px; height: 20px; border-radius: 50%;
                background: #22c55e; border: 3px solid #fff;
                box-shadow: 0 0 0 2px rgba(34,197,94,0.35);
            }
            /* Compact square icon buttons; labels remain available to assistive tech. */
            .av-mob-tool {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 40px;
                height: 40px;
                min-height: 40px !important;
                padding: 0;
                border-radius: 13px;
                border: 1.5px solid rgba(124,58,237,0.15);
                background: #fff;
                color: #475569;
                font-family: inherit;
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(100,80,200,0.06);
                -webkit-tap-highlight-color: transparent;
            }
            .av-mob-tool svg { width: 18px; height: 18px; flex: 0 0 18px; }
            .av-mob-tool.call {
                border-color: rgba(34,197,94,0.4);
                background: rgba(34,197,94,0.08);
                color: #16a34a;
            }
            .av-mob-tool.on {
                background: rgba(124,58,237,0.1);
                border-color: rgba(124,58,237,0.3);
                color: #7c3aed;
            }
        }

        .av-call {
            position: absolute; top: var(--s-5); left: 50%; transform: translateX(-50%);
            display: flex; align-items: center; gap: var(--s-3); padding: 10px var(--s-4); border-radius: var(--r-pill);
            background: var(--glass-strong); backdrop-filter: blur(16px); border: 1px solid rgba(52,211,153,0.4);
            box-shadow: var(--shadow-md); z-index: 7;
        }
        .av-call-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--text-dim); flex-shrink: 0; }
        .av-call-dot.live { background: var(--danger); animation: av-call-pulse 1.1s infinite; }
        @keyframes av-call-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(248,113,113,0.6); } 50% { box-shadow: 0 0 0 8px rgba(248,113,113,0); } }
        .av-call-text { color: var(--text); font-size: var(--fs-sm); font-weight: 600; white-space: nowrap; }
        .av-call-end {
            display: flex; align-items: center; gap: 5px; background: linear-gradient(135deg, #f43f5e, #e11d48); color: #fff;
            border: none; padding: 8px 14px; border-radius: var(--r-pill); cursor: pointer; font-weight: 700; font-size: var(--fs-sm);
            font-family: inherit; box-shadow: 0 6px 20px rgba(244,63,94,0.35); transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .av-call-end:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(244,63,94,0.5); }
        .av-call-interrupt {
            display: flex; align-items: center; gap: 5px; background: rgba(251,191,36,0.18); color: var(--warning);
            border: 1px solid rgba(251,191,36,0.5); padding: 8px 14px; border-radius: var(--r-pill); cursor: pointer;
            font-weight: 700; font-size: var(--fs-sm); font-family: inherit; transition: background var(--dur) var(--ease), transform var(--dur) var(--ease);
        }
        .av-call-interrupt:hover { background: rgba(251,191,36,0.32); transform: translateY(-2px); }
        /* Full-stage tap target for barge-in; no z-index so the banner + tools stay clickable above it. */
        .av-bargein { position: absolute; inset: 0; cursor: pointer; }
        .av-voice-err {
            position: absolute; bottom: 96px; left: 50%; transform: translateX(-50%);
            background: rgba(248,113,113,0.15); border: 1px solid rgba(248,113,113,0.4); color: #fca5a5;
            padding: 12px 18px; border-radius: var(--r-md); font-size: var(--fs-sm); max-width: 80%; text-align: center;
            cursor: pointer; z-index: 7; backdrop-filter: blur(10px); box-shadow: var(--shadow-md);
        }

        /* Reminiscence overlay */
        .av-rem {
            position: absolute; inset: 0; z-index: 9; display: flex; align-items: center; justify-content: center;
            padding: var(--s-6); background: rgba(5,8,16,0.62); backdrop-filter: blur(10px); animation: fb-fade 0.25s var(--ease) both;
        }
        @keyframes fb-fade { from { opacity: 0; } to { opacity: 1; } }
        .av-rem-close {
            position: absolute; top: var(--s-5); right: var(--s-5); width: 44px; height: 44px; border-radius: var(--r-md);
            background: var(--surface-2); border: 1px solid var(--border); color: var(--text); cursor: pointer;
            display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);
        }
        .av-rem-close:hover { background: var(--surface-3); }
        .av-rem-card {
            width: 100%; max-width: 440px; background: var(--glass-strong); border: 1px solid var(--border-strong);
            border-radius: var(--r-xl); padding: var(--s-5); box-shadow: var(--shadow-lg); text-align: center;
            display: flex; flex-direction: column; gap: var(--s-4); animation: ui-fade-up 0.35s var(--ease) both;
        }
        .av-rem-photo { width: 100%; max-height: 46vh; object-fit: cover; border-radius: var(--r-lg); box-shadow: var(--shadow-md); }
        .av-rem-noimg { height: 180px; display: flex; align-items: center; justify-content: center; color: var(--text-dim); background: var(--surface-1); }
        .av-rem-cap { font-size: var(--fs-md); font-weight: 700; color: var(--text); }
        .av-rem-line { font-size: var(--fs-lg); line-height: 1.5; color: var(--text); font-style: italic; }
        .av-rem-next {
            align-self: center; min-height: 48px; padding: 0 var(--s-6); border-radius: var(--r-md); border: none;
            background: var(--grad-brand); color: var(--text-on-brand); font-weight: 700; font-size: var(--fs-sm);
            font-family: inherit; cursor: pointer; box-shadow: var(--glow-brand);
            transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .av-rem-next:hover { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124,58,237,0.5); }
        .av-rem-empty { color: var(--text-muted); line-height: 1.6; }
        .av-rem-empty p { margin: 0; font-size: var(--fs-md); }
        .av-rem-empty > svg { color: var(--text-dim); margin: 0 auto; }

        .av-chat {
            width: 420px; flex-shrink: 0; display: flex; flex-direction: column;
            background: var(--glass); backdrop-filter: blur(20px); border-left: 1px solid var(--border);
        }
        @media (max-width: 820px) {
            .av { flex-direction: column; }
            .av-stage { flex: 0 0 56%; min-height: 320px; }
            .av-chat { width: 100%; height: 44%; min-height: 0; border-left: none; border-top: 1px solid var(--border); }
            /* Stacked layout: lift the input above the "Call family" safety button so it's never covered. */
            .av-input { padding-bottom: var(--s-4); }
            .av-tools { max-width: calc(100% - var(--s-10)); }
            .av-caption { bottom: var(--s-4); }
            .av-caption.with-controls { bottom: 104px; }
            .av-name { font-size: var(--fs-xl); }
            .av-cc { bottom: 116px; max-width: 92%; font-size: var(--fs-lg); }
        }
        .av-messages { flex: 1; min-height: 0; overflow-y: auto; padding: var(--s-5); display: flex; flex-direction: column; justify-content: flex-end; gap: var(--s-3); }
        .av-bubble {
            padding: 12px 16px; border-radius: var(--r-lg); font-size: var(--fs-md); line-height: 1.55; max-width: 85%;
            color: var(--text); animation: ui-fade-up 0.35s var(--ease) both;
        }
        .av-bubble.bot { background: var(--surface-2); border: 1px solid var(--border); align-self: flex-start; border-top-left-radius: var(--r-sm); display: flex; flex-direction: column; align-items: flex-start; gap: 7px; }
        .av-again {
            display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: var(--r-pill);
            background: transparent; border: 1px solid var(--border); color: var(--text-muted);
            font-size: var(--fs-xs); font-weight: 700; font-family: inherit; cursor: pointer;
            transition: background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease);
        }
        .av-again:hover:not(:disabled) { background: var(--surface-3); color: var(--text); border-color: var(--border-strong); }
        .av-again:disabled { opacity: 0.45; cursor: default; }
        .av-prep { flex-direction: row !important; align-items: center !important; gap: 8px; font-weight: 600; color: #c4b5fd;
            background: var(--grad-brand-soft); border-color: rgba(139,92,246,0.32); }
        .av-prep > svg { flex-shrink: 0; }
        .av-tool.on { border-color: rgba(139,92,246,0.55); background: rgba(139,92,246,0.18); color: #c4b5fd; }
        .av-cc {
            position: absolute; left: 50%; bottom: 140px; transform: translateX(-50%);
            max-width: min(760px, 88%); text-align: center; z-index: 6;
            background: var(--glass-strong); border: 1px solid var(--border-strong); backdrop-filter: blur(14px);
            color: var(--text); padding: 14px 22px; border-radius: var(--r-lg);
            font-size: var(--fs-xl); font-weight: 700; line-height: 1.4; box-shadow: var(--shadow-lg);
            max-height: 32vh; overflow-y: auto;
        }
        .av-cc.live { border-color: rgba(52,211,153,0.5); box-shadow: var(--shadow-lg), 0 0 0 3px rgba(52,211,153,0.12); }
        .av-bubble.user {
            background: var(--grad-brand-soft); border: 1px solid rgba(139,92,246,0.4); color: var(--text-on-brand);
            align-self: flex-end; border-top-right-radius: var(--r-sm); box-shadow: 0 6px 20px rgba(124,58,237,0.22);
        }
        .av-typing { display: flex; gap: 5px; align-items: center; }
        .av-typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted); animation: avb 1.2s infinite ease-in-out both; }
        .av-typing span:nth-child(2){ animation-delay: .2s; } .av-typing span:nth-child(3){ animation-delay: .4s; }
        @keyframes avb { 0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }
        .av-suggestions { display: flex; flex-wrap: wrap; gap: var(--s-2); padding: 0 var(--s-4) var(--s-3); }
        .av-suggestions button {
            background: var(--grad-brand-soft); border: 1px solid rgba(139,92,246,0.4); color: var(--text);
            padding: 9px 15px; border-radius: var(--r-pill); font-size: var(--fs-sm); font-weight: 600; cursor: pointer; font-family: inherit;
            transition: background var(--dur) var(--ease), color var(--dur) var(--ease), transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .av-suggestions button:hover:not(:disabled) { background: var(--grad-brand); color: var(--text-on-brand); transform: translateY(-2px); box-shadow: var(--glow-brand); }
        .av-suggestions button:disabled { opacity: .5; cursor: default; }
        .av-input { display: flex; gap: var(--s-2); padding: var(--s-4); border-top: 1px solid var(--border); }
        .av-input input {
            flex: 1; background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-md);
            padding: 13px 15px; color: var(--text); outline: none; font-size: var(--fs-md); font-family: inherit;
            transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .av-input input:focus { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }
        .av-input button {
            width: 50px; border-radius: var(--r-md); border: none; background: var(--grad-brand); color: var(--text-on-brand);
            cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: var(--glow-brand);
            transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease), opacity var(--dur) var(--ease);
        }
        .av-input button:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124,58,237,0.5); }
        .av-input button:disabled { opacity: .45; cursor: default; }

        .av-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.62); backdrop-filter: blur(6px); z-index: 100; display: flex; align-items: center; justify-content: center; padding: var(--s-5); }
        .av-modal-card {
            width: 100%; max-width: 640px; max-height: 90vh; overflow-y: auto;
            background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-xl);
            padding: var(--s-8); box-shadow: var(--shadow-lg); backdrop-filter: blur(20px); animation: ui-fade-up 0.4s var(--ease) both;
        }
        .av-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--s-5); }
        .av-modal-head h3 { margin: 0; color: var(--text); font-size: var(--fs-lg); font-weight: 800; }
        .av-modal-head button {
            background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted);
            width: 34px; height: 34px; border-radius: var(--r-sm); cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
        }
        .av-modal-head button:hover { background: var(--surface-3); color: var(--text); }

        /* ══════════════ MOBILE LAYOUT ══════════════════════════════════════════
           Completely restructures the AvatarPage for phones to match the
           reference design:
             ┌─────────────────────────────────────────┐
             │  [Auto-talk]  ●AVATAR●  [Photo]         │
             │  [Remember…]             [Edit]          │
             │  [Captions]              [Personality]   │
             │            Name · Status                 │
             │     ──── chat messages ────              │
             │     suggestion pills                     │
             │ ☎  Talk to Ajay…               ➤        │
             └─────────────────────────────────────────┘
           ══════════════════════════════════════════════════════════════════════ */
        @media (max-width: 640px) {
            /* Root container: fit the viewport between the fixed app bars. */
            .av {
                flex-direction: column !important;
                background: transparent !important;
                overflow: hidden !important;
                height: 100% !important;
            }

            /* Stack the avatar, identity and caption before the wrapped controls. */
            .av-stage {
                flex: 0 0 auto !important;
                position: relative !important;
                min-height: 0 !important;
                overflow: visible !important;
                display: grid !important;
                grid-template-columns: 44px minmax(0, 1fr) 44px !important;
                grid-template-rows: auto auto auto !important;
                align-items: center !important;
                align-content: start !important;
                padding: 12px 12px 10px !important;
                gap: 8px 6px !important;
            }

            /* Hide the 3D canvas / full-stage avatar on mobile — we show a pill photo */
            .av-stage > div:first-child,
            .av-stage canvas,
            .av-stage > div.av-photo { display: none !important; }

            /* The "Photo" mobile avatar circle — we create it via pseudo + tools reuse */
            /* We'll overlay the actual avatar inside av-stage center using a mobile-circle */

            /* Hide desktop-only elements in stage */
            .av-privacy { display: none !important; }
            .av-call { top: auto !important; bottom: 4px !important; left: 50% !important; transform: translateX(-50%) !important; width: max-content !important; }
            .av-controls { position: static !important; transform: none !important; justify-content: center !important; width: 100% !important; background: transparent !important; border: none !important; box-shadow: none !important; backdrop-filter: none !important; padding: 0 !important; }
            .av-bargein { display: none !important; }
            .av-voice-err { bottom: 4px !important; }

            /* Caption block — repositioned below the 3-col section */
            .av-caption {
                grid-column: 1 / -1 !important;
                grid-row: 2 !important;
                position: static !important;
                width: 100% !important;
                text-align: center !important;
                pointer-events: auto !important;
                padding: 2px 0 0 !important;
            }
            .av-name { font-size: 1.3rem !important; font-weight: 800 !important; color: #f8fafc !important; text-shadow: 0 2px 12px rgba(0,0,0,0.72) !important; }
            .av-rel  { font-size: 0.82rem !important; color: #64748b !important; background: none !important; -webkit-text-fill-color: initial !important; color: #64748b !important; }
            .av-state {
                font-size: 0.7rem !important; letter-spacing: 0.1em !important;
                border: 1.5px solid rgba(124,58,237,0.35) !important;
                background: rgba(124,58,237,0.06) !important;
                color: #7c3aed !important; margin-top: 6px !important;
                display: inline-flex !important; align-items: center !important; gap: 6px !important;
            }
            /* Mic wave bars inside status */
            .av-waves span { background: #7c3aed !important; }

            /* ── Reposition av-tools into a left/right column layout ── */
            /* We split tools visually: Auto-talk/Remember/Captions go LEFT of avatar,
               Photo/Edit/Personality go RIGHT of avatar.
               We use CSS order to achieve this by making av-tools a grid. */
            .av-tools {
                position: static !important;
                display: contents !important;   /* let children participate in stage grid */
                max-width: none !important;
            }

            /* Each av-tool becomes a rounded pill button */
            .av-tool {
                width: 100% !important;
                max-width: 100% !important;
                min-width: 0 !important;
                min-height: 44px !important;
                justify-content: center !important;
                padding: 8px !important;
                border-radius: 12px !important;
                white-space: normal !important;
                text-align: center !important;
                line-height: 1.2 !important;
                font-size: 0.72rem !important;
                border: 1.5px solid rgba(124,58,237,0.15) !important;
                background: #fff !important;
                color: #475569 !important;
                box-shadow: 0 2px 8px rgba(100,80,200,0.06) !important;
                display: flex !important;
                align-items: center !important;
                gap: 5px !important;
                backdrop-filter: none !important;
            }
            .av-tool svg { flex: 0 0 16px !important; }
            .av-tool:hover { transform: none !important; }

            /* Call/Auto-talk button stays green */
            .av-tool.call {
                border-color: rgba(34,197,94,0.4) !important;
                background: rgba(34,197,94,0.08) !important;
                color: #16a34a !important;
            }
            /* Active toggle */
            .av-tool.on {
                background: rgba(124,58,237,0.1) !important;
                border-color: rgba(124,58,237,0.3) !important;
                color: #7c3aed !important;
            }
            /* Live-call controls — span all cols, centered */
            .av-call {
                grid-column: 1 / -1 !important; grid-row: 1 !important;
                position: static !important; transform: none !important;
                justify-self: center !important; margin-top: 4px !important;
            }

            /* We need a mobile avatar circle in the stage center.
               We display it via a ::before pseudo on av-stage (the grid center cell). */
            .av-stage::after {
                content: '';
                display: none !important; /* placeholder — actual avatar is shown via av-mob-ring */
            }
            .av-controls {
                grid-column: 1 / -1 !important;
                position: static !important; transform: none !important;
                background: transparent !important; border: none !important;
                box-shadow: none !important; backdrop-filter: none !important;
                padding: 4px 0 !important; justify-content: center !important;
            }
            .av-voice-err { position: absolute !important; bottom: 2px !important; left: 50% !important; transform: translateX(-50%) !important; }
            .av-privacy, .av-bargein, .av-tools { display: none !important; }

            /* ── Chat section ── */
            /* ── Chat panel ── */
            .av-chat {
                width: 100% !important;
                height: auto !important;
                flex: 1 1 auto !important;
                min-height: 0 !important;
                border-left: none !important;
                border-top: none !important;
                background: transparent !important;
                backdrop-filter: none !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                width: 100% !important; height: auto !important;
                flex: 1 1 auto !important; min-height: 0 !important;
                border-left: none !important; border-top: none !important;
                background: transparent !important; backdrop-filter: none !important;
                display: flex !important; flex-direction: column !important; overflow: hidden !important;
            }

            .av-messages {
                flex: 1 !important;
                padding: 10px 14px !important;
                gap: 10px !important;
                justify-content: flex-start !important;
                overflow-y: auto !important;
                -webkit-overflow-scrolling: touch !important;
                flex: 1 !important; padding: 10px 14px !important;
                gap: 10px !important; justify-content: flex-start !important;
                overflow-y: auto !important; -webkit-overflow-scrolling: touch !important;
            }

            /* Bot messages → white card like reference */
            /* Bot messages → white card */
            .av-bubble.bot {
                background: #fff !important;
                border: 1px solid rgba(124,58,237,0.08) !important;
                border-radius: 16px !important;
                border-top-left-radius: 4px !important;
                border-radius: 16px !important; border-top-left-radius: 4px !important;
                box-shadow: 0 2px 10px rgba(100,80,200,0.06) !important;
                color: #0f0c2e !important;
                font-size: 0.9rem !important;
                max-width: 92% !important;
                padding: 14px 16px !important;
                color: #0f0c2e !important; font-size: 0.9rem !important;
                max-width: 92% !important; padding: 14px 16px !important;
                display: flex !important; flex-direction: column !important; gap: 8px !important;
            }
            /* User messages → purple tint */
            .av-bubble.user {
                background: linear-gradient(135deg, rgba(124,58,237,0.12), rgba(79,70,229,0.12)) !important;
                border: 1px solid rgba(124,58,237,0.2) !important;
                border-radius: 16px !important;
                border-top-right-radius: 4px !important;
                color: #0f0c2e !important;
                font-size: 0.9rem !important;
                max-width: 85% !important;
                border: 1px solid rgba(124,58,237,0.18) !important;
                border-radius: 16px !important; border-top-right-radius: 4px !important;
                color: #0f0c2e !important; font-size: 0.9rem !important; max-width: 85% !important;
            }

            /* "Say it again" button */
            /* "Say it again" */
            .av-again {
                background: rgba(124,58,237,0.06) !important;
                border: 1.5px solid rgba(124,58,237,0.2) !important;
                color: #7c3aed !important;
                border-radius: 999px !important;
                font-size: 0.78rem !important;
                color: #7c3aed !important; border-radius: 999px !important; font-size: 0.78rem !important;
            }

            /* Compact prompt chips leave more room for the conversation on phones. */
            .av-suggestions {
                padding: 2px 12px 6px !important;
                gap: 6px !important;
                flex-wrap: wrap !important;
            }
            .av-suggestions button {
                min-height: 34px !important;
                padding: 5px 10px !important;
                border: 1.5px solid rgba(124,58,237,0.18) !important;
                border-radius: 999px !important;
                background: rgba(124,58,237,0.07) !important;
                color: #475569 !important;
                font-size: 0.74rem !important;
                font-weight: 600 !important;
                line-height: 1.3 !important;
                white-space: nowrap;
                display: inline-flex !important;
                align-items: center !important;
                gap: 6px !important;
                transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
            }
            .av-suggestions button:hover:not(:disabled) {
                background: rgba(124,58,237,0.13) !important;
                color: #0f0c2e !important;
                transform: none !important;
                box-shadow: none !important;
            }

            /* ── Bottom input bar ── */
            .av-input {
                padding: 10px 12px 14px 76px !important;
                gap: 8px !important;
                border-top: 1px solid rgba(124,58,237,0.08) !important;
                background: rgba(255,255,255,0.9) !important;
                align-items: center !important;
                display: flex !important;
                background: rgba(255,255,255,0.95) !important;
                align-items: center !important; display: flex !important;
            }

            /* The phone FAB replaces the normal send button on the left — using the
               av-input's first child (the input) + second child (send btn).
               We inject a call button via the existing av-tool.call in a sibling, but
               to keep it clean we style the input row here. */
            .av-input input {
                background: rgba(124,58,237,0.05) !important;
                border: 1.5px solid rgba(124,58,237,0.12) !important;
                border-radius: 999px !important;
                padding: 12px 16px !important;
                font-size: 0.88rem !important;
                color: #0f0c2e !important;
                flex: 1 !important;
                border-radius: 999px !important; padding: 12px 16px !important;
                font-size: 0.88rem !important; color: #0f0c2e !important; flex: 1 !important;
            }
            .av-input input::placeholder { color: #94a3b8 !important; }
            .av-input input:focus { border-color: #7c3aed !important; }

            /* Send button → purple rounded square */
            .av-input input:focus { border-color: #7c3aed !important; box-shadow: none !important; }
            .av-input button {
                width: 44px !important; height: 44px !important;
                min-height: 44px !important;
                width: 44px !important; height: 44px !important; min-height: 44px !important;
                border-radius: 14px !important;
                background: linear-gradient(135deg, #7c3aed, #4f46e5) !important;
                box-shadow: 0 4px 14px rgba(124,58,237,0.35) !important;
                box-shadow: 0 4px 14px rgba(124,58,237,0.35) !important; opacity: 1 !important;
            }

            /* Captions stay readable but never cover the avatar or the chat composer. */
            .av-cc {
                grid-column: 1 / -1 !important;
                grid-row: 3 !important;
                position: static !important;
                width: 100% !important;
                max-width: 100% !important;
                max-height: min(96px, 16vh) !important;
                margin: 0 !important;
                padding: 10px 14px !important;
                overflow-y: auto !important;
                transform: none !important;
                font-size: 0.9rem !important;
                line-height: 1.4 !important;
                border-radius: 16px !important;
            }
        }
      `}</style>
        </div>
    );
}
