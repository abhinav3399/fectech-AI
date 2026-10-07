// One tiny, app-wide feedback layer: toasts (success / error / info) and a calm
// confirm dialog. Event-based so any module can call toast() / confirmAction()
// without prop-drilling a provider. Mount <FeedbackHost/> once in App.
import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, AlertOctagon } from 'lucide-react';

let _id = 0;
let _toasts = [];
const toastListeners = new Set();
const emitToasts = () => toastListeners.forEach((l) => l(_toasts));

export function toast(message, type = 'success', ms = 3400) {
    const id = ++_id;
    _toasts = [..._toasts, { id, message, type }];
    emitToasts();
    setTimeout(() => { _toasts = _toasts.filter((t) => t.id !== id); emitToasts(); }, ms);
}

let confirmListener = null;
// Returns a Promise<boolean>. Falls back to window.confirm if the host isn't mounted.
export function confirmAction({ title, message, confirmLabel = 'Yes', cancelLabel = 'Cancel', danger = true } = {}) {
    return new Promise((resolve) => {
        if (!confirmListener) { resolve(window.confirm(message || title || 'Are you sure?')); return; }
        confirmListener({ title, message, confirmLabel, cancelLabel, danger, resolve });
    });
}

const ICONS = { success: CheckCircle2, error: AlertOctagon, info: Info, warning: AlertTriangle };

export function FeedbackHost() {
    const [list, setList] = useState(_toasts);
    const [dlg, setDlg] = useState(null);

    useEffect(() => {
        const l = (t) => setList([...t]);
        toastListeners.add(l);
        confirmListener = (d) => setDlg(d);
        return () => { toastListeners.delete(l); confirmListener = null; };
    }, []);

    useEffect(() => {
        if (!dlg) return;
        const onKey = (e) => { if (e.key === 'Escape') close(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [dlg]);

    const close = (val) => { setDlg((d) => { if (d) d.resolve(val); return null; }); };

    return (
        <>
            <div className="fb-toasts" role="status" aria-live="polite">
                {list.map((t) => {
                    const Icon = ICONS[t.type] || Info;
                    return (
                        <div key={t.id} className={`fb-toast fb-${t.type}`}>
                            <Icon size={20} /><span>{t.message}</span>
                        </div>
                    );
                })}
            </div>

            {dlg && (
                <div className="fb-confirm" onClick={(e) => e.target === e.currentTarget && close(false)}
                    role="dialog" aria-modal="true" aria-label={dlg.title || 'Please confirm'}>
                    <div className="fb-confirm-card">
                        {dlg.title && <h3>{dlg.title}</h3>}
                        {dlg.message && <p>{dlg.message}</p>}
                        <div className="fb-confirm-actions">
                            <button className="fb-btn fb-ghost" onClick={() => close(false)}>{dlg.cancelLabel}</button>
                            <button className={`fb-btn ${dlg.danger ? 'fb-danger' : 'fb-primary'}`} onClick={() => close(true)} autoFocus>
                                {dlg.confirmLabel}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
        .fb-toasts { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 4000;
            display: flex; flex-direction: column; gap: 10px; align-items: center; pointer-events: none; width: max-content; max-width: 92vw; }
        .fb-toast { display: flex; align-items: center; gap: 10px; padding: 14px 20px; border-radius: var(--r-md);
            font-weight: 700; font-size: var(--fs-md); color: var(--text);
            background: var(--glass-strong); border: 1px solid var(--border-strong); backdrop-filter: blur(16px);
            box-shadow: var(--shadow-lg); animation: fb-in 0.3s var(--ease) both; }
        .fb-toast.fb-success > svg { color: var(--success); }
        .fb-toast.fb-error   > svg { color: var(--danger); }
        .fb-toast.fb-warning > svg { color: var(--warning); }
        .fb-toast.fb-info    > svg { color: var(--brand-1); }
        @keyframes fb-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }

        .fb-confirm { position: fixed; inset: 0; z-index: 4100; background: rgba(5,8,16,0.66); backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center; padding: var(--s-5); animation: fb-fade 0.2s var(--ease) both; }
        @keyframes fb-fade { from { opacity: 0; } to { opacity: 1; } }
        .fb-confirm-card { width: 100%; max-width: 440px; background: var(--glass-strong); border: 1px solid var(--border-strong);
            border-radius: var(--r-xl); padding: var(--s-6); box-shadow: var(--shadow-lg); backdrop-filter: blur(20px); animation: fb-in 0.25s var(--ease) both; }
        .fb-confirm-card h3 { margin: 0 0 var(--s-2); font-size: var(--fs-lg); font-weight: 800; }
        .fb-confirm-card p { margin: 0 0 var(--s-5); color: var(--text-muted); font-size: var(--fs-md); line-height: 1.55; }
        .fb-confirm-actions { display: flex; justify-content: flex-end; gap: var(--s-3); }
        .fb-btn { min-height: 48px; padding: 0 var(--s-6); border-radius: var(--r-md); border: 1px solid transparent;
            font-weight: 700; font-size: var(--fs-sm); font-family: inherit; cursor: pointer;
            transition: transform var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .fb-btn:active { transform: translateY(1px); }
        .fb-ghost { background: var(--surface-2); color: var(--text); border-color: var(--border); }
        .fb-ghost:hover { background: var(--surface-3); }
        .fb-primary { background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand); }
        .fb-danger { background: linear-gradient(135deg, #f43f5e, #e11d48); color: #fff; }
        .fb-danger:hover, .fb-primary:hover { transform: translateY(-2px); }
      `}</style>
        </>
    );
}
