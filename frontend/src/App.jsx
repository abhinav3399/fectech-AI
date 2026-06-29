import React, { useState, useEffect, useRef } from 'react';
import { Bell, X, Pill, Check, Clock } from 'lucide-react';
import NavBar from './components/SideNav';
import Onboarding from './components/Onboarding';
import HomeView from './pages/HomeView';
import AvatarPage from './pages/AvatarPage';
import MemoriesPage from './pages/MemoriesPage';
import RemindersPage from './pages/RemindersPage';
import ContactsPage from './pages/ContactsPage';
import SettingsPage from './pages/SettingsPage';
import { FeedbackHost } from './components/Feedback';
import EmergencyButton from './components/EmergencyButton';
import { useAppState, getState, markReminderFired, updateReminder, logAdherence } from './lib/store';
import './lib/a11y'; // apply saved text-size / contrast / motion prefs on load

function App() {
  const { profile, persona } = useAppState();
  const [view, setView] = useState('home');
  const [dueReminder, setDueReminder] = useState(null);
  const dueRef = useRef(null); // id of the reminder currently prompting (so we never stack prompts)

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
  if (view === 'avatar') content = <AvatarPage />;
  else if (view === 'memories') content = <MemoriesPage />;
  else if (view === 'reminders') content = <RemindersPage />;
  else if (view === 'contacts') content = <ContactsPage />;
  else if (view === 'settings') content = <SettingsPage />;
  else content = <HomeView onNavigate={setView} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'transparent', overflow: 'hidden' }}>
      <NavBar onViewChange={setView} currentView={view} />

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
              position: fixed; top: 84px; left: 50%; transform: translateX(-50%); z-index: 2000;
              display: flex; align-items: center; gap: var(--s-3); max-width: 92%; flex-wrap: wrap; justify-content: center;
              background: var(--glass-strong); backdrop-filter: blur(16px);
              border: 1px solid var(--border-strong); border-left: 3px solid var(--brand-1);
              color: var(--text);
              padding: var(--s-3) var(--s-5); border-radius: var(--r-lg);
              box-shadow: var(--shadow-lg), var(--glow-brand);
              animation: rb-in var(--dur) var(--ease); font-weight: 600;
            }
            .reminder-banner.med { border-left-color: var(--accent-pink); }
            .reminder-banner > svg { color: var(--brand-1); flex-shrink: 0; }
            .reminder-banner.med > svg { color: var(--accent-pink); }
            .reminder-banner > span { flex: 1; min-width: 180px; }
            .rb-actions { display: flex; gap: var(--s-2); flex-wrap: wrap; flex-shrink: 0; }
            .rb-act { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 16px; border-radius: var(--r-md); border: 1px solid var(--border); font-weight: 800; font-size: var(--fs-sm); font-family: inherit; cursor: pointer; transition: transform var(--dur) var(--ease), background var(--dur) var(--ease); }
            .rb-act.taken { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; border-color: transparent; box-shadow: 0 8px 22px rgba(22,163,74,0.35); }
            .rb-act.snooze { background: var(--surface-2); color: var(--text); }
            .rb-act.skip { background: var(--surface-2); color: var(--text-muted); }
            .rb-act:hover { transform: translateY(-1px); }
            .rb-dismiss { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); width: 30px; height: 30px; border-radius: var(--r-sm); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
            .rb-dismiss:hover { background: var(--surface-3); color: var(--text); }
            @keyframes rb-in { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }
          `}</style>
        </div>
      )}

      <div style={{ flex: 1, paddingTop: '70px', height: '100%', overflow: 'hidden' }}>
        {content}
      </div>

      <EmergencyButton />
      <FeedbackHost />
    </div>
  );
}

export default App;
