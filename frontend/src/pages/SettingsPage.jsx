// One calm place for all configuration — patient profile, companion, memory
// (forget/clear), accessibility, appearance, safety contacts, behaviour, and data.
// Caregiver-oriented; every destructive action is confirmed.
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
    User, Heart, Brain, Accessibility, Sun, Moon, Phone, Plus, Trash2, X, Activity,
    Download, RotateCcw, Check, Pencil, Info,
} from 'lucide-react';
import {
    useAppState, getState, setProfile, setPersona, setEmergencyContacts, setAppSettings, resetAll,
} from '../lib/store';
import { OFFLINE_MODEL, OFFLINE_MODEL_LICENSE } from '../lib/offlineAi';
import { checkOllama, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL } from '../lib/ollama';
import { getA11y, setA11y } from '../lib/a11y';
import { getTheme, setTheme } from '../lib/theme';
import { toast, confirmAction } from '../components/Feedback';
import PersonaEditor from '../components/PersonaEditor';
import { API_BASE, backendHealthUrl, getBackendSettingValue, normalizeBackendBase } from '../lib/apiConfig';

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
    const { profile, persona, emergencyContacts = [], settings = {} } = useAppState();
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
    const [backendUrl, setBackendUrl] = useState(() => getBackendSettingValue());
    const [backendTesting, setBackendTesting] = useState(false);
    const [backendFeedback, setBackendFeedback] = useState(null);
    const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaUrl || DEFAULT_OLLAMA_URL);
    const [ollamaModel, setOllamaModel] = useState(settings.ollamaModel || DEFAULT_OLLAMA_MODEL);
    const [ollamaTesting, setOllamaTesting] = useState(false);
    const [ollamaFeedback, setOllamaFeedback] = useState(null);

    useEffect(() => {
        setBackendUrl(settings.backendUrl || getBackendSettingValue());
    }, [settings.backendUrl]);

    useEffect(() => {
        setOllamaUrl(settings.ollamaUrl || DEFAULT_OLLAMA_URL);
        setOllamaModel(settings.ollamaModel || DEFAULT_OLLAMA_MODEL);
    }, [settings.ollamaUrl, settings.ollamaModel]);

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

    const saveBackendUrl = () => {
        try {
            const normalized = normalizeBackendBase(backendUrl);
            setAppSettings({ backendUrl: normalized });
            setBackendUrl(normalized);
            setBackendFeedback({ type: 'success', text: normalized ? 'Backend address saved on this device.' : 'Using the build-time backend address.' });
        } catch (error) {
            setBackendFeedback({ type: 'error', text: error.message });
        }
    };

    const testBackend = async () => {
        setBackendTesting(true);
        setBackendFeedback({ type: 'info', text: 'Checking backend connection…' });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(backendHealthUrl(backendUrl), { signal: controller.signal, headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}.`);
            const health = await response.json();
            setBackendFeedback({
                type: 'success',
                text: `Connected${health.model_3d_provider ? ` · 3D provider: ${health.model_3d_provider}` : ''}. This confirms API reachability, not that every optional service is configured.`,
            });
        } catch (error) {
            const detail = error.name === 'AbortError' ? 'Connection timed out.' : error.message;
            setBackendFeedback({ type: 'error', text: `${detail} Check the HTTPS/VPN address and make sure the backend is running.` });
        } finally {
            clearTimeout(timeout);
            setBackendTesting(false);
        }
    };

    const saveOllamaSettings = () => {
        const url = ollamaUrl.trim().replace(/\/+$/, '');
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
        } catch {
            setOllamaFeedback({ type: 'error', text: 'Enter a valid http:// or https:// server URL.' });
            return;
        }
        if (!ollamaModel.trim()) {
            setOllamaFeedback({ type: 'error', text: 'Enter the name of an installed Ollama model.' });
            return;
        }
        setAppSettings({ ollamaUrl: url, ollamaModel: ollamaModel.trim() });
        setOllamaUrl(url);
        setOllamaModel(ollamaModel.trim());
        setOllamaFeedback({ type: 'success', text: 'Ollama settings saved on this device.' });
    };

    const testOllama = async () => {
        setOllamaTesting(true);
        setOllamaFeedback({ type: 'info', text: 'Checking the local server…' });
        try {
            const result = await checkOllama({ baseUrl: ollamaUrl, model: ollamaModel });
            if (result.modelInstalled) {
                setOllamaFeedback({ type: 'success', text: `Connected. “${result.model}” is installed and ready.` });
            } else {
                setOllamaFeedback({ type: 'error', text: `Server is reachable, but “${result.model}” is not installed. Install it in your phone’s Ollama runtime.` });
            }
        } catch (error) {
            setOllamaFeedback({ type: 'error', text: `${error.message} Start the Ollama-compatible server on this phone first.` });
        } finally {
            setOllamaTesting(false);
        }
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

            {/* BACKEND CONNECTION */}
            <section className="set-card">
                <div className="set-card-head"><Activity size={18} /><h2>Backend connection</h2></div>
                <p className="set-card-help">Connect this APK to your FastAPI server. Use HTTPS or a private VPN address, for example https://api.example.com or a VPN-reachable PC address with port 8010. The app cannot reach a plain home-LAN address after the phone leaves that network.</p>
                <label className="set-field" htmlFor="backend-url"><span>Backend URL</span>
                    <input id="backend-url" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={backendUrl} onChange={(event) => { setBackendUrl(event.target.value); setBackendFeedback(null); }} placeholder="https://your-backend.example.com" />
                </label>
                <div className="backend-actions">
                    <button className="set-btn" type="button" onClick={saveBackendUrl}>Save address</button>
                    <button className="set-btn primary" type="button" onClick={testBackend} disabled={backendTesting || !backendUrl.trim()}>{backendTesting ? 'Checking…' : 'Test connection'}</button>
                </div>
                {backendFeedback && <p className={`backend-feedback ${backendFeedback.type}`} role="status" aria-live="polite">{backendFeedback.text}</p>}
                <p className="set-card-help backend-note">This app does not host or expose your PC. Remote access requires your own HTTPS deployment or a private VPN/tunnel. Keep the 3D worker private behind the backend.</p>
            </section>

            {/* AI MODE */}
            <section className="set-card">
                <div className="set-card-head"><Brain size={18} /><h2>AI mode</h2></div>
                <p className="set-card-help">Auto uses phone-local Ollama when available, then the configured backend, then the downloaded offline model. Ollama itself is not bundled in this APK.</p>
                <div className="set-sizes ai-mode-selector">
                    {[
                        ['auto', 'Auto'],
                        ['ollama', 'Ollama'],
                        ['offline', 'Offline'],
                        ['online', 'Online'],
                    ].map(([value, label]) => (
                        <button key={value} className={`set-size ${(settings.aiMode || 'auto') === value ? 'on' : ''}`} onClick={() => setAppSettings({ aiMode: value })}>{label}</button>
                    ))}
                </div>
                <p className="set-card-help ai-model-note">
                    {settings.aiMode === 'ollama'
                        ? 'Ollama mode connects directly to the server below. The selected model must already be installed on your phone.'
                        : settings.aiMode === 'offline'
                            ? 'Offline mode uses Transformers.js. The model downloads on first use and is cached privately on this device.'
                            : settings.aiMode === 'online'
                                ? 'Online mode uses only the configured Factech backend.'
                                : 'Auto tries phone-local Ollama on Android, then the configured backend, then Transformers.js. The offline model needs one internet-connected download.'}
                    {' '}Offline model: {OFFLINE_MODEL} ({OFFLINE_MODEL_LICENSE}).
                </p>
                <div className="ollama-config">
                    <label className="set-field">
                        <span>Ollama server URL</span>
                        <input value={ollamaUrl} onChange={(event) => { setOllamaUrl(event.target.value); setOllamaFeedback(null); }} placeholder="http://127.0.0.1:11434" inputMode="url" autoCapitalize="none" spellCheck={false} />
                    </label>
                    <label className="set-field">
                        <span>Installed model name</span>
                        <input value={ollamaModel} onChange={(event) => { setOllamaModel(event.target.value); setOllamaFeedback(null); }} placeholder="llama3.2:3b" autoCapitalize="none" spellCheck={false} />
                    </label>
                    <div className="ollama-actions">
                        <button className="set-btn" type="button" onClick={saveOllamaSettings}>Save local settings</button>
                        <button className="set-btn primary" type="button" onClick={testOllama} disabled={ollamaTesting || !ollamaUrl.trim() || !ollamaModel.trim()}>{ollamaTesting ? 'Checking…' : 'Test connection'}</button>
                    </div>
                    {ollamaFeedback && <p className={`ollama-feedback ${ollamaFeedback.type}`} role="status" aria-live="polite">{ollamaFeedback.text}</p>}
                    <p className="set-card-help ollama-note">For this phone, keep the URL at 127.0.0.1 unless your Android runtime shows another address. Install/start an Ollama-compatible Android server separately; this APK does not ship Ollama or its model files.</p>
                </div>
            </section>

            {/* PRIVACY & DATA */}
            <section className="set-card">
                <div className="set-card-head"><Download size={18} /><h2>Privacy &amp; data</h2></div>
                <p className="set-card-help">Your profile, reminders, and app preferences are stored on this device. Features that need a server send requests to the backend URL configured above.</p>
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
        .set-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3); margin-bottom: var(--s-3); min-width: 0; }
        .set-grid > * { width: 100%; min-width: 0; box-sizing: border-box; }
        @media (max-width: 560px) { .set-grid { grid-template-columns: 1fr; } }
        .set-field { display: flex; flex-direction: column; gap: var(--s-2); margin-bottom: var(--s-3); }
        .set-field > span { font-size: var(--fs-sm); color: var(--text-muted); font-weight: 600; }
        .set-field input, .set-input { width: 100%; min-width: 0; box-sizing: border-box; background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-md); padding: 0 14px; min-height: 48px; color: var(--text); font-size: var(--fs-md); font-family: inherit; outline: none; transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
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
        .backend-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-3); }
        .backend-feedback { margin: var(--s-3) 0 0; font-size: var(--fs-sm); line-height: 1.5; overflow-wrap: anywhere; }
        .backend-feedback.success { color: var(--success); }
        .backend-feedback.error { color: var(--danger); }
        .backend-feedback.info { color: var(--text-muted); }
        .backend-note { margin: var(--s-3) 0 0; }
        .set-sizes { display: flex; gap: var(--s-2); }
        .set-size { flex: 1; min-height: 48px; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-1); color: var(--text-muted); font-weight: 700; font-size: var(--fs-sm); font-family: inherit; cursor: pointer; }
        .set-size.on { background: var(--grad-brand); color: var(--text-on-brand); border-color: transparent; }
        .ai-mode-selector { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .ollama-config { display: grid; gap: var(--s-3); padding-top: var(--s-4); border-top: 1px solid var(--border); }
        .ollama-config .set-field { margin: 0; }
        .ollama-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
        .ollama-feedback { margin: 0; font-size: var(--fs-sm); line-height: 1.5; }
        .ollama-feedback.success { color: var(--success); }
        .ollama-feedback.error { color: var(--danger); }
        .ollama-feedback.info { color: var(--text-muted); }
        .ollama-note { margin: 0; }
        @media (max-width: 420px) { .ai-mode-selector { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
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
