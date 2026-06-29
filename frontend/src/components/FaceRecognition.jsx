import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Camera, X, RotateCcw, ScanFace, UserPlus } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';

const dataUrlToBlob = (dataUrl) => {
    const [meta, b64] = dataUrl.split(',');
    const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
};

export default function FaceRecognition({ onClose }) {
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const uploadRef = useRef(null);
    const [stage, setStage] = useState('camera'); // camera | working | result | enroll | done
    const [shot, setShot] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [enrollName, setEnrollName] = useState('');
    const [enrollRel, setEnrollRel] = useState('');
    const [ready, setReady] = useState(false);

    const stopStream = () => {
        if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    };

    useEffect(() => {
        let active = true;
        navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
            .then((stream) => {
                if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }
                streamRef.current = stream;
                if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.onloadedmetadata = () => { videoRef.current.play(); setReady(true); }; }
            })
            .catch(() => setError('Camera unavailable — use Upload instead.'));
        return () => { active = false; stopStream(); };
    }, []);

    const captureFromVideo = () => {
        const v = videoRef.current;
        if (!v || !v.videoWidth) return null;
        const c = document.createElement('canvas');
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        return c.toDataURL('image/jpeg', 0.9);
    };

    const recognize = async (dataUrl) => {
        setShot(dataUrl);
        setStage('working');
        setError(null);
        stopStream();
        try {
            const fd = new FormData();
            fd.append('file', dataUrlToBlob(dataUrl), 'face.jpg');
            const r = await axios.post(`${API_BASE}/recognize/person`, fd, { timeout: 40000 });
            const d = r.data || {};
            if (d.status === 'identified' && d.person) {
                setResult(d.person); setStage('result');
            } else if (d.status === 'no_face_detected') {
                setError('I couldn’t find a clear face. Try again, facing the camera.'); setStage('camera-retry');
            } else {
                setStage('enroll'); // unknown -> offer to remember
            }
        } catch (e) {
            setError('Recognition service error.'); setStage('camera-retry');
        }
    };

    const capture = () => { const d = captureFromVideo(); if (d) recognize(d); };

    const onUpload = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onloadend = () => recognize(reader.result);
        reader.readAsDataURL(f);
        e.target.value = '';
    };

    const enroll = async () => {
        if (!enrollName.trim() || !shot) return;
        setStage('working'); setError(null);
        try {
            const fd = new FormData();
            fd.append('name', enrollName.trim());
            fd.append('relation', enrollRel.trim() || 'Acquaintance');
            fd.append('file', dataUrlToBlob(shot), 'face.jpg');
            const r = await axios.post(`${API_BASE}/remember/person`, fd, { timeout: 40000 });
            if (r.data?.status === 'stored') { setResult({ name: enrollName.trim(), relation: enrollRel.trim(), notes: 'Just remembered.', image: shot }); setStage('done'); }
            else { setError(r.data?.message || 'Could not remember this person.'); setStage('enroll'); }
        } catch (e) {
            setError('Enrollment error.'); setStage('enroll');
        }
    };

    const retry = () => { setShot(null); setResult(null); setError(null); setStage('camera'); setReady(false);
        navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' }, audio: false })
            .then((s) => { streamRef.current = s; if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.onloadedmetadata = () => { videoRef.current.play(); setReady(true); }; } })
            .catch(() => setError('Camera unavailable — use Upload instead.'));
    };

    const close = () => { stopStream(); onClose(); };

    return (
        <div className="fr" onClick={(e) => e.target === e.currentTarget && close()}>
            <div className="fr-card">
                <div className="fr-head">
                    <h3><ScanFace size={18} /> Who is this?</h3>
                    <button onClick={close} aria-label="Close"><X size={18} /></button>
                </div>

                <div className="fr-stage">
                    {(stage === 'camera' || stage === 'camera-retry') && !shot && (
                        <video ref={videoRef} className="fr-media mirror" playsInline muted />
                    )}
                    {shot && stage !== 'camera' && <img src={shot} alt="captured" className="fr-media" />}
                    {stage === 'working' && <div className="fr-overlay">Looking…</div>}
                    {!ready && (stage === 'camera') && <div className="fr-overlay">Starting camera…</div>}
                </div>

                {error && <div className="fr-error">{error}</div>}

                {stage === 'result' && result && (
                    <div className="fr-result">
                        <div className="fr-name">{result.name}</div>
                        {result.relation && result.relation !== 'Unknown' && <div className="fr-rel">your {result.relation}</div>}
                        {result.notes && <p className="fr-notes">{result.notes}</p>}
                        {typeof result.confidence === 'number' && <div className="fr-conf">match {Math.round(result.confidence * 100)}%</div>}
                    </div>
                )}

                {stage === 'done' && result && (
                    <div className="fr-result">
                        <div className="fr-name">✓ Remembered {result.name}</div>
                        <p className="fr-notes">I'll recognise them next time.</p>
                    </div>
                )}

                {stage === 'enroll' && (
                    <div className="fr-enroll">
                        <p className="fr-enroll-q">I don't recognise them yet. Who is this?</p>
                        <input value={enrollName} onChange={(e) => setEnrollName(e.target.value)} placeholder="Their name" />
                        <input value={enrollRel} onChange={(e) => setEnrollRel(e.target.value)} placeholder="Relationship (e.g. Son, Nurse)" />
                    </div>
                )}

                <div className="fr-actions">
                    {(stage === 'camera') && <button className="fr-btn primary" onClick={capture} disabled={!ready}><Camera size={16} /> Capture</button>}
                    {(stage === 'camera' || stage === 'camera-retry') && <button className="fr-btn ghost" onClick={() => uploadRef.current?.click()}>Upload</button>}
                    {stage === 'camera-retry' && <button className="fr-btn primary" onClick={retry}><RotateCcw size={16} /> Try again</button>}
                    {(stage === 'result' || stage === 'done') && <button className="fr-btn primary" onClick={retry}><RotateCcw size={16} /> Scan another</button>}
                    {stage === 'enroll' && <><button className="fr-btn ghost" onClick={retry}>Cancel</button><button className="fr-btn primary" onClick={enroll} disabled={!enrollName.trim()}><UserPlus size={16} /> Remember</button></>}
                    <input ref={uploadRef} type="file" accept="image/*" hidden onChange={onUpload} />
                </div>
            </div>

            <style>{`
        .fr { position: fixed; inset: 0; background: rgba(5, 8, 18, 0.72); backdrop-filter: blur(6px); z-index: 200; display: flex; align-items: center; justify-content: center; padding: var(--s-5); }
        .fr-card { width: 100%; max-width: 440px; background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-xl); padding: var(--s-6); box-shadow: var(--shadow-lg); backdrop-filter: blur(18px); animation: ui-fade-up 0.4s var(--ease) both; }
        .fr-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--s-4); }
        .fr-head h3 { margin: 0; color: var(--text); font-size: var(--fs-lg); font-weight: 800; letter-spacing: -0.01em; display: flex; align-items: center; gap: var(--s-2); }
        .fr-head h3 svg { color: var(--brand-1); }
        .fr-head button { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); width: 36px; height: 36px; border-radius: var(--r-md); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
        .fr-head button:hover { background: var(--surface-3); color: var(--text); }
        .fr-stage { position: relative; width: 100%; aspect-ratio: 1; max-height: 320px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: hidden; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 60px rgba(0,0,0,0.5); }
        .fr-media { width: 100%; height: 100%; object-fit: cover; }
        .fr-media.mirror { transform: scaleX(-1); }
        .fr-stage::after {
            content: '';
            position: absolute; inset: 16px;
            border-radius: var(--r-md);
            border: 2px solid rgba(139, 92, 246, 0.45);
            box-shadow: 0 0 0 100vmax rgba(5, 8, 18, 0.18) inset, var(--glow-brand);
            pointer-events: none;
        }
        .fr-overlay { position: absolute; z-index: 2; color: #ddd6fe; font-weight: 700; font-size: var(--fs-sm); background: var(--glass-strong); border: 1px solid var(--border-strong); padding: 10px 18px; border-radius: var(--r-pill); backdrop-filter: blur(10px); box-shadow: var(--shadow-md); }
        .fr-error { margin-top: var(--s-3); color: var(--danger); background: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.32); padding: 12px 14px; border-radius: var(--r-md); font-size: var(--fs-sm); }
        .fr-result { text-align: center; margin-top: var(--s-4); padding: var(--s-5); background: var(--grad-brand-soft); border: 1px solid var(--border); border-radius: var(--r-lg); }
        .fr-name { font-size: var(--fs-xl); font-weight: 800; color: var(--text); letter-spacing: -0.01em; }
        .fr-rel { color: #c4b5fd; margin-top: var(--s-1); font-weight: 600; }
        .fr-notes { color: var(--text-muted); margin: var(--s-2) 0 0; line-height: 1.6; }
        .fr-conf { display: inline-flex; margin-top: var(--s-3); color: var(--text-muted); font-size: var(--fs-xs); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 5px 12px; border-radius: var(--r-pill); background: var(--surface-2); border: 1px solid var(--border); }
        .fr-enroll { margin-top: var(--s-4); display: flex; flex-direction: column; gap: var(--s-3); }
        .fr-enroll-q { color: var(--text); font-weight: 600; margin: 0; }
        .fr-enroll input { background: var(--glass-strong); border: 1px solid var(--border); border-radius: var(--r-md); padding: 12px 14px; color: var(--text); font-size: var(--fs-md); font-family: inherit; outline: none; transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .fr-enroll input::placeholder { color: var(--text-dim); }
        .fr-enroll input:focus { border-color: var(--brand-1); box-shadow: 0 0 0 3px var(--ring); }
        .fr-actions { display: flex; justify-content: center; gap: var(--s-3); margin-top: var(--s-5); flex-wrap: wrap; }
        .fr-btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--s-2); padding: 12px 20px; border-radius: var(--r-md); border: 1px solid transparent; font-weight: 700; font-size: var(--fs-sm); font-family: inherit; cursor: pointer; transition: transform var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease), opacity var(--dur) var(--ease); }
        .fr-btn:active { transform: translateY(1px); }
        .fr-btn.primary { background: var(--grad-brand); color: var(--text-on-brand); box-shadow: var(--glow-brand); }
        .fr-btn.primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124, 58, 237, 0.5); }
        .fr-btn.primary:disabled { opacity: 0.5; cursor: default; transform: none; box-shadow: none; }
        .fr-btn.ghost { background: var(--surface-2); color: var(--text); border-color: var(--border); }
        .fr-btn.ghost:hover { background: var(--surface-3); }
      `}</style>
        </div>
    );
}
