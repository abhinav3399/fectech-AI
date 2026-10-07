import React, { useState } from 'react';
import axios from 'axios';
import { Activity, Sparkles, AlertCircle, Lightbulb, TrendingUp } from 'lucide-react';
import { useAppState, addInsight } from '../lib/store';
import { API_BASE } from '../lib/apiConfig';

const MOOD = {
    positive: { label: 'Positive', color: '#34d399', score: 4 }, // success
    neutral: { label: 'Neutral', color: '#22d3ee', score: 3 },   // accent-cyan
    low: { label: 'Low', color: '#fbbf24', score: 2 },           // warning
    anxious: { label: 'Anxious', color: '#f87171', score: 1 },   // danger
};
const ENGAGE = { high: '#34d399', medium: '#22d3ee', low: '#fbbf24' };

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
        .wi {
            background: var(--glass); border: 1px solid var(--border); border-radius: var(--r-lg);
            padding: var(--s-6); margin-top: var(--s-8);
            box-shadow: var(--shadow-md); backdrop-filter: blur(14px);
        }
        .wi-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; }
        .wi-title { display: flex; align-items: center; gap: var(--s-2); font-size: var(--fs-lg); font-weight: 800; letter-spacing: -0.01em; }
        .wi-btn {
            display: inline-flex; align-items: center; gap: var(--s-2);
            background: var(--grad-brand); color: var(--text-on-brand); border: none;
            padding: 11px 18px; border-radius: var(--r-md); font-weight: 700; cursor: pointer;
            font-size: var(--fs-sm); font-family: inherit; box-shadow: var(--glow-brand);
            transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease), opacity var(--dur) var(--ease);
        }
        .wi-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124, 58, 237, 0.5); }
        .wi-btn:active:not(:disabled) { transform: translateY(1px); }
        .wi-btn:disabled { opacity: 0.5; cursor: default; }
        .wi-sub { color: var(--text-muted); font-size: var(--fs-sm); margin: var(--s-2) 0 0; line-height: 1.6; }
        .wi-error {
            margin-top: var(--s-3); color: var(--danger);
            background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.3);
            padding: 12px 16px; border-radius: var(--r-md); font-size: var(--fs-sm);
        }
        .wi-body { margin-top: var(--s-4); animation: ui-fade-up 0.4s var(--ease) both; }
        .wi-pills { display: flex; gap: var(--s-3); flex-wrap: wrap; margin-bottom: var(--s-4); }
        .wi-pill {
            border: 1px solid; padding: 6px 16px; border-radius: var(--r-pill);
            font-size: var(--fs-xs); font-weight: 700; letter-spacing: 0.02em;
            background: var(--surface-1); backdrop-filter: blur(8px);
        }
        .wi-summary { color: var(--text); line-height: 1.65; font-size: var(--fs-md); margin: 0 0 var(--s-4); }
        .wi-section { margin-bottom: var(--s-4); }
        .wi-label {
            font-size: var(--fs-xs); font-weight: 700; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: var(--s-2);
            display: flex; align-items: center; gap: var(--s-2);
        }
        .wi-label.wi-warn { color: var(--warning); }
        .wi-label.wi-tip { color: var(--success); }
        .wi-chips { display: flex; flex-wrap: wrap; gap: var(--s-2); }
        .wi-chip {
            display: inline-flex; align-items: center;
            background: rgba(139, 92, 246, 0.14); border: 1px solid rgba(139, 92, 246, 0.32); color: #ddd6fe;
            padding: 6px 14px; border-radius: var(--r-pill); font-size: var(--fs-sm); font-weight: 600;
            transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
        }
        .wi-chip:hover { background: rgba(139, 92, 246, 0.26); color: #fff; }
        .wi-list { margin: 0; padding-left: var(--s-5); color: var(--text-muted); line-height: 1.65; font-size: var(--fs-sm); }
        .wi-list li { margin-bottom: var(--s-1); }
        .wi-trend {
            display: flex; align-items: flex-end; gap: var(--s-2); height: 64px;
            padding: var(--s-3); background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--r-md);
        }
        .wi-bar-wrap {
            flex: 1; max-width: 28px; height: 100%; display: flex; align-items: flex-end;
            background: var(--surface-2); border-radius: var(--r-sm); overflow: hidden;
        }
        .wi-bar { width: 100%; border-radius: var(--r-sm); min-height: 6px; transition: height var(--dur) var(--ease); }
      `}</style>
        </div>
    );
}
