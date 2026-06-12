import React, { useState } from 'react';
import { Brain, ArrowRight, Heart } from 'lucide-react';
import { setProfile, setPersona } from '../lib/store';
import PersonaEditor from './PersonaEditor';

export default function Onboarding() {
    const [step, setStep] = useState(1);
    const [name, setName] = useState('');
    const [age, setAge] = useState('');

    const continueToPersona = () => {
        if (!name.trim()) return;
        setProfile({ name: name.trim(), age: age ? Number(age) : null });
        setStep(2);
    };

    const finish = (persona) => {
        setPersona(persona);
        // Profile already saved in step 1; persona save flips the app into the
        // main 3-tab experience (App gates on profile + persona).
    };

    return (
        <div className="ob">
            <div className="ob-blob b1" />
            <div className="ob-blob b2" />

            <div className="ob-card">
                <div className="ob-brand">
                    <Brain size={26} color="#a78bfa" />
                    <span>Factech AI</span>
                </div>

                {step === 1 && (
                    <>
                        <h1 className="ob-title">Welcome 👋</h1>
                        <p className="ob-sub">Let's set things up. First, tell me a little about you.</p>
                        <label className="ob-field">
                            <span>Your name *</span>
                            <input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && continueToPersona()}
                                placeholder="e.g. Robert"
                                autoFocus
                            />
                        </label>
                        <label className="ob-field">
                            <span>Your age (optional)</span>
                            <input type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 74" />
                        </label>
                        <button className="ob-btn" onClick={continueToPersona} disabled={!name.trim()}>
                            Continue <ArrowRight size={18} />
                        </button>
                        <div className="ob-steps"><span className="on" /><span /></div>
                    </>
                )}

                {step === 2 && (
                    <>
                        <h1 className="ob-title"><Heart size={22} color="#f472b6" /> Create your companion</h1>
                        <p className="ob-sub">
                            Build one assistant in the likeness of someone you love. They'll talk with you in their own voice and personality.
                        </p>
                        <PersonaEditor
                            initial={{ userName: name }}
                            onSave={finish}
                            saveLabel="Create companion"
                        />
                        <button className="ob-back" onClick={() => setStep(1)}>← Back</button>
                        <div className="ob-steps"><span className="done" /><span className="on" /></div>
                    </>
                )}
            </div>

            <style>{`
        .ob {
            position: fixed; inset: 0; background: #0f172a; color: #fff;
            display: flex; align-items: center; justify-content: center; padding: 24px;
            font-family: system-ui, sans-serif; overflow-y: auto;
        }
        .ob-blob { position: absolute; width: 45vw; height: 45vw; border-radius: 50%; filter: blur(130px); opacity: 0.28; pointer-events: none; }
        .ob-blob.b1 { background: #7c3aed; top: -12%; left: -12%; }
        .ob-blob.b2 { background: #2563eb; bottom: -12%; right: -12%; }
        .ob-card {
            position: relative; z-index: 1; width: 100%; max-width: 620px;
            background: rgba(30,41,59,0.72); backdrop-filter: blur(20px);
            border: 1px solid rgba(255,255,255,0.1); border-radius: 24px;
            padding: 34px; box-shadow: 0 30px 70px rgba(0,0,0,0.4); margin: auto;
        }
        .ob-brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 1.2rem; margin-bottom: 22px; }
        .ob-brand span { background: linear-gradient(90deg,#a78bfa,#60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .ob-title { font-size: 1.9rem; font-weight: 800; margin: 0 0 8px; display: flex; align-items: center; gap: 10px; }
        .ob-sub { color: #94a3b8; margin: 0 0 22px; line-height: 1.55; }
        .ob-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
        .ob-field > span { font-size: 0.8rem; color: #94a3b8; font-weight: 600; }
        .ob-field input {
            background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.12);
            border-radius: 10px; padding: 13px 15px; color: #fff; font-size: 1rem; outline: none;
        }
        .ob-field input:focus { border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(167,139,250,0.15); }
        .ob-btn {
            display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;
            background: linear-gradient(135deg,#7c3aed,#2563eb); color: #fff; border: none;
            padding: 14px; border-radius: 12px; font-size: 1.05rem; font-weight: 700; cursor: pointer; transition: transform 0.15s;
        }
        .ob-btn:hover:not(:disabled) { transform: scale(1.02); }
        .ob-btn:disabled { opacity: 0.5; cursor: default; }
        .ob-back { background: none; border: none; color: #94a3b8; cursor: pointer; margin-top: 16px; font-size: 0.9rem; }
        .ob-steps { display: flex; gap: 8px; justify-content: center; margin-top: 22px; }
        .ob-steps span { width: 34px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.15); }
        .ob-steps span.on { background: #a78bfa; }
        .ob-steps span.done { background: #4ade80; }
      `}</style>
        </div>
    );
}
