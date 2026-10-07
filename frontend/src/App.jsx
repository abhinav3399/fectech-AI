import React, { useState, useEffect, useRef } from 'react';
import { Bell, X, Pill, Check, Clock, WifiOff } from 'lucide-react';
import { MotionConfig } from 'framer-motion';
import { PageTransition } from './components/MotionPrimitives';
import NavBar from './components/SideNav';
import Onboarding from './components/Onboarding';
import HomeView from './pages/HomeView';
import AvatarPage from './pages/AvatarPage';
import MemoriesPage from './pages/MemoriesPage';
import RemindersPage from './pages/RemindersPage';
import ContactsPage from './pages/ContactsPage';
import SettingsPage from './pages/SettingsPage';
import FamilySafetyPage from './pages/FamilySafetyPage';
import UpdatesPage from './pages/UpdatesPage';
import { FeedbackHost } from './components/Feedback';
import EmergencyButton from './components/EmergencyButton';
import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { useAppState, getState, markReminderFired, updateReminder, logAdherence } from './lib/store';
import './lib/a11y'; // apply saved text-size / contrast / motion prefs on load

function App() {
  const { profile, persona } = useAppState();
  const [view, setView] = useState('home');
  const [dueReminder, setDueReminder] = useState(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const dueRef = useRef(null); // id of the reminder currently prompting (so we never stack prompts)

  // Android back-button handling via Capacitor App plugin
  useEffect(() => {
    let cleanup = () => {};
    const setupBackButton = async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        const handle = await CapApp.addListener('backButton', ({ canGoBack }) => {
          if (view !== 'home') {
            setView('home');
          } else {
            CapApp.exitApp();
          }
        });
        cleanup = () => handle.remove();
      } catch (e) {
        // Not running in Capacitor (desktop/browser) — ignore
      }
    };
    setupBackButton();
    return () => cleanup();
  }, [view]);

  // Network online/offline detection
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);


  const todayStr = () => new Date().toISOString().slice(0, 10);
  const resolveDue = () => { dueRef.current = null; setDueReminder(null); };
  // Medication outcomes: log it, mark resolved for today, and clear the prompt.
  const onTaken = (r) => { logAdherence({ reminderId: r.id, title: r.title, type: r.type, status: 'taken' }); markReminderFired(r.id, todayStr()); resolveDue(); };
  const onSkip = (r) => { logAdherence({ reminderId: r.id, title: r.title, type: r.type, status: 'skipped' }); markReminderFired(r.id, todayStr()); resolveDue(); };
  const onSnooze = (r) => { logAdherence({ reminderId: r.id, title: r.title, type: r.type, status: 'snoozed' }); updateReminder(r.id, { snoozeUntil: new Date(Date.now() + 10 * 60000).toISOString() }); resolveDue(); };

  // Global reminder checker: fires within an hour of a reminder's time, once
  // per day, and has the companion announce it aloud.
  useEffect(() => {
    const speak = (text, lang) => {
      if (Capacitor.isNativePlatform()) {
        TextToSpeech.speak({ text, lang, rate: 0.95, pitch: 1, volume: 1, queueStrategy: 0 }).catch((e) => console.warn('[Reminder TTS] Phone speech unavailable:', e?.message || e));
        return;
      }
      if (!window.speechSynthesis) return;
      try {
        window.speechSynthesis.cancel(); // never layer over a voice already speaking
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        window.speechSynthesis.speak(u);
      } catch (e) { /* noop */ }
    };
    const check = () => {
      if (dueRef.current) return; // a prompt is already showing — never stack
      const s = getState();
      if (!s.reminders?.length) return;
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const nowMs = now.getTime();
      const uname = s.profile?.name || 'dear';
      const lang = (s.persona?.language || '').toLowerCase();
      const ttsLang = (lang === 'hindi' || lang === 'hinglish') ? 'hi-IN' : 'en-US';
      const lineFor = (r) => r.type === 'medication' ? `${uname}, it's time for your medicine: ${r.title}.`
        : r.type === 'meal' ? `${uname}, it's time to eat: ${r.title}.`
          : (r.type === 'appointment' || r.type === 'event') ? `${uname}, you have ${r.type === 'event' ? 'an event' : 'an appointment'}: ${r.title}.`
            : `${uname}, a gentle reminder: ${r.title}.`;
      for (const r of s.reminders) {
        if (r.enabled === false) continue; // muted reminders never announce
        const [h, m] = (r.time || '00:00').split(':').map(Number);
        const tMin = h * 60 + m;
        if (nowMin < tMin) continue;
        if (r.snoozeUntil && nowMs < new Date(r.snoozeUntil).getTime()) continue; // snoozed -> wait

        if (r.type === 'medication') {
          if (r.lastFired === today) continue;                 // already taken/skipped today
          if (nowMin - tMin > 120) {                            // window passed, no response -> missed (once)
            if (r.missedDate !== today) {
              logAdherence({ reminderId: r.id, title: r.title, type: 'medication', status: 'missed' });
              updateReminder(r.id, { missedDate: today });      // caregiver-only record; patient sees nothing
            }
            continue;
          }
          const line = lineFor(r);
          dueRef.current = r.id;
          setDueReminder({ ...r, line, isMed: true });          // -> Taken / Snooze / Skip prompt
          speak(line, ttsLang);
          break;
        }
        // Non-medication: keep the gentle announce-once banner.
        if (nowMin - tMin <= 60 && r.lastFired !== today) {
          markReminderFired(r.id, today);
          const line = lineFor(r);
          dueRef.current = r.id;
          setDueReminder({ ...r, line });
          speak(line, ttsLang);
          break;
        }
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  // First run: register the user and create their one companion.
  if (!profile || !persona) {
    return <Onboarding />;
  }

  let content;
  if (view === 'avatar')    content = <AvatarPage />;
  else if (view === 'memories')  content = <MemoriesPage />;
  else if (view === 'reminders') content = <RemindersPage />;
  else if (view === 'contacts')  content = <ContactsPage />;
  else if (view === 'family')    content = <FamilySafetyPage />;
  else if (view === 'updates')   content = <UpdatesPage />;
  else if (view === 'settings')  content = <SettingsPage />;
  else content = <HomeView onNavigate={setView} />;

  return (
    <MotionConfig reducedMotion="user">
      <div className={`app-shell ${Capacitor.isNativePlatform() ? 'native-app-shell' : ''}`}>
      <NavBar onViewChange={setView} currentView={view} />

      {isOffline && (
        <div className="offline-banner">
          <WifiOff size={14} style={{ display: 'inline', marginRight: 6 }} />
          OFFLINE MODE
        </div>
      )}

      {dueReminder && (
        <div className={`reminder-banner ${dueReminder.isMed ? 'med' : ''}`}>
          {dueReminder.isMed ? <Pill size={18} /> : <Bell size={18} />}
          <span>{dueReminder.line}</span>
          {dueReminder.isMed ? (
            <div className="rb-actions">
              <button className="rb-act taken" onClick={() => onTaken(dueReminder)}><Check size={16} /> Taken</button>
              <button className="rb-act snooze" onClick={() => onSnooze(dueReminder)}><Clock size={16} /> 10 min</button>
              <button className="rb-act skip" onClick={() => onSkip(dueReminder)}><X size={16} /> Skip</button>
            </div>
          ) : (
            <button className="rb-dismiss" onClick={resolveDue} aria-label="Dismiss"><X size={16} /></button>
          )}
          <style>{`
            .reminder-banner {
              position: fixed; top: 72px; left: 50%; transform: translateX(-50%); z-index: 2000;
              display: flex; align-items: center; gap: 10px; max-width: 92%; flex-wrap: wrap; justify-content: center;
              background: var(--glass-strong); backdrop-filter: blur(16px);
              border: 1px solid var(--border-strong); border-left: 3px solid var(--brand-1);
              color: var(--text); padding: 10px 18px; border-radius: 14px;
              box-shadow: var(--shadow-lg); animation: rb-in 0.2s ease; font-weight: 600;
            }
            .reminder-banner.med { border-left-color: var(--accent-pink); }
            .reminder-banner > svg { color: var(--brand-1); flex-shrink: 0; }
            .reminder-banner.med > svg { color: var(--accent-pink); }
            .reminder-banner > span { flex: 1; min-width: 180px; }
            .rb-actions { display: flex; gap: 8px; flex-wrap: wrap; flex-shrink: 0; }
            .rb-act { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--border); font-weight: 800; font-size: 0.85rem; font-family: inherit; cursor: pointer; }
            .rb-act.taken { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; border-color: transparent; }
            .rb-act.snooze { background: var(--surface-2); color: var(--text); }
            .rb-act.skip { background: var(--surface-2); color: var(--text-muted); }
            .rb-dismiss { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); width: 30px; height: 30px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
            @keyframes rb-in { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
          `}</style>
        </div>
      )}

      <main className="app-content">
        <PageTransition routeKey={view}>{content}</PageTransition>
      </main>

      <EmergencyButton />
      <FeedbackHost />

      <style>{`
        /* ━━━━━━━━━━━ APP SHELL ━━━━━━━━━━━ */
        .app-shell {
          display: flex; flex-direction: column;
          height: 100dvh; height: 100vh;
          background: transparent;
          overflow: hidden;
        }

        /* Desktop content area */
        .app-content {
          flex: 1;
          padding-top: 64px;   /* top nav height */
          overflow: hidden;
          height: 100%;
        }

        /* Mobile content area — scrollable, padded for both navbars */
        @media (max-width: 640px) {
          .app-content {
            padding-top: 64px;
            padding-bottom: calc(70px + env(safe-area-inset-bottom, 0px));
            overflow-y: auto;
            overflow-x: hidden;
            -webkit-overflow-scrolling: touch;
          }
          /* Light background for mobile */
          .app-shell {
            background: linear-gradient(150deg, #eef1ff 0%, #f3efff 60%, #fce7ff 100%);
          }
        }
      `}</style>
      </div>
    </MotionConfig>
  );
}

export default App;
