import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Send, Pencil, Volume2, X, User, Box, Phone, PhoneOff, Mic } from 'lucide-react';
import Avatar3D from '../components/Avatar3D';
import PhotoAvatar from '../components/PhotoAvatar';
import PersonaEditor from '../components/PersonaEditor';
import { useAppState, setPersona, addTurn } from '../lib/store';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';

export default function AvatarPage() {
    const { persona, profile } = useAppState();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [editing, setEditing] = useState(false);
    const [mode, setMode] = useState('photo'); // 'photo' | '3d'
    const [callMode, setCallMode] = useState(false);
    const [listening, setListening] = useState(false);
    const [voiceError, setVoiceError] = useState(null);
    const scrollRef = useRef(null);
    const audioRef = useRef(null);
    const recognitionRef = useRef(null);
    const callModeRef = useRef(false);   // mirror of callMode for async callbacks
    const messagesRef = useRef([]);      // latest messages (avoid stale-closure history)
    const busyRef = useRef(false);       // thinking or speaking -> ignore the mic
    const startListenRef = useRef(null); // always the freshest startListening
    const lastSpokenRef = useRef('');    // filter the avatar's own voice echo
    const lastActivityRef = useRef(Date.now()); // last time the user spoke/typed
    const nudgeCountRef = useRef(0);     // cap proactive check-ins

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

    // Prefer the generated 3D likeness if there is one, then a real photo, else the head.
    useEffect(() => {
        setMode(persona?.modelUrl ? '3d' : (persona?.faceImage ? 'photo' : '3d'));
    }, [persona?.modelUrl, persona?.faceImage]);

    // Tear down mic + audio if we leave the page.
    useEffect(() => () => {
        callModeRef.current = false;
        try { recognitionRef.current?.stop(); } catch (e) { /* noop */ }
        window.speechSynthesis?.cancel();
    }, []);

    // Warm greeting from the persona on first open (localized).
    useEffect(() => {
        if (persona) {
            const u = profile?.name || 'dear';
            const lang = (persona.language || '').toLowerCase();
            const greet = lang === 'hindi'
                ? `नमस्ते ${u}, मैं ${persona.name} हूँ। तुमसे मिलकर बहुत खुशी हुई। कैसे हो तुम?`
                : lang === 'hinglish'
                    ? `Arre ${u}! Main ${persona.name}. Tumse milke bahut khushi hui. Kaise ho?`
                    : `Hello ${u}, it's ${persona.name}. I'm so glad you're here. How are you feeling?`;
            setMessages([{ role: 'bot', text: greet }]);
        }
    }, [persona?.name, persona?.language]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, isThinking]);

    // Keep a live ref of messages so async voice callbacks send real history.
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // Proactive companion: if the user goes quiet, gently check in (up to twice).
    useEffect(() => {
        const linesFor = (lang, name) => {
            if (lang === 'hindi') return [`तुम वहाँ हो ना, ${name}? मैं यहीं हूँ।`, `अभी कैसा महसूस कर रहे हो, ${name}?`];
            if (lang === 'hinglish') return [`Tum wahan ho na ${name}? Main yahin hoon.`, `Abhi kaisa feel kar rahe ho, ${name}?`];
            return [`Are you still there, ${name}? I'm right here with you.`, `How are you feeling right now, ${name}?`];
        };
        const id = setInterval(() => {
            if (callModeRef.current || busyRef.current || editing) return;
            if (Date.now() - lastActivityRef.current < 22000) return;
            if (nudgeCountRef.current >= 2) return;
            const name = profile?.name || 'dear';
            const opts = linesFor((persona?.language || '').toLowerCase(), name);
            const line = opts[nudgeCountRef.current % opts.length];
            nudgeCountRef.current += 1;
            lastActivityRef.current = Date.now();
            setMessages((p) => [...p, { role: 'bot', text: line }]);
            addTurn('bot', line);
            speak(line);
        }, 5000);
        return () => clearInterval(id);
    }, [persona?.language, profile?.name, editing]);

    if (!persona) return null;

    const speak = async (text) => {
        lastSpokenRef.current = (text || '').toLowerCase();
        // After the avatar finishes speaking, resume listening if we're in a live call.
        // The 700ms gap lets the speaker audio settle so the mic doesn't catch the tail.
        const afterSpeak = () => {
            setIsSpeaking(false);
            busyRef.current = false;
            if (callModeRef.current) setTimeout(() => startListenRef.current?.(), 700);
        };
        try {
            const r = await axios.post(`${API_BASE}/tts`, { text, voice: persona.voiceId, clone_voice_id: persona.voiceCloneId }, { timeout: 30000 });
            if (r.data?.audio_base64) {
                const audio = new Audio(`data:audio/mpeg;base64,${r.data.audio_base64}`);
                audioRef.current = audio;
                setIsSpeaking(true);
                audio.onended = afterSpeak;
                audio.onerror = afterSpeak;
                await audio.play();
                return;
            }
        } catch (e) { /* fall back to browser speech below */ }
        // Fallback: browser speech synthesis so the avatar always speaks — set the
        // language and pick a matching installed voice so Hindi is spoken in Hindi.
        if (window.speechSynthesis) {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = ttsLang;
            const vs = window.speechSynthesis.getVoices();
            const base = ttsLang.split('-')[0];
            const match = vs.find((v) => v.lang === ttsLang) || vs.find((v) => v.lang?.startsWith(base));
            if (match) u.voice = match;
            setIsSpeaking(true);
            u.onend = afterSpeak;
            u.onerror = afterSpeak;
            window.speechSynthesis.speak(u);
        } else {
            afterSpeak();
        }
    };

    const playRealVoice = () => {
        if (!persona.voiceSample) return;
        const audio = new Audio(persona.voiceSample);
        setIsSpeaking(true);
        audio.onended = () => setIsSpeaking(false);
        audio.play().catch(() => setIsSpeaking(false));
    };

    // One conversational turn: user text -> persona reply -> speak it.
    const runTurn = async (text) => {
        const q = (text ?? '').trim();
        if (!q) return;
        busyRef.current = true; // block the mic until we've finished replying + speaking
        lastActivityRef.current = Date.now();
        nudgeCountRef.current = 0; // user responded -> allow future proactive check-ins
        const history = messagesRef.current.slice(-8);
        setMessages((p) => [...p, { role: 'user', text: q }]);
        addTurn('user', q); // persist for the wellbeing evaluation
        setIsThinking(true);
        try {
            const r = await axios.post(`${API_BASE}/persona/chat`, {
                text: q,
                persona: { name: persona.name, relationship: persona.relationship, personality: persona.personality, gender: persona.gender, age: persona.age, accent: persona.accent, language: persona.language },
                user: { name: profile?.name },
                history,
            }, { timeout: 30000 });
            const reply = r.data?.text || `I'm right here with you, ${profile?.name || 'dear'}.`;
            setMessages((p) => [...p, { role: 'bot', text: reply }]);
            addTurn('bot', reply);
            setIsThinking(false);
            speak(reply); // busyRef stays true until speaking ends (afterSpeak)
        } catch (e) {
            setMessages((p) => [...p, { role: 'bot', text: `I'm right here with you, ${profile?.name || 'dear'}.` }]);
            setIsThinking(false);
            busyRef.current = false;
            if (callModeRef.current) setTimeout(() => startListenRef.current?.(), 500);
        }
    };

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
        startListening();
    };

    const endCall = () => {
        callModeRef.current = false;
        busyRef.current = false;
        setCallMode(false);
        setListening(false);
        try { recognitionRef.current?.abort(); } catch (e) { /* noop */ }
        window.speechSynthesis?.cancel();
        if (audioRef.current) { try { audioRef.current.pause(); } catch (e) { /* noop */ } }
        setIsSpeaking(false);
    };

    const saveEdit = (p) => { setPersona({ ...persona, ...p }); setEditing(false); };

    return (
        <div className="av">
            {/* Stage: the companion's face (real photo) or the 3D head */}
            <div className="av-stage">
                {mode === 'photo' && persona.faceImage
                    ? <PhotoAvatar src={persona.faceImage} isSpeaking={isSpeaking} name={persona.name} />
                    : <Avatar3D isSpeaking={isSpeaking} src={persona.modelUrl || '/model.glb'} />}

                {/* Live call banner */}
                {callMode && (
                    <div className="av-call">
                        <span className={`av-call-dot ${listening ? 'live' : ''}`} />
                        <span className="av-call-text">
                            {isSpeaking ? `${persona.name} is speaking…` : isThinking ? 'Thinking…' : listening ? 'Listening — speak now' : 'Connecting…'}
                        </span>
                        <button className="av-call-end" onClick={endCall}><PhoneOff size={15} /> End</button>
                    </div>
                )}
                {voiceError && <div className="av-voice-err" onClick={() => setVoiceError(null)}>{voiceError}</div>}

                <div className="av-caption">
                    <div className="av-name">{persona.name}</div>
                    <div className="av-rel">your {persona.relationship}</div>
                    <div className={`av-state ${isSpeaking ? 'speaking' : isThinking ? 'thinking' : ''}`}>
                        {isSpeaking ? 'Speaking…' : isThinking ? 'Thinking…' : 'Listening'}
                    </div>
                </div>
                <div className="av-tools">
                    {!callMode && (
                        <button className="av-tool call" onClick={startCall} title="Talk hands-free, voice to voice">
                            <Phone size={16} /> Auto-talk
                        </button>
                    )}
                    {persona.faceImage && (
                        <button className="av-tool" onClick={() => setMode((m) => (m === 'photo' ? '3d' : 'photo'))} title="Switch between their photo and the 3D avatar">
                            {mode === 'photo' ? <><Box size={16} /> 3D</> : <><User size={16} /> Photo</>}
                        </button>
                    )}
                    {persona.voiceSample && (
                        <button className="av-tool" onClick={playRealVoice} title="Play their real recorded voice">
                            <Volume2 size={16} /> Their voice
                        </button>
                    )}
                    <button className="av-tool" onClick={() => setEditing(true)} title="Edit companion">
                        <Pencil size={16} /> Edit
                    </button>
                </div>
            </div>

            {/* Chat */}
            <div className="av-chat">
                <div className="av-messages" ref={scrollRef}>
                    {messages.map((m, i) => (
                        <div key={i} className={`av-bubble ${m.role}`}>{m.text}</div>
                    ))}
                    {isThinking && <div className="av-bubble bot av-typing"><span /><span /><span /></div>}
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
        .av { display: flex; height: 100%; width: 100%; background: linear-gradient(135deg,#0f172a,#1e1b4b); overflow: hidden; }
        .av-stage { flex: 1; position: relative; min-width: 0; }
        .av-caption { position: absolute; bottom: 28px; left: 0; right: 0; text-align: center; pointer-events: none; }
        .av-name { font-size: 1.8rem; font-weight: 800; color: #fff; text-shadow: 0 2px 20px rgba(0,0,0,0.6); }
        .av-rel { color: #c4b5fd; font-size: 0.95rem; margin-top: 2px; }
        .av-state { display: inline-block; margin-top: 10px; font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; color: #60a5fa; padding: 5px 14px; border: 1px solid rgba(96,165,250,0.4); border-radius: 20px; background: rgba(96,165,250,0.12); }
        .av-state.speaking { color: #4ade80; border-color: rgba(74,222,128,0.5); background: rgba(74,222,128,0.12); }
        .av-state.thinking { color: #c4b5fd; border-color: rgba(167,139,250,0.5); background: rgba(167,139,250,0.12); }
        .av-tools { position: absolute; top: 18px; right: 18px; display: flex; gap: 8px; }
        .av-tool { display: flex; align-items: center; gap: 6px; padding: 8px 13px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.14); background: rgba(15,23,42,0.6); backdrop-filter: blur(8px); color: #e2e8f0; cursor: pointer; font-size: 0.82rem; }
        .av-tool:hover { background: rgba(15,23,42,0.85); }
        .av-tool.call { border-color: rgba(74,222,128,0.5); background: rgba(74,222,128,0.14); color: #86efac; }
        .av-tool.call:hover { background: rgba(74,222,128,0.24); }

        .av-call { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 9px 16px; border-radius: 30px; background: rgba(15,23,42,0.85); backdrop-filter: blur(10px); border: 1px solid rgba(74,222,128,0.4); box-shadow: 0 8px 30px rgba(0,0,0,0.4); z-index: 5; }
        .av-call-dot { width: 12px; height: 12px; border-radius: 50%; background: #64748b; flex-shrink: 0; }
        .av-call-dot.live { background: #f87171; animation: av-call-pulse 1.1s infinite; }
        @keyframes av-call-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(248,113,113,0.6); } 50% { box-shadow: 0 0 0 8px rgba(248,113,113,0); } }
        .av-call-text { color: #e2e8f0; font-size: 0.85rem; font-weight: 600; white-space: nowrap; }
        .av-call-end { display: flex; align-items: center; gap: 5px; background: #ef4444; color: #fff; border: none; padding: 6px 12px; border-radius: 20px; cursor: pointer; font-weight: 700; font-size: 0.8rem; }
        .av-call-end:hover { background: #dc2626; }
        .av-voice-err { position: absolute; bottom: 90px; left: 50%; transform: translateX(-50%); background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.4); color: #fca5a5; padding: 10px 16px; border-radius: 12px; font-size: 0.85rem; max-width: 80%; text-align: center; cursor: pointer; z-index: 5; }

        .av-chat { width: 420px; flex-shrink: 0; display: flex; flex-direction: column; background: rgba(15,23,42,0.6); backdrop-filter: blur(20px); border-left: 1px solid rgba(255,255,255,0.08); }
        @media (max-width: 820px) { .av { flex-direction: column; } .av-chat { width: 100%; height: 50%; } }
        .av-messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 10px; }
        .av-bubble { padding: 11px 15px; border-radius: 15px; font-size: 0.95rem; line-height: 1.5; max-width: 85%; color: #e2e8f0; }
        .av-bubble.bot { background: rgba(30,41,59,0.9); align-self: flex-start; border-top-left-radius: 3px; }
        .av-bubble.user { background: linear-gradient(135deg, rgba(124,58,237,0.4), rgba(37,99,235,0.4)); border: 1px solid rgba(124,58,237,0.4); color: #fff; align-self: flex-end; border-top-right-radius: 3px; }
        .av-typing { display: flex; gap: 5px; }
        .av-typing span { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; animation: avb 1.2s infinite ease-in-out both; }
        .av-typing span:nth-child(2){ animation-delay: .2s; } .av-typing span:nth-child(3){ animation-delay: .4s; }
        @keyframes avb { 0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }
        .av-suggestions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 10px; }
        .av-suggestions button { background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.3); color: #c4b5fd; padding: 6px 12px; border-radius: 16px; font-size: 0.78rem; cursor: pointer; }
        .av-suggestions button:hover:not(:disabled) { background: rgba(124,58,237,0.25); color: #fff; }
        .av-suggestions button:disabled { opacity: .5; }
        .av-input { display: flex; gap: 8px; padding: 14px 16px; border-top: 1px solid rgba(255,255,255,0.08); }
        .av-input input { flex: 1; background: rgba(15,23,42,0.9); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 12px 14px; color: #fff; outline: none; font-size: 0.92rem; }
        .av-input input:focus { border-color: #a78bfa; }
        .av-input button { width: 46px; border-radius: 12px; border: none; background: linear-gradient(135deg,#7c3aed,#2563eb); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .av-input button:disabled { opacity: .45; }

        .av-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .av-modal-card { width: 100%; max-width: 640px; max-height: 90vh; overflow-y: auto; background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 26px; }
        .av-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
        .av-modal-head h3 { margin: 0; color: #fff; font-size: 1.2rem; }
        .av-modal-head button { background: rgba(255,255,255,0.08); border: none; color: #cbd5e1; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
      `}</style>
        </div>
    );
}
