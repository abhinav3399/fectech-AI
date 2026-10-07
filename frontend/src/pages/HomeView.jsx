import React, { useEffect, useRef, useState } from 'react';
import { CalendarClock, ChevronRight, Clock3, Heart, Images, MessageCircle, ScanFace, Utensils } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppState } from '../lib/store';
import FaceRecognition from '../components/FaceRecognition';
import { ScrollParallax, ScrollProgress, ScrollReveal, Surface } from '../components/MotionPrimitives';
import { API_BASE } from '../lib/apiConfig';

function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
}

function formatTime(value) {
    if (!value) return '';
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
    const suffix = hours >= 12 ? 'PM' : 'AM';
    return `${((hours + 11) % 12) + 1}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function formatMemoryDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function HomeView({ onNavigate }) {
    const { profile, persona, memories = [], reminders = [] } = useAppState();
    const [scanning, setScanning] = useState(false);
    const [foodQuery, setFoodQuery] = useState('');
    const [nutrition, setNutrition] = useState(null);
    const [nutLoading, setNutLoading] = useState(false);
    const [nutError, setNutError] = useState(null);
    const [mealOpen, setMealOpen] = useState(false);
    const foodRef = useRef(null);
    const pageRef = useRef(null);
    const companionRef = useRef(null);
    const firstName = (profile?.name || 'friend').trim().split(/\s+/)[0];
    const activeReminders = reminders
        .filter((reminder) => reminder.enabled !== false)
        .slice()
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
        .slice(0, 3);
    const recentMemories = memories.slice(0, 3);

    useEffect(() => {
        if (mealOpen) foodRef.current?.focus();
    }, [mealOpen]);

    const fetchNutrition = async () => {
        if (!foodQuery.trim()) return;
        setNutLoading(true);
        setNutError(null);
        setNutrition(null);
        try {
            const res = await fetch(`${API_BASE}/health-apis/nutrition`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: foodQuery.trim() }),
            });
            const data = await res.json();
            setNutrition(data);
        } catch (error) {
            setNutError('Could not fetch nutrition data. Try again when you are connected.');
        } finally {
            setNutLoading(false);
        }
    };

    return (
        <div ref={pageRef} className="hv premium-page">
            <ScrollProgress containerRef={pageRef} />
            {scanning && <FaceRecognition onClose={() => setScanning(false)} />}

            <div className="hv-ambient" aria-hidden="true" />
            <div className="hv-inner">
                <ScrollReveal className="hv-welcome" distance={12}>
                    <div>
                        <span className="hv-eyebrow">Your space</span>
                        <h1>{greeting()}, {firstName}</h1>
                        <p>Here’s what’s waiting today.</p>
                    </div>
                    <div className="hv-date-mark">
                        <Clock3 size={16} />
                        <span>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                    </div>
                </ScrollReveal>

                <div className="hv-drawbridge">
                    <ScrollReveal className="hv-stage-wrap" distance={18}>
                        <Surface className="hv-companion-stage" interactive>
                            <div className="hv-stage-copy">
                                <span className="hv-eyebrow">Companion room</span>
                                <h2>{persona?.name || 'Your companion'}</h2>
                                <p>Ready to talk.</p>
                                <button type="button" className="ui-btn ui-btn--primary hv-talk" onClick={() => onNavigate('avatar')}>
                                    <MessageCircle size={18} /> Talk to {persona?.name || 'your companion'}
                                    <ChevronRight size={17} />
                                </button>
                            </div>
                            <ScrollParallax targetRef={companionRef} containerRef={pageRef} distance={16} className="hv-presence-wrap">
                                <div ref={companionRef} className="hv-presence" aria-label={`${persona?.name || 'Companion'} visual`}>
                                    <div className="hv-presence-halo" aria-hidden="true" />
                                    {persona?.faceImage ? (
                                        <img src={persona.faceImage} alt={persona.name || 'Companion'} />
                                    ) : (
                                        <span>{(persona?.name || 'F').charAt(0).toUpperCase()}</span>
                                    )}
                                </div>
                            </ScrollParallax>
                            <div className="hv-stage-line" aria-hidden="true" />
                        </Surface>
                    </ScrollReveal>

                    <ScrollReveal className="hv-today-wrap" direction="right" distance={18}>
                        <Surface className="hv-today">
                            <div className="hv-section-head">
                                <div>
                                    <span className="hv-eyebrow">Today</span>
                                    <h2>A gentle plan</h2>
                                </div>
                                <CalendarClock size={20} aria-hidden="true" />
                            </div>
                            <div className="hv-agenda">
                                {activeReminders.length === 0 ? (
                                    <button type="button" className="hv-agenda-row" onClick={() => onNavigate('reminders')}>
                                        <span className="hv-agenda-icon"><Clock3 size={16} /></span>
                                        <span><strong>No reminders scheduled today</strong><small>Add one when you’re ready.</small></span>
                                        <ChevronRight size={17} />
                                    </button>
                                ) : activeReminders.map((reminder) => (
                                    <button type="button" className="hv-agenda-row" key={reminder.id} onClick={() => onNavigate('reminders')}>
                                        <span className="hv-agenda-time">{formatTime(reminder.time)}</span>
                                        <span><strong>{reminder.title}</strong><small>{reminder.description || reminder.type || 'Reminder'}</small></span>
                                        <ChevronRight size={17} />
                                    </button>
                                ))}
                                {memories.length > 0 && (
                                    <button type="button" className="hv-agenda-row" onClick={() => onNavigate('memories')}>
                                        <span className="hv-agenda-icon"><Images size={16} /></span>
                                        <span><strong>{memories.length} {memories.length === 1 ? 'memory' : 'memories'} saved</strong><small>Keep a moment close.</small></span>
                                        <ChevronRight size={17} />
                                    </button>
                                )}
                            </div>
                        </Surface>
                    </ScrollReveal>
                </div>

                <ScrollReveal className="hv-memory-section" distance={14}>
                    <div className="hv-section-head hv-memory-head">
                        <div>
                            <span className="hv-eyebrow">Archive</span>
                            <h2>Recent memories</h2>
                        </div>
                        <button type="button" className="hv-text-link" onClick={() => onNavigate('memories')}>View all <ChevronRight size={16} /></button>
                    </div>
                    {recentMemories.length === 0 ? (
                        <Surface className="hv-empty-row">
                            <Images size={20} />
                            <span>No memories yet. Add a photo, note, or voice message.</span>
                            <button type="button" className="ui-btn ui-btn--ghost" onClick={() => onNavigate('memories')}>Add memory</button>
                        </Surface>
                    ) : (
                        <div className="hv-memory-grid">
                            {recentMemories.map((memory) => (
                                <button type="button" className="hv-memory-tile" key={memory.id} onClick={() => onNavigate('memories')}>
                                    {memory.image ? <img src={memory.image} alt={memory.caption || 'Saved memory'} /> : <span className="hv-memory-placeholder"><Heart size={24} /></span>}
                                    <span className="hv-memory-meta"><strong>{memory.caption || 'Saved memory'}</strong><small>{formatMemoryDate(memory.date)}</small></span>
                                </button>
                            ))}
                        </div>
                    )}
                </ScrollReveal>

                <ScrollReveal className="hv-care-section" distance={12}>
                    <div className="hv-section-head">
                        <div>
                            <span className="hv-eyebrow">Care tools</span>
                            <h2>Keep the day moving</h2>
                        </div>
                    </div>
                    <div className="hv-care-line">
                        <button type="button" className="hv-care-action" onClick={() => setMealOpen((open) => !open)} aria-expanded={mealOpen}>
                            <span className="hv-care-icon"><Utensils size={18} /></span>
                            <span><strong>Log a meal</strong><small>Look up a nutrition estimate.</small></span>
                            <ChevronRight size={17} className={mealOpen ? 'is-open' : ''} />
                        </button>
                        <button type="button" className="hv-care-action" onClick={() => setScanning(true)}>
                            <span className="hv-care-icon"><ScanFace size={18} /></span>
                            <span><strong>Recognize a person</strong><small>Use the camera to identify someone.</small></span>
                            <ChevronRight size={17} />
                        </button>
                    </div>
                    {mealOpen && (
                        <motion.div className="hv-meal-drawer" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
                            <label htmlFor="hv-food-query">What did you eat?</label>
                            <div className="hv-meal-form">
                                <input id="hv-food-query" ref={foodRef} className="ui-input" value={foodQuery} onChange={(event) => setFoodQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && fetchNutrition()} placeholder="e.g. two eggs and toast" />
                                <button type="button" className="ui-btn ui-btn--primary" onClick={fetchNutrition} disabled={nutLoading}>{nutLoading ? 'Looking up…' : 'Log meal'}</button>
                            </div>
                            {nutError && <p className="hv-feedback hv-feedback--error">{nutError}</p>}
                            {nutrition?.foods?.length > 0 && (
                                <div className="hv-nutrition-result">
                                    {nutrition.foods.map((food, index) => (
                                        <div key={`${food.food_name}-${index}`} className="hv-food-result">
                                            <strong>{food.food_name}</strong>
                                            <dl>
                                                <div><dt>Calories</dt><dd>{Math.round(food.nf_calories)} </dd></div>
                                                <div><dt>Protein</dt><dd>{Math.round(food.nf_protein)}g</dd></div>
                                                <div><dt>Carbs</dt><dd>{Math.round(food.nf_total_carbohydrate)}g</dd></div>
                                                <div><dt>Fat</dt><dd>{Math.round(food.nf_total_fat)}g</dd></div>
                                            </dl>
                                        </div>
                                    ))}
                                    <small>Nutrition estimate from {nutrition.source || 'the connected service'}{nutrition.demo ? ' · Demo data' : ''}</small>
                                </div>
                            )}
                        </motion.div>
                    )}
                </ScrollReveal>
            </div>
        </div>
    );
}
