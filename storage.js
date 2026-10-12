// Shared data access for the server and the helper scripts.
// Chooses JSON (crm-data.json) or SQLite (crm.sqlite) from STORAGE in .env.
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const JSON_FILE = path.join(ROOT, "crm-data.json");
const SQLITE_FILE = path.join(ROOT, "crm.sqlite");
const BACKUP_DIR = path.join(ROOT, "backups");

function readEnvValue(key) {
  if (process.env[key] !== undefined) return process.env[key];
  const envFile = path.join(ROOT, ".env");
  if (!fs.existsSync(envFile)) return undefined;
  for (const raw of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    if (line.slice(0, i).trim() === key) {
      return line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

const MODE = String(readEnvValue("STORAGE") || "json").toLowerCase() === "sqlite" ? "sqlite" : "json";

function dataExists() {
  return fs.existsSync(MODE === "sqlite" ? SQLITE_FILE : JSON_FILE);
}

function dataLabel() {
  return MODE === "sqlite" ? "crm.sqlite" : "crm-data.json";
}

function readData() {
  if (MODE === "sqlite") {
    const store = require("./sqlite-store");
    const db = store.openStore(SQLITE_FILE);
    try {
      return store.loadFromStore(db);
    } finally {
      db.close();
    }
  }
  return JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
}

function writeData(data) {
  if (MODE === "sqlite") {
    const store = require("./sqlite-store");
    const db = store.openStore(SQLITE_FILE);
    try {
      store.saveToStore(db, data);
    } finally {
      db.close();
    }
    return;
  }
  const temp = `${JSON_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temp, JSON_FILE);
}

// Copies the current data into backups/ and returns the new file name.
// tag is a short label, for example "auto" or "before-role-change".
function backupData(tag) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (MODE === "sqlite") {
    const file = path.join(BACKUP_DIR, `crm-${tag}-${stamp}.sqlite`);
    const store = require("./sqlite-store");
    const db = store.openStore(SQLITE_FILE);
    try {
      // VACUUM INTO makes a clean, complete copy, even while the server is running (WAL mode).
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
    return path.basename(file);
  }
  const file = path.join(BACKUP_DIR, `crm-data-${tag}-${stamp}.json`);
  fs.copyFileSync(JSON_FILE, file);
  return path.basename(file);
}

module.exports = { MODE, JSON_FILE, SQLITE_FILE, BACKUP_DIR, dataExists, dataLabel, readData, writeData, backupData };
