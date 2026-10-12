// Sets a new password for an existing account without deleting any data.
// Usage (stop the server first):
//   node reset-password.js svapnil "NewPassword123"
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const [, , username, newPassword] = process.argv;

if (!username || !newPassword) {
  console.log('Usage: node reset-password.js <username> "<new password>"');
  process.exit(1);
}
if (newPassword.length < 8) {
  console.log("The new password must be at least 8 characters.");
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

// Keep a copy of the data before changing anything.
const backupName = storage.backupData("before-password-reset");

user.passwordHash = bcrypt.hashSync(newPassword, 10);
delete user.passwordVault;
user.passwordChangedAt = new Date().toISOString();
user.passwordVersion = (user.passwordVersion || 0) + 1;
user.mustChangePassword = false;
delete user.resetTokenHash;
delete user.resetExpires;

storage.writeData(db);

console.log(`Password updated for ${user.username}.`);
console.log(`Backup of the old data: ${backupName}`);
