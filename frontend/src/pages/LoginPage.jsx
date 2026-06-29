import React from 'react';
import { User, HeartHandshake } from 'lucide-react';

const LoginPage = ({ onSelectRole }) => {
    return (
        <div className="login-container">

            <div className="bg-glow"></div>

            <div className="cards-wrapper">

                {/* Patient Card */}
                <div className="role-card patient-card" onClick={() => onSelectRole('patient')}>
                    <div className="icon-wrapper patient-icon">
                        <User size={48} color="white" />
                    </div>
                    <h2 className="role-title">I am a User</h2>
                    <p className="role-desc">Access your assistant, memory aid, and companion.</p>
                    <div className="role-btn-wrapper">
                        <span className="role-btn patient-btn">Enter Factech AI &rarr;</span>
                    </div>
                </div>

                {/* Caregiver Card */}
                <div className="role-card caregiver-card" onClick={() => onSelectRole('caregiver')}>
                    <div className="icon-wrapper caregiver-icon">
                        <HeartHandshake size={48} color="white" />
                    </div>
                    <h2 className="role-title">I am a Caregiver</h2>
                    <p className="role-desc">Enroll memories, manage settings, and helping loved ones.</p>
                    <div className="role-btn-wrapper">
                        <span className="role-btn caregiver-btn">Manage Care &rarr;</span>
                    </div>
                </div>

            </div>

            <style>{`
        .login-container {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            overflow: hidden;
            font-family: inherit;
            color: var(--text);
            padding: var(--s-6);
        }
        .bg-glow {
            position: absolute;
            width: 900px;
            height: 900px;
            background:
                radial-gradient(circle at 35% 35%, rgba(139, 92, 246, 0.22), transparent 60%),
                radial-gradient(circle at 70% 65%, rgba(59, 130, 246, 0.18), transparent 60%);
            border-radius: 50%;
            filter: blur(110px);
            z-index: 0;
            pointer-events: none;
        }
        .cards-wrapper {
            position: relative;
            z-index: 10;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--s-8);
            width: 100%;
            max-width: 900px;
            padding: var(--s-5);
            animation: ui-fade-up 0.6s var(--ease) both;
        }
        .role-card {
            background: var(--glass);
            border: 1px solid var(--border);
            padding: var(--s-10);
            border-radius: var(--r-xl);
            cursor: pointer;
            text-align: center;
            backdrop-filter: blur(14px);
            box-shadow: var(--shadow-md);
            position: relative;
            overflow: hidden;
            transition: transform var(--dur) var(--ease), border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), background var(--dur) var(--ease);
        }
        .role-card::before {
            content: '';
            position: absolute;
            inset: 0;
            background: var(--grad-brand-soft);
            opacity: 0;
            transition: opacity var(--dur) var(--ease);
            pointer-events: none;
        }
        .role-card:hover { transform: translateY(-8px); box-shadow: var(--shadow-lg); }
        .patient-card:hover { border-color: rgba(139, 92, 246, 0.55); }
        .caregiver-card:hover { border-color: rgba(52, 211, 153, 0.55); }
        .role-card:hover::before { opacity: 1; }

        .icon-wrapper {
            width: 100px;
            height: 100px;
            border-radius: var(--r-pill);
            margin: 0 auto var(--s-6);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: var(--shadow-md);
            position: relative;
            z-index: 1;
            transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .patient-icon { background: var(--grad-brand); }
        .caregiver-icon { background: linear-gradient(135deg, var(--success), #059669); }
        .patient-card:hover .patient-icon { transform: scale(1.06); box-shadow: var(--glow-brand); }
        .caregiver-card:hover .caregiver-icon { transform: scale(1.06); box-shadow: 0 10px 36px rgba(16, 185, 129, 0.38); }

        .role-title { position: relative; z-index: 1; color: var(--text); margin: 0 0 var(--s-3); font-size: var(--fs-xl); font-weight: 800; letter-spacing: -0.01em; }
        .role-desc { position: relative; z-index: 1; color: var(--text-muted); font-size: var(--fs-md); line-height: 1.6; }

        .role-btn-wrapper { position: relative; z-index: 1; margin-top: var(--s-8); }
        .role-btn {
            padding: 12px 26px;
            border-radius: var(--r-pill);
            border: 1px solid var(--border-strong);
            background: var(--surface-2);
            color: var(--text);
            font-weight: 700;
            font-size: var(--fs-sm);
            transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), color var(--dur) var(--ease);
            display: inline-block;
        }
        .patient-card:hover .patient-btn { background: var(--grad-brand); border-color: transparent; box-shadow: var(--glow-brand); color: var(--text-on-brand); }
        .caregiver-card:hover .caregiver-btn { background: linear-gradient(135deg, var(--success), #059669); border-color: transparent; box-shadow: 0 10px 36px rgba(16, 185, 129, 0.38); color: #04211a; }

        @media (max-width: 768px) {
            .cards-wrapper { grid-template-columns: 1fr; gap: var(--s-5); }
        }
      `}</style>
        </div>
    );
};

export default LoginPage;
