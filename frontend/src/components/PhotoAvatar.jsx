import React from 'react';

// The person's real face as the talking avatar. Static photo today; a tasteful
// speaking animation (glow ring + gentle breathing zoom) stands in for lip-sync.
export default function PhotoAvatar({ src, isSpeaking = false, name }) {
    return (
        <div className={`pa ${isSpeaking ? 'speaking' : ''}`}>
            <div className="pa-glow" />
            <div className="pa-frame">
                <img src={src} alt={name || 'companion'} className="pa-img" />
            </div>

            <style>{`
        .pa { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
        .pa-glow {
            position: absolute; width: 460px; height: 460px; max-width: 82%; max-height: 82%; border-radius: 50%;
            background: radial-gradient(closest-side, rgba(124,58,237,0.42), rgba(37,99,235,0.16), transparent 75%);
            filter: blur(10px); transition: opacity .3s; opacity: 0.65;
        }
        .pa.speaking .pa-glow { opacity: 1; animation: pa-pulse 1.2s ease-in-out infinite; }
        .pa-frame {
            position: relative; width: 380px; height: 380px; max-width: 72%; max-height: 72%;
            border-radius: 50%; overflow: hidden; border: 4px solid var(--border-strong);
            box-shadow: 0 30px 80px rgba(15,23,42,0.30); transition: transform .2s;
        }
        .pa.speaking .pa-frame { animation: pa-breathe 2.4s ease-in-out infinite; border-color: rgba(74,222,128,0.55); }
        .pa-img { width: 100%; height: 100%; object-fit: cover; display: block; }
        @keyframes pa-pulse { 0%,100% { transform: scale(1); opacity: .8; } 50% { transform: scale(1.06); opacity: 1; } }
        @keyframes pa-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.03); } }
      `}</style>
        </div>
    );
}
