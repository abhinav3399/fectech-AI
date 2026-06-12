import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Send, Sparkles, Volume2, VolumeX } from 'lucide-react';

// Relative by default -> same origin as the served page (single-origin).
const API_BASE = import.meta.env.VITE_API_BASE || "/api/v1";

const SUGGESTIONS = [
    "What can you do?",
    "Who is Aunt May?",
    "Where are my keys?",
];

// Lightweight offline answers so the assistant is never "dead" if the
// backend isn't running. Real answers come from /chat/query when online.
const localFallback = (q) => {
    const t = q.toLowerCase();
    if (t.includes("what can you") || t.includes("help") || t.includes("do you do")) {
        return "I'm your Factech AI memory assistant. I can recognise faces, find your personal objects, and answer questions about the people in your life. Open the app to enrol your first memory.";
    }
    if (t.includes("who")) {
        return "Once your caregiver enrols people, I'll instantly recall who they are, your relationship, and any notes — just point the camera or ask me by name.";
    }
    if (t.includes("where") || t.includes("find") || t.includes("key") || t.includes("wallet")) {
        return "I remember where your important objects were last seen. Scan an item once and I'll help you find it again.";
    }
    return "I'm running in preview mode right now. Start the assistant to unlock live memory recall, face recognition, and voice replies.";
};

const HomeAssistant = ({ onGetStarted }) => {
    const [messages, setMessages] = useState([
        { role: 'bot', text: "Hi, I'm your Factech AI assistant. Ask me to recall a person, find an object, or tell you what I can do." }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [online, setOnline] = useState(null); // null = unknown, true, false
    const [voiceOn, setVoiceOn] = useState(true);
    const scrollRef = useRef(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping]);

    const speak = (text) => {
        if (!voiceOn || typeof window === 'undefined' || !window.speechSynthesis) return;
        try {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 0.95;
            window.speechSynthesis.speak(u);
        } catch (e) { /* ignore unsupported */ }
    };

    const send = async (raw) => {
        const q = (raw ?? input).trim();
        if (!q || isTyping) return;
        setInput('');
        setMessages((prev) => [...prev, { role: 'user', text: q }]);
        setIsTyping(true);
        try {
            const res = await axios.post(`${API_BASE}/chat/query`, { text: q }, { timeout: 20000 });
            setOnline(true);
            const data = res.data || {};
            const reply = data.text || "I couldn't find anything about that in my memory yet.";
            setMessages((prev) => [...prev, { role: 'bot', text: reply, image: data.image_base64 || null }]);
            speak(reply);
        } catch (e) {
            setOnline(false);
            const reply = localFallback(q);
            setMessages((prev) => [...prev, { role: 'bot', text: reply }]);
        } finally {
            setIsTyping(false);
        }
    };

    const onKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    };

    return (
        <div className="fa-assistant">
            <div className="fa-header">
                <div className="fa-avatar">
                    <Sparkles size={20} color="#fff" />
                </div>
                <div className="fa-id">
                    <div className="fa-name">Factech AI Assistant</div>
                    <div className="fa-status">
                        <span className={`fa-dot ${online === false ? 'off' : 'on'}`}></span>
                        {online === false ? 'Preview mode' : 'Online'}
                    </div>
                </div>
                <button
                    className="fa-voice"
                    onClick={() => setVoiceOn((v) => !v)}
                    title={voiceOn ? 'Mute voice' : 'Enable voice'}
                    aria-label={voiceOn ? 'Mute voice' : 'Enable voice'}
                >
                    {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
                </button>
            </div>

            <div className="fa-messages" ref={scrollRef}>
                {messages.map((m, i) => (
                    <div key={i} className={`fa-bubble ${m.role}`}>
                        {m.text}
                        {m.image && (
                            <img src={m.image} alt="memory" className="fa-bubble-img" />
                        )}
                    </div>
                ))}
                {isTyping && (
                    <div className="fa-bubble bot fa-typing">
                        <span></span><span></span><span></span>
                    </div>
                )}
            </div>

            <div className="fa-suggestions">
                {SUGGESTIONS.map((s) => (
                    <button key={s} className="fa-chip" onClick={() => send(s)} disabled={isTyping}>
                        {s}
                    </button>
                ))}
            </div>

            <div className="fa-input-row">
                <input
                    className="fa-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Ask Factech AI anything…"
                    aria-label="Message Factech AI"
                />
                <button className="fa-send" onClick={() => send()} disabled={isTyping || !input.trim()} aria-label="Send">
                    <Send size={18} />
                </button>
            </div>

            <style>{`
        .fa-assistant {
            background: rgba(30, 41, 59, 0.7);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255,255,255,0.1);
            padding: 18px;
            border-radius: 20px;
            width: 100%;
            max-width: 420px;
            box-shadow: 0 20px 50px rgba(0,0,0,0.35);
            display: flex;
            flex-direction: column;
            font-family: system-ui, sans-serif;
        }
        .fa-header { display: flex; align-items: center; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .fa-avatar {
            width: 44px; height: 44px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            background: linear-gradient(135deg, #7c3aed, #2563eb);
            flex-shrink: 0;
        }
        .fa-id { flex: 1; min-width: 0; }
        .fa-name { font-weight: 700; color: #fff; font-size: 0.95rem; }
        .fa-status { font-size: 0.8rem; color: #94a3b8; display: flex; align-items: center; gap: 6px; }
        .fa-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .fa-dot.on { background: #4ade80; box-shadow: 0 0 8px #4ade80; }
        .fa-dot.off { background: #fbbf24; box-shadow: 0 0 8px #fbbf24; }
        .fa-voice {
            background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
            color: #cbd5e1; width: 32px; height: 32px; border-radius: 10px;
            display: flex; align-items: center; justify-content: center; cursor: pointer; transition: 0.2s;
        }
        .fa-voice:hover { background: rgba(255,255,255,0.16); color: #fff; }

        .fa-messages {
            display: flex; flex-direction: column; gap: 10px;
            margin: 14px 0; max-height: 240px; min-height: 180px;
            overflow-y: auto; padding-right: 4px;
        }
        .fa-messages::-webkit-scrollbar { width: 6px; }
        .fa-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }

        .fa-bubble {
            padding: 10px 14px; border-radius: 14px; font-size: 0.9rem;
            line-height: 1.45; max-width: 85%; word-wrap: break-word; color: #e2e8f0;
        }
        .fa-bubble.bot { background: rgba(15, 23, 42, 0.85); border-top-left-radius: 2px; align-self: flex-start; }
        .fa-bubble.user {
            background: linear-gradient(135deg, rgba(124,58,237,0.35), rgba(37,99,235,0.35));
            border: 1px solid rgba(124,58,237,0.4); color: #fff;
            align-self: flex-end; border-top-right-radius: 2px;
        }
        .fa-bubble-img { display: block; margin-top: 8px; width: 100%; border-radius: 10px; }

        .fa-typing { display: flex; gap: 5px; align-items: center; }
        .fa-typing span {
            width: 7px; height: 7px; border-radius: 50%; background: #94a3b8;
            animation: fa-blink 1.2s infinite ease-in-out both;
        }
        .fa-typing span:nth-child(2) { animation-delay: 0.2s; }
        .fa-typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes fa-blink { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }

        .fa-suggestions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        .fa-chip {
            background: rgba(124, 58, 237, 0.12); border: 1px solid rgba(124, 58, 237, 0.3);
            color: #c4b5fd; padding: 6px 12px; border-radius: 16px; font-size: 0.78rem;
            cursor: pointer; transition: 0.2s;
        }
        .fa-chip:hover:not(:disabled) { background: rgba(124, 58, 237, 0.25); color: #fff; }
        .fa-chip:disabled { opacity: 0.5; cursor: default; }

        .fa-input-row { display: flex; gap: 8px; align-items: center; }
        .fa-input {
            flex: 1; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255,255,255,0.12);
            border-radius: 12px; padding: 12px 14px; color: #fff; font-size: 0.9rem; outline: none; transition: 0.2s;
        }
        .fa-input::placeholder { color: #64748b; }
        .fa-input:focus { border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(167,139,250,0.15); }
        .fa-send {
            width: 44px; height: 44px; border-radius: 12px; border: none; flex-shrink: 0;
            background: linear-gradient(135deg, #7c3aed, #2563eb); color: #fff;
            display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.15s;
        }
        .fa-send:hover:not(:disabled) { transform: scale(1.06); }
        .fa-send:disabled { opacity: 0.45; cursor: default; }
      `}</style>
        </div>
    );
};

export default HomeAssistant;
