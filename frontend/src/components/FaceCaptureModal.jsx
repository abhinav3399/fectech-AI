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
        .fc { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .fc-card { width: 100%; max-width: 460px; background: #1e293b; border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; padding: 22px; }
        .fc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .fc-head h3 { margin: 0; color: #fff; font-size: 1.15rem; display: flex; align-items: center; gap: 8px; }
        .fc-head button { background: rgba(255,255,255,0.08); border: none; color: #cbd5e1; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; }
        .fc-stage { position: relative; width: 100%; aspect-ratio: 4/3; background: #0f172a; border-radius: 14px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
        .fc-media { width: 100%; height: 100%; object-fit: cover; display: block; }
        .fc-media.mirror { transform: scaleX(-1); }
        .fc-loading { position: absolute; color: #94a3b8; font-size: 0.9rem; }
        .fc-error { color: #fca5a5; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); padding: 16px; border-radius: 12px; font-size: 0.92rem; line-height: 1.5; }
        .fc-actions { display: flex; justify-content: center; gap: 10px; margin-top: 16px; }
        .fc-btn { display: flex; align-items: center; gap: 8px; padding: 11px 20px; border-radius: 10px; border: none; font-weight: 700; cursor: pointer; }
        .fc-btn.primary { background: linear-gradient(135deg,#7c3aed,#2563eb); color: #fff; }
        .fc-btn.primary:disabled { opacity: 0.5; cursor: default; }
        .fc-btn.ghost { background: rgba(255,255,255,0.08); color: #cbd5e1; }
      `}</style>
        </div>
    );
}
