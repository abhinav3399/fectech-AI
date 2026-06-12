import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Volume2, Save, X, Upload, Camera, User, Box } from 'lucide-react';
import AudioRecorder from './AudioRecorder';
import FaceCaptureModal from './FaceCaptureModal';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';

const blobToDataUrl = (blob) =>
    new Promise((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result);
        r.readAsDataURL(blob);
    });

// Pick a neural voice that matches the person's language, gender + accent (also
// seeds the clone direction). Manual voice choice still overrides this afterward.
const pickVoice = (gender, accent, language) => {
    const isMale = gender === 'male';
    const lang = (language || '').toLowerCase();
    // Hindi / Hinglish -> Hindi voices.
    if (lang === 'hindi' || lang === 'hinglish') {
        return isMale ? 'hi-IN-MadhurNeural' : 'hi-IN-SwaraNeural';
    }
    const a = (accent || '').toLowerCase();
    const region = /brit|uk|england|scott|wales/.test(a) ? 'GB'
        : /indi|desi|south asia/.test(a) ? 'IN'
        : /austral|aussie/.test(a) ? 'AU' : 'US';
    const table = {
        US: { female: 'en-US-JennyNeural', male: 'en-US-GuyNeural' },
        GB: { female: 'en-GB-SoniaNeural', male: 'en-GB-RyanNeural' },
        IN: { female: 'en-IN-NeerjaNeural', male: 'en-IN-PrabhatNeural' },
        AU: { female: 'en-AU-NatashaNeural', male: 'en-US-GuyNeural' },
    };
    return table[region][isMale ? 'male' : 'female'];
};

export default function PersonaEditor({ initial, onSave, onCancel, saveLabel = 'Save' }) {
    const [name, setName] = useState(initial?.name || '');
    const [relationship, setRelationship] = useState(initial?.relationship || '');
    const [gender, setGender] = useState(initial?.gender || '');
    const [age, setAge] = useState(initial?.age || '');
    const [accent, setAccent] = useState(initial?.accent || '');
    const [language, setLanguage] = useState(initial?.language || '');
    const [personality, setPersonality] = useState(initial?.personality || '');
    const [voiceId, setVoiceId] = useState(initial?.voiceId || 'en-US-JennyNeural');
    const [voiceSample, setVoiceSample] = useState(initial?.voiceSample || null);
    const [voiceCloneId, setVoiceCloneId] = useState(initial?.voiceCloneId || null);
    const [cloning, setCloning] = useState({ active: false, error: null });
    const [faceImage, setFaceImage] = useState(initial?.faceImage || null);
    const [modelUrl, setModelUrl] = useState(initial?.modelUrl || null);
    const [gen, setGen] = useState({ active: false, progress: 0, error: null });
    const [capturing, setCapturing] = useState(false);
    const [voices, setVoices] = useState([]);
    const [previewing, setPreviewing] = useState(false);
    const audioRef = useRef(null);
    const uploadRef = useRef(null);
    const faceUploadRef = useRef(null);

    useEffect(() => {
        axios.get(`${API_BASE}/voices`).then((r) => setVoices(r.data?.voices || [])).catch(() => setVoices([]));
    }, []);

    const previewVoice = async () => {
        setPreviewing(true);
        try {
            const sample = `Hello ${initial?.userName || 'dear'}, it's ${name || 'me'}. I'm so happy to see you.`;
            const r = await axios.post(`${API_BASE}/tts`, { text: sample, voice: voiceId, clone_voice_id: voiceCloneId }, { timeout: 30000 });
            if (r.data?.audio_base64) {
                const audio = new Audio(`data:audio/mpeg;base64,${r.data.audio_base64}`);
                audioRef.current = audio;
                audio.onended = () => setPreviewing(false);
                await audio.play();
            } else setPreviewing(false);
        } catch (e) {
            setPreviewing(false);
        }
    };

    const handleRecording = async (blob) => {
        setVoiceCloneId(null); // sample changed -> previous clone no longer matches
        if (!blob) { setVoiceSample(null); return; }
        setVoiceSample(await blobToDataUrl(blob));
    };

    const handleUpload = async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (!f.type.startsWith('audio/')) { alert('Please choose an audio file.'); return; }
        setVoiceCloneId(null);
        setVoiceSample(await blobToDataUrl(f));
        e.target.value = ''; // allow re-selecting the same file
    };

    // Clone the person's voice from the sample (ElevenLabs) -> voice id.
    const cloneVoice = async () => {
        if (!voiceSample || cloning.active) return;
        setCloning({ active: true, error: null });
        try {
            const r = await axios.post(`${API_BASE}/clone-voice`, {
                audio: voiceSample,
                name: `${name || 'Companion'} voice`,
                labels: { gender, accent },
            }, { timeout: 180000 });
            if (r.data?.status === 'ok' && r.data.voice_id) {
                setVoiceCloneId(r.data.voice_id);
                setCloning({ active: false, error: null });
            } else {
                setCloning({ active: false, error: r.data?.message || 'Cloning failed.' });
            }
        } catch (e) {
            setCloning({ active: false, error: 'Clone request failed.' });
        }
    };

    const handleFaceUpload = async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (!f.type.startsWith('image/')) { alert('Please choose an image file.'); return; }
        setFaceImage(await blobToDataUrl(f));
        setModelUrl(null); // new face -> old 3D model no longer matches
        e.target.value = '';
    };

    // Generate a real 3D mesh from the face photo via the backend (Meshy).
    const generate3D = async () => {
        if (!faceImage || gen.active) return;
        setGen({ active: true, progress: 0, error: null });
        try {
            const sub = await axios.post(`${API_BASE}/generate-3d`, { image: faceImage }, { timeout: 60000 });
            if (sub.data?.status !== 'submitted') {
                setGen({ active: false, progress: 0, error: sub.data?.message || 'Could not start generation.' });
                return;
            }
            const taskId = sub.data.task_id;
            for (let i = 0; i < 120; i++) { // poll up to ~8 min
                await new Promise((r) => setTimeout(r, 4000));
                const st = await axios.get(`${API_BASE}/generate-3d/${taskId}`, { timeout: 30000 });
                const d = st.data || {};
                if (d.status === 'SUCCEEDED') {
                    setModelUrl(d.model_url);
                    setGen({ active: false, progress: 100, error: null });
                    return;
                }
                if (['FAILED', 'CANCELED', 'error'].includes(d.status)) {
                    setGen({ active: false, progress: 0, error: d.message || 'Generation failed.' });
                    return;
                }
                setGen({ active: true, progress: d.progress || 0, error: null });
            }
            setGen({ active: false, progress: 0, error: 'Timed out — please try again.' });
        } catch (e) {
            setGen({ active: false, progress: 0, error: 'Generation request failed.' });
        }
    };

    const canSave = name.trim().length > 0;
    const save = () => {
        if (!canSave) return;
        onSave({
            name: name.trim(),
            relationship: relationship.trim() || 'loved one',
            gender,
            age: age ? Number(age) : null,
            accent: accent.trim(),
            language,
            personality: personality.trim(),
            voiceId,
            voiceSample,
            voiceCloneId,
            faceImage,
            modelUrl,
        });
    };

    return (
        <div className="pe">
            <div className="pe-grid">
                <label className="pe-field">
                    <span>Their name *</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Margaret" />
                </label>
                <label className="pe-field">
                    <span>Relationship to you</span>
                    <input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="e.g. Wife, Son, Best friend" />
                </label>
            </div>

            {/* Details that make the voice (and clone) faithful to the person. */}
            <div className="pe-grid pe-grid-3">
                <label className="pe-field">
                    <span>Gender</span>
                    <select value={gender} onChange={(e) => { setGender(e.target.value); setVoiceId(pickVoice(e.target.value, accent, language)); }}>
                        <option value="">Select…</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="other">Other / prefer not to say</option>
                    </select>
                </label>
                <label className="pe-field">
                    <span>Age</span>
                    <input type="number" min="1" max="120" value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 68" />
                </label>
                <label className="pe-field">
                    <span>Accent / from</span>
                    <input value={accent} onChange={(e) => { setAccent(e.target.value); if (gender) setVoiceId(pickVoice(gender, e.target.value, language)); }} placeholder="e.g. Indian" />
                </label>
            </div>

            <label className="pe-field">
                <span>Language they speak (the avatar will talk &amp; understand this)</span>
                <select value={language} onChange={(e) => { setLanguage(e.target.value); setVoiceId(pickVoice(gender, accent, e.target.value)); }}>
                    <option value="">English</option>
                    <option value="hinglish">Hinglish (Hindi + English, Roman script)</option>
                    <option value="hindi">Hindi — हिंदी (Devanagari)</option>
                </select>
            </label>

            <label className="pe-field">
                <span>Who are they? (personality &amp; shared memories)</span>
                <textarea
                    value={personality}
                    onChange={(e) => setPersonality(e.target.value)}
                    rows={4}
                    placeholder="Margaret is my wife of 42 years. She loves gardening and calls me 'love'. We met in Brighton in 1979. She is gentle, funny, and always reassuring."
                />
            </label>

            <div className="pe-field">
                <span>Their face (optional)</span>
                <div className="pe-face">
                    <div className="pe-face-thumb">
                        {faceImage ? (
                            <>
                                <img src={faceImage} alt="their face" />
                                <button type="button" className="pe-face-x" onClick={() => setFaceImage(null)} aria-label="Remove photo"><X size={14} /></button>
                            </>
                        ) : (
                            <User size={30} color="#475569" />
                        )}
                    </div>
                    <div className="pe-face-actions">
                        <button type="button" className="pe-face-btn" onClick={() => faceUploadRef.current?.click()}>
                            <Upload size={16} /> Upload photo
                        </button>
                        <button type="button" className="pe-face-btn" onClick={() => setCapturing(true)}>
                            <Camera size={16} /> Take photo
                        </button>
                    </div>
                    <input ref={faceUploadRef} type="file" accept="image/*" hidden onChange={handleFaceUpload} />
                </div>
                {faceImage && (
                    <div className="pe-gen">
                        <button type="button" className="pe-gen-btn" onClick={generate3D} disabled={gen.active}>
                            <Box size={15} />
                            {gen.active ? `Generating 3D model… ${gen.progress}%` : modelUrl ? 'Regenerate 3D model' : 'Generate 3D model from photo'}
                        </button>
                        {modelUrl && !gen.active && <span className="pe-hint">✓ 3D model ready</span>}
                        {gen.active && <div className="pe-gen-bar"><i style={{ width: `${Math.max(5, gen.progress)}%` }} /></div>}
                        {gen.error && <div className="pe-gen-err">{gen.error}</div>}
                    </div>
                )}
            </div>

            <div className="pe-grid">
                <label className="pe-field">
                    <span>Voice</span>
                    <div className="pe-voice-row">
                        <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                            {voices.map((v) => (
                                <option key={v.id} value={v.id}>{v.label}</option>
                            ))}
                        </select>
                        <button type="button" className="pe-preview" onClick={previewVoice} disabled={previewing}>
                            <Volume2 size={16} /> {previewing ? '…' : 'Preview'}
                        </button>
                    </div>
                </label>
                <div className="pe-field">
                    <span>Their real voice (optional)</span>
                    <AudioRecorder onRecordingComplete={handleRecording} />
                    <div className="pe-or"><span>or</span></div>
                    <button type="button" className="pe-upload" onClick={() => uploadRef.current?.click()}>
                        <Upload size={16} /> Upload audio file
                    </button>
                    <input ref={uploadRef} type="file" accept="audio/*" hidden onChange={handleUpload} />
                    {voiceSample && (
                        <div className="pe-sample">
                            <audio src={voiceSample} controls className="pe-audio" />
                            <button type="button" className="pe-remove" onClick={() => { setVoiceSample(null); setVoiceCloneId(null); }}>Remove</button>
                        </div>
                    )}
                    {voiceSample && (
                        <div className="pe-clone">
                            <button type="button" className="pe-clone-btn" onClick={cloneVoice} disabled={cloning.active}>
                                <Volume2 size={15} />
                                {cloning.active ? 'Cloning their voice…' : voiceCloneId ? 'Re-clone voice' : 'Clone this voice'}
                            </button>
                            {voiceCloneId && !cloning.active && <span className="pe-hint">✓ Voice cloned — the companion now speaks in this voice</span>}
                            {cloning.error && <div className="pe-gen-err">{cloning.error}</div>}
                        </div>
                    )}
                </div>
            </div>

            <div className="pe-actions">
                {onCancel && (
                    <button type="button" className="pe-btn ghost" onClick={onCancel}><X size={16} /> Cancel</button>
                )}
                <button type="button" className="pe-btn primary" onClick={save} disabled={!canSave}>
                    <Save size={16} /> {saveLabel}
                </button>
            </div>

            {capturing && (
                <FaceCaptureModal
                    onCapture={(img) => { setFaceImage(img); setCapturing(false); }}
                    onClose={() => setCapturing(false)}
                />
            )}

            <style>{`
        .pe { display: flex; flex-direction: column; gap: 16px; }
        .pe-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .pe-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
        @media (max-width: 640px) { .pe-grid, .pe-grid-3 { grid-template-columns: 1fr; } }
        .pe-field { display: flex; flex-direction: column; gap: 6px; }
        .pe-field > span { font-size: 0.8rem; color: #94a3b8; font-weight: 600; }
        .pe-field input, .pe-field textarea, .pe-field select {
            background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.12);
            border-radius: 10px; padding: 11px 13px; color: #fff; font-size: 0.92rem; outline: none; font-family: inherit;
        }
        .pe-field input:focus, .pe-field textarea:focus, .pe-field select:focus {
            border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(167,139,250,0.15);
        }
        .pe-field textarea { resize: vertical; line-height: 1.5; }
        .pe-voice-row { display: flex; gap: 8px; }
        .pe-voice-row select { flex: 1; }
        .pe-preview {
            display: flex; align-items: center; gap: 6px; padding: 0 14px; border-radius: 10px;
            border: 1px solid rgba(124,58,237,0.4); background: rgba(124,58,237,0.15); color: #c4b5fd; cursor: pointer; white-space: nowrap;
        }
        .pe-preview:disabled { opacity: 0.6; cursor: default; }
        .pe-hint { font-size: 0.8rem; color: #4ade80; }
        .pe-or { display: flex; align-items: center; text-align: center; color: #64748b; font-size: 0.72rem; margin: 2px 0; }
        .pe-or::before, .pe-or::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.1); }
        .pe-or span { padding: 0 10px; text-transform: uppercase; letter-spacing: 0.1em; }
        .pe-upload {
            display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
            padding: 9px 16px; border-radius: 20px; cursor: pointer; font-weight: 600;
            border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06); color: #e2e8f0;
        }
        .pe-upload:hover { background: rgba(255,255,255,0.12); }
        .pe-sample { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
        .pe-audio { flex: 1; height: 34px; }
        .pe-remove { background: none; border: none; color: #f87171; cursor: pointer; font-size: 0.8rem; font-weight: 600; white-space: nowrap; }
        .pe-face { display: flex; align-items: center; gap: 14px; }
        .pe-face-thumb {
            position: relative; width: 76px; height: 76px; border-radius: 14px; flex-shrink: 0;
            background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.12);
            display: flex; align-items: center; justify-content: center; overflow: hidden;
        }
        .pe-face-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .pe-face-x { position: absolute; top: 3px; right: 3px; width: 22px; height: 22px; border-radius: 6px; border: none; background: rgba(0,0,0,0.6); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .pe-face-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .pe-face-btn {
            display: flex; align-items: center; gap: 7px; padding: 9px 15px; border-radius: 10px; cursor: pointer; font-weight: 600;
            border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06); color: #e2e8f0;
        }
        .pe-face-btn:hover { background: rgba(255,255,255,0.12); }
        .pe-gen { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
        .pe-gen-btn {
            display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
            padding: 11px 16px; border-radius: 10px; cursor: pointer; font-weight: 700;
            border: 1px solid rgba(124,58,237,0.45); background: linear-gradient(135deg, rgba(124,58,237,0.25), rgba(37,99,235,0.25)); color: #ddd6fe;
        }
        .pe-gen-btn:hover:not(:disabled) { background: linear-gradient(135deg, rgba(124,58,237,0.4), rgba(37,99,235,0.4)); }
        .pe-gen-btn:disabled { opacity: 0.7; cursor: default; }
        .pe-gen-bar { height: 6px; border-radius: 4px; background: rgba(255,255,255,0.1); overflow: hidden; }
        .pe-gen-bar i { display: block; height: 100%; background: linear-gradient(90deg,#7c3aed,#2563eb); transition: width .4s; }
        .pe-gen-err { font-size: 0.82rem; color: #fca5a5; line-height: 1.4; }
        .pe-clone { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
        .pe-clone-btn {
            display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
            padding: 9px 16px; border-radius: 10px; cursor: pointer; font-weight: 700;
            border: 1px solid rgba(74,222,128,0.45); background: rgba(74,222,128,0.14); color: #86efac;
        }
        .pe-clone-btn:hover:not(:disabled) { background: rgba(74,222,128,0.24); }
        .pe-clone-btn:disabled { opacity: 0.7; cursor: default; }
        .pe-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
        .pe-btn { display: flex; align-items: center; gap: 8px; padding: 11px 20px; border-radius: 10px; border: none; font-weight: 700; cursor: pointer; font-size: 0.92rem; }
        .pe-btn.primary { background: linear-gradient(135deg, #7c3aed, #2563eb); color: #fff; }
        .pe-btn.primary:disabled { opacity: 0.5; cursor: default; }
        .pe-btn.ghost { background: rgba(255,255,255,0.08); color: #cbd5e1; }
      `}</style>
        </div>
    );
}
