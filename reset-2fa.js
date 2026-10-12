// Turns OFF two-factor sign-in for one account. Use this only if the phone with the
// authenticator app is lost. Stop the server first.
// Usage: node reset-2fa.js <username>
const storage = require("./storage");

const [, , username] = process.argv;
if (!username) {
  console.log("Usage: node reset-2fa.js <username>");
  process.exit(1);
}
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
if (!user.totpEnabled && !user.emailOtpEnabled) {
  console.log(`Two-factor sign-in is already off for ${user.username}.`);
  process.exit(0);
}

const backupName = storage.backupData("before-2fa-reset");

user.totpEnabled = false;
delete user.totpSecret;
delete user.totpPendingSecret;
delete user.totpLastStep;
user.emailOtpEnabled = false;
delete user.emailOtpHash;
delete user.emailOtpExpires;
delete user.emailOtpAttempts;
user.passwordVersion = (user.passwordVersion || 0) + 1; // signs the account out everywhere

storage.writeData(db);

console.log(`Two-factor sign-in is now off for ${user.username}. They sign in with the password only.`);
console.log(`Backup of the old data: ${backupName}`);
console.log("Ask them to turn two-factor sign-in on again from the Security page.");
