import React, { useRef, useState } from 'react';
import { Plus, Image as ImageIcon, Trash2, Volume2, X } from 'lucide-react';
import AudioRecorder from '../components/AudioRecorder';
import { useAppState, addMemory, removeMemory } from '../lib/store';

const fileToDataUrl = (file) =>
    new Promise((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result);
        r.readAsDataURL(file);
    });

export default function MemoriesPage() {
    const { memories } = useAppState();
    const [adding, setAdding] = useState(false);
    const [caption, setCaption] = useState('');
    const [image, setImage] = useState(null);
    const [voice, setVoice] = useState(null);
    const fileRef = useRef(null);

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
    };

    const playVoice = (src) => { new Audio(src).play().catch(() => {}); };

    return (
        <div className="mem">
            <div className="mem-head">
                <div>
                    <h1>Memories</h1>
                    <p>A journal of the people and moments worth holding onto.</p>
                </div>
                <button className="mem-add" onClick={() => setAdding(true)}><Plus size={18} /> Add memory</button>
            </div>

            {memories.length === 0 && !adding && (
                <div className="mem-empty">
                    <ImageIcon size={42} color="#475569" />
                    <p>No memories yet. Add a photo, a note, or a voice message to begin.</p>
                    <button className="mem-add" onClick={() => setAdding(true)}><Plus size={18} /> Add your first memory</button>
                </div>
            )}

            <div className="mem-grid">
                {memories.map((m) => (
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
                                    <button onClick={() => removeMemory(m.id)} title="Delete"><Trash2 size={15} /></button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

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
        .mem { height: 100%; overflow-y: auto; padding: 28px; background: #0f172a; color: #fff; font-family: system-ui, sans-serif; }
        .mem-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
        .mem-head h1 { margin: 0; font-size: 1.9rem; font-weight: 800; }
        .mem-head p { margin: 4px 0 0; color: #94a3b8; }
        .mem-add { display: flex; align-items: center; gap: 8px; background: linear-gradient(135deg,#7c3aed,#2563eb); color: #fff; border: none; padding: 11px 18px; border-radius: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
        .mem-empty { text-align: center; padding: 70px 20px; color: #64748b; display: flex; flex-direction: column; align-items: center; gap: 14px; }
        .mem-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 18px; }
        .mem-card { background: rgba(30,41,59,0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; overflow: hidden; transition: transform .2s; }
        .mem-card:hover { transform: translateY(-3px); border-color: rgba(167,139,250,0.4); }
        .mem-card img { width: 100%; height: 170px; object-fit: cover; display: block; }
        .mem-card-body { padding: 14px; }
        .mem-cap { margin: 0 0 10px; font-size: 0.92rem; line-height: 1.45; color: #e2e8f0; }
        .mem-meta { display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem; color: #64748b; }
        .mem-actions { display: flex; gap: 6px; }
        .mem-actions button { background: rgba(255,255,255,0.06); border: none; color: #94a3b8; width: 28px; height: 28px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .mem-actions button:hover { background: rgba(255,255,255,0.14); color: #fff; }

        .mem-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .mem-modal-card { width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 24px; }
        .mem-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .mem-modal-head h3 { margin: 0; }
        .mem-modal-head button { background: rgba(255,255,255,0.08); border: none; color: #cbd5e1; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; }
        .mem-upload { border: 2px dashed rgba(255,255,255,0.15); border-radius: 14px; overflow: hidden; cursor: pointer; margin-bottom: 14px; }
        .mem-upload img { width: 100%; height: 200px; object-fit: cover; display: block; }
        .mem-upload-empty { height: 140px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #64748b; }
        .mem-caption { width: 100%; box-sizing: border-box; background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 12px; color: #fff; font-family: inherit; resize: vertical; outline: none; margin-bottom: 14px; }
        .mem-caption:focus { border-color: #a78bfa; }
        .mem-voice { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
        .mem-voice > span { font-size: 0.8rem; color: #94a3b8; font-weight: 600; }
        .mem-modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
        .mem-modal-actions button { padding: 11px 20px; border-radius: 10px; border: none; font-weight: 700; cursor: pointer; }
        .mem-modal-actions .ghost { background: rgba(255,255,255,0.08); color: #cbd5e1; }
        .mem-modal-actions .primary { background: linear-gradient(135deg,#7c3aed,#2563eb); color: #fff; }
        .mem-modal-actions .primary:disabled { opacity: .5; cursor: default; }
      `}</style>
        </div>
    );
}
