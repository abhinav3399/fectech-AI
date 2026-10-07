// Accessibility preferences for elderly / dementia users: text size, reduce
// motion, high contrast. Persisted to localStorage and applied to <html> so the
// whole design-token system (index.css) responds — no per-component wiring.
const KEY = 'factech_a11y';
export const FONT_SCALES = { normal: 1, large: 1.16, largest: 1.34 };
const DEFAULTS = { fontScale: 'normal', reduceMotion: false, highContrast: false };

export function getA11y() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch (e) { return { ...DEFAULTS }; }
}

export function applyA11y(a = getA11y()) {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    el.style.setProperty('--fs-scale', String(FONT_SCALES[a.fontScale] || 1));
    el.setAttribute('data-reduce-motion', a.reduceMotion ? 'true' : 'false');
    el.setAttribute('data-contrast', a.highContrast ? 'high' : 'normal');
}

export function setA11y(patch) {
    const next = { ...getA11y(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* ignore quota */ }
    applyA11y(next);
    return next;
}

// Apply immediately on import (before React renders) so there's no flash.
applyA11y();
