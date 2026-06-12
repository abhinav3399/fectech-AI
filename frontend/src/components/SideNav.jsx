import React from 'react';
import { Home, MessageCircle, Images, Brain } from 'lucide-react';

const TABS = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'avatar', label: 'Avatar', icon: MessageCircle },
    { id: 'memories', label: 'Memories', icon: Images },
];

const NavBar = ({ onViewChange, currentView }) => {
    return (
        <>
            <div className="topnav">
                <div className="nav-brand" onClick={() => onViewChange('home')}>
                    <Brain size={26} color="#a78bfa" />
                    <span className="brand-text">Factech AI</span>
                </div>

                <div className="nav-links">
                    {TABS.map(({ id, label, icon: Icon }) => (
                        <div
                            key={id}
                            className={`nav-item ${currentView === id ? 'active' : ''}`}
                            onClick={() => onViewChange(id)}
                        >
                            <Icon size={20} />
                            <span>{label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <style>{`
        .topnav {
            position: fixed; top: 0; left: 0; width: 100%; height: 70px;
            background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(255,255,255,0.1);
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 28px; z-index: 1000;
        }
        .nav-brand { display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .brand-text {
            font-size: 1.45rem; font-weight: 800;
            background: linear-gradient(90deg, #a78bfa, #60a5fa);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .nav-links { display: flex; gap: 8px; }
        .nav-item {
            display: flex; align-items: center; gap: 8px; padding: 8px 18px;
            border-radius: 20px; cursor: pointer; color: #94a3b8; font-weight: 600; transition: 0.2s;
        }
        .nav-item:hover { background: rgba(255,255,255,0.05); color: white; }
        .nav-item.active {
            background: linear-gradient(90deg, #7c3aed, #4f46e5); color: white;
            box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
        }
        @media (max-width: 520px) { .nav-item span { display: none; } .nav-item { padding: 10px; } }
      `}</style>
        </>
    );
};

export default NavBar;
