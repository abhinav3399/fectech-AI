import React, { useRef, useState } from 'react';
import { Plus, Image as ImageIcon, Trash2, Volume2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AudioRecorder from '../components/AudioRecorder';
import { useAppState, addMemory, removeMemory } from '../lib/store';
import { toast, confirmAction } from '../components/Feedback';
import { ScrollReveal, GlassCard, StaggerContainer } from '../components/MotionPrimitives';

const fileToDataUrl = (file) =>
    new Promise((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result);
        r.readAsDataURL(file);
    });

export default function MemoriesPage() {
    const { memories, persona } = useAppState();
    const [adding, setAdding] = useState(false);
    const [caption, setCaption] = useState('');
    const [image, setImage] = useState(null);
    const [voice, setVoice] = useState(null);
    const [filter, setFilter] = useState('all'); 
    const fileRef = useRef(null);

    const matchesFilter = (m) => filter === 'all' ? true : filter === 'photos' ? !!m.image : !!m.voice;
    const bucketOf = (m) => {
        const d = new Date(m.date), now = new Date();
        if (d.toDateString() === now.toDateString()) return 'Today';
        if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'This month';
        return 'Older';
    };
    const filtered = memories.filter(matchesFilter);
    const grouped = ['Today', 'This month', 'Older']
        .map((label) => [label, filtered.filter((m) => bucketOf(m) === label)])
        .filter(([, arr]) => arr.length);
    const FILTERS = [['all', 'All'], ['photos', 'Photos'], ['voice', 'Voice notes']];

    const pickImage = async (e) => {
        const f = e.target.files?.[0];
        if (f) setImage(await fileToDataUrl(f));
    };
    const onVoice = async (blob) => {
        if (!blob) { setVoice(null); return; }
        const r = new FileReader();
        r.onloadend = () => setVoice(r.result);
        r.readAsDataURL(blob);
    };

    const reset = () => { setCaption(''); setImage(null); setVoice(null); setAdding(false); };
    const save = () => {
        if (!caption.trim() && !image) return;
        addMemory({ caption: caption.trim(), image, voice });
        reset();
        toast('Memory saved', 'success');
    };

    const del = async (m) => {
        const ok = await confirmAction({
            title: 'Delete this memory?',
            message: 'This can’t be undone. The photo, note, and voice for this memory will be removed.',
            confirmLabel: 'Delete', danger: true,
        });
        if (ok) { removeMemory(m.id); toast('Memory deleted', 'info'); }
    };

    const playVoice = (src) => { new Audio(src).play().catch(() => {}); };

    return (
        <div className="mem">
            <ScrollReveal>
                <div className="mem-head">
                    <div className="mem-head-text">
                        <h1 className="mem-title">Memories Gallery</h1>
                        <p className="mem-subtitle">Special moments{persona?.name ? ` shared with ${persona.name}` : ' worth holding onto'}.</p>
                    </div>
                    <motion.button 
                        className="mem-add" 
                        onClick={() => setAdding(true)}
                        whileHover={{ scale: 1.05, boxShadow: "0 10px 20px rgba(124,58,237,0.4)" }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <Plus size={18} /> Add New Memory
                    </motion.button>
                </div>
            </ScrollReveal>

            {memories.length === 0 && !adding && (
                <ScrollReveal direction="up">
                    <div className="mem-empty">
                        <ImageIcon size={42} color="#475569" />
                        <p>No memories yet. Add a photo, a note, or a voice message to begin.</p>
                        <button className="mem-add" onClick={() => setAdding(true)}><Plus size={18} /> Add your first memory</button>
                    </div>
                </ScrollReveal>
            )}

            {memories.length > 0 && (
                <ScrollReveal direction="up" delay={0.1}>
                    <div className="mem-filters" role="tablist" aria-label="Filter memories">
                        {FILTERS.map(([id, label]) => (
                            <button key={id} role="tab" aria-selected={filter === id}
                                className={`mem-filter ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
                                {label}
                            </button>
                        ))}
                    </div>
                </ScrollReveal>
            )}

            <AnimatePresence mode="popLayout">
                {grouped.length === 0 && memories.length > 0 && (
                    <motion.p 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }} 
                        className="mem-none"
                    >
                        No {filter === 'photos' ? 'photos' : 'voice notes'} yet.
                    </motion.p>
                )}

                {grouped.map(([label, items]) => (
                    <ScrollReveal key={label} direction="up" distance={30}>
                        <section className="mem-section">
                            <h2 className="mem-section-title">{label} <span className="count-pill">{items.length}</span></h2>
                            <StaggerContainer className="mem-grid">
                                {items.map((m) => (
                                    <GlassCard key={m.id} className="mem-card">
                                        {m.image && <img src={m.image} alt={m.caption || 'memory'} className="mem-img" />}
                                        <div className="mem-card-body">
                                            {m.caption && <p className="mem-cap">{m.caption}</p>}
                                            <div className="mem-meta">
                                                <span className="mem-date">{new Date(m.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                                                <div className="mem-actions">
                                                    {m.voice && (
                                                        <motion.button whileHover={{ scale: 1.2 }} onClick={() => playVoice(m.voice)} title="Play voice note"><Volume2 size={15} /></motion.button>
                                                    )}
                                                    <motion.button whileHover={{ scale: 1.2, color: '#f87171' }} onClick={() => del(m)} title="Delete" aria-label="Delete memory"><Trash2 size={15} /></motion.button>
                                                </div>
                                            </div>
                                        </div>
                                    </GlassCard>
                                ))}
                            </StaggerContainer>
                        </section>
                    </ScrollReveal>
                ))}
            </AnimatePresence>

            <AnimatePresence>
                {adding && (
                    <motion.div 
                        className="mem-modal" 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }}
                        onClick={(e) => e.target === e.currentTarget && reset()}
                    >
                        <motion.div 
                            className="mem-modal-card"
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        >
                            <div className="mem-modal-head">
                                <h3>Add a memory</h3>
                                <button onClick={reset} aria-label="Close"><X size={18} /></button>
                            </div>

                            <div className="mem-upload" onClick={() => fileRef.current?.click()}>
                                {image ? <img src={image} alt="preview" /> : (
                                    <div className="mem-upload-empty"><ImageIcon size={28} /><span>Add a photo</span></div>
                                )}
                                <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
                            </div>

                            <textarea
                                className="mem-caption"
                                value={caption}
                                onChange={(e) => setCaption(e.target.value)}
                                rows={3}
                                placeholder="Write a note about this memory…"
                            />

                            <div className="mem-voice">
                                <span className="voice-label">Voice note (optional)</span>
                                <AudioRecorder onRecordingComplete={onVoice} />
                            </div>

                            <div className="mem-modal-actions">
                                <button className="ghost" onClick={reset}>Cancel</button>
                                <button className="primary" onClick={save} disabled={!caption.trim() && !image}>Save memory</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <style>{`
        .mem { position: relative; height: 100%; overflow-y: auto; padding: var(--s-10) var(--s-8); color: var(--text); font-family: inherit; }
        .mem-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); margin-bottom: var(--s-10); }
        .mem-head-text { display: flex; flex-direction: column; gap: var(--s-2); }
        .mem-title { margin: 0; font-size: var(--fs-2xl); font-weight: 800; letter-spacing: -0.02em; background: var(--grad-text); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
        .mem-subtitle { margin: 0; color: var(--text-muted); font-size: var(--fs-md); line-height: 1.5; }
        .mem-add { display: inline-flex; align-items: center; gap: var(--s-2); background: var(--grad-brand); color: var(--text-on-brand); border: 1px solid transparent; padding: 12px 20px; border-radius: var(--r-md); font-weight: 700; font-size: var(--fs-sm); cursor: pointer; white-space: nowrap; box-shadow: var(--glow-brand); transition: all var(--dur) var(--ease); }

        .mem-empty { text-align: center; padding: var(--s-12) var(--s-6); color: var(--text-dim); display: flex; flex-direction: column; align-items: center; gap: var(--s-4); background: var(--glass); border: 1px solid var(--border); border-radius: var(--r-xl); box-shadow: var(--shadow-md); backdrop-filter: blur(14px); max-width: 520px; margin: var(--s-10) auto; }
        .mem-empty p { margin: 0; color: var(--text-muted); font-size: var(--fs-md); line-height: 1.6; max-width: 360px; }

        .mem-filters { display: flex; gap: var(--s-2); flex-wrap: wrap; margin-bottom: var(--s-8); padding: 6px; background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--r-pill); width: fit-content; }
        .mem-filter { min-height: 40px; padding: 0 var(--s-5); border: none; border-radius: var(--r-pill); background: transparent; color: var(--text-muted); font-weight: 700; font-size: var(--fs-sm); font-family: inherit; cursor: pointer; transition: all var(--dur) var(--ease); }
        .mem-filter:hover { color: var(--text); background: var(--surface-2); }
        .mem-filter.active { background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand); }
        .mem-none { text-align: center; color: var(--text-muted); font-size: var(--fs-md); padding: var(--s-8) 0; }
        .mem-section { margin-bottom: var(--s-10); }
        .mem-section-title { margin: 0 0 var(--s-5); font-size: var(--fs-lg); font-weight: 800; color: var(--text); display: flex; align-items: center; gap: var(--s-3); }
        .count-pill { font-size: var(--fs-xs); font-weight: 700; color: var(--text-muted); background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 2px 10px; }
        .mem-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--s-5); }
        @media (max-width: 560px) { .mem-grid { grid-template-columns: 1fr 1fr; gap: var(--s-3); } }
        .mem-card { overflow: hidden; padding: 0 !important; }
        .mem-img { width: 100%; height: 180px; object-fit: cover; display: block; border-bottom: 1px solid var(--border); }
        .mem-card-body { padding: var(--s-4); }
        .mem-cap { margin: 0 0 var(--s-3); font-size: var(--fs-sm); line-height: 1.5; color: var(--text); }
        .mem-meta { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); font-size: var(--fs-xs); color: var(--text-dim); }
        .mem-date { opacity: 0.8; }
        .mem-actions { display: flex; gap: var(--s-2); }
        .mem-actions button { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); width: 32px; height: 32px; border-radius: var(--r-sm); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all var(--dur) var(--ease); }
        .mem-actions button:hover { background: var(--surface-3); color: var(--text); border-color: var(--border-strong); }

        .mem-modal { position: fixed; inset: 0; background: rgba(5,8,16,0.75); backdrop-filter: blur(12px); z-index: 100; display: flex; align-items: center; justify-content: center; padding: var(--s-5); }
        .mem-modal-card { width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; background: var(--glass-strong); border: 1px solid var(--border-strong); border-radius: var(--r-xl); padding: var(--s-6); box-shadow: var(--shadow-lg); backdrop-filter: blur(20px); }
        .mem-modal-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-5); }
        .mem-modal-head h3 { margin: 0; font-size: var(--fs-lg); font-weight: 800; }
        .mem-modal-head button { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); width: 34px; height: 34px; border-radius: var(--r-sm); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all var(--dur) var(--ease); }
        .mem-modal-head button:hover { background: var(--surface-3); color: var(--text); }
        .mem-upload { border: 2px dashed var(--border-strong); border-radius: var(--r-lg); overflow: hidden; cursor: pointer; margin-bottom: var(--s-4); background: var(--surface-1); transition: all var(--dur) var(--ease); }
        .mem-upload:hover { border-color: var(--brand-1); background: var(--surface-2); }
        .mem-upload img { width: 100%; height: 200px; object-fit: cover; display: block; }
        .mem-upload-empty { height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--s-2); color: var(--text-muted); font-size: var(--fs-sm); font-weight: 600; }
        .mem-caption { width: 100%; box-sizing: border-box; background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-md); padding: 12px 14px; color: var(--text); font-size: var(--fs-md); font-family: inherit; resize: vertical; outline: none; margin-bottom: var(--s-4); transition: all var(--dur) var(--ease); }
        .mem-caption:focus { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }
        .mem-voice { display: flex; flex-direction: column; gap: var(--s-2); margin-bottom: var(--s-5); }
        .voice-label { font-size: var(--fs-sm); color: var(--text-muted); font-weight: 600; }
        .mem-modal-actions { display: flex; justify-content: flex-end; gap: var(--s-3); }
        .mem-modal-actions button { padding: 12px 20px; border-radius: var(--r-md); border: 1px solid transparent; font-weight: 700; font-size: var(--fs-sm); font-family: inherit; cursor: pointer; transition: all var(--dur) var(--ease); }
        .mem-modal-actions .ghost { background: var(--surface-2); color: var(--text); border-color: var(--border); }
        .mem-modal-actions .ghost:hover { background: var(--surface-3); }
        .mem-modal-actions .primary { background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand); }
        .mem-modal-actions .primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124,58,237,0.5); }
        .mem-modal-actions .primary:disabled { opacity: .5; cursor: default; transform: none; box-shadow: none; }

        @media (max-width: 560px) { .mem { padding: var(--s-6) var(--s-4); } .mem-head { flex-direction: column; align-items: flex-start; } .mem-add { width: 100%; justify-content: center; } }
      `}</style>
        </div>
    );
}
