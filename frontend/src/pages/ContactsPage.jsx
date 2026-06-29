import React, { useState } from 'react';
import { Phone, Plus, Star, Pencil, Trash2, X, UserPlus } from 'lucide-react';
import { useAppState, setEmergencyContacts } from '../lib/store';
import { toast, confirmAction } from '../components/Feedback';

const timeAgo = (ts) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

export default function ContactsPage() {
    const { emergencyContacts = [] } = useAppState();
    const [form, setForm] = useState(null); // null | {} (add) | contact (edit)
    const [name, setName] = useState('');
    const [rel, setRel] = useState('');
    const [phone, setPhone] = useState('');

    const contacts = [...emergencyContacts].sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));

    const openAdd = () => { setName(''); setRel(''); setPhone(''); setForm({}); };
    const openEdit = (c) => { setName(c.name || ''); setRel(c.relationship || ''); setPhone(c.phone || ''); setForm(c); };
    const close = () => setForm(null);

    const save = () => {
        const n = name.trim(), p = phone.trim();
        if (!n || !p) return;
        if (form && form.id) {
            setEmergencyContacts(emergencyContacts.map((c) => c.id === form.id ? { ...c, name: n, relationship: rel.trim(), phone: p } : c));
            toast('Contact updated', 'success');
        } else {
            const primary = emergencyContacts.length === 0;
            setEmergencyContacts([...emergencyContacts, { id: String(Date.now()), name: n, relationship: rel.trim(), phone: p, primary }]);
            toast(`${n} added`, 'success');
        }
        close();
    };

    const setPrimary = (id) => setEmergencyContacts(emergencyContacts.map((c) => ({ ...c, primary: c.id === id })));
    const markCalled = (id) => setEmergencyContacts(emergencyContacts.map((c) => c.id === id ? { ...c, lastCalled: Date.now() } : c));
    const remove = async (c) => {
        const ok = await confirmAction({ title: `Remove ${c.name}?`, message: 'This contact will be removed from quick-dial.', confirmLabel: 'Remove', danger: true });
        if (ok) { setEmergencyContacts(emergencyContacts.filter((x) => x.id !== c.id)); toast('Contact removed', 'info'); }
    };

    return (
        <div className="cp">
            <div className="cp-inner">
                <header className="cp-head">
                    <div>
                        <h1>Family Contacts</h1>
                        <p>The people who can help — one tap to call, always within reach.</p>
                    </div>
                    <button className="cp-add" onClick={openAdd}><Plus size={18} /> Add Contact</button>
                </header>

                {contacts.length === 0 ? (
                    <div className="cp-empty">
                        <UserPlus size={40} />
                        <p>No contacts yet. Add a family member or carer so help is always one tap away.</p>
                        <button className="cp-add" onClick={openAdd}><Plus size={18} /> Add your first contact</button>
                    </div>
                ) : (
                    <div className="cp-grid">
                        {contacts.map((c) => (
                            <div key={c.id} className={`cp-card ${c.primary ? 'primary' : ''}`}>
                                <div className="cp-card-top">
                                    <div className="cp-avatar">{(c.name || '?').trim().charAt(0).toUpperCase()}</div>
                                    <div className="cp-info">
                                        <div className="cp-name">{c.name}{c.primary && <span className="cp-badge"><Star size={11} /> Primary</span>}</div>
                                        <div className="cp-rel">{c.relationship || 'Family'}</div>
                                        <div className="cp-num">{c.phone}{c.lastCalled ? ` · last talked ${timeAgo(c.lastCalled)}` : ''}</div>
                                    </div>
                                </div>
                                <a className="cp-call" href={`tel:${c.phone.replace(/[^+\d]/g, '')}`} onClick={() => markCalled(c.id)}>
                                    <Phone size={20} /> Call {c.name}
                                </a>
                                <div className="cp-actions">
                                    {!c.primary && <button className="cp-ic" onClick={() => setPrimary(c.id)} title="Make primary"><Star size={16} /></button>}
                                    <button className="cp-ic" onClick={() => openEdit(c)} title="Edit"><Pencil size={16} /></button>
                                    <button className="cp-ic danger" onClick={() => remove(c)} title="Remove"><Trash2 size={16} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {form && (
                <div className="cp-modal" onClick={(e) => e.target === e.currentTarget && close()} role="dialog" aria-modal="true">
                    <div className="cp-modal-card">
                        <div className="cp-modal-head">
                            <h3>{form.id ? 'Edit contact' : 'Add a contact'}</h3>
                            <button onClick={close} aria-label="Close"><X size={20} /></button>
                        </div>
                        <label className="cp-label">Name</label>
                        <input className="cp-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah" />
                        <label className="cp-label">Relationship</label>
                        <input className="cp-input" value={rel} onChange={(e) => setRel(e.target.value)} placeholder="e.g. Daughter" />
                        <label className="cp-label">Phone number</label>
                        <input className="cp-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" inputMode="tel" />
                        <div className="cp-modal-actions">
                            <button className="cp-btn ghost" onClick={close}>Cancel</button>
                            <button className="cp-btn primary" onClick={save} disabled={!name.trim() || !phone.trim()}>{form.id ? 'Save changes' : 'Add contact'}</button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
        .cp { height: 100%; overflow-y: auto; color: var(--text); font-family: inherit;
            background: radial-gradient(900px 520px at 12% -10%, rgba(139,92,246,0.16), transparent 60%), var(--bg); }
        .cp-inner { max-width: 1040px; margin: 0 auto; padding: var(--s-10) var(--s-8); }
        .cp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-4); margin-bottom: var(--s-8); flex-wrap: wrap; }
        .cp-head h1 { margin: 0; font-size: var(--fs-2xl); font-weight: 800; letter-spacing: -0.02em;
            background: var(--grad-text); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
        .cp-head p { margin: var(--s-2) 0 0; color: var(--text-muted); font-size: var(--fs-md); line-height: 1.6; }
        .cp-add { display: inline-flex; align-items: center; gap: var(--s-2); min-height: 48px; padding: 0 var(--s-5); border-radius: var(--r-lg);
            border: 1px solid transparent; background: var(--grad-brand); color: var(--text-on-brand); font-weight: 800; font-size: var(--fs-sm);
            font-family: inherit; cursor: pointer; box-shadow: var(--glow-brand); white-space: nowrap;
            transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .cp-add:hover { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124,58,237,0.5); }

        .cp-empty { text-align: center; padding: var(--s-12) var(--s-6); color: var(--text-muted); display: flex; flex-direction: column;
            align-items: center; gap: var(--s-4); background: var(--glass); border: 1px solid var(--border); border-radius: var(--r-xl);
            box-shadow: var(--shadow-md); backdrop-filter: blur(14px); max-width: 520px; margin: var(--s-8) auto; }
        .cp-empty > svg { color: var(--text-dim); }
        .cp-empty p { margin: 0; line-height: 1.6; max-width: 360px; font-size: var(--fs-md); }

        .cp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--s-5); }
        .cp-card { display: flex; flex-direction: column; gap: var(--s-4); padding: var(--s-5); border-radius: var(--r-xl);
            background: var(--glass); border: 1px solid var(--border); box-shadow: var(--shadow-md); backdrop-filter: blur(14px); }
        .cp-card.primary { border-color: rgba(251,191,36,0.55); box-shadow: 0 0 0 2px rgba(251,191,36,0.30), var(--shadow-md); }
        .cp-card-top { display: flex; align-items: center; gap: var(--s-4); }
        .cp-avatar { width: 56px; height: 56px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
            font-weight: 800; font-size: var(--fs-xl); color: var(--text-on-brand); background: var(--grad-brand); box-shadow: var(--shadow-sm); }
        .cp-card.primary .cp-avatar { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #422006; }
        .cp-info { flex: 1; min-width: 0; }
        .cp-name { display: flex; align-items: center; gap: var(--s-2); font-size: var(--fs-lg); font-weight: 800; color: var(--text); }
        .cp-badge { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-xs); font-weight: 700; color: #422006;
            background: linear-gradient(135deg, #fbbf24, #f59e0b); border-radius: var(--r-pill); padding: 2px 9px; }
        .cp-rel { font-size: var(--fs-sm); color: var(--text-muted); margin-top: 2px; }
        .cp-num { font-size: var(--fs-xs); color: var(--text-dim); margin-top: 3px; }
        .cp-call { display: flex; align-items: center; justify-content: center; gap: var(--s-3); min-height: 60px; border-radius: var(--r-md);
            background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; text-decoration: none; font-weight: 800; font-size: var(--fs-md);
            box-shadow: 0 10px 28px rgba(22,163,74,0.4); transition: transform var(--dur) var(--ease); }
        .cp-call:hover { transform: translateY(-2px); }
        .cp-actions { display: flex; gap: var(--s-2); justify-content: flex-end; }
        .cp-ic { width: 40px; height: 40px; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--border);
            color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
        .cp-ic:hover { background: var(--surface-3); color: var(--warning); }
        .cp-ic.danger:hover { background: rgba(248,113,113,0.18); color: var(--danger); }

        .cp-modal { position: fixed; inset: 0; z-index: 100; background: rgba(5,8,16,0.7); backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center; padding: var(--s-5); }
        .cp-modal-card { width: 100%; max-width: 440px; background: var(--glass-strong); border: 1px solid var(--border-strong);
            border-radius: var(--r-xl); padding: var(--s-6); box-shadow: var(--shadow-lg); backdrop-filter: blur(20px); }
        .cp-modal-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-4); }
        .cp-modal-head h3 { margin: 0; font-size: var(--fs-lg); font-weight: 800; }
        .cp-modal-head > button { width: 40px; height: 40px; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--border);
            color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .cp-modal-head > button:hover { background: var(--surface-3); color: var(--text); }
        .cp-label { display: block; font-size: var(--fs-xs); font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
            color: var(--text-dim); margin: var(--s-4) 0 var(--s-2); }
        .cp-input { width: 100%; box-sizing: border-box; background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-md);
            padding: 13px 15px; color: var(--text); font-size: var(--fs-md); font-family: inherit; outline: none;
            transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .cp-input:focus { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }
        .cp-modal-actions { display: flex; justify-content: flex-end; gap: var(--s-3); margin-top: var(--s-6); }
        .cp-btn { min-height: 48px; padding: 0 var(--s-6); border-radius: var(--r-md); border: 1px solid transparent; font-weight: 800;
            font-size: var(--fs-sm); font-family: inherit; cursor: pointer; transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease), background var(--dur) var(--ease), opacity var(--dur) var(--ease); }
        .cp-btn.ghost { background: var(--surface-2); color: var(--text); border-color: var(--border); }
        .cp-btn.ghost:hover { background: var(--surface-3); }
        .cp-btn.primary { background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand); }
        .cp-btn.primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124,58,237,0.5); }
        .cp-btn.primary:disabled { opacity: 0.5; cursor: default; }

        @media (max-width: 560px) { .cp-inner { padding: var(--s-6) var(--s-4); } .cp-grid { grid-template-columns: 1fr; } }
      `}</style>
        </div>
    );
}
