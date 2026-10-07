import React from 'react';
import {
    Accessibility, Bell, Brain, Check, ChevronRight, Home, Images, MoreHorizontal,
    Moon, Settings, Shield, Sun, Users, MessageCircle,
} from 'lucide-react';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { Capacitor } from '@capacitor/core';
import { getTheme, toggleTheme } from '../lib/theme';
import { getA11y, setA11y } from '../lib/a11y';
import { BottomSheet } from './MotionPrimitives';

const TABS = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'avatar', label: 'Talk', icon: MessageCircle },
    { id: 'memories', label: 'Memories', icon: Images },
    { id: 'reminders', label: 'Reminders', icon: Bell },
    { id: 'contacts', label: 'Family', icon: Users },
    { id: 'updates', label: 'Updates', icon: Shield },
    { id: 'settings', label: 'Settings', icon: Settings },
];

const MOBILE_TABS = TABS.filter(({ id }) => ['home', 'avatar', 'memories', 'contacts'].includes(id));
const MORE_TABS = TABS.filter(({ id }) => ['reminders', 'updates', 'settings'].includes(id));
const SIZES = [{ k: 'normal', label: 'Normal' }, { k: 'large', label: 'Large' }, { k: 'largest', label: 'Largest' }];

function MoreItem({ item, onViewChange, currentView, onSelect }) {
    const Icon = item.icon;
    return (
        <button
            type="button"
            className="nav-more-item"
            onClick={() => { onViewChange(item.id); onSelect(); }}
            aria-current={currentView === item.id ? 'page' : undefined}
        >
            <Icon size={19} />
            <span>{item.label}</span>
            <ChevronRight size={17} />
        </button>
    );
}

const NavBar = ({ onViewChange, currentView }) => {
    const isNativeApp = Capacitor.isNativePlatform();
    const [theme, setTheme] = React.useState(getTheme());
    const [a11y, setA11yState] = React.useState(getA11y());
    const [a11yOpen, setA11yOpen] = React.useState(false);
    const [moreOpen, setMoreOpen] = React.useState(false);
    const moreActive = MORE_TABS.some(({ id }) => id === currentView);
    const { scrollY } = useScroll();
    const navBg = useTransform(scrollY, [0, 50], ['rgba(10, 14, 26, 0.68)', 'rgba(10, 14, 26, 0.92)']);
    const navHeight = useTransform(scrollY, [0, 50], ['68px', '60px']);
    const navPadding = useTransform(scrollY, [0, 50], ['0px 28px', '0px 20px']);

    const onToggleTheme = () => setTheme(toggleTheme());
    const update = (patch) => setA11yState(setA11y(patch));

    return (
        <>
            <motion.div className={`topnav premium-nav ${isNativeApp ? 'native-nav-header' : ''}`} style={{ backgroundColor: navBg, height: navHeight, padding: navPadding }}>
                <button type="button" className="nav-brand" onClick={() => onViewChange('home')} aria-label="Go to Home">
                    <motion.span className="nav-brand-mark" whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                        <Brain size={21} color="#fff" />
                    </motion.span>
                    <span className="brand-text">Factech AI</span>
                </button>

                <div className="nav-right">
                    <div className="nav-links" aria-label="Main navigation">
                        {TABS.filter(({ id }) => id !== 'settings').map(({ id, label, icon: Icon }) => (
                            <motion.button
                                key={id}
                                type="button"
                                className={`nav-item ${currentView === id ? 'active' : ''}`}
                                onClick={() => onViewChange(id)}
                                whileHover={{ y: -1 }}
                                whileTap={{ scale: 0.98 }}
                                aria-current={currentView === id ? 'page' : undefined}
                            >
                                <Icon size={18} />
                                <span>{label}</span>
                            </motion.button>
                        ))}
                    </div>

                    <div className="nav-a11y-wrap">
                        <motion.button className="nav-icon-btn" onClick={() => setA11yOpen((open) => !open)} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} aria-label="Accessibility settings" aria-expanded={a11yOpen}>
                            <Accessibility size={18} />
                        </motion.button>
                        <AnimatePresence>
                            {a11yOpen && (
                                <>
                                    <motion.div className="nav-a11y-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setA11yOpen(false)} />
                                    <motion.div className="nav-a11y-pop" initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}>
                                        <div className="a11y-label">Accessibility</div>
                                        <div className="a11y-sizes">{SIZES.map((size) => <button key={size.k} className={`a11y-size ${a11y.fontScale === size.k ? 'on' : ''}`} onClick={() => update({ fontScale: size.k })}>{size.label}</button>)}</div>
                                        <button className="a11y-toggle" onClick={() => update({ highContrast: !a11y.highContrast })}><span>High contrast</span><span className={`a11y-sw ${a11y.highContrast ? 'on' : ''}`}>{a11y.highContrast && <Check size={14} />}</span></button>
                                        <button className="a11y-toggle" onClick={() => update({ reduceMotion: !a11y.reduceMotion })}><span>Reduce motion</span><span className={`a11y-sw ${a11y.reduceMotion ? 'on' : ''}`}>{a11y.reduceMotion && <Check size={14} />}</span></button>
                                    </motion.div>
                                </>
                            )}
                        </AnimatePresence>
                    </div>

                    <motion.button className="nav-icon-btn theme-toggle" onClick={onToggleTheme} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>
                        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
                    </motion.button>
                    <motion.button className={`nav-icon-btn ${currentView === 'settings' ? 'active' : ''}`} onClick={() => onViewChange('settings')} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} aria-label="Settings">
                        <Settings size={18} />
                    </motion.button>
                </div>
            </motion.div>

            <nav className={`mob-bottom-nav premium-mobile-nav ${isNativeApp ? 'native-mobile-nav' : ''}`} aria-label="Main navigation">
                {MOBILE_TABS.map(({ id, label, icon: Icon }) => (
                    <motion.button key={id} type="button" className={`mob-nav-btn ${currentView === id ? 'mob-nav-active' : ''}`} onClick={() => onViewChange(id)} whileTap={{ scale: 0.94 }} aria-current={currentView === id ? 'page' : undefined}>
                        <Icon size={21} strokeWidth={currentView === id ? 2.2 : 1.8} />
                        <span>{label}</span>
                        {currentView === id && <motion.span className="mob-nav-dot" initial={{ scale: 0 }} animate={{ scale: 1 }} />}
                    </motion.button>
                ))}
                <motion.button type="button" className={`mob-nav-btn ${moreOpen || moreActive ? 'mob-nav-active' : ''}`} onClick={() => setMoreOpen(true)} whileTap={{ scale: 0.94 }} aria-expanded={moreOpen}>
                    <MoreHorizontal size={21} />
                    <span>More</span>
                    {(moreOpen || moreActive) && <motion.span className="mob-nav-dot" initial={{ scale: 0 }} animate={{ scale: 1 }} />}
                </motion.button>
            </nav>

            <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
                <div className="nav-more-list">
                    {MORE_TABS.map((item) => <MoreItem key={item.id} item={item} onViewChange={onViewChange} currentView={currentView} onSelect={() => setMoreOpen(false)} />)}
                    <button type="button" className="nav-more-item" onClick={onToggleTheme}><span>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</span><span>Theme</span><small>{theme === 'light' ? 'Light' : 'Dark'}</small></button>
                    <div className="nav-more-a11y">
                        <div className="a11y-label">Accessibility</div>
                        <div className="a11y-sizes">{SIZES.map((size) => <button key={size.k} className={`a11y-size ${a11y.fontScale === size.k ? 'on' : ''}`} onClick={() => update({ fontScale: size.k })}>{size.label}</button>)}</div>
                        <button className="a11y-toggle" onClick={() => update({ highContrast: !a11y.highContrast })}><span>High contrast</span><span className={`a11y-sw ${a11y.highContrast ? 'on' : ''}`}>{a11y.highContrast && <Check size={14} />}</span></button>
                        <button className="a11y-toggle" onClick={() => update({ reduceMotion: !a11y.reduceMotion })}><span>Reduce motion</span><span className={`a11y-sw ${a11y.reduceMotion ? 'on' : ''}`}>{a11y.reduceMotion && <Check size={14} />}</span></button>
                    </div>
                </div>
            </BottomSheet>

            <style>{`
                .topnav { position: fixed; top: 0; left: 0; width: 100%; z-index: 1000; display: flex; align-items: center; justify-content: space-between; backdrop-filter: blur(20px); border-bottom: 1px solid var(--border); }
                .nav-brand { display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; border: 0; background: transparent; color: inherit; padding: 0; }
                .nav-brand-mark { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: var(--grad-brand); flex-shrink: 0; }
                .brand-text { font-weight: 800; letter-spacing: -0.025em; background: var(--grad-text); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
                .nav-right { display: flex; align-items: center; gap: 8px; }
                .nav-links { display: flex; gap: 3px; padding: 4px; border-radius: var(--r-pill); border: 1px solid var(--border); }
                .nav-item { display: flex; align-items: center; gap: 7px; min-height: 40px; padding: 0 14px; border: 0; border-radius: var(--r-md); background: transparent; color: var(--text-muted); font-family: inherit; font-size: 0.8rem; font-weight: 700; cursor: pointer; transition: color var(--dur) var(--ease), background var(--dur) var(--ease); }
                .nav-item:hover { color: var(--text); background: var(--surface-2); }
                .nav-item.active { color: #fff; background: var(--grad-brand); box-shadow: var(--glow-brand); }
                .nav-icon-btn { display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; flex-shrink: 0; border-radius: 50%; border: 1px solid var(--border); background: var(--surface-1); color: var(--text-muted); cursor: pointer; }
                .nav-icon-btn:hover { background: var(--surface-2); color: var(--text); }
                .nav-icon-btn.active { background: var(--grad-brand); color: #fff; border-color: transparent; }
                .nav-a11y-wrap { position: relative; display: flex; }
                .nav-a11y-scrim { position: fixed; inset: 0; z-index: 1100; }
                .nav-a11y-pop { position: absolute; top: 50px; right: 0; z-index: 1200; width: 238px; background: var(--glass-strong); border: 1px solid var(--border-strong); border-radius: var(--r-lg); box-shadow: var(--shadow-lg); backdrop-filter: blur(18px); padding: 14px; display: flex; flex-direction: column; gap: 10px; }
                .a11y-label { font-size: 0.7rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); }
                .a11y-sizes { display: flex; gap: 6px; }
                .a11y-size { flex: 1; min-height: 40px; border-radius: var(--r-sm); border: 1px solid var(--border); background: var(--surface-1); color: var(--text-muted); font-family: inherit; font-weight: 700; font-size: 0.72rem; cursor: pointer; }
                .a11y-size.on { background: var(--grad-brand); color: #fff; border-color: transparent; }
                .a11y-toggle { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 0 12px; border-radius: var(--r-sm); border: 1px solid var(--border); background: var(--surface-1); color: var(--text); font-family: inherit; font-weight: 700; font-size: 0.82rem; cursor: pointer; }
                .a11y-toggle:hover { background: var(--surface-2); }
                .a11y-sw { width: 34px; height: 22px; border-radius: var(--r-pill); background: var(--surface-3); border: 1px solid var(--border-strong); display: flex; align-items: center; justify-content: center; color: #fff; }
                .a11y-sw.on { background: var(--success); border-color: transparent; }
                .nav-more-a11y { display: grid; gap: 10px; padding: 12px 0 0; border-top: 1px solid var(--border); }
                .mob-bottom-nav { display: none; }
                @media (max-width: 1180px) and (min-width: 641px) { .nav-item { padding-inline: 10px; } .nav-item span { display: none; } .nav-links { border-radius: var(--r-lg); } }
                @media (max-width: 640px) { .mob-bottom-nav { display: flex; position: fixed; bottom: 0; left: 0; right: 0; height: calc(70px + env(safe-area-inset-bottom, 0px)); padding-bottom: env(safe-area-inset-bottom, 0px); z-index: 1000; align-items: center; justify-content: space-around; } .mob-nav-btn { position: relative; display: flex; flex: 1; min-height: 62px; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border: 0; background: transparent; color: var(--text-muted); font-family: inherit; font-size: 9px; font-weight: 800; cursor: pointer; } .mob-nav-btn.mob-nav-active { color: var(--brand-1); } .mob-nav-dot { position: absolute; bottom: 7px; width: 5px; height: 5px; border-radius: 50%; background: var(--brand-1); } }
            `}</style>
        </>
    );
};

export default NavBar;
