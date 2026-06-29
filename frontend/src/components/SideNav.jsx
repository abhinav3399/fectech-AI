import React from 'react';
import { Home, MessageCircle, Images, Brain, Sun, Moon, Accessibility, Check, Settings, Bell, Users } from 'lucide-react';
import { getTheme, toggleTheme } from '../lib/theme';
import { getA11y, setA11y } from '../lib/a11y';

const TABS = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'avatar', label: 'Avatar', icon: MessageCircle },
    { id: 'memories', label: 'Memories', icon: Images },
    { id: 'reminders', label: 'Reminders', icon: Bell },
    { id: 'contacts', label: 'Family', icon: Users },
];

const SIZES = [{ k: 'normal', label: 'Normal' }, { k: 'large', label: 'Large' }, { k: 'largest', label: 'Largest' }];

const NavBar = ({ onViewChange, currentView }) => {
    const [theme, setTheme] = React.useState(getTheme());
    const [a11y, setA11yState] = React.useState(getA11y());
    const [a11yOpen, setA11yOpen] = React.useState(false);
    const onToggleTheme = () => setTheme(toggleTheme());
    const update = (patch) => setA11yState(setA11y(patch));

    return (
        <>
            <div className="topnav">
                <div className="nav-brand" onClick={() => onViewChange('home')}>
                    <span className="nav-brand-mark"><Brain size={22} color="#fff" /></span>
                    <span className="brand-text">Factech AI</span>
                </div>

                <div className="nav-right">
                    <div className="nav-links">
                        {TABS.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                type="button"
                                className={`nav-item ${currentView === id ? 'active' : ''}`}
                                onClick={() => onViewChange(id)}
                                aria-current={currentView === id ? 'page' : undefined}
                            >
                                <Icon size={20} />
                                <span>{label}</span>
                            </button>
                        ))}
                    </div>

                    <div className="nav-a11y-wrap">
                        <button
                            className="nav-theme"
                            onClick={() => setA11yOpen((o) => !o)}
                            aria-label="Accessibility settings"
                            aria-expanded={a11yOpen}
                            title="Text size, contrast & motion"
                        >
                            <Accessibility size={18} />
                        </button>
                        {a11yOpen && (
                            <>
                                <div className="nav-a11y-scrim" onClick={() => setA11yOpen(false)} />
                                <div className="nav-a11y-pop" role="menu">
                                    <div className="a11y-label">Text size</div>
                                    <div className="a11y-sizes">
                                        {SIZES.map((s) => (
                                            <button key={s.k} className={`a11y-size ${a11y.fontScale === s.k ? 'on' : ''}`}
                                                onClick={() => update({ fontScale: s.k })}>{s.label}</button>
                                        ))}
                                    </div>
                                    <button className="a11y-toggle" onClick={() => update({ highContrast: !a11y.highContrast })}>
                                        <span>High contrast</span>
                                        <span className={`a11y-sw ${a11y.highContrast ? 'on' : ''}`}>{a11y.highContrast && <Check size={14} />}</span>
                                    </button>
                                    <button className="a11y-toggle" onClick={() => update({ reduceMotion: !a11y.reduceMotion })}>
                                        <span>Reduce motion</span>
                                        <span className={`a11y-sw ${a11y.reduceMotion ? 'on' : ''}`}>{a11y.reduceMotion && <Check size={14} />}</span>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    <button
                        className="nav-theme"
                        onClick={onToggleTheme}
                        title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                        aria-label="Toggle light or dark mode"
                    >
                        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
                    </button>

                    <button
                        className={`nav-theme ${currentView === 'settings' ? 'active' : ''}`}
                        onClick={() => onViewChange('settings')}
                        title="Settings"
                        aria-label="Settings"
                        aria-current={currentView === 'settings' ? 'page' : undefined}
                    >
                        <Settings size={18} />
                    </button>
                </div>
            </div>

            <style>{`
        .topnav {
            position: fixed; top: 0; left: 0; width: 100%; height: 68px;
            background: var(--glass-strong); backdrop-filter: blur(16px);
            border-bottom: 1px solid var(--border);
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 var(--s-6); z-index: 1000;
        }
        .nav-brand { display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .nav-brand-mark {
            width: 38px; height: 38px; border-radius: 11px; display: flex; align-items: center; justify-content: center;
            background: var(--grad-brand); box-shadow: var(--glow-brand);
        }
        .brand-text {
            font-size: 1.35rem; font-weight: 800; letter-spacing: -0.01em;
            background: var(--grad-text);
            -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
        }
        .nav-right { display: flex; align-items: center; gap: var(--s-3); }
        .nav-links { display: flex; gap: 6px; background: var(--surface-1); padding: 5px; border-radius: var(--r-pill); border: 1px solid var(--border); }
        .nav-theme {
            display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex-shrink: 0;
            border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-1); color: var(--text-muted);
            cursor: pointer; transition: background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease);
        }
        .nav-theme:hover { background: var(--surface-2); color: var(--text); border-color: var(--border-strong); }
        .nav-theme.active { background: var(--grad-brand); color: var(--text-on-brand); border-color: transparent; box-shadow: var(--glow-brand); }
        .nav-item {
            display: flex; align-items: center; gap: 8px; padding: 9px 18px; min-height: 44px;
            border: none; background: transparent; font-family: inherit; font-size: var(--fs-sm);
            border-radius: var(--r-pill); cursor: pointer; color: var(--text-muted); font-weight: 600;
            transition: color var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }

        /* Accessibility popover */
        .nav-a11y-wrap { position: relative; display: flex; }
        .nav-a11y-scrim { position: fixed; inset: 0; z-index: 1100; }
        .nav-a11y-pop {
            position: absolute; top: 52px; right: 0; z-index: 1200; width: 230px;
            background: var(--glass-strong); border: 1px solid var(--border-strong); border-radius: var(--r-lg);
            box-shadow: var(--shadow-lg); backdrop-filter: blur(18px); padding: var(--s-4);
            display: flex; flex-direction: column; gap: var(--s-3); animation: ui-fade-up 0.25s var(--ease) both;
        }
        .a11y-label { font-size: var(--fs-xs); font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-dim); }
        .a11y-sizes { display: flex; gap: 6px; }
        .a11y-size { flex: 1; min-height: 44px; border-radius: var(--r-sm); border: 1px solid var(--border);
            background: var(--surface-1); color: var(--text-muted); font-family: inherit; font-weight: 700; font-size: var(--fs-xs); cursor: pointer; }
        .a11y-size.on { background: var(--grad-brand); color: var(--text-on-brand); border-color: transparent; }
        .a11y-toggle { display: flex; align-items: center; justify-content: space-between; min-height: 48px; padding: 0 var(--s-3);
            border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-1); color: var(--text);
            font-family: inherit; font-weight: 700; font-size: var(--fs-sm); cursor: pointer; }
        .a11y-toggle:hover { background: var(--surface-2); }
        .a11y-sw { width: 34px; height: 22px; border-radius: 999px; background: var(--surface-3); border: 1px solid var(--border-strong);
            display: flex; align-items: center; justify-content: center; color: #fff; }
        .a11y-sw.on { background: var(--success); border-color: transparent; }
        .nav-item:hover { background: var(--surface-2); color: var(--text); }
        .nav-item.active {
            background: var(--grad-brand); color: var(--text-on-brand);
            box-shadow: var(--glow-brand);
        }
        @media (max-width: 520px) { .nav-item span { display: none; } .nav-item { padding: 10px; } .topnav { padding: 0 var(--s-4); } }
      `}</style>
        </>
    );
};

export default NavBar;
