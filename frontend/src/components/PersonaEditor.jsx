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

// Inspect a recorded sample: duration (s) + loudness (RMS), to guide clone quality.
// Returns null if it can't analyze (then we don't block — let the server decide).
const sampleQuality = async (dataUrl) => {
    try {
        const buf = await (await fetch(dataUrl)).arrayBuffer();
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        const ctx = new Ctx();
        const audio = await ctx.decodeAudioData(buf);
        const ch = audio.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
        const rms = Math.sqrt(sum / (ch.length || 1));
        const duration = audio.duration;
        if (ctx.close) ctx.close();
        return { duration, rms };
    } catch (e) {
        return null;
    }
};

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

// The edit form is split into tabs so it's never one overwhelming scroll.
const TABS = [
    { id: 'basics', label: 'Basics' },
    { id: 'story', label: 'Story' },
    { id: 'voice', label: 'Voice' },
    { id: 'photo', label: 'Photo' },
    { id: 'care', label: 'Care plan' },
];

export default function PersonaEditor({ initial, onSave, onCancel, saveLabel = 'Save' }) {
    const [name, setName] = useState(initial?.name || '');
    const [relationship, setRelationship] = useState(initial?.relationship || '');
    const [gender, setGender] = useState(initial?.gender || '');
    const [age, setAge] = useState(initial?.age || '');
    const [accent, setAccent] = useState(initial?.accent || '');
    const [language, setLanguage] = useState(initial?.language || '');
    const [style, setStyle] = useState(initial?.style || 'balanced');
    const [personality, setPersonality] = useState(initial?.personality || '');
    const [voiceId, setVoiceId] = useState(initial?.voiceId || 'en-US-JennyNeural');
    const [voicePitch, setVoicePitch] = useState(initial?.voicePitch || 0); // Hz offset for the fast neural voice
    const [voiceSample, setVoiceSample] = useState(initial?.voiceSample || null);
    const [voiceCloneId, setVoiceCloneId] = useState(initial?.voiceCloneId || null);
    const [cloning, setCloning] = useState({ active: false, error: null });
    const [faceImage, setFaceImage] = useState(initial?.faceImage || null);
    const [modelUrl, setModelUrl] = useState(initial?.modelUrl || null);
    const [gen, setGen] = useState({ active: false, progress: 0, error: null });
    const [printUrl, setPrintUrl] = useState(null); // printable STL url from the last generation
    const [capturing, setCapturing] = useState(false);
    const [voices, setVoices] = useState([]);
    const [previewing, setPreviewing] = useState(false);
    const [cloningAvailable, setCloningAvailable] = useState(false); // backend has an ElevenLabs key
    const [cloneConsent, setCloneConsent] = useState(false);         // permission to clone a real voice
    // Care plan — private caregiver guidance that steers the companion's behavior.
    const [carePlan, setCarePlan] = useState(initial?.carePlan || {
        routine: '', dosAndDonts: '', avoidTopics: [], comfortTopics: [], triggers: '', strategies: '',
    });
    // Proactive companion: gently start the conversation when the patient goes quiet.
    const [proactiveCheckins, setProactiveCheckins] = useState(initial?.proactiveCheckins !== false);
    const [avoidInput, setAvoidInput] = useState('');
    const [comfortInput, setComfortInput] = useState('');
    const [anchorQ, setAnchorQ] = useState(''); // anchor-answer question/answer being typed
    const [anchorA, setAnchorA] = useState('');
    const [tab, setTab] = useState('basics'); // active edit section
    const audioRef = useRef(null);
    const uploadRef = useRef(null);
    const faceUploadRef = useRef(null);

    useEffect(() => {
        axios.get(`${API_BASE}/voices`).then((r) => {
            setVoices(r.data?.voices || []);
            setCloningAvailable(!!r.data?.cloning);
        }).catch(() => setVoices([]));
    }, []);

    const previewVoice = async () => {
        setPreviewing(true);
        try {
            const sample = `Hello ${initial?.userName || 'dear'}, it's ${name || 'me'}. I'm so happy to see you.`;
            // Preview the FAST neural voice WITH the pitch tuning (no clone) so it's instant and you
            // can hear how the pitch slider shapes it toward the loved one's voice.
            const pitch = `${voicePitch >= 0 ? '+' : ''}${voicePitch}Hz`;
            const r = await axios.post(`${API_BASE}/tts`, { text: sample, voice: voiceId, pitch }, { timeout: 30000 });
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
        // Guard sample quality first — short/silent clips clone poorly or fail.
        const q = await sampleQuality(voiceSample);
        if (q && q.duration < 15) {
            setCloning({ active: false, error: `Sample is only ${q.duration.toFixed(0)}s — record about 20–30 seconds of clear speech for a good clone.` });
            return;
        }
        if (q && q.rms < 0.004) {
            setCloning({ active: false, error: 'Sample is very quiet — record again a little louder, closer to the mic.' });
            return;
        }
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
            // Surface the REAL reason instead of a generic message: the server's own
            // error body if it sent one, otherwise distinguish timeout / 5xx / unreachable.
            const msg = e.response?.data?.message
                || (e.code === 'ECONNABORTED'
                    ? 'Cloning timed out — try a shorter sample (about 20–30s of clear speech).'
                    : e.response
                        ? `Cloning failed (server error ${e.response.status}).`
                        : "Couldn't reach the server — is the backend running on the API port (8010)?");
            setCloning({ active: false, error: msg });
        }
    };

    const handleFaceUpload = async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (!f.type.startsWith('image/')) { alert('Please choose an image file.'); return; }
        setFaceImage(await blobToDataUrl(f));
        setModelUrl(null); // new face -> old 3D model no longer matches
        setPrintUrl(null);
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
                    setPrintUrl(d.printable_url || null);
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

    // Care-plan helpers: update a free-text field, add/remove a topic chip (de-duped).
    const setCare = (key, value) => setCarePlan((c) => ({ ...c, [key]: value }));
    const addChip = (key, raw, clearInput) => {
        const v = (raw || '').trim();
        if (!v) return;
        setCarePlan((c) => {
            const list = c[key] || [];
            if (list.some((x) => x.toLowerCase() === v.toLowerCase())) return c; // de-dupe
            return { ...c, [key]: [...list, v] };
        });
        clearInput('');
    };
    const removeChip = (key, idx) => setCarePlan((c) => ({ ...c, [key]: (c[key] || []).filter((_, i) => i !== idx) }));

    // Anchor answers — steady {question, answer} pairs for questions asked repeatedly.
    const addAnchor = () => {
        const q = anchorQ.trim(), a = anchorA.trim();
        if (!q || !a) return;
        setCarePlan((c) => ({ ...c, anchors: [...(c.anchors || []), { question: q, answer: a }] }));
        setAnchorQ(''); setAnchorA('');
    };
    const removeAnchor = (idx) => setCarePlan((c) => ({ ...c, anchors: (c.anchors || []).filter((_, i) => i !== idx) }));

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
            style,
            personality: personality.trim(),
            voiceId,
            voicePitch,
            voiceSample,
            voiceCloneId,
            faceImage,
            modelUrl,
            proactiveCheckins,
            carePlan: {
                routine: (carePlan.routine || '').trim(),
                dosAndDonts: (carePlan.dosAndDonts || '').trim(),
                // include the unsubmitted input box too, so a typed-but-not-Entered topic isn't lost
                avoidTopics: [...(carePlan.avoidTopics || []), avoidInput].map((t) => (t || '').trim()).filter(Boolean)
                    .filter((t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i),
                comfortTopics: [...(carePlan.comfortTopics || []), comfortInput].map((t) => (t || '').trim()).filter(Boolean)
                    .filter((t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i),
                triggers: (carePlan.triggers || '').trim(),
                strategies: (carePlan.strategies || '').trim(),
                // include a typed-but-not-Added pair so it isn't lost on save
                anchors: [...(carePlan.anchors || []), ...(anchorQ.trim() && anchorA.trim() ? [{ question: anchorQ, answer: anchorA }] : [])]
                    .map((a) => ({ question: (a.question || '').trim(), answer: (a.answer || '').trim() }))
                    .filter((a) => a.question && a.answer),
            },
        });
    };

    return (
        <div className="pe">
            <div className="pe-tabs">
                {TABS.map((t) => (
                    <button key={t.id} type="button" className={`pe-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
                ))}
            </div>

            {tab === 'basics' && (
            <div className="pe-section">
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

            <div className="pe-grid">
                <label className="pe-field">
                    <span>Language they speak (the avatar will talk &amp; understand this)</span>
                    <select value={language} onChange={(e) => { setLanguage(e.target.value); setVoiceId(pickVoice(gender, accent, e.target.value)); }}>
                        <option value="">English</option>
                        <option value="hinglish">Hinglish (Hindi + English, Roman script)</option>
                        <option value="hindi">Hindi — हिंदी (Devanagari)</option>
                    </select>
                </label>
                <label className="pe-field">
                    <span>Conversation style</span>
                    <select value={style} onChange={(e) => setStyle(e.target.value)}>
                        <option value="brief">Brief — short &amp; gentle</option>
                        <option value="balanced">Balanced — warm &amp; natural</option>
                        <option value="chatty">Chatty — detailed &amp; talkative</option>
                        <option value="dosti">Dosti — like a close yaar (casual &amp; playful)</option>
                    </select>
                </label>
            </div>
            </div>
            )}

            {tab === 'story' && (
            <div className="pe-section">
            <label className="pe-field">
                <span>Who are they? (personality &amp; shared memories)</span>
                <textarea
                    value={personality}
                    onChange={(e) => setPersonality(e.target.value)}
                    rows={4}
                    placeholder="Margaret is my wife of 42 years. She loves gardening and calls me 'love'. We met in Brighton in 1979. She is gentle, funny, and always reassuring."
                />
            </label>
            </div>
            )}

            {tab === 'care' && (
            <div className="pe-section">
            {/* Care plan — private caregiver guidance that steers the companion. */}
            <div className="pe-care">
                <div className="pe-care-head">
                    <span className="pe-care-title">Care plan (for caregivers)</span>
                    <span className="pe-care-help">Private guidance for the companion — it follows this and never brings up topics you mark to avoid.</span>
                </div>

                <label className="pe-field">
                    <span>Topics to avoid</span>
                    <div className="pe-chips">
                        {(carePlan.avoidTopics || []).map((t, i) => (
                            <span key={i} className="pe-chip">
                                {t}
                                <button type="button" className="pe-chip-x" onClick={() => removeChip('avoidTopics', i)} aria-label={`Remove ${t}`}><X size={12} /></button>
                            </span>
                        ))}
                        <input
                            className="pe-chip-input"
                            value={avoidInput}
                            onChange={(e) => setAvoidInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChip('avoidTopics', avoidInput, setAvoidInput); } }}
                            onBlur={() => addChip('avoidTopics', avoidInput, setAvoidInput)}
                            placeholder="e.g. her late husband — press Enter"
                        />
                    </div>
                </label>

                <label className="pe-field">
                    <span>Comfort topics</span>
                    <div className="pe-chips">
                        {(carePlan.comfortTopics || []).map((t, i) => (
                            <span key={i} className="pe-chip">
                                {t}
                                <button type="button" className="pe-chip-x" onClick={() => removeChip('comfortTopics', i)} aria-label={`Remove ${t}`}><X size={12} /></button>
                            </span>
                        ))}
                        <input
                            className="pe-chip-input"
                            value={comfortInput}
                            onChange={(e) => setComfortInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChip('comfortTopics', comfortInput, setComfortInput); } }}
                            onBlur={() => addChip('comfortTopics', comfortInput, setComfortInput)}
                            placeholder="e.g. gardening, her grandchildren — press Enter"
                        />
                    </div>
                </label>

                <div className="pe-grid">
                    <label className="pe-field">
                        <span>Daily routine</span>
                        <textarea rows={2} value={carePlan.routine} onChange={(e) => setCare('routine', e.target.value)} placeholder="e.g. Tea at 8, short walk after lunch, rests in the afternoon." />
                    </label>
                    <label className="pe-field">
                        <span>Do's &amp; don'ts</span>
                        <textarea rows={2} value={carePlan.dosAndDonts} onChange={(e) => setCare('dosAndDonts', e.target.value)} placeholder="e.g. Do speak slowly. Don't correct or argue." />
                    </label>
                </div>

                <div className="pe-grid">
                    <label className="pe-field">
                        <span>Triggers (what upsets them)</span>
                        <textarea rows={2} value={carePlan.triggers} onChange={(e) => setCare('triggers', e.target.value)} placeholder="e.g. Being told she's forgotten something; loud noises." />
                    </label>
                    <label className="pe-field">
                        <span>Reassurance strategies</span>
                        <textarea rows={2} value={carePlan.strategies} onChange={(e) => setCare('strategies', e.target.value)} placeholder="e.g. Remind her she's safe, mention the garden, hold the moment gently." />
                    </label>
                </div>

                <div className="pe-anchors">
                    <div className="pe-anchors-head">
                        <span className="pe-anchors-title">Steady answers</span>
                        <span className="pe-anchors-help">For questions they ask again and again. The companion gives the SAME calm answer every time — never “you already asked”.</span>
                    </div>
                    {(carePlan.anchors || []).map((a, i) => (
                        <div key={i} className="pe-anchor">
                            <div className="pe-anchor-qa">
                                <div className="pe-anchor-q">“{a.question}”</div>
                                <div className="pe-anchor-a">{a.answer}</div>
                            </div>
                            <button type="button" className="pe-anchor-x" onClick={() => removeAnchor(i)} aria-label={`Remove ${a.question}`}><X size={14} /></button>
                        </div>
                    ))}
                    <div className="pe-anchor-add">
                        <input value={anchorQ} onChange={(e) => setAnchorQ(e.target.value)} placeholder="Question they ask, e.g. Where is my daughter?" />
                        <textarea rows={2} value={anchorA} onChange={(e) => setAnchorA(e.target.value)} placeholder="Calm answer, e.g. She’s at work and she’ll visit tonight — she loves you." />
                        <button type="button" className="pe-anchor-addbtn" onClick={addAnchor} disabled={!anchorQ.trim() || !anchorA.trim()}>Add steady answer</button>
                    </div>
                </div>

                <label className="pe-toggle">
                    <input type="checkbox" checked={proactiveCheckins} onChange={(e) => setProactiveCheckins(e.target.checked)} />
                    <span className="pe-toggle-text">
                        <b>Gentle check-ins</b>
                        <small>If {name || 'they'} goes quiet, the companion gently starts the conversation with a warm, in-character hello — never demanding, easy to ignore.</small>
                    </span>
                </label>
            </div>
            </div>
            )}

            {tab === 'photo' && (
            <div className="pe-section">
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
                        <p className="pe-gen-note">The real photo is the faithful likeness. A 3D model is an <em>approximate</em> artistic likeness built from this one photo — it won't match exactly and each run differs. For the best result use a clear, front-facing, well-lit photo. <em>(Needs a Meshy API key on the backend.)</em></p>
                        <button type="button" className="pe-gen-btn" onClick={generate3D} disabled={gen.active}>
                            <Box size={15} />
                            {gen.active ? `Generating 3D model… ${gen.progress}%` : modelUrl ? 'Regenerate 3D model' : 'Generate 3D model from photo'}
                        </button>
                        {modelUrl && !gen.active && <span className="pe-hint">✓ 3D model ready</span>}
                        {printUrl && !gen.active && (
                            <a className="pe-gen-print" href={printUrl} target="_blank" rel="noreferrer">
                                <Box size={14} /> Download for 3D printing (STL)
                            </a>
                        )}
                        {gen.active && <div className="pe-gen-bar"><i style={{ width: `${Math.max(5, gen.progress)}%` }} /></div>}
                        {gen.error && <div className="pe-gen-err">{gen.error}</div>}
                    </div>
                )}
            </div>
            </div>
            )}

            {tab === 'voice' && (
            <div className="pe-section">
            <div className="pe-voicewrap">
                <label className="pe-field">
                    <span>Companion voice</span>
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
                    <span className="pe-tip">A natural preset voice — instant (~1–2s). Use the pitch slider to make it sound more like them.</span>
                </label>
                <label className="pe-field">
                    <span>Voice pitch <span className="pe-opt">(tune the fast voice toward their voice)</span></span>
                    <div className="pe-pitch">
                        <input type="range" min="-50" max="50" step="1" value={voicePitch}
                            onChange={(e) => setVoicePitch(Number(e.target.value))} aria-label="Voice pitch in Hz" />
                        <span className="pe-pitch-val">{voicePitch > 0 ? '+' : ''}{voicePitch} Hz</span>
                    </div>
                    <span className="pe-tip">Lower for a deeper voice, higher for a lighter one. Tap Preview to hear it.</span>
                </label>
                <div className="pe-field pe-voice-real">
                    <span>Their real voice <span className="pe-opt">(optional)</span></span>
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
                    {voiceSample && (cloningAvailable ? (
                        <div className="pe-clone">
                            <label className="pe-consent">
                                <input type="checkbox" checked={cloneConsent} onChange={(e) => setCloneConsent(e.target.checked)} />
                                <span>I have this person's permission to clone their voice.</span>
                            </label>
                            <button type="button" className="pe-clone-btn" onClick={cloneVoice} disabled={cloning.active || !cloneConsent}>
                                <Volume2 size={15} />
                                {cloning.active ? 'Cloning their voice…' : voiceCloneId ? 'Re-clone voice' : 'Clone this voice'}
                            </button>
                            <span className="pe-tip">Tip: 20–30 seconds of clear speech (no background noise) makes the best clone.</span>
                            {voiceCloneId && !cloning.active && <span className="pe-hint">✓ Voice cloned — the companion now speaks in this voice</span>}
                            {cloning.error && <div className="pe-gen-err">{cloning.error}</div>}
                        </div>
                    ) : (
                        <div className="pe-clone">
                            <div className="pe-clone-off">Voice cloning isn't enabled, so the companion will speak with a natural preset voice matched to their gender &amp; accent. To clone their real voice, add an ElevenLabs key to the backend.</div>
                        </div>
                    ))}
                </div>
            </div>
            </div>
            )}

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
                    onCapture={(img) => { setFaceImage(img); setModelUrl(null); setPrintUrl(null); setCapturing(false); }}
                    onClose={() => setCapturing(false)}
                />
            )}

            <style>{`
        .pe { display: flex; flex-direction: column; gap: var(--s-5); }
        .pe-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--s-4); }
        .pe-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        @media (max-width: 640px) { .pe-grid, .pe-grid-3 { grid-template-columns: 1fr; } }
        .pe-field { display: flex; flex-direction: column; gap: var(--s-2); min-width: 0; }
        .pe-field > span { font-size: var(--fs-sm); color: var(--text-muted); font-weight: 600; }
        .pe-field input, .pe-field textarea, .pe-field select {
            background: var(--glass-strong); border: 1px solid var(--border);
            border-radius: var(--r-md); padding: 12px 14px; color: var(--text); font-size: var(--fs-md); outline: none; font-family: inherit;
            transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .pe-field input:focus, .pe-field textarea:focus, .pe-field select:focus {
            border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring);
        }
        .pe-field textarea { resize: vertical; line-height: 1.5; }
        .pe-tabs { display: flex; gap: 4px; flex-wrap: wrap; padding: 5px; background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--r-pill); }
        .pe-tab { flex: 1 1 auto; padding: 9px 14px; border: none; border-radius: var(--r-pill); background: transparent; color: var(--text-muted); font-weight: 600; font-size: var(--fs-sm); cursor: pointer; font-family: inherit; white-space: nowrap; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
        .pe-tab:hover { color: var(--text); background: var(--surface-2); }
        .pe-tab.active { background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand); }
        .pe-section { display: flex; flex-direction: column; gap: var(--s-5); animation: ui-fade-up 0.3s var(--ease) both; }
        .pe-care { display: flex; flex-direction: column; gap: var(--s-4); padding: var(--s-5); border-radius: var(--r-lg); border: 1px solid rgba(139,92,246,0.32); background: var(--grad-brand-soft); box-shadow: var(--shadow-sm); backdrop-filter: blur(12px); }
        .pe-care-head { display: flex; flex-direction: column; gap: var(--s-1); }
        .pe-care-title {
            font-size: var(--fs-lg); font-weight: 800; letter-spacing: -0.01em;
            background: var(--grad-text); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
        }
        .pe-care-help { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.4; }
        .pe-anchors { display: flex; flex-direction: column; gap: var(--s-3); padding: var(--s-4); border-radius: var(--r-md); border: 1px solid var(--border); background: var(--glass-strong); }
        .pe-anchors-head { display: flex; flex-direction: column; gap: 2px; }
        .pe-anchors-title { font-size: var(--fs-md); font-weight: 800; color: var(--text); }
        .pe-anchors-help { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.45; }
        .pe-anchor { display: flex; align-items: flex-start; gap: var(--s-2); padding: var(--s-3); border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-1); }
        .pe-anchor-qa { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .pe-anchor-q { font-size: var(--fs-sm); font-weight: 700; color: var(--text); }
        .pe-anchor-a { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.45; }
        .pe-anchor-x { width: 28px; height: 28px; flex-shrink: 0; border-radius: var(--r-sm); border: 1px solid var(--border); background: var(--surface-2); color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .pe-anchor-x:hover { background: rgba(248,113,113,0.18); color: var(--danger); }
        .pe-anchor-add { display: flex; flex-direction: column; gap: var(--s-2); }
        .pe-anchor-add input, .pe-anchor-add textarea {
            background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-md);
            padding: 11px 13px; color: var(--text); font-size: var(--fs-md); font-family: inherit; outline: none; resize: vertical;
            transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .pe-anchor-add input:focus, .pe-anchor-add textarea:focus { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }
        .pe-anchor-addbtn {
            align-self: flex-start; min-height: 44px; padding: 0 var(--s-5); border-radius: var(--r-md); border: 1px solid rgba(139,92,246,0.45);
            background: var(--grad-brand-soft); color: #ddd6fe; font-weight: 700; font-size: var(--fs-sm); font-family: inherit; cursor: pointer;
            transition: box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
        }
        .pe-anchor-addbtn:hover:not(:disabled) { box-shadow: var(--glow-brand); transform: translateY(-1px); }
        .pe-anchor-addbtn:disabled { opacity: 0.5; cursor: default; }
        .pe-toggle { display: flex; align-items: flex-start; gap: var(--s-3); padding: var(--s-3) var(--s-4); border-radius: var(--r-md); border: 1px solid var(--border); background: var(--glass-strong); cursor: pointer; }
        .pe-toggle input { width: 20px; height: 20px; margin-top: 2px; accent-color: var(--brand-1); cursor: pointer; flex-shrink: 0; }
        .pe-toggle-text { display: flex; flex-direction: column; gap: 2px; }
        .pe-toggle-text b { font-size: var(--fs-md); color: var(--text); font-weight: 700; }
        .pe-toggle-text small { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.45; }
        .pe-chips { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--s-2) var(--s-3); transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .pe-chips:focus-within { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }
        .pe-chip { display: inline-flex; align-items: center; gap: 6px; background: rgba(139,92,246,0.18); border: 1px solid rgba(139,92,246,0.4); color: #ddd6fe; border-radius: var(--r-pill); padding: 5px 6px 5px 14px; font-size: var(--fs-sm); font-weight: 600; }
        .pe-chip-x { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: none; border-radius: 50%; background: var(--surface-3); color: var(--text); cursor: pointer; padding: 0; transition: background var(--dur) var(--ease); }
        .pe-chip-x:hover { background: rgba(255,255,255,0.28); }
        .pe-chip-input { flex: 1; min-width: 140px; background: transparent !important; border: none !important; box-shadow: none !important; padding: 4px !important; color: var(--text); outline: none; font-size: var(--fs-sm); }
        .pe-voicewrap { display: flex; flex-direction: column; gap: var(--s-5); }
        .pe-voice-real { padding: var(--s-4); border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--glass-strong); }
        .pe-opt { color: var(--text-dim); font-weight: 500; }
        .pe-pitch { display: flex; align-items: center; gap: var(--s-3); }
        .pe-pitch input[type=range] { flex: 1; min-width: 0; accent-color: var(--brand-1); height: 28px; cursor: pointer; }
        .pe-pitch-val { min-width: 58px; text-align: right; font-weight: 700; font-size: var(--fs-sm); color: var(--text); font-variant-numeric: tabular-nums; }
        .pe-voice-row { display: flex; gap: var(--s-2); min-width: 0; }
        .pe-voice-row select { flex: 1; min-width: 0; }
        .pe-preview {
            display: flex; align-items: center; gap: 6px; padding: 0 var(--s-4); border-radius: var(--r-md);
            border: 1px solid rgba(139,92,246,0.4); background: rgba(139,92,246,0.16); color: #c4b5fd; cursor: pointer; white-space: nowrap; font-weight: 700;
            transition: background var(--dur) var(--ease), transform var(--dur) var(--ease);
        }
        .pe-preview:hover:not(:disabled) { background: rgba(139,92,246,0.28); transform: translateY(-1px); }
        .pe-preview:disabled { opacity: 0.6; cursor: default; }
        .pe-hint { font-size: var(--fs-sm); color: var(--success); font-weight: 600; }
        .pe-or { display: flex; align-items: center; text-align: center; color: var(--text-dim); font-size: var(--fs-xs); margin: var(--s-1) 0; }
        .pe-or::before, .pe-or::after { content: ''; flex: 1; height: 1px; background: var(--border); }
        .pe-or span { padding: 0 var(--s-3); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; }
        .pe-upload {
            display: flex; align-items: center; justify-content: center; gap: var(--s-2); width: 100%;
            padding: 11px var(--s-4); border-radius: var(--r-md); cursor: pointer; font-weight: 700; font-size: var(--fs-sm);
            border: 1px solid var(--border); background: var(--surface-2); color: var(--text);
            transition: background var(--dur) var(--ease), transform var(--dur) var(--ease);
        }
        .pe-upload:hover { background: var(--surface-3); transform: translateY(-1px); }
        .pe-sample { display: flex; align-items: center; gap: var(--s-2); margin-top: var(--s-1); min-width: 0; }
        .pe-audio { flex: 1; min-width: 0; height: 36px; }
        .pe-remove { background: none; border: none; color: var(--danger); cursor: pointer; font-size: var(--fs-sm); font-weight: 700; white-space: nowrap; }
        .pe-face { display: flex; align-items: center; gap: var(--s-4); }
        .pe-face-thumb {
            position: relative; width: 80px; height: 80px; border-radius: var(--r-lg); flex-shrink: 0;
            background: var(--glass-strong); border: 1px solid var(--border); box-shadow: var(--shadow-sm);
            display: flex; align-items: center; justify-content: center; overflow: hidden;
        }
        .pe-face-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .pe-face-x { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: var(--r-sm); border: none; background: rgba(0,0,0,0.6); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background var(--dur) var(--ease); }
        .pe-face-x:hover { background: rgba(0,0,0,0.8); }
        .pe-face-actions { display: flex; gap: var(--s-2); flex-wrap: wrap; }
        .pe-face-btn {
            display: flex; align-items: center; gap: 7px; padding: 10px var(--s-4); border-radius: var(--r-md); cursor: pointer; font-weight: 700; font-size: var(--fs-sm);
            border: 1px solid var(--border); background: var(--surface-2); color: var(--text);
            transition: background var(--dur) var(--ease), transform var(--dur) var(--ease);
        }
        .pe-face-btn:hover { background: var(--surface-3); transform: translateY(-1px); }
        .pe-gen { display: flex; flex-direction: column; gap: var(--s-2); margin-top: var(--s-3); }
        .pe-gen-btn {
            display: flex; align-items: center; justify-content: center; gap: var(--s-2); width: 100%;
            padding: 12px var(--s-4); border-radius: var(--r-md); cursor: pointer; font-weight: 700; font-size: var(--fs-sm);
            border: 1px solid rgba(139,92,246,0.45); background: var(--grad-brand-soft); color: #ddd6fe;
            transition: background var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
        }
        .pe-gen-btn:hover:not(:disabled) { box-shadow: var(--glow-brand); transform: translateY(-1px); }
        .pe-gen-btn:disabled { opacity: 0.7; cursor: default; }
        .pe-gen-bar { height: 6px; border-radius: var(--r-pill); background: var(--surface-3); overflow: hidden; }
        .pe-gen-bar i { display: block; height: 100%; background: var(--grad-brand); transition: width .4s var(--ease); }
        .pe-gen-err { font-size: var(--fs-sm); color: var(--danger); line-height: 1.4; }
        .pe-gen-note { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.5; margin: 0 0 var(--s-1); }
        .pe-gen-note em { font-style: normal; color: var(--text-dim); }
        .pe-gen-print {
            display: inline-flex; align-items: center; gap: 7px; align-self: flex-start;
            padding: 9px 15px; border-radius: var(--r-md); text-decoration: none; font-weight: 600; font-size: var(--fs-sm);
            border: 1px solid rgba(34,211,238,0.4); background: rgba(34,211,238,0.12); color: var(--accent-cyan);
            transition: background var(--dur) var(--ease);
        }
        .pe-gen-print:hover { background: rgba(34,211,238,0.22); }
        .pe-clone { display: flex; flex-direction: column; gap: var(--s-2); margin-top: var(--s-2); }
        .pe-clone-btn {
            display: flex; align-items: center; justify-content: center; gap: var(--s-2); width: 100%;
            padding: 11px var(--s-4); border-radius: var(--r-md); cursor: pointer; font-weight: 700; font-size: var(--fs-sm);
            border: 1px solid rgba(52,211,153,0.45); background: rgba(52,211,153,0.14); color: #86efac;
            transition: background var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
        }
        .pe-clone-btn:hover:not(:disabled) { background: rgba(52,211,153,0.24); box-shadow: 0 10px 30px rgba(52,211,153,0.25); transform: translateY(-1px); }
        .pe-clone-btn:disabled { opacity: 0.7; cursor: default; }
        .pe-consent { display: flex; align-items: flex-start; gap: var(--s-2); font-size: var(--fs-sm); color: var(--text); cursor: pointer; line-height: 1.4; }
        .pe-consent input { width: 16px; height: 16px; margin-top: 1px; accent-color: var(--brand-1); cursor: pointer; flex-shrink: 0; }
        .pe-tip { font-size: var(--fs-xs); color: var(--text-muted); line-height: 1.4; }
        .pe-clone-off { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.45; padding: 12px var(--s-3); border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-1); }
        .pe-actions { display: flex; justify-content: flex-end; gap: var(--s-3); margin-top: var(--s-1); }
        .pe-btn {
            display: flex; align-items: center; gap: var(--s-2); padding: 12px var(--s-5); border-radius: var(--r-md); border: 1px solid transparent; font-weight: 700; cursor: pointer; font-size: var(--fs-sm);
            transition: transform var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease), opacity var(--dur) var(--ease);
        }
        .pe-btn:active { transform: translateY(1px); }
        .pe-btn.primary { background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand); }
        .pe-btn.primary:hover:not(:disabled) { box-shadow: 0 14px 44px rgba(124,58,237,0.5); transform: translateY(-2px); }
        .pe-btn.primary:disabled { opacity: 0.5; cursor: default; transform: none; box-shadow: none; }
        .pe-btn.ghost { background: var(--surface-2); color: var(--text); border-color: var(--border); }
        .pe-btn.ghost:hover { background: var(--surface-3); }
      `}</style>
        </div>
    );
}
