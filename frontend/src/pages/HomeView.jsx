import React, { useState } from 'react';
import { MessageCircle, Images, ArrowRight, Heart, ScanFace } from 'lucide-react';
import { useAppState } from '../lib/store';
import WellbeingInsights from '../components/WellbeingInsights';
import Reminders from '../components/Reminders';
import FaceRecognition from '../components/FaceRecognition';

function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
}

export default function HomeView({ onNavigate }) {
    const { profile, persona, memories } = useAppState();
    const [scanning, setScanning] = useState(false);

    return (
        <div className="hv">
            {scanning && <FaceRecognition onClose={() => setScanning(false)} />}
            <div className="hv-blob b1" />
            <div className="hv-blob b2" />

            <div className="hv-inner">
                <p className="hv-greet">{greeting()},</p>
                <h1 className="hv-name">{profile?.name || 'friend'} 👋</h1>

                {/* Persona spotlight */}
                {persona && (
                    <div className="hv-persona" onClick={() => onNavigate('avatar')}>
                        <div className="hv-persona-glow" />
                        <div className="hv-persona-body">
                            <div className="hv-avatar">
                                {persona.faceImage
                                    ? <img src={persona.faceImage} alt={persona.name} />
                                    : <Heart size={26} color="#fff" />}
                            </div>
                            <div className="hv-persona-text">
                                <div className="hv-persona-name">{persona.name}</div>
                                <div className="hv-persona-rel">your {persona.relationship} · always here for you</div>
                            </div>
                            <button className="hv-talk">Talk to {persona.name} <ArrowRight size={18} /></button>
                        </div>
                    </div>
                )}

                {/* Quick tiles */}
                <div className="hv-tiles">
                    <button className="hv-tile" onClick={() => onNavigate('avatar')}>
                        <MessageCircle size={26} color="#a78bfa" />
                        <div className="hv-tile-t">Talk</div>
                        <div className="hv-tile-d">Have a warm conversation with {persona?.name || 'your companion'}.</div>
                    </button>
                    <button className="hv-tile" onClick={() => onNavigate('memories')}>
                        <Images size={26} color="#60a5fa" />
                        <div className="hv-tile-t">Memories</div>
                        <div className="hv-tile-d">{memories.length > 0 ? `${memories.length} saved` : 'Add photos, notes & voices'}</div>
                    </button>
                    <button className="hv-tile" onClick={() => setScanning(true)}>
                        <ScanFace size={26} color="#f472b6" />
                        <div className="hv-tile-t">Who is this?</div>
                        <div className="hv-tile-d">Point the camera at someone to recognise them.</div>
                    </button>
                </div>

                {/* Reminders & medication */}
                <Reminders />

                {/* Wellbeing insights from recent conversations */}
                <WellbeingInsights />

                {/* Recent memories preview */}
                {memories.length > 0 && (
                    <div className="hv-recent">
                        <div className="hv-recent-head">
                            <h3>Recent memories</h3>
                            <button onClick={() => onNavigate('memories')}>See all</button>
                        </div>
                        <div className="hv-recent-row">
                            {memories.slice(0, 4).map((m) => (
                                <div key={m.id} className="hv-recent-card" onClick={() => onNavigate('memories')}>
                                    {m.image
                                        ? <img src={m.image} alt={m.caption || 'memory'} />
                                        : <div className="hv-recent-noimg">{(m.caption || 'Memory').slice(0, 40)}</div>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <style>{`
        .hv { position: relative; height: 100%; overflow-y: auto; background: #0f172a; color: #fff; font-family: system-ui, sans-serif; }
        .hv-blob { position: absolute; width: 40vw; height: 40vw; border-radius: 50%; filter: blur(130px); opacity: 0.22; pointer-events: none; }
        .hv-blob.b1 { background: #7c3aed; top: -15%; left: -10%; }
        .hv-blob.b2 { background: #2563eb; bottom: -15%; right: -10%; }
        .hv-inner { position: relative; z-index: 1; max-width: 880px; margin: 0 auto; padding: 48px 28px; }
        .hv-greet { color: #94a3b8; font-size: 1.2rem; margin: 0; }
        .hv-name { font-size: 2.6rem; font-weight: 800; margin: 2px 0 28px; }

        .hv-persona { position: relative; border-radius: 22px; cursor: pointer; margin-bottom: 24px; overflow: hidden; }
        .hv-persona-glow { position: absolute; inset: 0; background: linear-gradient(120deg, rgba(124,58,237,0.35), rgba(37,99,235,0.35)); }
        .hv-persona-body { position: relative; display: flex; align-items: center; gap: 18px; padding: 22px; border: 1px solid rgba(255,255,255,0.12); border-radius: 22px; backdrop-filter: blur(6px); }
        .hv-avatar { width: 64px; height: 64px; border-radius: 50%; background: linear-gradient(135deg,#7c3aed,#2563eb); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 0 30px rgba(124,58,237,0.5); overflow: hidden; }
        .hv-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .hv-persona-text { flex: 1; min-width: 0; }
        .hv-persona-name { font-size: 1.4rem; font-weight: 800; }
        .hv-persona-rel { color: #cbd5e1; font-size: 0.9rem; }
        .hv-talk { display: flex; align-items: center; gap: 8px; background: #fff; color: #1e1b4b; border: none; padding: 12px 18px; border-radius: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }

        .hv-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px; margin-bottom: 28px; }
        @media (max-width: 560px) { .hv-tiles { grid-template-columns: 1fr; } }
        .hv-tile { text-align: left; background: rgba(30,41,59,0.55); border: 1px solid rgba(255,255,255,0.09); border-radius: 18px; padding: 22px; cursor: pointer; transition: transform .2s, border-color .2s; }
        .hv-tile:hover { transform: translateY(-3px); border-color: rgba(167,139,250,0.4); }
        .hv-tile-t { font-size: 1.15rem; font-weight: 700; margin-top: 12px; }
        .hv-tile-d { color: #94a3b8; font-size: 0.88rem; margin-top: 4px; }

        .hv-recent-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .hv-recent-head h3 { margin: 0; font-size: 1.15rem; }
        .hv-recent-head button { background: none; border: none; color: #a78bfa; cursor: pointer; font-size: 0.9rem; }
        .hv-recent-row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; }
        .hv-recent-card { width: 150px; height: 110px; border-radius: 14px; overflow: hidden; flex-shrink: 0; cursor: pointer; border: 1px solid rgba(255,255,255,0.08); background: rgba(30,41,59,0.6); }
        .hv-recent-card img { width: 100%; height: 100%; object-fit: cover; }
        .hv-recent-noimg { padding: 14px; font-size: 0.82rem; color: #cbd5e1; }
      `}</style>
        </div>
    );
}
