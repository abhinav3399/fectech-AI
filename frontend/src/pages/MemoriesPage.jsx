import React, { useRef, useState } from 'react';
import { Plus, Image as ImageIcon, Trash2, Volume2, X } from 'lucide-react';
import AudioRecorder from '../components/AudioRecorder';
import { useAppState, addMemory, removeMemory } from '../lib/store';
import { toast, confirmAction } from '../components/Feedback';

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
    const [filter, setFilter] = useState('all'); // all | photos | voice
    const fileRef = useRef(null);

    // Filter + group memories into friendly time buckets (Today / This month / Older).
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
            <div className="mem-head">
                <div>
                    <h1>Memories Gallery</h1>
                    <p>Special moments{persona?.name ? ` shared with ${persona.name}` : ' worth holding onto'}.</p>
                </div>
                <button className="mem-add" onClick={() => setAdding(true)}><Plus size={18} /> Add New Memory</button>
            </div>

            {memories.length === 0 && !adding && (
                <div className="mem-empty">
                    <ImageIcon size={42} color="#475569" />
                    <p>No memories yet. Add a photo, a note, or a voice message to begin.</p>
                    <button className="mem-add" onClick={() => setAdding(true)}><Plus size={18} /> Add your first memory</button>
                </div>
            )}

            {memories.length > 0 && (
                <div className="mem-filters" role="tablist" aria-label="Filter memories">
                    {FILTERS.map(([id, label]) => (
                        <button key={id} role="tab" aria-selected={filter === id}
                            className={`mem-filter ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
                            {label}
                        </button>
                    ))}
                </div>
            )}

            {memories.length > 0 && grouped.length === 0 && (
                <p className="mem-none">No {filter === 'photos' ? 'photos' : 'voice notes'} yet.</p>
            )}

            {grouped.map(([label, items]) => (
                <section key={label} className="mem-section">
                    <h2 className="mem-section-title">{label} <span>{items.length}</span></h2>
                    <div className="mem-grid">
                        {items.map((m) => (
                            <div key={m.id} className="mem-card">
                                {m.image && <img src={m.image} alt={m.caption || 'memory'} />}
                                <div className="mem-card-body">
                                    {m.caption && <p className="mem-cap">{m.caption}</p>}
                                    <div className="mem-meta">
                                        <span>{new Date(m.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                                        <div className="mem-actions">
                                            {m.voice && (
                                                <button onClick={() => playVoice(m.voice)} title="Play voice note"><Volume2 size={15} /></button>
                                            )}
                                            <button onClick={() => del(m)} title="Delete" aria-label="Delete memory"><Trash2 size={15} /></button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            ))}

            {adding && (
                <div className="mem-modal" onClick={(e) => e.target === e.currentTarget && reset()}>
                    <div className="mem-modal-card">
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
                            placeholder="Write a note about this memory… who, where, when, why it matters."
                        />

                        <div className="mem-voice">
                            <span>Voice note (optional)</span>
                            <AudioRecorder onRecordingComplete={onVoice} />
                        </div>

                        <div className="mem-modal-actions">
                            <button className="ghost" onClick={reset}>Cancel</button>
                            <button className="primary" onClick={save} disabled={!caption.trim() && !image}>Save memory</button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
        .mem { position: relative; height: 100%; overflow-y: auto; padding: var(--s-10) var(--s-8); color: var(--text); font-family: inherit; }
        .mem-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-4); margin-bottom: var(--s-8); }
        .mem-head h1 { margin: 0; font-size: var(--fs-2xl); font-weight: 800; letter-spacing: -0.02em; background: var(--grad-text); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
        .mem-head p { margin: var(--s-2) 0 0; color: var(--text-muted); font-size: var(--fs-md); line-height: 1.5; }
        .mem-add { display: inline-flex; align-items: center; gap: var(--s-2); background: var(--grad-brand); color: var(--text-on-brand); border: 1px solid transparent; padding: 12px 20px; border-radius: var(--r-md); font-weight: 700; font-size: var(--fs-sm); cursor: pointer; white-space: nowrap; box-shadow: var(--glow-brand); transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .mem-add:hover { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124,58,237,0.5); }
        .mem-add:active { transform: translateY(1px); }

        .mem-empty { text-align: center; padding: var(--s-12) var(--s-6); color: var(--text-dim); display: flex; flex-direction: column; align-items: center; gap: var(--s-4); background: var(--glass); border: 1px solid var(--border); border-radius: var(--r-xl); box-shadow: var(--shadow-md); backdrop-filter: blur(14px); max-width: 520px; margin: var(--s-10) auto; }
        .mem-empty p { margin: 0; color: var(--text-muted); font-size: var(--fs-md); line-height: 1.6; max-width: 360px; }

        .mem-filters { display: flex; gap: var(--s-2); flex-wrap: wrap; margin-bottom: var(--s-6); padding: 5px; background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--r-pill); width: fit-content; }
        .mem-filter { min-height: 44px; padding: 0 var(--s-5); border: none; border-radius: var(--r-pill); background: transparent; color: var(--text-muted); font-weight: 700; font-size: var(--fs-sm); font-family: inherit; cursor: pointer; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
        .mem-filter:hover { color: var(--text); background: var(--surface-2); }
        .mem-filter.active { background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand); }
        .mem-none { color: var(--text-muted); font-size: var(--fs-md); padding: var(--s-6) 0; }
        .mem-section { margin-bottom: var(--s-8); }
        .mem-section-title { margin: 0 0 var(--s-4); font-size: var(--fs-lg); font-weight: 800; color: var(--text); display: flex; align-items: center; gap: var(--s-3); }
        .mem-section-title span { font-size: var(--fs-xs); font-weight: 700; color: var(--text-muted); background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 2px 10px; }
        .mem-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--s-5); }
        @media (max-width: 560px) { .mem-grid { grid-template-columns: 1fr 1fr; gap: var(--s-3); } }
        .mem-card { background: var(--glass); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: hidden; box-shadow: var(--shadow-md); backdrop-filter: blur(14px); transition: transform var(--dur) var(--ease), border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .mem-card:hover { transform: translateY(-4px); border-color: rgba(139,92,246,0.45); box-shadow: var(--shadow-lg); }
        .mem-card img { width: 100%; height: 180px; object-fit: cover; display: block; }
        .mem-card-body { padding: var(--s-4); }
        .mem-cap { margin: 0 0 var(--s-3); font-size: var(--fs-sm); line-height: 1.5; color: var(--text); }
        .mem-meta { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); font-size: var(--fs-xs); color: var(--text-dim); }
        .mem-actions { display: flex; gap: var(--s-2); }
        .mem-actions button { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); width: 32px; height: 32px; border-radius: var(--r-sm); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease); }
        .mem-actions button:hover { background: var(--surface-3); color: var(--text); border-color: var(--border-strong); }

        .mem-modal { position: fixed; inset: 0; background: rgba(5,8,16,0.66); backdrop-filter: blur(8px); z-index: 100; display: flex; align-items: center; justify-content: center; padding: var(--s-5); }
        .mem-modal-card { width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; background: var(--glass-strong); border: 1px solid var(--border-strong); border-radius: var(--r-xl); padding: var(--s-6); box-shadow: var(--shadow-lg); backdrop-filter: blur(20px); }
        .mem-modal-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-5); }
        .mem-modal-head h3 { margin: 0; font-size: var(--fs-lg); font-weight: 800; }
        .mem-modal-head button { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); width: 34px; height: 34px; border-radius: var(--r-sm); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
        .mem-modal-head button:hover { background: var(--surface-3); color: var(--text); }
        .mem-upload { border: 2px dashed var(--border-strong); border-radius: var(--r-lg); overflow: hidden; cursor: pointer; margin-bottom: var(--s-4); background: var(--surface-1); transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease); }
        .mem-upload:hover { border-color: var(--brand-1); background: var(--surface-2); }
        .mem-upload img { width: 100%; height: 200px; object-fit: cover; display: block; }
        .mem-upload-empty { height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--s-2); color: var(--text-muted); font-size: var(--fs-sm); font-weight: 600; }
        .mem-caption { width: 100%; box-sizing: border-box; background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-md); padding: 12px 14px; color: var(--text); font-size: var(--fs-md); font-family: inherit; resize: vertical; outline: none; margin-bottom: var(--s-4); transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .mem-caption::placeholder { color: var(--text-dim); }
        .mem-caption:focus { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }
        .mem-voice { display: flex; flex-direction: column; gap: var(--s-2); margin-bottom: var(--s-5); }
        .mem-voice > span { font-size: var(--fs-sm); color: var(--text-muted); font-weight: 600; }
        .mem-modal-actions { display: flex; justify-content: flex-end; gap: var(--s-3); }
        .mem-modal-actions button { padding: 12px 20px; border-radius: var(--r-md); border: 1px solid transparent; font-weight: 700; font-size: var(--fs-sm); font-family: inherit; cursor: pointer; transition: transform var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease), opacity var(--dur) var(--ease); }
        .mem-modal-actions button:active { transform: translateY(1px); }
        .mem-modal-actions .ghost { background: var(--surface-2); color: var(--text); border-color: var(--border); }
        .mem-modal-actions .ghost:hover { background: var(--surface-3); }
        .mem-modal-actions .primary { background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand); }
        .mem-modal-actions .primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124,58,237,0.5); }
        .mem-modal-actions .primary:disabled { opacity: .5; cursor: default; transform: none; box-shadow: none; }

        @media (max-width: 560px) { .mem { padding: var(--s-6) var(--s-4); } .mem-head { flex-direction: column; } }
      `}</style>
        </div>
    );
}
