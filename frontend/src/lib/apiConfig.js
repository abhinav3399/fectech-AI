const APP_STATE_KEY = 'factech_state_v1';
const API_PREFIX = '/api/v1';
const buildBackendBase = import.meta.env.VITE_API_BASE_URL
    || import.meta.env.VITE_API_BASE
    || import.meta.env.VITE_API_URL
    || '';

export function normalizeBackendBase(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error('Enter a full backend URL, for example https://api.example.com.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
        throw new Error('Use a valid HTTP or HTTPS backend URL without embedded credentials.');
    }

    // Accept either the service origin/prefix or a URL already ending in /api/v1.
    const path = parsed.pathname.replace(/\/api\/v1\/?$/i, '').replace(/\/+$/, '');
    return `${parsed.origin}${path}`;
}

function readSavedBackendBase() {
    try {
        if (typeof localStorage === 'undefined') return '';
        const saved = JSON.parse(localStorage.getItem(APP_STATE_KEY) || 'null');
        const value = saved?.settings?.backendUrl;
        return typeof value === 'string' ? value : '';
    } catch {
        return '';
    }
}

function envBackendBase() {
    try { return normalizeBackendBase(buildBackendBase); }
    catch { return ''; }
}

export function getBackendBase() {
    const saved = readSavedBackendBase();
    if (saved) {
        try { return normalizeBackendBase(saved); }
        catch { /* ignore invalid legacy data and use the build default */ }
    }
    return envBackendBase();
}

export function getBackendSettingValue() {
    return readSavedBackendBase() || envBackendBase();
}

function baseWithApiPrefix(base) {
    return base ? `${base}${API_PREFIX}` : API_PREFIX;
}

export let API_BASE = baseWithApiPrefix(getBackendBase());

// ES-module imports are live bindings, so all existing feature modules switch
// endpoints immediately when Settings saves a new backend address.
export function setRuntimeBackendBase(value) {
    const normalized = normalizeBackendBase(value);
    API_BASE = baseWithApiPrefix(normalized || envBackendBase());
    return API_BASE;
}

export function getBackendOrigin() {
    return getBackendBase();
}

export function backendHealthUrl(value) {
    const base = normalizeBackendBase(value);
    if (!base) throw new Error('Enter a backend URL before testing the connection.');
    return `${base}/health`;
}

export function backendAssetUrl(path) {
    if (!path || /^(?:https?:|blob:|data:)/i.test(path)) return path;
    const base = getBackendBase();
    if (!base || !String(path).startsWith('/')) return path;
    return `${base}${path}`;
}
