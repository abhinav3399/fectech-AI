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
        .fr { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .fr-card { width: 100%; max-width: 440px; background: #1e293b; border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; padding: 22px; }
        .fr-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .fr-head h3 { margin: 0; color: #fff; font-size: 1.15rem; display: flex; align-items: center; gap: 8px; }
        .fr-head button { background: rgba(255,255,255,0.08); border: none; color: #cbd5e1; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; }
        .fr-stage { position: relative; width: 100%; aspect-ratio: 1; max-height: 320px; background: #0f172a; border-radius: 14px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
        .fr-media { width: 100%; height: 100%; object-fit: cover; }
        .fr-media.mirror { transform: scaleX(-1); }
        .fr-overlay { position: absolute; color: #c4b5fd; font-weight: 600; background: rgba(0,0,0,0.4); padding: 8px 16px; border-radius: 20px; }
        .fr-error { margin-top: 12px; color: #fca5a5; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); padding: 10px 14px; border-radius: 10px; font-size: 0.85rem; }
        .fr-result { text-align: center; margin-top: 16px; }
        .fr-name { font-size: 1.5rem; font-weight: 800; color: #fff; }
        .fr-rel { color: #c4b5fd; margin-top: 2px; }
        .fr-notes { color: #cbd5e1; margin: 8px 0 0; line-height: 1.5; }
        .fr-conf { color: #64748b; font-size: 0.8rem; margin-top: 6px; }
        .fr-enroll { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
        .fr-enroll-q { color: #e2e8f0; margin: 0; }
        .fr-enroll input { background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 11px 13px; color: #fff; outline: none; }
        .fr-enroll input:focus { border-color: #a78bfa; }
        .fr-actions { display: flex; justify-content: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
        .fr-btn { display: flex; align-items: center; gap: 8px; padding: 11px 20px; border-radius: 10px; border: none; font-weight: 700; cursor: pointer; }
        .fr-btn.primary { background: linear-gradient(135deg,#7c3aed,#2563eb); color: #fff; }
        .fr-btn.primary:disabled { opacity: 0.5; cursor: default; }
        .fr-btn.ghost { background: rgba(255,255,255,0.08); color: #cbd5e1; }
      `}</style>
        </div>
    );
}
