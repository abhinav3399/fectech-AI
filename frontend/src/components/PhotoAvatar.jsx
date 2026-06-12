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
            position: absolute; width: 340px; height: 340px; max-width: 70%; max-height: 70%; border-radius: 50%;
            background: radial-gradient(closest-side, rgba(124,58,237,0.45), rgba(37,99,235,0.15), transparent 75%);
            filter: blur(8px); transition: opacity .3s; opacity: 0.6;
        }
        .pa.speaking .pa-glow { opacity: 1; animation: pa-pulse 1.2s ease-in-out infinite; }
        .pa-frame {
            position: relative; width: 300px; height: 300px; max-width: 62%; max-height: 62%;
            border-radius: 50%; overflow: hidden; border: 3px solid rgba(255,255,255,0.18);
            box-shadow: 0 20px 60px rgba(0,0,0,0.45); transition: transform .2s;
        }
        .pa.speaking .pa-frame { animation: pa-breathe 2.4s ease-in-out infinite; border-color: rgba(74,222,128,0.55); }
        .pa-img { width: 100%; height: 100%; object-fit: cover; display: block; }
        @keyframes pa-pulse { 0%,100% { transform: scale(1); opacity: .8; } 50% { transform: scale(1.06); opacity: 1; } }
        @keyframes pa-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.03); } }
      `}</style>
        </div>
    );
}
