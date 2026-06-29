import React from 'react';
import { ArrowRight, Brain, Shield, Heart } from 'lucide-react';
import HomeAssistant from '../components/HomeAssistant';

const LandingPage = ({ onGetStarted }) => {
    return (
        <div className="landing-container">

            {/* Background Gradients */}
            <div className="bg-blob blob-1"></div>
            <div className="bg-blob blob-2"></div>



            {/* Hero Section */}
            <main className="hero-section">
                <div className="hero-content">
                    <div className="badge">🚀 Revolutionizing Alzheimer's Care</div>
                    <h1 className="hero-title">
                        Your External <br />
                        <span className="gradient-text">Second Brain</span>
                    </h1>
                    <p className="hero-desc">
                        Factech AI empowers patients with AI-driven memory recall, object recognition, and a friendly companion that never forgets.
                    </p>

                    <div className="hero-buttons">
                        <button onClick={onGetStarted} className="btn-primary">
                            Get Started Now <ArrowRight size={20} />
                        </button>
                    </div>
                </div>

                {/* Live AI Assistant */}
                <div className="hero-visual">
                    <HomeAssistant onGetStarted={onGetStarted} />
                </div>
            </main>

            {/* Features Grid */}
            <section id="features" className="features-section">
                <h2 className="section-title">Why Factech AI?</h2>
                <div className="features-grid">
                    <FeatureCard
                        icon={<Brain color="#a78bfa" size={40} />}
                        title="Memory Recall"
                        desc="Instantly identify faces and objects using advanced AI vision."
                    />
                    <FeatureCard
                        icon={<Shield color="#60a5fa" size={40} />}
                        title="Safe & Secure"
                        desc="All memories are stored locally on your device for maximum privacy."
                    />
                    <FeatureCard
                        icon={<Heart color="#f472b6" size={40} />}
                        title="Family Connected"
                        desc="Caregivers can update memories remotely to keep you supported."
                    />
                </div>
            </section>

            <footer className="footer">
                © 2026 Factech AI Project. All rights reserved.
            </footer>

            <style>{`
        .landing-container {
            min-height: 100vh;
            background:
                radial-gradient(1200px 620px at 8% -12%, rgba(139, 92, 246, 0.20), transparent 60%),
                radial-gradient(1000px 600px at 112% 8%, rgba(59, 130, 246, 0.16), transparent 55%),
                var(--bg);
            color: var(--text);
            font-family: inherit;
            position: relative;
            overflow-x: hidden;
        }
        .bg-blob {
            position: absolute;
            width: 50vw;
            height: 50vw;
            border-radius: 50%;
            filter: blur(130px);
            opacity: 0.32;
            z-index: 0;
            pointer-events: none;
        }
        .blob-1 { background: var(--brand-1); top: -10%; left: -10%; }
        .blob-2 { background: var(--brand-3); bottom: -10%; right: -10%; }

        .navbar {
            position: relative;
            z-index: 10;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: var(--s-5) var(--s-10);
            background: var(--glass-strong);
            backdrop-filter: blur(16px);
            border-bottom: 1px solid var(--border);
        }
        .logo { display: flex; align-items: center; gap: 10px; }
        .brand-name {
            font-size: 1.5rem;
            font-weight: 800;
            letter-spacing: -0.01em;
            background: var(--grad-text);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            color: transparent;
        }
        .nav-links { display: flex; gap: 30px; }
        .nav-links a { color: var(--text-muted); text-decoration: none; transition: color var(--dur) var(--ease); }
        .nav-links a:hover { color: var(--text); }
        .btn-login {
            background: var(--surface-2);
            border: 1px solid var(--border);
            padding: 8px 20px;
            border-radius: var(--r-pill);
            color: var(--text);
            cursor: pointer;
            transition: background var(--dur) var(--ease);
        }
        .btn-login:hover { background: var(--surface-3); }

        .hero-section {
            position: relative;
            z-index: 10;
            display: flex;
            align-items: center;
            justify-content: space-between;
            max-width: 1200px;
            margin: 0 auto;
            padding: var(--s-12) var(--s-5);
            gap: var(--s-12);
        }
        .hero-content { flex: 1; animation: ui-fade-up 0.6s var(--ease) both; }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            background: rgba(139, 92, 246, 0.14);
            border: 1px solid rgba(139, 92, 246, 0.32);
            color: #ddd6fe;
            border-radius: var(--r-pill);
            font-size: var(--fs-sm);
            font-weight: 600;
            margin-bottom: var(--s-5);
            box-shadow: var(--shadow-sm);
        }
        .hero-title {
            font-size: clamp(2.8rem, 6vw, 4.4rem);
            font-weight: 800;
            line-height: 1.08;
            letter-spacing: -0.02em;
            margin-bottom: var(--s-5);
        }
        .gradient-text {
            background: var(--grad-text);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
            color: transparent;
        }
        .hero-desc {
            font-size: var(--fs-lg);
            color: var(--text-muted);
            margin-bottom: var(--s-10);
            max-width: 500px;
            line-height: 1.65;
        }
        .hero-buttons { display: flex; gap: var(--s-4); flex-wrap: wrap; }
        .btn-primary {
            background: var(--grad-brand);
            color: var(--text-on-brand);
            padding: 15px 30px;
            border: none;
            border-radius: var(--r-md);
            font-size: var(--fs-lg);
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: var(--glow-brand);
            transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124, 58, 237, 0.5); }
        .btn-primary:active { transform: translateY(1px); }

        .hero-visual { flex: 1; display: flex; justify-content: center; animation: ui-fade-up 0.6s var(--ease) 0.1s both; }
        .chat-card {
            background: var(--glass-strong);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border);
            padding: var(--s-5);
            border-radius: var(--r-xl);
            width: 100%;
            max-width: 400px;
            box-shadow: var(--shadow-lg);
        }
        .chat-header { display: flex; align-items: center; gap: var(--s-4); margin-bottom: var(--s-5); border-bottom: 1px solid var(--border); padding-bottom: var(--s-4); }
        .avatar-img { width: 50px; height: 50px; border-radius: 50%; object-fit: cover; background: var(--surface-3); }
        .chat-bubble {
            padding: 10px 15px;
            border-radius: var(--r-md);
            margin-bottom: var(--s-3);
            font-size: var(--fs-sm);
            max-width: 80%;
        }
        .bot { background: var(--surface-2); color: var(--text-muted); border-top-left-radius: var(--r-sm); }
        .user { background: var(--grad-brand-soft); color: var(--text); margin-left: auto; border-top-right-radius: var(--r-sm); border: 1px solid rgba(139, 92, 246, 0.32); }

        .features-section {
            position: relative;
            z-index: 10;
            background: var(--surface-1);
            padding: var(--s-12) var(--s-5);
            border-top: 1px solid var(--border);
        }
        .section-title { text-align: center; font-size: var(--fs-3xl); font-weight: 800; letter-spacing: -0.02em; margin-bottom: var(--s-12); }
        .features-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: var(--s-6);
            max-width: 1200px;
            margin: 0 auto;
        }
        .feature-card {
            background: var(--glass);
            border: 1px solid var(--border);
            padding: var(--s-8);
            border-radius: var(--r-lg);
            box-shadow: var(--shadow-sm);
            backdrop-filter: blur(12px);
            transition: transform var(--dur) var(--ease), border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .feature-card:hover { transform: translateY(-5px); border-color: rgba(139, 92, 246, 0.5); box-shadow: var(--shadow-lg); }
        .feature-icon {
            background: var(--surface-2);
            border: 1px solid var(--border);
            padding: 15px;
            border-radius: var(--r-md);
            display: inline-flex;
            margin-bottom: var(--s-5);
        }
        .feature-title { font-size: var(--fs-lg); font-weight: 700; margin-bottom: var(--s-3); }
        .feature-desc { color: var(--text-muted); line-height: 1.65; }

        .footer { position: relative; z-index: 10; background: var(--bg-2); padding: var(--s-10); text-align: center; color: var(--text-dim); font-size: var(--fs-sm); border-top: 1px solid var(--border); }

        @media (max-width: 768px) {
            .hero-section { flex-direction: column; text-align: center; }
            .hero-buttons { justify-content: center; }
            .nav-links { display: none; }
        }
      `}</style>
        </div>
    );
};

const FeatureCard = ({ icon, title, desc }) => (
    <div className="feature-card">
        <div className="feature-icon">{icon}</div>
        <h3 className="feature-title">{title}</h3>
        <p className="feature-desc">{desc}</p>
    </div>
);

export default LandingPage;
