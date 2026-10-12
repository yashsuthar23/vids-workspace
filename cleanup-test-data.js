// Removes test data before the real team starts.
// Usage (stop the server first):
//   node cleanup-test-data.js            -> dry run, shows what would change, writes nothing
//   node cleanup-test-data.js --apply    -> backs up crm-data.json, then makes the changes
//
// Test accounts are BLOCKED, not deleted, so audit history stays readable.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TEST_USERNAMES = ["raj", "abhi", "riya", "priya", "graphic.hod"];
const TEST_SCRIPT_TITLES = [
  "Riya Test Script",
  "Graphic Test Banner",
  "Reel",
  "30-sec TVC — Festival Special Launch"
];

const apply = process.argv.includes("--apply");
const storage = require("./storage");
const uploadsDir = path.join(__dirname, "uploads");

if (!storage.dataExists()) {
  console.log(`${storage.dataLabel()} not found in this folder.`);
  process.exit(1);
}

const db = storage.readData();
const report = [];

// 1. Test accounts: block and randomise the password
const testUsers = db.users.filter(
  (u) => TEST_USERNAMES.includes(u.username.toLowerCase()) && u.active !== false
);
testUsers.forEach((u) => report.push(`Block account: ${u.username} (${u.name})`));
const testUserIds = new Set(db.users.filter((u) => TEST_USERNAMES.includes(u.username.toLowerCase())).map((u) => u.id));

// 2. Test scripts, and the work linked to them
const testScripts = db.scripts.filter((s) => TEST_SCRIPT_TITLES.includes(s.title));
const testScriptIds = new Set(testScripts.map((s) => s.id));
testScripts.forEach((s) => report.push(`Remove script: ${s.title} (${s.id}, stage ${s.status})`));

const testTasks = db.tasks.filter(
  (t) => testScriptIds.has(t.scriptId) || TEST_SCRIPT_TITLES.includes(t.title)
);
testTasks.forEach((t) => report.push(`Remove work: ${t.title} (${t.id}, stage ${t.status})`));

// 3. Files attached to removed scripts or work
const removedRecordIds = new Set([...testScriptIds, ...testTasks.map((t) => t.id)]);
const testFiles = db.files.filter((f) => removedRecordIds.has(f.recordId));
testFiles.forEach((f) => report.push(`Remove file record: ${f.name} (${f.id})`));

// 4. Notifications sent to test accounts (they will not be needed)
const testNotes = db.notifications.filter((n) => testUserIds.has(n.userId));
report.push(`Remove notifications for test accounts: ${testNotes.length}`);

console.log(apply ? "APPLYING CHANGES" : "DRY RUN (no changes will be written)");
console.log("----------------------------------------");
report.forEach((line) => console.log(" - " + line));
console.log("----------------------------------------");
console.log("Audit log entries are kept (history).");

if (!apply) {
  console.log("\nNothing was changed. To apply, run: node cleanup-test-data.js --apply");
  process.exit(0);
}

// Backup first
const backupName = storage.backupData("before-cleanup");
console.log(`\nBackup written: ${backupName}`);

// Apply: block accounts
const now = new Date().toISOString();
for (const u of testUsers) {
  u.active = false;
  u.passwordHash = require("bcryptjs").hashSync(crypto.randomBytes(32).toString("hex"), 10);
  delete u.passwordVault;
  u.passwordVersion = (u.passwordVersion || 0) + 1;
  u.retiredAt = now;
}

// Apply: remove test records
db.scripts = db.scripts.filter((s) => !testScriptIds.has(s.id));
const removedTaskIds = new Set(testTasks.map((t) => t.id));
db.tasks = db.tasks.filter((t) => !removedTaskIds.has(t.id));
db.files = db.files.filter((f) => !removedRecordIds.has(f.recordId));
db.notifications = db.notifications.filter((n) => !testUserIds.has(n.userId));

// Delete the physical files for removed records only
for (const f of testFiles) {
  const p = path.join(uploadsDir, f.storedName);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

storage.writeData(db);

console.log("Done. Start the server with: npm start");
