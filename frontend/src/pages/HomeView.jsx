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
                                <span className="hv-online" aria-label="Always here for you" title="Always here for you" />
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
        .hv { position: relative; height: 100%; overflow-y: auto; color: var(--text); font-family: inherit; }
        .hv-blob { position: absolute; width: 42vw; height: 42vw; border-radius: 50%; filter: blur(140px); opacity: 0.28; pointer-events: none; }
        .hv-blob.b1 { background: var(--brand-1); top: -18%; left: -12%; }
        .hv-blob.b2 { background: var(--brand-3); bottom: -18%; right: -12%; }
        .hv-inner { position: relative; z-index: 1; max-width: 920px; margin: 0 auto; padding: var(--s-12) var(--s-6); }
        .hv-greet { color: var(--text-muted); font-size: var(--fs-lg); margin: 0; font-weight: 500; }
        .hv-name { font-size: var(--fs-3xl); font-weight: 800; letter-spacing: -0.02em; margin: 2px 0 var(--s-8); }

        .hv-persona { position: relative; border-radius: var(--r-xl); cursor: pointer; margin-bottom: var(--s-6); overflow: hidden; transition: transform var(--dur) var(--ease); }
        .hv-persona:hover { transform: translateY(-3px); }
        .hv-persona-glow { position: absolute; inset: 0; background: var(--grad-brand); opacity: 0.85; }
        .hv-persona-body { position: relative; display: flex; align-items: center; gap: var(--s-5); padding: var(--s-6); border: 1px solid var(--border-strong); border-radius: var(--r-xl); background: rgba(10, 14, 26, 0.32); backdrop-filter: blur(10px); }
        .hv-avatar { position: relative; width: 72px; height: 72px; border-radius: 50%; background: rgba(255,255,255,0.14); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 0 0 3px rgba(255,255,255,0.2), var(--shadow-md); overflow: hidden; }
        .hv-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .hv-online { position: absolute; bottom: 3px; right: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--success); border: 3px solid #0b1020; box-shadow: 0 0 0 2px rgba(52,211,153,0.45); }
        .hv-persona-text { flex: 1; min-width: 0; }
        .hv-persona-name { font-size: var(--fs-xl); font-weight: 800; color: #fff; }
        .hv-persona-rel { color: rgba(255,255,255,0.88); font-size: var(--fs-md); }
        .hv-talk { display: flex; align-items: center; gap: 8px; min-height: 60px; background: #fff; color: #1e1b4b; border: none; padding: 0 22px; border-radius: var(--r-lg); font-weight: 800; font-size: var(--fs-lg); font-family: inherit; cursor: pointer; white-space: nowrap; box-shadow: var(--shadow-md); transition: transform var(--dur) var(--ease); }
        .hv-talk:hover { transform: scale(1.04); }

        .hv-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--s-4); margin-bottom: var(--s-8); }
        @media (max-width: 560px) { .hv-tiles { grid-template-columns: 1fr; } }
        .hv-tile { text-align: left; background: var(--glass); border: 1px solid var(--border); border-radius: var(--r-lg); padding: var(--s-6); cursor: pointer; backdrop-filter: blur(12px); box-shadow: var(--shadow-sm); transition: transform var(--dur) var(--ease), border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
        .hv-tile:hover { transform: translateY(-4px); border-color: rgba(139,92,246,0.5); box-shadow: var(--shadow-lg); }
        .hv-tile-t { font-size: var(--fs-lg); font-weight: 700; margin-top: var(--s-3); }
        .hv-tile-d { color: var(--text-muted); font-size: var(--fs-sm); margin-top: 4px; line-height: 1.5; }

        .hv-recent-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--s-3); }
        .hv-recent-head h3 { margin: 0; font-size: var(--fs-lg); }
        .hv-recent-head button { background: none; border: none; color: var(--brand-1); cursor: pointer; font-size: var(--fs-sm); font-weight: 600; }
        .hv-recent-row { display: flex; gap: var(--s-3); overflow-x: auto; padding-bottom: 6px; }
        .hv-recent-card { width: 156px; height: 112px; border-radius: var(--r-md); overflow: hidden; flex-shrink: 0; cursor: pointer; border: 1px solid var(--border); background: var(--glass); transition: transform var(--dur) var(--ease); }
        .hv-recent-card:hover { transform: translateY(-3px); }
        .hv-recent-card img { width: 100%; height: 100%; object-fit: cover; }
        .hv-recent-noimg { padding: var(--s-4); font-size: var(--fs-sm); color: #cbd5e1; }
      `}</style>
        </div>
    );
}
