// App theme (dark | light). Persisted to localStorage and applied as a
// data-theme attribute on <html>, which flips the design tokens in index.css.
const KEY = 'factech_theme';

export function getTheme() {
    try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; }
}

export function applyTheme(t) {
    if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', t);
}

export function setTheme(t) {
    try { localStorage.setItem(KEY, t); } catch (e) { /* ignore quota */ }
    applyTheme(t);
}

export function toggleTheme() {
    const next = getTheme() === 'light' ? 'dark' : 'light';
    setTheme(next);
    return next;
}

// Apply immediately on import (before React renders) so there's no theme flash.
applyTheme(getTheme());
