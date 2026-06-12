import React, { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import NavBar from './components/SideNav';
import Onboarding from './components/Onboarding';
import HomeView from './pages/HomeView';
import AvatarPage from './pages/AvatarPage';
import MemoriesPage from './pages/MemoriesPage';
import { useAppState, getState, markReminderFired } from './lib/store';

function App() {
  const { profile, persona } = useAppState();
  const [view, setView] = useState('home');
  const [dueReminder, setDueReminder] = useState(null);

  // Global reminder checker: fires within an hour of a reminder's time, once
  // per day, and has the companion announce it aloud.
  useEffect(() => {
    const speak = (text, lang) => {
      if (!window.speechSynthesis) return;
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        window.speechSynthesis.speak(u);
      } catch (e) { /* noop */ }
    };
    const check = () => {
      const s = getState();
      if (!s.reminders?.length) return;
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      for (const r of s.reminders) {
        const [h, m] = (r.time || '00:00').split(':').map(Number);
        const tMin = h * 60 + m;
        if (nowMin >= tMin && nowMin - tMin <= 60 && r.lastFired !== today) {
          markReminderFired(r.id, today);
          const uname = s.profile?.name || 'dear';
          const lang = (s.persona?.language || '').toLowerCase();
          const ttsLang = (lang === 'hindi' || lang === 'hinglish') ? 'hi-IN' : 'en-US';
          const line = r.type === 'medication' ? `${uname}, it's time for your medicine: ${r.title}.`
            : r.type === 'meal' ? `${uname}, it's time to eat: ${r.title}.`
              : r.type === 'appointment' ? `${uname}, you have an appointment: ${r.title}.`
                : `${uname}, a gentle reminder: ${r.title}.`;
          setDueReminder({ ...r, line });
          speak(line, ttsLang);
          break; // one at a time
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
  else content = <HomeView onNavigate={setView} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f172a', overflow: 'hidden' }}>
      <NavBar onViewChange={setView} currentView={view} />

      {dueReminder && (
        <div className="reminder-banner">
          <Bell size={18} />
          <span>{dueReminder.line}</span>
          <button onClick={() => setDueReminder(null)} aria-label="Dismiss"><X size={16} /></button>
          <style>{`
            .reminder-banner {
              position: fixed; top: 80px; left: 50%; transform: translateX(-50%); z-index: 2000;
              display: flex; align-items: center; gap: 12px; max-width: 92%;
              background: linear-gradient(135deg,#7c3aed,#2563eb); color: #fff;
              padding: 12px 18px; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,0.5);
              animation: rb-in .3s ease; font-weight: 600;
            }
            .reminder-banner button { background: rgba(255,255,255,0.2); border: none; color: #fff; width: 28px; height: 28px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
            @keyframes rb-in { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }
          `}</style>
        </div>
      )}

      <div style={{ flex: 1, paddingTop: '70px', height: '100%', overflow: 'hidden' }}>
        {content}
      </div>
    </div>
  );
}

export default App;
