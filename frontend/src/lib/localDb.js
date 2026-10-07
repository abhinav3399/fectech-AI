import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

const DB_NAME = 'factech_local';
const DB_VERSION = 1;
const STATE_KEY = 'root_state';

let connectionPromise = null;

const schema = [
    `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS personas (id TEXT PRIMARY KEY NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT, data_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS family_contacts (id TEXT PRIMARY KEY NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS family_preferences (id TEXT PRIMARY KEY NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sync_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, operation TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, synced_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_sync_queue_pending ON sync_queue(synced_at, created_at)`,
];

function isNative() {
    return Capacitor.isNativePlatform();
}

async function getConnection() {
    if (!isNative()) return null;
    if (!connectionPromise) {
        connectionPromise = (async () => {
            const sqlite = new SQLiteConnection(CapacitorSQLite);
            const consistency = await sqlite.checkConnectionsConsistency();
            const hasConnection = await sqlite.isConnection(DB_NAME, false);
            const db = consistency.result && hasConnection.result
                ? await sqlite.retrieveConnection(DB_NAME, false)
                : await sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
            await db.open();
            for (const sql of schema) await db.execute(sql);
            await db.execute(`INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES ('schema_version', '1', '${new Date().toISOString()}')`);
            return db;
        })().catch((error) => {
            connectionPromise = null;
            console.warn('[Factech] Native SQLite unavailable; using localStorage fallback.', error);
            return null;
        });
    }
    return connectionPromise;
}

export async function hydrateState() {
    const db = await getConnection();
    if (!db) return null;
    try {
        const result = await db.query('SELECT state_json FROM app_state WHERE key = ?', [STATE_KEY]);
        const raw = result.values?.[0]?.state_json;
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('[Factech] Could not hydrate SQLite state.', error);
        return null;
    }
}

export async function persistState(state) {
    const db = await getConnection();
    if (!db) return false;
    try {
        const now = new Date().toISOString();
        await db.run(
            'INSERT OR REPLACE INTO app_state (key, state_json, updated_at) VALUES (?, ?, ?)',
            [STATE_KEY, JSON.stringify(state), now],
        );
        await db.run(
            'INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)',
            ['app_settings', JSON.stringify({ offlineFirst: true }), now],
        );
        const collections = [
            ['memories', state.memories || []],
            ['reminders', state.reminders || []],
            ['family_contacts', state.emergencyContacts || []],
        ];
        for (const [table, rows] of collections) {
            await db.run(`DELETE FROM ${table}`);
            for (const row of rows) {
                await db.run(
                    `INSERT OR REPLACE INTO ${table} (id, data_json, updated_at) VALUES (?, ?, ?)`,
                    [String(row.id), JSON.stringify(row), now],
                );
            }
        }
        if (state.profile) {
            await db.run('INSERT OR REPLACE INTO users (id, data_json, updated_at) VALUES (?, ?, ?)', ['current', JSON.stringify(state.profile), now]);
        }
        if (state.persona) {
            await db.run('INSERT OR REPLACE INTO personas (id, data_json, updated_at) VALUES (?, ?, ?)', ['current', JSON.stringify(state.persona), now]);
        }
        return true;
    } catch (error) {
        console.warn('[Factech] Could not persist SQLite state.', error);
        return false;
    }
}

export async function queueSync(entity, operation, payload) {
    const db = await getConnection();
    if (!db) return false;
    try {
        await db.run(
            'INSERT INTO sync_queue (entity, operation, payload_json, created_at) VALUES (?, ?, ?, ?)',
            [entity, operation, JSON.stringify(payload), new Date().toISOString()],
        );
        return true;
    } catch (error) {
        console.warn('[Factech] Could not queue sync operation.', error);
        return false;
    }
}

export async function getPendingSync() {
    const db = await getConnection();
    if (!db) return [];
    try {
        const result = await db.query('SELECT id, entity, operation, payload_json, created_at FROM sync_queue WHERE synced_at IS NULL ORDER BY created_at ASC');
        return (result.values || []).map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
    } catch (error) {
        console.warn('[Factech] Could not read sync queue.', error);
        return [];
    }
}

export async function markSyncComplete(id) {
    const db = await getConnection();
    if (!db) return false;
    try {
        await db.run('UPDATE sync_queue SET synced_at = ? WHERE id = ?', [new Date().toISOString(), id]);
        return true;
    } catch (error) {
        console.warn('[Factech] Could not mark sync operation complete.', error);
        return false;
    }
}
