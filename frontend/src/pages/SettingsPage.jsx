// One calm place for all configuration — patient profile, companion, memory
// (forget/clear), accessibility, appearance, safety contacts, behaviour, and data.
// Caregiver-oriented; every destructive action is confirmed.
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
    User, Heart, Brain, Accessibility, Sun, Moon, Phone, Plus, Trash2, X,
    Download, RotateCcw, Check, Pencil, Info,
} from 'lucide-react';
import {
    useAppState, getState, setProfile, setPersona, setEmergencyContacts, resetAll,
} from '../lib/store';
import { getA11y, setA11y } from '../lib/a11y';
import { getTheme, setTheme } from '../lib/theme';
import { toast, confirmAction } from '../components/Feedback';
import PersonaEditor from '../components/PersonaEditor';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';
const SIZES = [{ k: 'normal', label: 'Normal' }, { k: 'large', label: 'Large' }, { k: 'largest', label: 'Largest' }];

function Toggle({ on, onClick, label, hint }) {
    return (
        <button type="button" className="set-toggle" onClick={onClick} aria-pressed={on}>
            <span className="set-toggle-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>
            <span className={`set-sw ${on ? 'on' : ''}`}>{on && <Check size={14} />}</span>
        </button>
    );
}

export default function SettingsPage() {
    const { profile, persona, emergencyContacts = [] } = useAppState();
    const [name, setName] = useState(profile?.name || '');
    const [age, setAge] = useState(profile?.age || '');
    const [a11y, setA11yState] = useState(getA11y());
    const [theme, setThemeState] = useState(getTheme());
    const [editing, setEditing] = useState(false);
    const [mems, setMems] = useState([]);
    const [ecName, setEcName] = useState('');
    const [ecPhone, setEcPhone] = useState('');
    const [captions, setCaptions] = useState(() => {
        try { return localStorage.getItem('factech_captions') !== 'off'; } catch (e) { return true; }
    });

    const proactiveOn = persona?.proactiveCheckins !== false;

    useEffect(() => {
        axios.post(`${API_BASE}/memory/list`, { user: { name: profile?.name } })
            .then((r) => setMems(r.data?.memories || [])).catch(() => setMems([]));
    }, [profile?.name]);

    const updateA11y = (patch) => setA11yState(setA11y(patch));
    const flipTheme = () => { const n = theme === 'light' ? 'dark' : 'light'; setTheme(n); setThemeState(n); };
    const saveProfile = () => {
        setProfile({ ...(profile || {}), name: name.trim() || profile?.name || 'Friend', age: age ? Number(age) : null });
        toast('Profile saved', 'success');
    };
    const flipCaptions = () => setCaptions((v) => {
        const n = !v; try { localStorage.setItem('factech_captions', n ? 'on' : 'off'); } catch (e) { /* noop */ }
        return n;
    });
    const flipProactive = () => setPersona({ ...persona, proactiveCheckins: !proactiveOn });

    const clearMemories = async () => {
        const ok = await confirmAction({
            title: 'Forget all memories?',
            message: 'The companion will forget everything it learned about you from past conversations. This can’t be undone.',
            confirmLabel: 'Forget all', danger: true,
        });
        if (!ok) return;
        try { await axios.post(`${API_BASE}/memory/clear`, { user: { name: profile?.name } }); } catch (e) { /* fail-soft */ }
        setMems([]); toast('All memories cleared', 'info');
    };
    const forgetOne = async (m) => {
        const ok = await confirmAction({ title: 'Forget this memory?', message: `“${m.text}”`, confirmLabel: 'Forget', danger: true });
        if (!ok) return;
        try { await axios.post(`${API_BASE}/memory/forget`, { id: m.id }); } catch (e) { /* fail-soft */ }
        setMems((list) => list.filter((x) => x.id !== m.id)); toast('Forgotten', 'info');
    };

    const addContact = () => {
        const n = ecName.trim(), p = ecPhone.trim();
        if (!n || !p) return;
        setEmergencyContacts([...emergencyContacts, { id: String(Date.now()), name: n, phone: p }]);
        setEcName(''); setEcPhone(''); toast(`${n} added`, 'success');
    };
    const removeContact = (id) => setEmergencyContacts(emergencyContacts.filter((c) => c.id !== id));

    const exportData = () => {
        const blob = new Blob([JSON.stringify({ ...getState(), memories_stored: mems }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'factech-data.json'; a.click();
        toast('Data exported', 'success');
    };
    const resetEverything = async () => {
        const ok = await confirmAction({
            title: 'Reset everything?',
            message: 'This deletes the patient profile, the companion, all memories and reminders, and returns to setup. This cannot be undone.',
            confirmLabel: 'Reset everything', danger: true,
        });
        if (!ok) return;
        try { await axios.post(`${API_BASE}/memory/clear`, { user: { name: profile?.name } }); } catch (e) { /* fail-soft */ }
        resetAll();
    };

    return (
        <div className="set">
            <div className="set-head">
                <h1>Settings</h1>
                <p>Everything in one calm place. Changes save right away.</p>
            </div>

            {/* PATIENT */}
            <section className="set-card">
                <div className="set-card-head"><User size={18} /><h2>You</h2></div>
                <p className="set-card-help">The person using the app.</p>
                <div className="set-grid">
                    <label className="set-field"><span>Your name</span>
                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Robert" /></label>
                    <label className="set-field"><span>Your age</span>
                        <input type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 74" /></label>
                </div>
                <button className="set-btn primary" onClick={saveProfile}><Check size={16} /> Save profile</button>
            </section>

            {/* COMPANION */}
            <section className="set-card">
                <div className="set-card-head"><Heart size={18} /><h2>Companion</h2></div>
                <div className="set-row">
                    <div><b>{persona?.name || 'Your companion'}</b><small>your {persona?.relationship || 'loved one'}</small></div>
                    <button className="set-btn" onClick={() => setEditing(true)}><Pencil size={16} /> Edit companion</button>
                </div>
            </section>

            {/* MEMORY */}
            <section className="set-card">
                <div className="set-card-head"><Brain size={18} /><h2>Memory</h2></div>
                <p className="set-card-help">What the companion remembers about you from past chats.</p>
                {mems.length === 0
                    ? <p className="set-empty">Nothing stored yet.</p>
                    : (
                        <div className="set-mems">
                            {mems.map((m) => (
                                <div key={m.id} className="set-mem">
                                    <span>{m.text}</span>
                                    <button onClick={() => forgetOne(m)} aria-label="Forget this">Forget</button>
                                </div>
                            ))}
                        </div>
                    )}
                {mems.length > 0 && <button className="set-btn danger" onClick={clearMemories}><Trash2 size={16} /> Forget all memories</button>}
            </section>

            {/* ACCESSIBILITY */}
            <section className="set-card">
                <div className="set-card-head"><Accessibility size={18} /><h2>Accessibility</h2></div>
                <div className="set-field"><span>Text size</span>
                    <div className="set-sizes">
                        {SIZES.map((s) => (
                            <button key={s.k} className={`set-size ${a11y.fontScale === s.k ? 'on' : ''}`} onClick={() => updateA11y({ fontScale: s.k })}>{s.label}</button>
                        ))}
                    </div>
                </div>
                <Toggle on={a11y.highContrast} onClick={() => updateA11y({ highContrast: !a11y.highContrast })} label="High contrast" hint="Stronger text and borders." />
                <Toggle on={a11y.reduceMotion} onClick={() => updateA11y({ reduceMotion: !a11y.reduceMotion })} label="Reduce motion" hint="Calmer, fewer animations." />
            </section>

            {/* APPEARANCE */}
            <section className="set-card">
                <div className="set-card-head">{theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}<h2>Appearance</h2></div>
                <Toggle on={theme === 'dark'} onClick={flipTheme} label="Dark mode" hint="Switch between light and dark." />
            </section>

            {/* SAFETY */}
            <section className="set-card">
                <div className="set-card-head"><Phone size={18} /><h2>Call-family contacts</h2></div>
                <p className="set-card-help">Shown on the always-visible “Call family” button.</p>
                {emergencyContacts.map((c) => (
                    <div key={c.id} className="set-row">
                        <div><b>{c.name}</b><small>{c.phone}</small></div>
                        <button className="set-icon" onClick={() => removeContact(c.id)} aria-label={`Remove ${c.name}`}><Trash2 size={16} /></button>
                    </div>
                ))}
                <div className="set-grid">
                    <input className="set-input" value={ecName} onChange={(e) => setEcName(e.target.value)} placeholder="Name (e.g. Sarah)" />
                    <input className="set-input" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} placeholder="Phone number" inputMode="tel" />
                </div>
                <button className="set-btn" onClick={addContact} disabled={!ecName.trim() || !ecPhone.trim()}><Plus size={16} /> Add contact</button>
            </section>

            {/* BEHAVIOUR */}
            <section className="set-card">
                <div className="set-card-head"><Heart size={18} /><h2>Companion behaviour</h2></div>
                <Toggle on={proactiveOn} onClick={flipProactive} label="Gentle check-ins" hint="If you go quiet, the companion gently starts the conversation." />
                <Toggle on={captions} onClick={flipCaptions} label="Captions" hint="Show large on-screen text of what the companion says." />
            </section>

            {/* PRIVACY & DATA */}
            <section className="set-card">
                <div className="set-card-head"><Download size={18} /><h2>Privacy &amp; data</h2></div>
                <p className="set-card-help">Everything is stored on this device. Nothing here uses an outside service.</p>
                <div className="set-actions">
                    <button className="set-btn" onClick={exportData}><Download size={16} /> Export my data</button>
                    <button className="set-btn danger" onClick={resetEverything}><RotateCcw size={16} /> Reset everything</button>
                </div>
            </section>

            <section className="set-card">
                <div className="set-card-head"><Info size={18} /><h2>About</h2></div>
                <p className="set-card-help">Factech AI — a warm memory companion for comfort and familiarity. Runs locally.</p>
            </section>

            {editing && (
                <div className="set-modal" onClick={(e) => e.target === e.currentTarget && setEditing(false)}>
                    <div className="set-modal-card">
                        <div className="set-modal-head"><h3>Edit {persona?.name}</h3><button onClick={() => setEditing(false)} aria-label="Close"><X size={18} /></button></div>
                        <PersonaEditor initial={{ ...persona, userName: profile?.name }}
                            onSave={(p) => { setPersona({ ...persona, ...p }); setEditing(false); toast('Companion saved', 'success'); }}
                            onCancel={() => setEditing(false)} saveLabel="Save changes" />
                    </div>
                </div>
            )}

            <style>{`
        .set { height: 100%; overflow-y: auto; padding: var(--s-10) var(--s-8) calc(var(--s-12) + 80px); color: var(--text); max-width: 760px; margin: 0 auto; }
        .set-head h1 { margin: 0; font-size: var(--fs-2xl); font-weight: 800; letter-spacing: -0.02em; background: var(--grad-text); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
        .set-head p { margin: var(--s-2) 0 var(--s-8); color: var(--text-muted); font-size: var(--fs-md); }
        .set-card { background: var(--glass); border: 1px solid var(--border); border-radius: var(--r-lg); padding: var(--s-5); margin-bottom: var(--s-5); box-shadow: var(--shadow-md); backdrop-filter: blur(14px); }
        .set-card-head { display: flex; align-items: center; gap: var(--s-2); margin-bottom: var(--s-2); }
        .set-card-head h2 { margin: 0; font-size: var(--fs-lg); font-weight: 800; }
        .set-card-head > svg { color: var(--brand-1); }
        .set-card-help { color: var(--text-muted); font-size: var(--fs-sm); margin: 0 0 var(--s-4); line-height: 1.5; }
        .set-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3); margin-bottom: var(--s-3); }
        @media (max-width: 560px) { .set-grid { grid-template-columns: 1fr; } }
        .set-field { display: flex; flex-direction: column; gap: var(--s-2); margin-bottom: var(--s-3); }
        .set-field > span { font-size: var(--fs-sm); color: var(--text-muted); font-weight: 600; }
        .set-field input, .set-input { background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-md); padding: 0 14px; min-height: 48px; color: var(--text); font-size: var(--fs-md); font-family: inherit; outline: none; transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .set-field input:focus, .set-input:focus { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }
        .set-btn { display: inline-flex; align-items: center; gap: 8px; min-height: 48px; padding: 0 var(--s-5); border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-2); color: var(--text); font-weight: 700; font-size: var(--fs-sm); font-family: inherit; cursor: pointer; transition: background var(--dur) var(--ease), transform var(--dur) var(--ease); }
        .set-btn:hover:not(:disabled) { background: var(--surface-3); transform: translateY(-1px); }
        .set-btn:disabled { opacity: 0.5; cursor: default; }
        .set-btn.primary { background: var(--grad-brand); color: var(--text-on-brand); border-color: transparent; box-shadow: var(--glow-brand); }
        .set-btn.danger { background: linear-gradient(135deg, #f43f5e, #e11d48); color: #fff; border-color: transparent; }
        .set-actions { display: flex; flex-wrap: wrap; gap: var(--s-3); }
        .set-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); padding: var(--s-3) 0; border-top: 1px solid var(--border); }
        .set-row:first-of-type { border-top: none; }
        .set-row b { display: block; font-size: var(--fs-md); }
        .set-row small { color: var(--text-muted); font-size: var(--fs-sm); }
        .set-icon { width: 44px; height: 44px; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .set-icon:hover { background: rgba(248,113,113,0.18); color: var(--danger); }
        .set-empty { color: var(--text-muted); font-size: var(--fs-sm); margin: 0; }
        .set-mems { display: flex; flex-direction: column; gap: var(--s-2); margin-bottom: var(--s-4); }
        .set-mem { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); padding: var(--s-3); border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-1); }
        .set-mem span { font-size: var(--fs-sm); line-height: 1.4; }
        .set-mem button { flex-shrink: 0; min-height: 36px; padding: 0 14px; border-radius: var(--r-pill); border: 1px solid var(--border); background: var(--surface-2); color: var(--text-muted); font-weight: 700; font-size: var(--fs-xs); font-family: inherit; cursor: pointer; }
        .set-mem button:hover { background: rgba(248,113,113,0.18); color: var(--danger); }
        .set-sizes { display: flex; gap: var(--s-2); }
        .set-size { flex: 1; min-height: 48px; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-1); color: var(--text-muted); font-weight: 700; font-size: var(--fs-sm); font-family: inherit; cursor: pointer; }
        .set-size.on { background: var(--grad-brand); color: var(--text-on-brand); border-color: transparent; }
        .set-toggle { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); width: 100%; min-height: 56px; padding: 0 var(--s-3); margin-bottom: var(--s-2); border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-1); cursor: pointer; font-family: inherit; text-align: left; }
        .set-toggle:hover { background: var(--surface-2); }
        .set-toggle-text { display: flex; flex-direction: column; gap: 2px; }
        .set-toggle-text b { font-size: var(--fs-md); color: var(--text); }
        .set-toggle-text small { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.4; }
        .set-sw { width: 40px; height: 24px; flex-shrink: 0; border-radius: 999px; background: var(--surface-3); border: 1px solid var(--border-strong); display: flex; align-items: center; justify-content: center; color: #fff; }
        .set-sw.on { background: var(--success); border-color: transparent; }
        .set-modal { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,0.62); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: var(--s-5); }
        .set-modal-card { width: 100%; max-width: 640px; max-height: 90vh; overflow-y: auto; background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-xl); padding: var(--s-8); box-shadow: var(--shadow-lg); backdrop-filter: blur(20px); }
        .set-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--s-5); }
        .set-modal-head h3 { margin: 0; font-size: var(--fs-lg); font-weight: 800; }
        .set-modal-head button { width: 36px; height: 36px; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .set-modal-head button:hover { background: var(--surface-3); color: var(--text); }
      `}</style>
        </div>
    );
}
