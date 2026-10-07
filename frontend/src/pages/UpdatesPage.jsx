import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, AlertCircle, Bell, CheckCircle, Info, RefreshCw, Shield } from 'lucide-react';
import { ScrollReveal } from '../components/MotionPrimitives';
import { API_BASE } from '../lib/apiConfig';

const UPDATES = [
    { id: 1, icon: CheckCircle, iconColor: '#22c55e', bg: 'rgba(34,197,94,0.08)', title: 'App is up to date', body: 'You are running the latest version of Factech AI.', time: 'Just now' },
    { id: 2, icon: Shield, iconColor: '#7c3aed', bg: 'rgba(124,58,237,0.08)', title: 'Privacy reminder', body: 'Your data is stored locally on this device. Nothing is shared without your consent.', time: 'Today' },
    { id: 3, icon: Info, iconColor: '#4f46e5', bg: 'rgba(79,70,229,0.08)', title: 'New feature: Voice cloning', body: 'You can now create a personalised voice for your AI companion in Settings → Persona.', time: 'This week' },
    { id: 4, icon: Bell, iconColor: '#f59e0b', bg: 'rgba(245,158,11,0.08)', title: 'Reminder check', body: 'Make sure your medication and daily reminders are set up so your AI companion can keep you on track.', time: 'This week' },
];

function formatNumber(value) {
    if (!value && value !== 0) return '—';
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return value.toLocaleString();
}

export default function UpdatesPage() {
    const [disease, setDisease] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refreshed, setRefreshed] = useState(false);

    const fetchDisease = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/health-apis/disease`);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setDisease(data);
            setRefreshed(true);
            setTimeout(() => setRefreshed(false), 2000);
        } catch {
            setError('Could not load health data. Backend must be running.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchDisease(); }, []);

    return (
        <div className="upd premium-page">
            <ScrollReveal className="upd-inner" distance={14}>
                <div className="upd-header">
                    <div className="upd-header-text">
                        <span className="hv-eyebrow">Information</span>
                        <h1 className="upd-title">Updates</h1>
                        <p className="upd-sub">What’s new and important for you.</p>
                    </div>
                    <div className="upd-hero-icon" aria-hidden="true"><Shield size={44} strokeWidth={1.4} /></div>
                </div>

                <motion.section className="upd-disease-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.4 }}>
                    <div className="upd-disease-head">
                        <div className="upd-disease-title"><Activity size={18} color="#7c3aed" /> Today’s global health briefing</div>
                        <button className="upd-disease-refresh" onClick={fetchDisease} title="Refresh health data" disabled={loading}>
                            <RefreshCw size={14} className={loading ? 'upd-spin' : ''} />
                            {refreshed ? 'Updated' : 'Refresh'}
                        </button>
                    </div>
                    {loading && <div className="upd-disease-loading"><RefreshCw size={20} className="upd-spin" /> Looking up health data…</div>}
                    {error && !loading && <div className="upd-disease-error"><AlertCircle size={16} /> {error}</div>}
                    {disease && !loading && (
                        <div className="upd-disease-body">
                            <div className="upd-stat-grid">
                                <div className="upd-stat blue"><div className="upd-stat-val">{formatNumber(disease.todayCases)}</div><div className="upd-stat-label">New cases today</div></div>
                                <div className="upd-stat red"><div className="upd-stat-val">{formatNumber(disease.todayDeaths)}</div><div className="upd-stat-label">Deaths today</div></div>
                                <div className="upd-stat purple"><div className="upd-stat-val">{formatNumber(disease.active)}</div><div className="upd-stat-label">Active cases</div></div>
                                <div className="upd-stat green"><div className="upd-stat-val">{formatNumber(disease.recovered)}</div><div className="upd-stat-label">Recovered</div></div>
                            </div>
                            <p className="upd-disease-src">Source: disease.sh · Updated: {disease.updated ? new Date(disease.updated).toLocaleTimeString() : 'recently'}</p>
                        </div>
                    )}
                </motion.section>

                <div className="upd-list" aria-label="Latest updates">
                    {UPDATES.map(({ id, icon: Icon, iconColor, bg, title, body, time }, index) => (
                        <motion.article key={id} className="upd-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 + index * 0.06, duration: 0.38 }}>
                            <div className="upd-icon" style={{ background: bg }}><Icon size={22} color={iconColor} /></div>
                            <div className="upd-body"><div className="upd-card-title">{title}</div><div className="upd-card-body">{body}</div><div className="upd-card-time">{time}</div></div>
                        </motion.article>
                    ))}
                </div>

                <div className="upd-footer"><Shield size={26} color="#7c3aed" /><p>Factech AI keeps your data private and secure.</p></div>
            </ScrollReveal>
        </div>
    );
}
