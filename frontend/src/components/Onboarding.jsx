import React, { useRef, useState } from 'react';
import { Brain, ArrowRight, Heart, User, Upload, Camera } from 'lucide-react';
import { setProfile, setPersona } from '../lib/store';
import FaceCaptureModal from './FaceCaptureModal';

const TOTAL = 5;

const blobToDataUrl = (blob) =>
    new Promise((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result);
        r.readAsDataURL(blob);
    });

// Auto-pick a neural voice from gender + accent + language (refined later in Edit).
const pickVoice = (gender, accent, language) => {
    const isMale = gender === 'male';
    const lang = (language || '').toLowerCase();
    if (lang === 'hindi' || lang === 'hinglish') return isMale ? 'hi-IN-MadhurNeural' : 'hi-IN-SwaraNeural';
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

const STEP_TITLES = ['About you', 'Your companion', 'Their manner', 'Their story', 'Review'];

export default function Onboarding() {
    const [step, setStep] = useState(1);
    // You (the person using the app)
    const [name, setName] = useState('');
    const [age, setAge] = useState('');
    // The companion
    const [cName, setCName] = useState('');
    const [relationship, setRelationship] = useState('');
    const [cGender, setCGender] = useState('');
    const [cAge, setCAge] = useState('');
    const [accent, setAccent] = useState('');
    const [language, setLanguage] = useState('');
    const [cStyle, setCStyle] = useState('balanced');
    const [personality, setPersonality] = useState('');
    const [faceImage, setFaceImage] = useState(null);
    const [capturing, setCapturing] = useState(false);
    const fileRef = useRef(null);

    const canAdvance = (step === 1 && name.trim()) || (step === 2 && cName.trim()) || step >= 3;

    const next = () => {
        if (step === 1) {
            if (!name.trim()) return;
            setProfile({ name: name.trim(), age: age ? Number(age) : null });
        }
        if (step === 2 && !cName.trim()) return;
        setStep((s) => Math.min(TOTAL, s + 1));
    };
    const back = () => setStep((s) => Math.max(1, s - 1));

    const create = () => {
        if (!cName.trim()) { setStep(2); return; }
        setPersona({
            name: cName.trim(),
            relationship: relationship.trim() || 'loved one',
            gender: cGender,
            age: cAge ? Number(cAge) : null,
            accent: accent.trim(),
            language,
            style: cStyle,
            personality: personality.trim(),
            voiceId: pickVoice(cGender, accent, language),
            voiceSample: null,
            voiceCloneId: null,
            faceImage,
            modelUrl: null,
        });
        // Profile saved in step 1; persona save flips the app into the main experience.
    };

    const onPhoto = async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (!f.type.startsWith('image/')) { alert('Please choose an image file.'); return; }
        setFaceImage(await blobToDataUrl(f));
        e.target.value = '';
    };

    const langLabel = language === 'hindi' ? 'Hindi' : language === 'hinglish' ? 'Hinglish' : 'English';

    return (
        <div className="ob">
            <div className="ob-blob b1" />
            <div className="ob-blob b2" />

            <div className="ob-card" key={step}>
                <div className="ob-brand">
                    <span className="ob-brand-mark"><Brain size={20} color="#fff" /></span>
                    <span className="ob-brand-text">Factech AI</span>
                </div>

                {/* Progress */}
                <div className="ob-prog">
                    <span className="ob-prog-label">Step {step} of {TOTAL} · {STEP_TITLES[step - 1]}</span>
                    <div className="ob-prog-bar"><i style={{ width: `${(step / TOTAL) * 100}%` }} /></div>
                </div>

                {step === 1 && (
                    <div className="ob-step">
                        <h1 className="ob-title">Welcome 👋</h1>
                        <p className="ob-sub">Let's set things up gently. First, a little about you.</p>
                        <label className="ob-field">
                            <span>Your name *</span>
                            <input value={name} autoFocus
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && next()}
                                placeholder="e.g. Robert" />
                        </label>
                        <label className="ob-field">
                            <span>Your age <em>(optional)</em></span>
                            <input type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 74" />
                        </label>
                    </div>
                )}

                {step === 2 && (
                    <div className="ob-step">
                        <h1 className="ob-title"><Heart size={22} color="#f472b6" /> Your companion</h1>
                        <p className="ob-sub">Create a companion in the likeness of someone you love — {name || 'you'}'ll talk with them in their own voice and personality.</p>

                        <div className="ob-avatar-up">
                            <div className="ob-avatar-thumb">
                                {faceImage ? <img src={faceImage} alt="their face" /> : <User size={28} color="#64748b" />}
                            </div>
                            <div className="ob-avatar-actions">
                                <div className="ob-avatar-btns">
                                    <button type="button" className="ob-soft" onClick={() => fileRef.current?.click()}><Upload size={15} /> Upload photo</button>
                                    <button type="button" className="ob-soft" onClick={() => setCapturing(true)}><Camera size={15} /> Take photo</button>
                                    {faceImage && <button type="button" className="ob-link" onClick={() => setFaceImage(null)}>Remove</button>}
                                </div>
                                <span className="ob-optional">A photo is optional — you can add it later.</span>
                            </div>
                            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />
                        </div>

                        <div className="ob-grid">
                            <label className="ob-field">
                                <span>Their name *</span>
                                <input value={cName} autoFocus
                                    onChange={(e) => setCName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && next()}
                                    placeholder="e.g. Margaret" />
                            </label>
                            <label className="ob-field">
                                <span>Relationship to you</span>
                                <input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="e.g. Wife, Son, Best friend" />
                            </label>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="ob-step">
                        <h1 className="ob-title">What are they like?</h1>
                        <p className="ob-sub">This gently shapes their voice and how they speak with you. All optional.</p>
                        <div className="ob-grid ob-grid-3">
                            <label className="ob-field">
                                <span>Gender</span>
                                <select value={cGender} onChange={(e) => setCGender(e.target.value)}>
                                    <option value="">Select…</option>
                                    <option value="female">Female</option>
                                    <option value="male">Male</option>
                                    <option value="other">Other</option>
                                </select>
                            </label>
                            <label className="ob-field">
                                <span>Age</span>
                                <input type="number" value={cAge} onChange={(e) => setCAge(e.target.value)} placeholder="e.g. 68" />
                            </label>
                            <label className="ob-field">
                                <span>Accent / from</span>
                                <input value={accent} onChange={(e) => setAccent(e.target.value)} placeholder="e.g. Indian" />
                            </label>
                        </div>
                        <div className="ob-grid">
                            <label className="ob-field">
                                <span>Language they speak</span>
                                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                                    <option value="">English</option>
                                    <option value="hinglish">Hinglish (Hindi + English, Roman)</option>
                                    <option value="hindi">Hindi — हिंदी (Devanagari)</option>
                                </select>
                            </label>
                            <label className="ob-field">
                                <span>Conversation style</span>
                                <select value={cStyle} onChange={(e) => setCStyle(e.target.value)}>
                                    <option value="brief">Brief — short &amp; gentle</option>
                                    <option value="balanced">Balanced — warm &amp; natural</option>
                                    <option value="chatty">Chatty — detailed &amp; talkative</option>
                                    <option value="dosti">Dosti — like a close yaar</option>
                                </select>
                            </label>
                        </div>
                    </div>
                )}

                {step === 4 && (
                    <div className="ob-step">
                        <h1 className="ob-title">Tell me about them</h1>
                        <p className="ob-sub">A few words on who they are and your shared memories — it makes them feel real. <em>(Optional, and you can add more anytime.)</em></p>
                        <label className="ob-field">
                            <span>Who are they?</span>
                            <textarea rows={6} value={personality} onChange={(e) => setPersonality(e.target.value)}
                                placeholder="Margaret is my wife of 42 years. She loves gardening and calls me 'love'. We met in Brighton in 1979. She is gentle, funny, and always reassuring." />
                        </label>
                    </div>
                )}

                {step === 5 && (
                    <div className="ob-step">
                        <h1 className="ob-title">All set? 🎉</h1>
                        <p className="ob-sub">Here's your companion. You can refine everything — photo, their real voice, care notes — anytime from <strong>Edit</strong>.</p>
                        <div className="ob-review">
                            <div className="ob-review-avatar">
                                {faceImage ? <img src={faceImage} alt={cName} /> : <Heart size={26} color="#fff" />}
                            </div>
                            <div className="ob-review-info">
                                <div className="ob-review-name">{cName || 'Your companion'}</div>
                                <div className="ob-review-rel">your {relationship || 'loved one'}</div>
                                <div className="ob-review-tags">
                                    <span className="ob-tag">{langLabel}</span>
                                    <span className="ob-tag">{cStyle}</span>
                                    {cGender && <span className="ob-tag">{cGender}</span>}
                                    <span className="ob-tag">voice auto-matched</span>
                                </div>
                            </div>
                        </div>
                        {personality.trim() && <p className="ob-review-note">“{personality.trim().slice(0, 140)}{personality.trim().length > 140 ? '…' : ''}”</p>}
                    </div>
                )}

                {/* Navigation */}
                <div className="ob-nav">
                    {step > 1
                        ? <button className="ob-back" onClick={back}>← Back</button>
                        : <span />}
                    {step < TOTAL
                        ? <button className="ob-btn" onClick={next} disabled={!canAdvance}>Continue <ArrowRight size={18} /></button>
                        : <button className="ob-btn" onClick={create}>Create companion <Heart size={18} /></button>}
                </div>
            </div>

            {capturing && (
                <FaceCaptureModal
                    onCapture={(img) => { setFaceImage(img); setCapturing(false); }}
                    onClose={() => setCapturing(false)}
                />
            )}

            <style>{`
        .ob {
            position: fixed; inset: 0; color: var(--text);
            display: flex; align-items: center; justify-content: center; padding: var(--s-6);
            font-family: inherit; overflow-y: auto;
            background:
                radial-gradient(1100px 580px at 6% -14%, rgba(139, 92, 246, 0.20), transparent 60%),
                radial-gradient(900px 560px at 114% 10%, rgba(59, 130, 246, 0.16), transparent 55%),
                var(--bg);
        }
        .ob-blob { position: absolute; width: 45vw; height: 45vw; border-radius: 50%; filter: blur(140px); opacity: 0.30; pointer-events: none; }
        .ob-blob.b1 { background: var(--brand-1); top: -14%; left: -12%; }
        .ob-blob.b2 { background: var(--brand-3); bottom: -14%; right: -12%; }
        .ob-card {
            position: relative; z-index: 1; width: 100%; max-width: 640px;
            background: var(--glass); backdrop-filter: blur(20px);
            border: 1px solid var(--border); border-radius: var(--r-xl);
            padding: var(--s-10); box-shadow: var(--shadow-lg); margin: auto;
            animation: ui-fade-up 0.45s var(--ease) both;
        }
        .ob-brand { display: flex; align-items: center; gap: var(--s-3); margin-bottom: var(--s-6); }
        .ob-brand-mark { width: 36px; height: 36px; border-radius: 11px; display: flex; align-items: center; justify-content: center; background: var(--grad-brand); box-shadow: var(--glow-brand); }
        .ob-brand-text {
            font-weight: 800; font-size: var(--fs-lg); letter-spacing: -0.01em;
            background: var(--grad-text); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
        }

        .ob-prog { margin-bottom: var(--s-8); }
        .ob-prog-label { display: block; font-size: var(--fs-xs); font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted); margin-bottom: var(--s-2); }
        .ob-prog-bar { height: 7px; border-radius: var(--r-pill); background: var(--surface-3); overflow: hidden; }
        .ob-prog-bar i { display: block; height: 100%; border-radius: var(--r-pill); background: var(--grad-brand); box-shadow: var(--glow-brand); transition: width 0.4s var(--ease); }

        .ob-step { animation: ui-fade-up 0.35s var(--ease) both; }
        .ob-title { font-size: var(--fs-2xl); font-weight: 800; letter-spacing: -0.02em; margin: 0 0 var(--s-2); display: flex; align-items: center; gap: var(--s-3); }
        .ob-sub { color: var(--text-muted); margin: 0 0 var(--s-6); line-height: 1.6; font-size: var(--fs-md); }
        .ob-sub em, .ob-field em { font-style: normal; color: var(--text-dim); }

        .ob-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-4); }
        .ob-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
        @media (max-width: 560px) { .ob-grid, .ob-grid-3 { grid-template-columns: 1fr; } }

        .ob-field { display: flex; flex-direction: column; gap: var(--s-2); margin-bottom: var(--s-4); }
        .ob-field > span { font-size: var(--fs-sm); color: var(--text-muted); font-weight: 600; }
        .ob-field input, .ob-field select, .ob-field textarea {
            background: var(--glass-strong); border: 1px solid var(--border);
            border-radius: var(--r-md); padding: 14px 16px; color: var(--text); font-size: var(--fs-md); outline: none;
            font-family: inherit; transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .ob-field textarea { resize: vertical; line-height: 1.55; }
        .ob-field input:focus, .ob-field select:focus, .ob-field textarea:focus { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }

        .ob-avatar-up { display: flex; align-items: center; gap: var(--s-4); margin-bottom: var(--s-5); padding: var(--s-4); border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface-1); }
        .ob-avatar-thumb {
            width: 70px; height: 70px; border-radius: 50%; flex-shrink: 0; overflow: hidden;
            background: var(--glass-strong); border: 1px solid var(--border-strong);
            display: flex; align-items: center; justify-content: center;
        }
        .ob-avatar-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .ob-avatar-actions { display: flex; flex-direction: column; gap: var(--s-2); min-width: 0; }
        .ob-avatar-btns { display: flex; gap: var(--s-2); flex-wrap: wrap; }
        .ob-soft {
            display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: var(--r-md); cursor: pointer; font-weight: 600; font-size: var(--fs-sm);
            border: 1px solid var(--border); background: var(--surface-2); color: var(--text); font-family: inherit;
            transition: background var(--dur) var(--ease);
        }
        .ob-soft:hover { background: var(--surface-3); }
        .ob-link { background: none; border: none; color: var(--danger); cursor: pointer; font-size: var(--fs-sm); font-weight: 600; }
        .ob-optional { font-size: var(--fs-xs); color: var(--text-dim); }

        .ob-review { display: flex; align-items: center; gap: var(--s-5); padding: var(--s-6); border-radius: var(--r-lg); border: 1px solid var(--border-strong); background: var(--grad-brand-soft); }
        .ob-review-avatar {
            width: 66px; height: 66px; border-radius: 50%; flex-shrink: 0; overflow: hidden;
            background: var(--grad-brand); display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-md);
        }
        .ob-review-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .ob-review-info { min-width: 0; }
        .ob-review-name { font-size: var(--fs-xl); font-weight: 800; }
        .ob-review-rel { color: var(--text-muted); font-size: var(--fs-sm); margin-bottom: var(--s-3); }
        .ob-review-tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .ob-tag { font-size: var(--fs-xs); font-weight: 600; padding: 4px 10px; border-radius: var(--r-pill); background: var(--surface-2); border: 1px solid var(--border); color: #ddd6fe; text-transform: capitalize; }
        .ob-review-note { color: var(--text-muted); font-style: italic; line-height: 1.6; margin: var(--s-4) 0 0; font-size: var(--fs-sm); }

        .ob-nav { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin-top: var(--s-8); }
        .ob-btn {
            display: inline-flex; align-items: center; justify-content: center; gap: var(--s-2);
            background: var(--grad-brand); color: var(--text-on-brand); border: 1px solid transparent;
            padding: 14px 26px; border-radius: var(--r-md); font-size: var(--fs-md); font-weight: 700; cursor: pointer;
            box-shadow: var(--glow-brand); font-family: inherit;
            transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease), opacity var(--dur) var(--ease);
        }
        .ob-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124, 58, 237, 0.5); }
        .ob-btn:active:not(:disabled) { transform: translateY(1px); }
        .ob-btn:disabled { opacity: 0.5; cursor: default; transform: none; box-shadow: none; }
        .ob-back {
            background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted);
            cursor: pointer; font-size: var(--fs-sm); font-weight: 600;
            padding: 11px 18px; border-radius: var(--r-pill); font-family: inherit;
            transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
        }
        .ob-back:hover { background: var(--surface-3); color: var(--text); }
      `}</style>
        </div>
    );
}
