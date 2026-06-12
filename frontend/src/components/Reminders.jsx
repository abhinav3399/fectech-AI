import React, { useState } from 'react';
import { Bell, Plus, Pill, Utensils, CalendarClock, Trash2, X } from 'lucide-react';
import { useAppState, addReminder, removeReminder } from '../lib/store';

const TYPES = {
    medication: { icon: Pill, color: '#f472b6', label: 'Medication' },
    meal: { icon: Utensils, color: '#fbbf24', label: 'Meal' },
    appointment: { icon: CalendarClock, color: '#60a5fa', label: 'Appointment' },
    general: { icon: Bell, color: '#a78bfa', label: 'Reminder' },
};

const fmt = (t) => {
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const hh = ((h + 11) % 12) + 1;
    return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
};

export default function Reminders() {
    const { reminders } = useAppState();
    const [adding, setAdding] = useState(false);
    const [title, setTitle] = useState('');
    const [time, setTime] = useState('09:00');
    const [type, setType] = useState('medication');

    const save = () => {
        if (!title.trim()) return;
        addReminder({ title: title.trim(), time, type });
        setTitle(''); setTime('09:00'); setType('medication'); setAdding(false);
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
                        <select value={type} onChange={(e) => setType(e.target.value)}>
                            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                        <button className="rm-save" onClick={save} disabled={!title.trim()}>Save</button>
                    </div>
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
                                <div className="rm-item-meta">{T.label} · {fmt(r.time)}</div>
                            </div>
                            <button className="rm-del" onClick={() => removeReminder(r.id)} aria-label="Delete"><Trash2 size={15} /></button>
                        </div>
                    );
                })}
            </div>

            <style>{`
        .rm { background: rgba(30,41,59,0.55); border: 1px solid rgba(255,255,255,0.09); border-radius: 18px; padding: 22px; margin-top: 20px; }
        .rm-head { display: flex; align-items: center; justify-content: space-between; }
        .rm-title { display: flex; align-items: center; gap: 8px; font-size: 1.15rem; font-weight: 700; }
        .rm-add { display: flex; align-items: center; gap: 6px; background: rgba(124,58,237,0.18); border: 1px solid rgba(124,58,237,0.35); color: #c4b5fd; padding: 8px 14px; border-radius: 10px; font-weight: 700; cursor: pointer; font-size: 0.85rem; }
        .rm-form { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
        .rm-input, .rm-form select, .rm-form input[type=time] { background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 10px 12px; color: #fff; outline: none; font-size: 0.9rem; }
        .rm-input:focus, .rm-form select:focus, .rm-form input[type=time]:focus { border-color: #a78bfa; }
        .rm-form-row { display: flex; gap: 8px; }
        .rm-form-row select { flex: 1; }
        .rm-save { background: linear-gradient(135deg,#7c3aed,#2563eb); color: #fff; border: none; border-radius: 10px; padding: 0 18px; font-weight: 700; cursor: pointer; }
        .rm-save:disabled { opacity: .5; }
        .rm-empty { color: #94a3b8; font-size: 0.88rem; margin: 12px 0 0; line-height: 1.5; }
        .rm-list { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
        .rm-item { display: flex; align-items: center; gap: 12px; background: rgba(15,23,42,0.5); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; padding: 12px 14px; }
        .rm-ic { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .rm-item-body { flex: 1; min-width: 0; }
        .rm-item-title { font-weight: 600; color: #e2e8f0; }
        .rm-item-meta { font-size: 0.8rem; color: #94a3b8; }
        .rm-del { background: rgba(255,255,255,0.06); border: none; color: #94a3b8; width: 30px; height: 30px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .rm-del:hover { background: rgba(239,68,68,0.2); color: #fca5a5; }
      `}</style>
        </div>
    );
}
