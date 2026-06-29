// Always-visible safety button: a distressed or confused patient gets a one-tap
// way to reach a real person. Uses tel: links (100% local, no service) and shows
// the number large as a fallback on devices that can't dial. A carer adds 1-2
// contacts; they persist in the local store.
import React, { useState } from 'react';
import { Phone, X, Plus, Trash2, Star } from 'lucide-react';
import { useAppState, setEmergencyContacts } from '../lib/store';
import { toast } from './Feedback';

const timeAgo = (ts) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

export default function EmergencyButton() {
    const { emergencyContacts = [] } = useAppState();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [rel, setRel] = useState('');
    const [phone, setPhone] = useState('');

    // Primary contact (gold ring) sorts first; everything else keeps its order.
    const contacts = [...emergencyContacts].sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));

    const add = () => {
        const n = name.trim(), p = phone.trim();
        if (!n || !p) return;
        const primary = emergencyContacts.length === 0; // first contact becomes primary
        setEmergencyContacts([...emergencyContacts, { id: String(Date.now()), name: n, relationship: rel.trim(), phone: p, primary }]);
        setName(''); setRel(''); setPhone('');
        toast(`${n} added`, 'success');
    };
    const remove = (id) => setEmergencyContacts(emergencyContacts.filter((c) => c.id !== id));
    const setPrimary = (id) => setEmergencyContacts(emergencyContacts.map((c) => ({ ...c, primary: c.id === id })));
    const markCalled = (id) => setEmergencyContacts(emergencyContacts.map((c) => c.id === id ? { ...c, lastCalled: Date.now() } : c));

    return (
        <>
            <button className="eb-fab" onClick={() => setOpen(true)} aria-label="Call my family for help">
                <Phone size={24} /><span>Call family</span>
            </button>

            {open && (
                <div className="eb-modal" onClick={(e) => e.target === e.currentTarget && setOpen(false)}
                    role="dialog" aria-modal="true" aria-label="Call family">
                    <div className="eb-card">
                        <div className="eb-head">
                            <h2>Call someone who can help</h2>
                            <button onClick={() => setOpen(false)} aria-label="Close"><X size={22} /></button>
                        </div>

                        {emergencyContacts.length === 0 ? (
                            <p className="eb-hint">No contacts yet. A family member or carer can add one below.</p>
                        ) : (
                            <div className="eb-list">
                                {contacts.map((c) => (
                                    <div key={c.id} className={`eb-contact ${c.primary ? 'primary' : ''}`}>
                                        <div className="eb-contact-top">
                                            <div className="eb-avatar">{(c.name || '?').trim().charAt(0).toUpperCase()}</div>
                                            <div className="eb-contact-info">
                                                <div className="eb-contact-name">{c.name}{c.primary && <span className="eb-badge"><Star size={11} /> Primary</span>}</div>
                                                <div className="eb-contact-rel">{c.relationship || 'Family'}{c.lastCalled ? ` · last talked ${timeAgo(c.lastCalled)}` : ''}</div>
                                            </div>
                                            <div className="eb-contact-actions">
                                                {!c.primary && <button className="eb-icon" onClick={() => setPrimary(c.id)} title="Make primary contact" aria-label={`Make ${c.name} primary`}><Star size={16} /></button>}
                                                <button className="eb-icon danger" onClick={() => remove(c.id)} title="Remove" aria-label={`Remove ${c.name}`}><Trash2 size={16} /></button>
                                            </div>
                                        </div>
                                        <a className="eb-call" href={`tel:${c.phone.replace(/[^+\d]/g, '')}`} onClick={() => markCalled(c.id)}>
                                            <Phone size={22} />
                                            <span className="eb-call-text">
                                                <span className="eb-call-name">Call {c.name}</span>
                                                <span className="eb-call-num">{c.phone}</span>
                                            </span>
                                        </a>
                                    </div>
                                ))}
                            </div>
                        )}

                        <details className="eb-add">
                            <summary>Add a contact</summary>
                            <div className="eb-add-row">
                                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Sarah)" aria-label="Contact name" />
                                <input value={rel} onChange={(e) => setRel(e.target.value)} placeholder="Relationship (e.g. Daughter)" aria-label="Relationship" />
                                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" inputMode="tel" aria-label="Phone number" />
                                <button onClick={add} disabled={!name.trim() || !phone.trim()}><Plus size={18} /> Add contact</button>
                            </div>
                        </details>
                    </div>
                </div>
            )}

            <style>{`
        .eb-fab { position: fixed; left: 22px; bottom: 22px; z-index: 3500;
            display: inline-flex; align-items: center; gap: 10px; min-height: 56px; padding: 0 22px;
            border-radius: var(--r-pill); border: 1px solid rgba(255,255,255,0.22);
            background: linear-gradient(135deg, #f43f5e, #e11d48); color: #fff; font-weight: 800; font-size: var(--fs-md);
            font-family: inherit; cursor: pointer; box-shadow: 0 14px 40px rgba(225,29,72,0.45);
            transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .eb-fab:hover { transform: translateY(-2px); box-shadow: 0 18px 50px rgba(225,29,72,0.55); }
        .eb-fab:active { transform: translateY(1px); }
        @media (max-width: 520px) { .eb-fab span { display: none; } .eb-fab { padding: 0; width: 56px; justify-content: center; } }

        .eb-modal { position: fixed; inset: 0; z-index: 3600; background: rgba(5,8,16,0.7); backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center; padding: var(--s-5); }
        .eb-card { width: 100%; max-width: 460px; background: var(--glass-strong); border: 1px solid var(--border-strong);
            border-radius: var(--r-xl); padding: var(--s-6); box-shadow: var(--shadow-lg); backdrop-filter: blur(20px); animation: fb-in 0.25s var(--ease) both; }
        .eb-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-5); }
        .eb-head h2 { margin: 0; font-size: var(--fs-lg); font-weight: 800; }
        .eb-head > button { width: 44px; height: 44px; border-radius: var(--r-sm); background: var(--surface-2);
            border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .eb-head > button:hover { background: var(--surface-3); color: var(--text); }
        .eb-hint { color: var(--text-muted); font-size: var(--fs-md); line-height: 1.6; margin: 0 0 var(--s-4); }
        .eb-list { display: flex; flex-direction: column; gap: var(--s-4); }
        .eb-contact { display: flex; flex-direction: column; gap: var(--s-3); padding: var(--s-4); border-radius: var(--r-lg);
            background: var(--surface-1); border: 1px solid var(--border); }
        .eb-contact.primary { border-color: rgba(251,191,36,0.55); box-shadow: 0 0 0 2px rgba(251,191,36,0.30), var(--shadow-md); }
        .eb-contact-top { display: flex; align-items: center; gap: var(--s-3); }
        .eb-avatar { width: 48px; height: 48px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
            font-weight: 800; font-size: var(--fs-lg); color: var(--text-on-brand); background: var(--grad-brand); box-shadow: var(--shadow-sm); }
        .eb-contact.primary .eb-avatar { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #422006; }
        .eb-contact-info { flex: 1; min-width: 0; }
        .eb-contact-name { display: flex; align-items: center; gap: var(--s-2); font-size: var(--fs-md); font-weight: 800; color: var(--text); }
        .eb-badge { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-xs); font-weight: 700; color: #422006;
            background: linear-gradient(135deg, #fbbf24, #f59e0b); border-radius: var(--r-pill); padding: 2px 9px; }
        .eb-contact-rel { font-size: var(--fs-sm); color: var(--text-muted); margin-top: 2px; }
        .eb-contact-actions { display: flex; gap: var(--s-2); flex-shrink: 0; }
        .eb-icon { width: 40px; height: 40px; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--border);
            color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
        .eb-icon:hover { background: var(--surface-3); color: var(--warning); }
        .eb-icon.danger:hover { background: rgba(248,113,113,0.18); color: var(--danger); }
        .eb-call { display: flex; align-items: center; justify-content: center; gap: var(--s-3); min-height: 60px; padding: 0 var(--s-5);
            border-radius: var(--r-md); background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff;
            text-decoration: none; box-shadow: 0 10px 28px rgba(22,163,74,0.4); transition: transform var(--dur) var(--ease); }
        .eb-call:hover { transform: translateY(-2px); }
        .eb-call-text { display: flex; flex-direction: column; align-items: center; }
        .eb-call-name { font-size: var(--fs-md); font-weight: 800; }
        .eb-call-num { font-size: var(--fs-sm); opacity: 0.92; }
        .eb-add { margin-top: var(--s-5); }
        .eb-add summary { cursor: pointer; color: var(--text-muted); font-weight: 700; font-size: var(--fs-sm); }
        .eb-add-row { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-3); }
        .eb-add-row input { flex: 1; min-width: 140px; min-height: 48px; background: var(--glass-strong); border: 1px solid var(--border);
            border-radius: var(--r-md); padding: 0 14px; color: var(--text); font-size: var(--fs-md); font-family: inherit; outline: none; }
        .eb-add-row input:focus { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }
        .eb-add-row > button { display: inline-flex; align-items: center; gap: 6px; min-height: 48px; padding: 0 var(--s-5);
            border-radius: var(--r-md); border: none; background: var(--grad-brand); color: var(--text-on-brand);
            font-weight: 700; font-family: inherit; cursor: pointer; box-shadow: var(--glow-brand); }
        .eb-add-row > button:disabled { opacity: 0.5; cursor: default; }
      `}</style>
        </>
    );
}
