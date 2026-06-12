// Single source of truth for the user profile, the one editable persona,
// and memories. Persisted to localStorage. Every screen reads from here, so
// the persona is built once and multiplied across Home, Avatar and Memories.
import { useSyncExternalStore } from 'react';

const KEY = 'factech_state_v1';
const defaultState = { profile: null, persona: null, memories: [], transcript: [], reminders: [], insightsHistory: [] };

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
export function addReminder(r) {
    const rem = {
        id: String(Date.now()) + Math.random().toString(36).slice(2, 7),
        title: r.title, time: r.time, type: r.type || 'general', lastFired: null,
    };
    set({ reminders: [...state.reminders, rem].sort((a, b) => a.time.localeCompare(b.time)) });
    return rem;
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

export function resetAll() { set({ ...defaultState }); }

// React hook — re-renders any component when state changes.
export function useAppState() {
    return useSyncExternalStore(subscribe, getState, getState);
}
