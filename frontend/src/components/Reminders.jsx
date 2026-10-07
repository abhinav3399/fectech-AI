import React, { useState } from 'react';
import { Bell, Plus, Pill, Utensils, CalendarClock, Trash2, X, Volume2 } from 'lucide-react';
import { useAppState, addReminder, removeReminder } from '../lib/store';
import { toast, confirmAction } from './Feedback';

const TYPES = {
    medication: { icon: Pill, color: '#f472b6', label: 'Medication' },   // accent-pink
    meal: { icon: Utensils, color: '#fbbf24', label: 'Meal' },           // warning
    appointment: { icon: CalendarClock, color: '#22d3ee', label: 'Appointment' }, // accent-cyan
    general: { icon: Bell, color: '#8b5cf6', label: 'Reminder' },        // brand-1
};

const FREQS = { once: 'Once', daily: 'Daily', weekly: 'Weekly' };

// What the companion will gently announce — mirrors the spoken line in App.jsx.
const sayLine = (type, title, uname) =>
    type === 'medication' ? `${uname}, it's time for your medicine: ${title}.`
        : type === 'meal' ? `${uname}, it's time to eat: ${title}.`
            : type === 'appointment' ? `${uname}, you have an appointment: ${title}.`
                : `${uname}, a gentle reminder: ${title}.`;

const fmt = (t) => {
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const hh = ((h + 11) % 12) + 1;
    return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
};

export default function Reminders() {
    const { reminders, profile } = useAppState();
    const [adding, setAdding] = useState(false);
    const [title, setTitle] = useState('');
    const [time, setTime] = useState('09:00');
    const [type, setType] = useState('medication');
    const [freq, setFreq] = useState('daily');

    const uname = profile?.name || 'dear';
    const previewLine = title.trim() ? sayLine(type, title.trim(), uname) : '';

    const save = () => {
        if (!title.trim()) return;
        addReminder({ title: title.trim(), time, type, frequency: freq });
        setTitle(''); setTime('09:00'); setType('medication'); setFreq('daily'); setAdding(false);
        toast('Reminder added', 'success');
    };

    const del = async (r) => {
        const ok = await confirmAction({
            title: 'Delete this reminder?',
            message: `"${r.title}" will be removed. Your companion won't announce it anymore.`,
            confirmLabel: 'Delete', danger: true,
        });
        if (ok) { removeReminder(r.id); toast('Reminder deleted', 'info'); }
    };

    return (
        <div className="rm">
            <div className="rm-head">
                <div className="rm-title"><Bell size={20} color="#a78bfa" /> Reminders &amp; medication</div>
                <button className="rm-add" onClick={() => setAdding((a) => !a)}>
                    {adding ? <X size={15} /> : <Plus size={15} />} {adding ? 'Close' : 'Add'}
                </button>
            </div>

            {adding && (
                <div className="rm-form">
                    <input className="rm-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Blood pressure pill" />
                    <div className="rm-form-row">
                        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Reminder type">
                            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
                        <select value={freq} onChange={(e) => setFreq(e.target.value)} aria-label="Frequency">
                            {Object.entries(FREQS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                    </div>
                    {previewLine && (
                        <div className="rm-preview">
                            <Volume2 size={15} />
                            <span><b>Your companion will say:</b> “{previewLine}”</span>
                        </div>
                    )}
                    <button className="rm-save rm-save-full" onClick={save} disabled={!title.trim()}>Save reminder</button>
                </div>
            )}

            {reminders.length === 0 && !adding && (
                <p className="rm-empty">No reminders yet. Add medication, meals, or appointments and your companion will gently announce them at the right time.</p>
            )}

            <div className="rm-list">
                {reminders.map((r) => {
                    const T = TYPES[r.type] || TYPES.general;
                    const Icon = T.icon;
                    return (
                        <div key={r.id} className="rm-item">
                            <div className="rm-ic" style={{ background: `${T.color}22`, color: T.color }}><Icon size={18} /></div>
                            <div className="rm-item-body">
                                <div className="rm-item-title">{r.title}</div>
                                <div className="rm-item-meta">{T.label} · {fmt(r.time)}{r.frequency ? ` · ${FREQS[r.frequency] || r.frequency}` : ''}</div>
                            </div>
                            <button className="rm-del" onClick={() => del(r)} aria-label={`Delete ${r.title}`}><Trash2 size={15} /></button>
                        </div>
                    );
                })}
            </div>

            <style>{`
        .rm {
            background: var(--glass); border: 1px solid var(--border); border-radius: var(--r-lg);
            padding: var(--s-6); margin-top: var(--s-5);
            box-shadow: var(--shadow-md); backdrop-filter: blur(14px);
        }
        .rm-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; }
        .rm-title { display: flex; align-items: center; gap: var(--s-2); font-size: var(--fs-lg); font-weight: 800; letter-spacing: -0.01em; }
        .rm-add {
            display: inline-flex; align-items: center; gap: var(--s-2);
            background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
            padding: 10px 16px; border-radius: var(--r-md); font-weight: 700; cursor: pointer;
            font-size: var(--fs-sm); font-family: inherit;
            transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease), transform var(--dur) var(--ease);
        }
        .rm-add:hover { background: var(--surface-3); border-color: var(--border-strong); transform: translateY(-1px); }
        .rm-add:active { transform: translateY(1px); }
        .rm-form {
            margin-top: var(--s-4); display: flex; flex-direction: column; gap: var(--s-3);
            background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--s-4);
            animation: ui-fade-up 0.4s var(--ease) both;
        }
        .rm-input, .rm-form select, .rm-form input[type=time] {
            background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-md);
            padding: 12px 14px; color: var(--text); outline: none; font-size: var(--fs-md); font-family: inherit;
            transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .rm-input:focus, .rm-form select:focus, .rm-form input[type=time]:focus { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }
        .rm-form-row { display: flex; gap: var(--s-2); flex-wrap: wrap; }
        .rm-form-row select, .rm-form-row input[type=time] { flex: 1; min-width: 110px; }
        .rm-preview { display: flex; align-items: flex-start; gap: var(--s-2); font-size: var(--fs-sm); color: var(--text); line-height: 1.5; background: var(--grad-brand-soft); border: 1px solid rgba(139,92,246,0.32); border-radius: var(--r-md); padding: 12px 14px; }
        .rm-preview > svg { color: var(--brand-1); flex-shrink: 0; margin-top: 3px; }
        .rm-preview b { color: #c4b5fd; font-weight: 700; }
        .rm-save-full { min-height: 50px; width: 100%; }
        .rm-save {
            background: var(--grad-brand); color: var(--text-on-brand); border: none; border-radius: var(--r-md);
            padding: 0 var(--s-6); font-weight: 700; font-size: var(--fs-sm); cursor: pointer; font-family: inherit;
            box-shadow: var(--glow-brand);
            transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease), opacity var(--dur) var(--ease);
        }
        .rm-save:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124, 58, 237, 0.5); }
        .rm-save:active:not(:disabled) { transform: translateY(1px); }
        .rm-save:disabled { opacity: .5; cursor: default; }
        .rm-empty { color: var(--text-muted); font-size: var(--fs-sm); margin: var(--s-4) 0 0; line-height: 1.6; }
        .rm-list { display: flex; flex-direction: column; gap: var(--s-3); margin-top: var(--s-4); }
        .rm-item {
            display: flex; align-items: center; gap: var(--s-3);
            background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--r-md);
            padding: var(--s-3) var(--s-4);
            transition: transform var(--dur) var(--ease), border-color var(--dur) var(--ease), background var(--dur) var(--ease);
        }
        .rm-item:hover { transform: translateY(-2px); border-color: var(--border-strong); background: var(--surface-2); }
        .rm-ic {
            width: 44px; height: 44px; border-radius: var(--r-md);
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
            border: 1px solid var(--border);
        }
        .rm-item-body { flex: 1; min-width: 0; }
        .rm-item-title { font-weight: 700; color: var(--text); }
        .rm-item-meta { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; }
        .rm-del {
            background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted);
            width: 36px; height: 36px; border-radius: var(--r-sm); cursor: pointer;
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
            transition: background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease);
        }
        .rm-del:hover { background: rgba(248, 113, 113, 0.18); color: var(--danger); border-color: rgba(248, 113, 113, 0.4); }
      `}</style>
        </div>
    );
}
