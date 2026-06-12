import React, { useState } from 'react';
import axios from 'axios';
import { Activity, Sparkles, AlertCircle, Lightbulb, TrendingUp } from 'lucide-react';
import { useAppState, addInsight } from '../lib/store';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';

const MOOD = {
    positive: { label: 'Positive', color: '#4ade80', score: 4 },
    neutral: { label: 'Neutral', color: '#60a5fa', score: 3 },
    low: { label: 'Low', color: '#fbbf24', score: 2 },
    anxious: { label: 'Anxious', color: '#f87171', score: 1 },
};
const ENGAGE = { high: '#4ade80', medium: '#60a5fa', low: '#fbbf24' };

export default function WellbeingInsights() {
    const { transcript, persona, profile, insightsHistory } = useAppState();
    const [loading, setLoading] = useState(false);
    const [evalData, setEvalData] = useState(null);
    const [error, setError] = useState(null);

    const turns = (transcript || []).filter((t) => (t.text || '').trim()).length;

    const run = async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await axios.post(`${API_BASE}/evaluate`, {
                transcript,
                persona: { name: persona?.name, relationship: persona?.relationship },
                user: { name: profile?.name },
            }, { timeout: 40000 });
            if (r.data?.status === 'ok') { setEvalData(r.data.evaluation); addInsight(r.data.evaluation); }
            else setError(r.data?.message || 'Could not generate insights.');
        } catch (e) {
            setError('Could not reach the insights service.');
        } finally {
            setLoading(false);
        }
    };

    const mood = evalData && (MOOD[evalData.mood] || { label: evalData.mood, color: '#94a3b8' });

    return (
        <div className="wi">
            <div className="wi-head">
                <div className="wi-title"><Activity size={20} color="#a78bfa" /> Wellbeing insights</div>
                <button className="wi-btn" onClick={run} disabled={loading || turns < 2}>
                    <Sparkles size={15} /> {loading ? 'Analyzing…' : evalData ? 'Refresh' : 'Evaluate conversations'}
                </button>
            </div>
            <p className="wi-sub">
                A gentle, private read on how {profile?.name || 'they'} have been doing — drawn from recent chats with {persona?.name || 'their companion'}.
                {turns < 2 && ' Have a short conversation first.'}
            </p>

            {error && <div className="wi-error">{error}</div>}

            {evalData && (
                <div className="wi-body">
                    <div className="wi-pills">
                        {mood && <span className="wi-pill" style={{ borderColor: mood.color, color: mood.color }}>Mood: {mood.label}</span>}
                        {evalData.engagement && (
                            <span className="wi-pill" style={{ borderColor: ENGAGE[evalData.engagement] || '#94a3b8', color: ENGAGE[evalData.engagement] || '#94a3b8' }}>
                                Engagement: {evalData.engagement}
                            </span>
                        )}
                    </div>

                    {evalData.summary && <p className="wi-summary">{evalData.summary}</p>}

                    {Array.isArray(insightsHistory) && insightsHistory.length >= 2 && (
                        <div className="wi-section">
                            <div className="wi-label"><TrendingUp size={14} /> Mood trend (last {Math.min(insightsHistory.length, 12)})</div>
                            <div className="wi-trend">
                                {insightsHistory.slice(-12).map((h, i) => {
                                    const m = MOOD[h.mood] || { color: '#94a3b8', score: 2 };
                                    return (
                                        <div key={i} className="wi-bar-wrap" title={`${h.mood || '—'} · ${new Date(h.date).toLocaleDateString()}`}>
                                            <div className="wi-bar" style={{ height: `${(m.score / 4) * 100}%`, background: m.color }} />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {Array.isArray(evalData.topics) && evalData.topics.length > 0 && (
                        <div className="wi-section">
                            <div className="wi-label">They talked about</div>
                            <div className="wi-chips">
                                {evalData.topics.map((t, i) => <span key={i} className="wi-chip">{t}</span>)}
                            </div>
                        </div>
                    )}

                    {Array.isArray(evalData.concerns) && evalData.concerns.length > 0 && (
                        <div className="wi-section">
                            <div className="wi-label wi-warn"><AlertCircle size={14} /> Worth noticing</div>
                            <ul className="wi-list">{evalData.concerns.map((c, i) => <li key={i}>{c}</li>)}</ul>
                        </div>
                    )}

                    {Array.isArray(evalData.suggestions) && evalData.suggestions.length > 0 && (
                        <div className="wi-section">
                            <div className="wi-label wi-tip"><Lightbulb size={14} /> Gentle suggestions</div>
                            <ul className="wi-list">{evalData.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
                        </div>
                    )}
                </div>
            )}

            <style>{`
        .wi { background: rgba(30,41,59,0.55); border: 1px solid rgba(255,255,255,0.09); border-radius: 18px; padding: 22px; margin-top: 28px; }
        .wi-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .wi-title { display: flex; align-items: center; gap: 8px; font-size: 1.15rem; font-weight: 700; }
        .wi-btn { display: flex; align-items: center; gap: 7px; background: linear-gradient(135deg,#7c3aed,#2563eb); color: #fff; border: none; padding: 9px 16px; border-radius: 10px; font-weight: 700; cursor: pointer; font-size: 0.85rem; }
        .wi-btn:disabled { opacity: 0.5; cursor: default; }
        .wi-sub { color: #94a3b8; font-size: 0.88rem; margin: 8px 0 0; line-height: 1.5; }
        .wi-error { margin-top: 12px; color: #fca5a5; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); padding: 10px 14px; border-radius: 10px; font-size: 0.85rem; }
        .wi-body { margin-top: 16px; }
        .wi-pills { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
        .wi-pill { border: 1px solid; padding: 5px 14px; border-radius: 20px; font-size: 0.78rem; font-weight: 700; background: rgba(255,255,255,0.03); }
        .wi-summary { color: #e2e8f0; line-height: 1.6; font-size: 0.95rem; margin: 0 0 16px; }
        .wi-section { margin-bottom: 14px; }
        .wi-label { font-size: 0.78rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
        .wi-label.wi-warn { color: #fbbf24; }
        .wi-label.wi-tip { color: #4ade80; }
        .wi-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .wi-chip { background: rgba(124,58,237,0.15); border: 1px solid rgba(124,58,237,0.3); color: #c4b5fd; padding: 5px 12px; border-radius: 14px; font-size: 0.8rem; }
        .wi-list { margin: 0; padding-left: 18px; color: #cbd5e1; line-height: 1.6; font-size: 0.9rem; }
        .wi-list li { margin-bottom: 4px; }
        .wi-trend { display: flex; align-items: flex-end; gap: 6px; height: 56px; padding: 4px 0; }
        .wi-bar-wrap { flex: 1; max-width: 26px; height: 100%; display: flex; align-items: flex-end; background: rgba(255,255,255,0.04); border-radius: 4px; }
        .wi-bar { width: 100%; border-radius: 4px; min-height: 6px; transition: height .3s; }
      `}</style>
        </div>
    );
}
