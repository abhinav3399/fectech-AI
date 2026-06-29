import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, RotateCcw, Check } from 'lucide-react';

export default function FaceCaptureModal({ onCapture, onClose }) {
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const [shot, setShot] = useState(null);
    const [error, setError] = useState(null);
    const [ready, setReady] = useState(false);

    const stopStream = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }
    };

    useEffect(() => {
        let active = true;
        navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
            .then((stream) => {
                if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.onloadedmetadata = () => { videoRef.current.play(); setReady(true); };
                }
            })
            .catch(() => setError('Could not access the camera. You can upload a photo instead.'));
        return () => { active = false; stopStream(); };
    }, []);

    const capture = () => {
        const v = videoRef.current;
        if (!v || !v.videoWidth) return;
        const c = document.createElement('canvas');
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext('2d');
        // Mirror so the captured photo matches the selfie preview.
        ctx.translate(c.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(v, 0, 0);
        setShot(c.toDataURL('image/jpeg', 0.85));
    };

    const usePhoto = () => { stopStream(); onCapture(shot); };
    const close = () => { stopStream(); onClose(); };

    return (
        <div className="fc" onClick={(e) => e.target === e.currentTarget && close()}>
            <div className="fc-card">
                <div className="fc-head">
                    <h3><Camera size={18} /> Take a photo</h3>
                    <button onClick={close} aria-label="Close"><X size={18} /></button>
                </div>

                {error ? (
                    <div className="fc-error">{error}</div>
                ) : (
                    <div className="fc-stage">
                        {shot ? (
                            <img src={shot} alt="captured" className="fc-media" />
                        ) : (
                            <video ref={videoRef} className="fc-media mirror" playsInline muted />
                        )}
                        {!ready && !shot && <div className="fc-loading">Starting camera…</div>}
                    </div>
                )}

                <div className="fc-actions">
                    {!shot && !error && (
                        <button className="fc-btn primary" onClick={capture} disabled={!ready}>
                            <Camera size={16} /> Capture
                        </button>
                    )}
                    {shot && (
                        <>
                            <button className="fc-btn ghost" onClick={() => setShot(null)}><RotateCcw size={16} /> Retake</button>
                            <button className="fc-btn primary" onClick={usePhoto}><Check size={16} /> Use photo</button>
                        </>
                    )}
                    {error && <button className="fc-btn ghost" onClick={close}>Close</button>}
                </div>
            </div>

            <style>{`
        .fc { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(6px); z-index: 200; display: flex; align-items: center; justify-content: center; padding: var(--s-5); }
        .fc-card { width: 100%; max-width: 460px; background: var(--glass-strong); border: 1px solid var(--border-strong); border-radius: var(--r-xl); padding: var(--s-6); box-shadow: var(--shadow-lg), var(--glow-brand); backdrop-filter: blur(16px); animation: ui-fade-up 0.4s var(--ease) both; }
        .fc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--s-4); }
        .fc-head h3 { margin: 0; color: var(--text); font-size: var(--fs-lg); font-weight: 800; letter-spacing: -0.01em; display: flex; align-items: center; gap: var(--s-2); }
        .fc-head h3 > svg { color: var(--brand-1); }
        .fc-head button { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); width: 34px; height: 34px; border-radius: var(--r-sm); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
        .fc-head button:hover { background: var(--surface-3); color: var(--text); }
        .fc-stage { position: relative; width: 100%; aspect-ratio: 4/3; background: var(--bg); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: hidden; display: flex; align-items: center; justify-content: center; }
        .fc-media { width: 100%; height: 100%; object-fit: cover; display: block; }
        .fc-media.mirror { transform: scaleX(-1); }
        .fc-loading { position: absolute; color: var(--text-muted); font-size: var(--fs-sm); }
        .fc-error { color: var(--danger); background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.3); padding: var(--s-4); border-radius: var(--r-md); font-size: var(--fs-sm); line-height: 1.5; }
        .fc-actions { display: flex; justify-content: center; gap: var(--s-3); margin-top: var(--s-4); }
        .fc-btn { display: flex; align-items: center; gap: var(--s-2); padding: 11px 20px; border-radius: var(--r-md); border: 1px solid transparent; font-weight: 700; font-size: var(--fs-sm); font-family: inherit; cursor: pointer; transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease), background var(--dur) var(--ease); }
        .fc-btn:active { transform: translateY(1px); }
        .fc-btn.primary { background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand); }
        .fc-btn.primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124, 58, 237, 0.5); }
        .fc-btn.primary:disabled { opacity: 0.5; cursor: default; transform: none; }
        .fc-btn.ghost { background: var(--surface-2); color: var(--text); border-color: var(--border); }
        .fc-btn.ghost:hover { background: var(--surface-3); }
      `}</style>
        </div>
    );
}
