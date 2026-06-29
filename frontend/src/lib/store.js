// Single source of truth for the user profile, the one editable persona,
// and memories. Persisted to localStorage. Every screen reads from here, so
// the persona is built once and multiplied across Home, Avatar and Memories.
import { useSyncExternalStore } from 'react';

const KEY = 'factech_state_v1';
const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';
const defaultState = { profile: null, persona: null, memories: [], transcript: [], reminders: [], insightsHistory: [], emergencyContacts: [], distressLog: [], adherence: [] };

function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) return { ...defaultState, ...JSON.parse(raw) };
    } catch (e) { /* ignore */ }
    return { ...defaultState };
}

let state = load();
const listeners = new Set();

function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore quota */ }
}
function emit() { listeners.forEach((l) => l()); }
function set(next) { state = { ...state, ...next }; persist(); emit(); }

export function getState() { return state; }
export function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function setProfile(profile) { set({ profile }); }
export function setPersona(persona) { set({ persona }); }

export function addMemory(mem) {
    const m = {
        id: String(Date.now()) + Math.random().toString(36).slice(2, 7),
        date: new Date().toISOString(),
        ...mem,
    };
    set({ memories: [m, ...state.memories] });
    return m;
}
export function removeMemory(id) {
    set({ memories: state.memories.filter((m) => m.id !== id) });
}

// Persisted conversation log (feeds the wellbeing evaluation). Capped so
// localStorage never overflows.
export function addTurn(role, text) {
    const t = (text || '').trim();
    if (!t) return;
    const turn = { role, text: t, ts: new Date().toISOString() };
    const next = [...state.transcript, turn].slice(-300);
    set({ transcript: next });
}
export function clearTranscript() { set({ transcript: [] }); }

// --- Reminders & medication ---
const sortByTime = (arr) => [...arr].sort((a, b) => (a.time || '').localeCompare(b.time || ''));

export function addReminder(r) {
    const rem = {
        id: String(Date.now()) + Math.random().toString(36).slice(2, 7),
        title: r.title, time: r.time, type: r.type || 'general',
        description: r.description || '', frequency: r.frequency || 'daily',
        enabled: r.enabled !== false, lastFired: null, snoozeUntil: null,
    };
    set({ reminders: sortByTime([...state.reminders, rem]) });
    return rem;
}
export function updateReminder(id, patch) {
    set({ reminders: sortByTime(state.reminders.map((r) => (r.id === id ? { ...r, ...patch } : r))) });
}
export function toggleReminder(id) {
    set({ reminders: state.reminders.map((r) => (r.id === id ? { ...r, enabled: r.enabled === false } : r)) });
}
export function removeReminder(id) {
    set({ reminders: state.reminders.filter((r) => r.id !== id) });
}
export function markReminderFired(id, dayKey) {
    set({ reminders: state.reminders.map((r) => (r.id === id ? { ...r, lastFired: dayKey } : r)) });
}

// --- Wellbeing trend history ---
export function addInsight(ev) {
    if (!ev) return;
    const entry = { date: new Date().toISOString(), mood: ev.mood, engagement: ev.engagement };
    set({ insightsHistory: [...state.insightsHistory, entry].slice(-30) });
}

// --- Distress Watch: log a sustained agitation episode for the caregiver (never shown to the patient). ---
export function addDistressEpisode(ev) {
    if (!ev) return;
    const entry = { ts: new Date().toISOString(), peak: ev.peak ?? 0, trigger: (ev.trigger || '').slice(0, 120), calmMode: true };
    set({ distressLog: [...(state.distressLog || []), entry].slice(-50) });
}

// --- Medication adherence: record a reminder outcome locally + best-effort to the server. ---
export function logAdherence({ reminderId, title, type, status }) {
    const entry = { id: String(Date.now()) + Math.random().toString(36).slice(2, 7), reminderId, title, type, status, ts: new Date().toISOString() };
    set({ adherence: [...(state.adherence || []), entry].slice(-500) });
    // Fire-and-forget — never block the UI. Attributes to the account if signed in, else a kiosk id.
    try {
        const headers = { 'Content-Type': 'application/json' };
        const token = localStorage.getItem('factech_token');
        if (token) headers.Authorization = 'Bearer ' + token;
        fetch(`${API_BASE}/adherence/log`, {
            method: 'POST', headers,
            body: JSON.stringify({ reminder_id: reminderId, title, type, status, kiosk_id: state.profile?.name || 'kiosk' }),
        }).catch(() => { });
    } catch (e) { /* offline — the local copy in store.adherence is the fallback */ }
    return entry;
}

// --- Emergency contacts (the "Call my family" safety button) ---
export function setEmergencyContacts(list) { set({ emergencyContacts: Array.isArray(list) ? list : [] }); }

export function resetAll() { set({ ...defaultState }); }

// React hook — re-renders any component when state changes.
export function useAppState() {
    return useSyncExternalStore(subscribe, getState, getState);
}
