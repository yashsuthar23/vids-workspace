// SQLite storage for the CRM. Same data shape as crm-data.json, so the server can switch
// between the two with one setting (STORAGE=sqlite in .env). Each collection is a table:
// id (primary key) + data (JSON). A save runs in one transaction, and writes only the rows
// that changed, so a save stays fast as the audit log grows.
// node:sqlite prints an "experimental" warning every time it loads. It is harmless here, so hide only that message.
const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const text = typeof warning === "string" ? warning : warning && warning.message;
  if (text && text.includes("SQLite is an experimental feature")) return;
  return originalEmitWarning.call(process, warning, ...rest);
};
const { DatabaseSync } = require("node:sqlite");

const COLLECTIONS = [
  "users", "clients", "leads", "projects", "tasks", "scripts", "chats",
  "messages", "notifications", "invoices", "quotations", "payments",
  "auditLogs", "files"
];

function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  // Wait up to 5 seconds if another process (for example a helper script) holds the write lock.
  db.exec("PRAGMA busy_timeout = 5000;");
  for (const name of COLLECTIONS) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  }
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
  return db;
}

// Returns the same object shape the JSON file has.
function loadFromStore(db) {
  const out = {};
  for (const name of COLLECTIONS) {
    out[name] = db
      .prepare(`SELECT data FROM ${name} ORDER BY rowid`)
      .all()
      .map((row) => JSON.parse(row.data));
  }
  const seq = db.prepare("SELECT value FROM meta WHERE key = 'idSequences'").get();
  out.idSequences = seq ? JSON.parse(seq.value) : {};
  return out;
}

// Reads the stored JSON of every row, keyed by collection and id.
// Used as the baseline so a save only writes what changed.
function readRowMap(db) {
  const map = {};
  for (const name of COLLECTIONS) {
    const rows = new Map();
    for (const row of db.prepare(`SELECT id, data FROM ${name}`).all()) {
      rows.set(row.id, row.data);
    }
    map[name] = rows;
  }
  const seq = db.prepare("SELECT value FROM meta WHERE key = 'idSequences'").get();
  map.__seq = seq ? seq.value : null;
  return map;
}

// Saves the whole data object. Only rows that were added, changed or removed are written.
function saveToStore(db, data) {
  const next = {};
  for (const name of COLLECTIONS) {
    const rows = new Map();
    for (const item of data[name] || []) {
      if (!item || !item.id) throw new Error(`${name}: record without id`);
      rows.set(String(item.id), JSON.stringify(item));
    }
    next[name] = rows;
  }
  const seqJson = JSON.stringify(data.idSequences || {});

  // Baseline: the last state this process saved (or read) for this database.
  if (!db.__rowMap) db.__rowMap = readRowMap(db);
  const prev = db.__rowMap;

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const name of COLLECTIONS) {
      const before = prev[name];
      const after = next[name];
      const upsert = db.prepare(
        `INSERT INTO ${name} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`
      );
      for (const [id, json] of after) {
        if (before.get(id) !== json) upsert.run(id, json);
      }
      const remove = db.prepare(`DELETE FROM ${name} WHERE id = ?`);
      for (const id of before.keys()) {
        if (!after.has(id)) remove.run(id);
      }
    }
    if (prev.__seq !== seqJson) {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('idSequences', ?)").run(seqJson);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.__rowMap = null; // force a fresh baseline next time
    throw error;
  }

  // The new baseline is exactly what was just written.
  const updated = { __seq: seqJson };
  for (const name of COLLECTIONS) updated[name] = next[name];
  db.__rowMap = updated;
}

module.exports = { COLLECTIONS, openStore, loadFromStore, saveToStore };
