// Sets the role of an existing account. This is the only way to grant administrator
// access, because the Employees form always creates employees with the Employee role.
// Usage (stop the server first):
//   node set-role.js <username> <Employee|Administrator|CMO|Master Administrator>
const fs = require("fs");
const path = require("path");

const ALLOWED_ROLES = ["Employee", "Administrator", "CMO", "Master Administrator"];
const [, , username, role] = process.argv;

if (!username || !role) {
  console.log('Usage: node set-role.js <username> "<role>"');
  console.log("Roles: " + ALLOWED_ROLES.join(", "));
  process.exit(1);
}
if (!ALLOWED_ROLES.includes(role)) {
  console.log(`Unknown role "${role}". Allowed roles: ${ALLOWED_ROLES.join(", ")}`);
  process.exit(1);
}

const storage = require("./storage");
if (!storage.dataExists()) {
  console.log(`${storage.dataLabel()} not found in this folder.`);
  process.exit(1);
}

const db = storage.readData();
const user = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
if (!user) {
  console.log(`No account named "${username}". Check the spelling.`);
  process.exit(1);
}
if (user.role === "Client") {
  console.log("Client logins cannot be given an employee or admin role.");
  process.exit(1);
}

const backupName = storage.backupData("before-role-change");

const previous = user.role;
user.role = role;
user.passwordVersion = (user.passwordVersion || 0) + 1; // signs the account out everywhere, so the new role applies at once

storage.writeData(db);

console.log(`Role for ${user.username} changed: ${previous} -> ${role}.`);
console.log(`Backup of the old data: ${backupName}`);
