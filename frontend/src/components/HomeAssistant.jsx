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
            background: var(--glass-strong);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            padding: var(--s-5);
            border-radius: var(--r-xl);
            width: 100%;
            max-width: 420px;
            box-shadow: var(--shadow-lg);
            display: flex;
            flex-direction: column;
            font-family: inherit;
            animation: ui-fade-up 0.6s var(--ease) both;
        }
        .fa-header { display: flex; align-items: center; gap: var(--s-3); padding-bottom: var(--s-4); border-bottom: 1px solid var(--border); }
        .fa-avatar {
            width: 44px; height: 44px; border-radius: var(--r-md);
            display: flex; align-items: center; justify-content: center;
            background: var(--grad-brand); box-shadow: var(--glow-brand);
            flex-shrink: 0;
        }
        .fa-id { flex: 1; min-width: 0; }
        .fa-name { font-weight: 800; color: var(--text); font-size: var(--fs-md); letter-spacing: -0.01em; }
        .fa-status { font-size: var(--fs-xs); color: var(--text-muted); display: flex; align-items: center; gap: 6px; font-weight: 600; }
        .fa-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .fa-dot.on { background: var(--success); box-shadow: 0 0 8px var(--success); }
        .fa-dot.off { background: var(--warning); box-shadow: 0 0 8px var(--warning); }
        .fa-voice {
            background: var(--surface-2); border: 1px solid var(--border);
            color: var(--text-muted); width: 34px; height: 34px; border-radius: var(--r-sm);
            display: flex; align-items: center; justify-content: center; cursor: pointer;
            transition: background var(--dur) var(--ease), color var(--dur) var(--ease), transform var(--dur) var(--ease);
        }
        .fa-voice:hover { background: var(--surface-3); color: var(--text); transform: translateY(-1px); }

        .fa-messages {
            display: flex; flex-direction: column; gap: var(--s-3);
            margin: var(--s-4) 0; max-height: 240px; min-height: 180px;
            overflow-y: auto; padding-right: var(--s-1);
        }
        .fa-messages::-webkit-scrollbar { width: 6px; }
        .fa-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.16); border-radius: var(--r-pill); }

        .fa-bubble {
            padding: 10px 14px; border-radius: var(--r-md); font-size: var(--fs-sm);
            line-height: 1.5; max-width: 85%; word-wrap: break-word; color: var(--text);
            animation: ui-fade-up 0.4s var(--ease) both;
        }
        .fa-bubble.bot { background: var(--surface-2); border: 1px solid var(--border); border-top-left-radius: var(--r-sm); align-self: flex-start; color: var(--text); }
        .fa-bubble.user {
            background: var(--grad-brand-soft);
            border: 1px solid rgba(139,92,246,0.4); color: #fff;
            align-self: flex-end; border-top-right-radius: var(--r-sm);
        }
        .fa-bubble-img { display: block; margin-top: var(--s-2); width: 100%; border-radius: var(--r-sm); }

        .fa-typing { display: flex; gap: 5px; align-items: center; }
        .fa-typing span {
            width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted);
            animation: fa-blink 1.2s infinite ease-in-out both;
        }
        .fa-typing span:nth-child(2) { animation-delay: 0.2s; }
        .fa-typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes fa-blink { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }

        .fa-suggestions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-bottom: var(--s-3); }
        .fa-chip {
            background: rgba(139, 92, 246, 0.14); border: 1px solid rgba(139, 92, 246, 0.32);
            color: #ddd6fe; padding: 6px 14px; border-radius: var(--r-pill); font-size: var(--fs-xs); font-weight: 600;
            cursor: pointer; transition: background var(--dur) var(--ease), color var(--dur) var(--ease), transform var(--dur) var(--ease);
        }
        .fa-chip:hover:not(:disabled) { background: rgba(139, 92, 246, 0.26); color: #fff; transform: translateY(-1px); }
        .fa-chip:disabled { opacity: 0.5; cursor: default; }

        .fa-input-row { display: flex; gap: var(--s-2); align-items: center; }
        .fa-input {
            flex: 1; background: var(--glass-strong); border: 1px solid var(--border);
            border-radius: var(--r-md); padding: 12px 14px; color: var(--text); font-size: var(--fs-sm); outline: none;
            transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .fa-input::placeholder { color: var(--text-dim); }
        .fa-input:focus { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }
        .fa-send {
            width: 44px; height: 44px; border-radius: var(--r-md); border: none; flex-shrink: 0;
            background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand);
            display: flex; align-items: center; justify-content: center; cursor: pointer;
            transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .fa-send:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124, 58, 237, 0.5); }
        .fa-send:disabled { opacity: 0.45; cursor: default; transform: none; box-shadow: none; }
      `}</style>
        </div>
    );
};

export default HomeAssistant;
