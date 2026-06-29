import React, { useState, useEffect } from 'react';
import { Pill, Utensils, CalendarClock, Plus, Trash2, Pencil, Clock, Volume2, ShieldCheck } from 'lucide-react';
import { useAppState, addReminder, updateReminder, toggleReminder, removeReminder } from '../lib/store';
import { toast, confirmAction } from '../components/Feedback';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';

const TYPES = {
    medication: { icon: Pill, color: '#f472b6', label: 'Medication' },
    meal: { icon: Utensils, color: '#fbbf24', label: 'Meal' },
    event: { icon: CalendarClock, color: '#22d3ee', label: 'Event' },
};
const FREQS = { once: 'Once', daily: 'Daily', weekly: 'Weekly' };

const fmt = (t) => {
    const [h, m] = (t || '09:00').split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`;
};

// What the companion will gently announce — mirrors the spoken line in App.jsx.
const sayLine = (type, title, uname) =>
    type === 'medication' ? `${uname}, it's time for your medicine: ${title}.`
        : type === 'meal' ? `${uname}, it's time to eat: ${title}.`
            : type === 'event' ? `${uname}, you have an event: ${title}.`
                : `${uname}, a gentle reminder: ${title}.`;

export default function RemindersPage() {
    const { reminders, profile, persona } = useAppState();
    const [type, setType] = useState('medication');
    const [title, setTitle] = useState('');
    const [desc, setDesc] = useState('');
    const [time, setTime] = useState('09:00');
    const [freq, setFreq] = useState('daily');
    const [editingId, setEditingId] = useState(null);

    const companion = persona?.name || 'Your companion';
    const uname = profile?.name || 'dear';
    const previewLine = title.trim() ? sayLine(type, title.trim(), uname) : '';
    const activeCount = reminders.filter((r) => r.enabled !== false).length;

    // Pull the last-7-days adherence summary (per reminder) for the "Taken X/7" strips.
    const [adherence, setAdherence] = useState({});
    useEffect(() => {
        const kiosk = encodeURIComponent(profile?.name || 'kiosk');
        fetch(`${API_BASE}/adherence?days=7&kiosk_id=${kiosk}`)
            .then((r) => r.json())
            .then((d) => { if (d?.summary) setAdherence(d.summary); })
            .catch(() => { /* offline — strips just won't show */ });
    }, [profile?.name, reminders.length]);

    const reset = () => { setType('medication'); setTitle(''); setDesc(''); setTime('09:00'); setFreq('daily'); setEditingId(null); };

    const submit = () => {
        if (!title.trim()) return;
        const payload = { title: title.trim(), description: desc.trim(), time, type, frequency: freq };
        if (editingId) { updateReminder(editingId, payload); toast('Reminder updated', 'success'); }
        else { addReminder(payload); toast('Reminder added', 'success'); }
        reset();
    };

    const edit = (r) => {
        setEditingId(r.id); setType(r.type === 'general' ? 'event' : r.type); setTitle(r.title);
        setDesc(r.description || ''); setTime(r.time || '09:00'); setFreq(r.frequency || 'daily');
    };

    const del = async (r) => {
        const ok = await confirmAction({
            title: 'Delete this reminder?',
            message: `"${r.title}" will be removed. ${companion} won't announce it anymore.`,
            confirmLabel: 'Delete', danger: true,
        });
        if (ok) { if (editingId === r.id) reset(); removeReminder(r.id); toast('Reminder deleted', 'info'); }
    };

    return (
        <div className="rp">
            <div className="rp-inner">
                <header className="rp-head">
                    <h1>Reminders &amp; Medication</h1>
                    <p>{companion} helps maintain your daily routine with gentle, familiar voice announcements.</p>
                </header>

                <div className="rp-grid">
                    {/* ---- Create / edit ---- */}
                    <section className="rp-card rp-form">
                        <h2 className="rp-card-title">{editingId ? 'Edit reminder' : 'Create New Reminder'}</h2>

                        <label className="rp-label">Reminder category</label>
                        <div className="rp-cats">
                            {Object.entries(TYPES).map(([k, t]) => {
                                const Icon = t.icon;
                                return (
                                    <button key={k} type="button" className={`rp-cat ${type === k ? 'active' : ''}`} onClick={() => setType(k)}>
                                        <Icon size={22} />
                                        <span>{t.label}</span>
                                    </button>
                                );
                            })}
                        </div>

                        <label className="rp-label" htmlFor="rp-title">Reminder title</label>
                        <input id="rp-title" className="rp-input" value={title} onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g. Morning Blood Pressure Pill" />

                        <label className="rp-label" htmlFor="rp-desc">Description <span className="rp-opt">(optional)</span></label>
                        <textarea id="rp-desc" className="rp-input rp-textarea" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)}
                            placeholder="e.g. Take one pill after breakfast" />

                        <div className="rp-row">
                            <div className="rp-field">
                                <label className="rp-label" htmlFor="rp-time">Time</label>
                                <input id="rp-time" type="time" className="rp-input" value={time} onChange={(e) => setTime(e.target.value)} />
                            </div>
                            <div className="rp-field">
                                <label className="rp-label" htmlFor="rp-freq">Frequency</label>
                                <select id="rp-freq" className="rp-input" value={freq} onChange={(e) => setFreq(e.target.value)}>
                                    {Object.entries(FREQS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                            </div>
                        </div>

                        {previewLine && (
                            <div className="rp-preview">
                                <Volume2 size={16} />
                                <span><b>{companion} will say:</b> “{previewLine}”</span>
                            </div>
                        )}

                        <div className="rp-form-actions">
                            {editingId && <button type="button" className="rp-btn ghost" onClick={reset}>Cancel</button>}
                            <button type="button" className="rp-btn primary" onClick={submit} disabled={!title.trim()}>
                                <Plus size={18} /> {editingId ? 'Save changes' : 'Add reminder'}
                            </button>
                        </div>
                    </section>

                    {/* ---- Active list ---- */}
                    <section className="rp-list-wrap">
                        <div className="rp-list-head">
                            <h2 className="rp-card-title">Active Reminders <span className="rp-count">{reminders.length}</span></h2>
                            {activeCount > 0 && (
                                <span className="rp-safe"><ShieldCheck size={14} /> Dementia-safe active</span>
                            )}
                        </div>

                        {reminders.length === 0 ? (
                            <div className="rp-empty">
                                <Clock size={36} />
                                <p>No reminders yet. Add medication, meals, or events and {companion} will gently announce them at the right time.</p>
                            </div>
                        ) : (
                            <div className="rp-list">
                                {reminders.map((r) => {
                                    const t = TYPES[r.type] || TYPES.event;
                                    const Icon = t.icon;
                                    const on = r.enabled !== false;
                                    return (
                                        <div key={r.id} className={`rp-item ${on ? '' : 'off'}`}>
                                            <div className="rp-item-ic" style={{ background: `${t.color}22`, color: t.color }}><Icon size={20} /></div>
                                            <div className="rp-item-body">
                                                <div className="rp-item-top">
                                                    <span className="rp-item-title">{r.title}</span>
                                                    <span className="rp-item-freq">{(FREQS[r.frequency] || 'Daily').toUpperCase()}</span>
                                                </div>
                                                {r.description && <div className="rp-item-desc">{r.description}</div>}
                                                <div className="rp-item-time"><Clock size={13} /> {fmt(r.time)}</div>
                                                {r.type === 'medication' && adherence[r.id] && (
                                                    <div className="rp-item-adh"><Pill size={12} /> Taken {adherence[r.id].taken}/{adherence[r.id].total} this week</div>
                                                )}
                                            </div>
                                            <div className="rp-item-actions">
                                                <button className={`rp-switch ${on ? 'on' : ''}`} onClick={() => toggleReminder(r.id)}
                                                    role="switch" aria-checked={on} aria-label={`${on ? 'Mute' : 'Enable'} ${r.title}`}>
                                                    <span className="rp-switch-knob" />
                                                </button>
                                                <button className="rp-ic-btn" onClick={() => edit(r)} aria-label={`Edit ${r.title}`}><Pencil size={15} /></button>
                                                <button className="rp-ic-btn danger" onClick={() => del(r)} aria-label={`Delete ${r.title}`}><Trash2 size={15} /></button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                </div>
            </div>

            <style>{`
        .rp { height: 100%; overflow-y: auto; color: var(--text); font-family: inherit;
            background: radial-gradient(900px 520px at 12% -10%, rgba(139,92,246,0.16), transparent 60%), var(--bg); }
        .rp-inner { max-width: 1120px; margin: 0 auto; padding: var(--s-10) var(--s-8); }
        .rp-head h1 { margin: 0; font-size: var(--fs-2xl); font-weight: 800; letter-spacing: -0.02em;
            background: var(--grad-text); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
        .rp-head p { margin: var(--s-2) 0 var(--s-8); color: var(--text-muted); font-size: var(--fs-md); line-height: 1.6; max-width: 640px; }
        .rp-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: var(--s-6); align-items: start; }
        @media (max-width: 900px) { .rp-grid { grid-template-columns: 1fr; } }

        .rp-card, .rp-list-wrap { background: var(--glass); border: 1px solid var(--border); border-radius: var(--r-xl);
            padding: var(--s-6); box-shadow: var(--shadow-md); backdrop-filter: blur(14px); }
        .rp-card-title { margin: 0; font-size: var(--fs-lg); font-weight: 800; }
        .rp-label { display: block; font-size: var(--fs-xs); font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
            color: var(--text-dim); margin: var(--s-5) 0 var(--s-2); }
        .rp-opt { text-transform: none; letter-spacing: 0; font-weight: 600; color: var(--text-dim); }

        .rp-cats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-2); }
        .rp-cat { display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 72px; padding: var(--s-3);
            border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-1); color: var(--text-muted);
            font-family: inherit; font-weight: 700; font-size: var(--fs-sm); cursor: pointer;
            transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease), color var(--dur) var(--ease), transform var(--dur) var(--ease); }
        .rp-cat:hover { background: var(--surface-2); color: var(--text); transform: translateY(-2px); }
        .rp-cat.active { border-color: transparent; background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand); }

        .rp-input { width: 100%; box-sizing: border-box; background: var(--glass-strong); border: 1px solid var(--border);
            border-radius: var(--r-md); padding: 13px 15px; color: var(--text); font-size: var(--fs-md); font-family: inherit; outline: none;
            transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .rp-input::placeholder { color: var(--text-dim); }
        .rp-input:focus { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }
        .rp-textarea { resize: vertical; line-height: 1.5; }
        .rp-row { display: flex; gap: var(--s-3); }
        .rp-field { flex: 1; min-width: 0; }
        .rp-field .rp-label { margin-top: var(--s-5); }

        .rp-preview { display: flex; align-items: flex-start; gap: var(--s-2); margin-top: var(--s-5); font-size: var(--fs-sm);
            color: var(--text); line-height: 1.5; background: var(--grad-brand-soft); border: 1px solid rgba(139,92,246,0.32);
            border-radius: var(--r-md); padding: 12px 14px; }
        .rp-preview > svg { color: var(--brand-1); flex-shrink: 0; margin-top: 3px; }
        .rp-preview b { color: #c4b5fd; font-weight: 700; }

        .rp-form-actions { display: flex; justify-content: flex-end; gap: var(--s-3); margin-top: var(--s-6); }
        .rp-btn { display: inline-flex; align-items: center; gap: 8px; min-height: 52px; padding: 0 var(--s-6); border-radius: var(--r-lg);
            border: 1px solid transparent; font-weight: 800; font-size: var(--fs-md); font-family: inherit; cursor: pointer;
            transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease), background var(--dur) var(--ease), opacity var(--dur) var(--ease); }
        .rp-btn.primary { background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand); flex: 1; justify-content: center; }
        .rp-btn.primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124,58,237,0.5); }
        .rp-btn.primary:disabled { opacity: 0.5; cursor: default; }
        .rp-btn.ghost { background: var(--surface-2); color: var(--text); border-color: var(--border); }
        .rp-btn.ghost:hover { background: var(--surface-3); }

        .rp-list-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-5); flex-wrap: wrap; }
        .rp-count { display: inline-flex; align-items: center; justify-content: center; min-width: 26px; height: 24px; padding: 0 8px;
            font-size: var(--fs-xs); font-weight: 800; color: var(--text-on-brand); background: var(--grad-brand); border-radius: var(--r-pill); margin-left: 6px; }
        .rp-safe { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); font-weight: 800; letter-spacing: 0.04em;
            text-transform: uppercase; color: #6ee7b7; background: rgba(52,211,153,0.14); border: 1px solid rgba(52,211,153,0.4);
            border-radius: var(--r-pill); padding: 5px 12px; }

        .rp-empty { text-align: center; padding: var(--s-10) var(--s-5); color: var(--text-muted); display: flex; flex-direction: column;
            align-items: center; gap: var(--s-3); }
        .rp-empty > svg { color: var(--text-dim); }
        .rp-empty p { margin: 0; line-height: 1.6; max-width: 340px; font-size: var(--fs-md); }

        .rp-list { display: flex; flex-direction: column; gap: var(--s-3); }
        .rp-item { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-4); border-radius: var(--r-lg);
            background: var(--surface-1); border: 1px solid var(--border); transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease); }
        .rp-item:hover { border-color: var(--border-strong); background: var(--surface-2); }
        .rp-item.off { opacity: 0.55; }
        .rp-item-ic { width: 46px; height: 46px; border-radius: var(--r-md); display: flex; align-items: center; justify-content: center;
            flex-shrink: 0; border: 1px solid var(--border); }
        .rp-item-body { flex: 1; min-width: 0; }
        .rp-item-top { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
        .rp-item-title { font-size: var(--fs-md); font-weight: 800; color: var(--text); }
        .rp-item-freq { font-size: 10px; font-weight: 800; letter-spacing: 0.06em; color: var(--text-muted);
            background: var(--surface-3); border-radius: var(--r-pill); padding: 2px 8px; }
        .rp-item-desc { font-size: var(--fs-sm); color: var(--text-muted); margin-top: 3px; line-height: 1.4; }
        .rp-item-time { display: inline-flex; align-items: center; gap: 5px; font-size: var(--fs-sm); font-weight: 700; color: var(--brand-3); margin-top: 6px; }
        .rp-item-adh { display: inline-flex; align-items: center; gap: 5px; font-size: var(--fs-xs); font-weight: 700; color: var(--success); margin-top: 5px; margin-left: 10px; }
        .rp-item-actions { display: flex; align-items: center; gap: var(--s-2); flex-shrink: 0; }
        .rp-switch { position: relative; width: 46px; height: 28px; border-radius: var(--r-pill); border: 1px solid var(--border-strong);
            background: var(--surface-3); cursor: pointer; padding: 0; transition: background var(--dur) var(--ease); flex-shrink: 0; }
        .rp-switch.on { background: var(--success); border-color: transparent; }
        .rp-switch-knob { position: absolute; top: 2px; left: 2px; width: 22px; height: 22px; border-radius: 50%; background: #fff;
            box-shadow: var(--shadow-sm); transition: transform var(--dur) var(--ease); }
        .rp-switch.on .rp-switch-knob { transform: translateX(18px); }
        .rp-ic-btn { width: 38px; height: 38px; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--border);
            color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease); }
        .rp-ic-btn:hover { background: var(--surface-3); color: var(--text); border-color: var(--border-strong); }
        .rp-ic-btn.danger:hover { background: rgba(248,113,113,0.18); color: var(--danger); border-color: rgba(248,113,113,0.4); }

        @media (max-width: 560px) { .rp-inner { padding: var(--s-6) var(--s-4); } .rp-row { flex-direction: column; gap: 0; } }
      `}</style>
        </div>
    );
}
