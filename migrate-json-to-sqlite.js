// Copies crm-data.json into crm.sqlite. crm-data.json is NOT changed.
// Usage (from the project folder):
//   node migrate-json-to-sqlite.js            -> creates crm.sqlite, refuses if it already exists
//   node migrate-json-to-sqlite.js --force    -> replaces crm.sqlite (after backing it up)
const fs = require("fs");
const path = require("path");
const { COLLECTIONS, openStore, loadFromStore, saveToStore } = require("./sqlite-store");

const jsonFile = path.join(__dirname, "crm-data.json");
const sqliteFile = path.join(__dirname, "crm.sqlite");
const force = process.argv.includes("--force");

if (!fs.existsSync(jsonFile)) {
  console.log("crm-data.json not found. Nothing to migrate.");
  process.exit(1);
}

if (fs.existsSync(sqliteFile)) {
  if (!force) {
    console.log("crm.sqlite already exists. Use --force to replace it (a backup is made first).");
    process.exit(1);
  }
  const backup = path.join(__dirname, "backups", `crm-before-migration-${Date.now()}.sqlite`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(sqliteFile, backup);
  for (const extra of ["-wal", "-shm"]) if (fs.existsSync(sqliteFile + extra)) fs.unlinkSync(sqliteFile + extra);
  fs.unlinkSync(sqliteFile);
  console.log(`Old crm.sqlite backed up to ${backup}`);
}

const json = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
const store = openStore(sqliteFile);
saveToStore(store, json);

// Verify: counts and full content must match the JSON
const back = loadFromStore(store);
let ok = true;
for (const name of COLLECTIONS) {
  const a = (json[name] || []).length;
  const b = back[name].length;
  const same = JSON.stringify(json[name] || []) === JSON.stringify(back[name]);
  console.log(`${name.padEnd(14)} json=${a}  sqlite=${b}  ${same ? "OK" : "MISMATCH"}`);
  if (!same) ok = false;
}
const seqSame = JSON.stringify(json.idSequences || {}) === JSON.stringify(back.idSequences);
console.log(`${"idSequences".padEnd(14)} ${seqSame ? "OK" : "MISMATCH"}`);
if (!seqSame) ok = false;

store.close();
console.log(ok ? "\nMigration verified. The JSON file was not changed." : "\nMISMATCH found. Do not switch yet.");
process.exit(ok ? 0 : 1);
