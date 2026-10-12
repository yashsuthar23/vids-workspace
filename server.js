const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

// Reads settings from a .env file in this folder, so they do not have to be typed in PowerShell.
// Values already set in the shell take priority over the file.
const ENV_FILE = path.join(__dirname, ".env");
if (fs.existsSync(ENV_FILE)) {
  for (const raw of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
const nodemailer = require("nodemailer");
const { createHash, randomBytes, createHmac } = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const JWT_SECRET =
  process.env.JWT_SECRET || "vids-crm-change-this-secret-in-production";
if (!process.env.JWT_SECRET) {
  console.warn("WARNING: JWT_SECRET is not set. Set it before using real data.");
}

const DATA_FILE = path.join(__dirname, "crm-data.json");
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(express.static(PUBLIC_DIR));

function createInitialData() {
  const passwordHash = process.env.ADMIN_PASSWORD_HASH || "$2a$10$Vpc9RL9n9IpD1AhEOGaOUu6afR43GkkvjRcgkLFn03ZgfVygG2KtC";

  return {
    users: [
      {
        id: "USR-001",
        username: "svapnil",
        passwordHash,
        name: "Svapnil Suthar",
        email: "swapnil.evm@gmail.com",
        role: "Master Administrator",
        department: "Management",
        location: "All Locations",
        active: true,
        createdAt: new Date().toISOString()
      }
    ],

    clients: [],
    leads: [],
    projects: [],
    tasks: [],
    scripts: [],
    chats: [],
    messages: [],
    notifications: [],
    auditLogs: []
  };
}

// Storage: "json" (default, crm-data.json) or "sqlite" (crm.sqlite, set STORAGE=sqlite in .env).
// Run migrate-json-to-sqlite.js once before switching to sqlite.
// Same decision as the helper scripts (storage.js): STORAGE from the environment or .env.
const storage = require("./storage");
const STORAGE = storage.MODE;
const SQLITE_FILE = storage.SQLITE_FILE;
const sqliteStore = STORAGE === "sqlite" ? require("./sqlite-store") : null;
const sqliteDb = sqliteStore ? sqliteStore.openStore(SQLITE_FILE) : null;

if (sqliteStore) {
  const hasUsers = sqliteDb.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0;
  if (!hasUsers && fs.existsSync(DATA_FILE)) {
    console.error(
      "STORAGE=sqlite but crm.sqlite is empty. Run: node migrate-json-to-sqlite.js (then restart)."
    );
    process.exit(1);
  }
}

function loadData() {
  if (sqliteStore) {
    const data = sqliteStore.loadFromStore(sqliteDb);
    if (!data.users || data.users.length === 0) {
      const initial = createInitialData();
      saveData(initial);
      return initial;
    }
    return data;
  }

  if (!fs.existsSync(DATA_FILE)) {
    const data = createInitialData();
    saveData(data);
    return data;
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.error("Could not read crm-data.json:", error.message);

    const backup = `${DATA_FILE}.broken-${Date.now()}`;
    try {
      fs.copyFileSync(DATA_FILE, backup);
    } catch (_) {}

    const data = createInitialData();
    saveData(data);
    return data;
  }
}

function saveData(data) {
  if (sqliteStore) {
    sqliteStore.saveToStore(sqliteDb, data);
    return;
  }

  const tempFile = `${DATA_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(tempFile, DATA_FILE);
}

let db = loadData();

// ----------------------------------------------------
// PASSWORD VAULT: lets administrators see the password they set for an employee.
// Passwords are stored encrypted (AES-256-GCM), never in plain text. The key comes from
// PASSWORD_VAULT_KEY in .env, or is derived from JWT_SECRET if that is not set.
// Login always uses the separate bcrypt hash, so the vault is only for display.
// ----------------------------------------------------
const VAULT_KEY = createHash("sha256")
  .update(`${process.env.PASSWORD_VAULT_KEY || JWT_SECRET}|password-vault`)
  .digest();

function vaultEncrypt(text) {
  const iv = randomBytes(12);
  const cipher = require("crypto").createCipheriv("aes-256-gcm", VAULT_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

function vaultDecrypt(value) {
  try {
    const [iv, tag, enc] = String(value).split(".").map((x) => Buffer.from(x, "base64"));
    const decipher = require("crypto").createDecipheriv("aes-256-gcm", VAULT_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch (_) {
    // Wrong or changed key (for example JWT_SECRET was changed): nothing to show.
    return null;
  }
}

// Moves records saved with the earlier status names onto the production chain.
function migrateWorkflowStatuses() {
  const taskMap = { Assigned: "Editor/Designer", "In Progress": "Editor/Designer", Completed: "Final Delivery", Delivered: "Final Delivery" };
  const scriptMap = { Submitted: "HOD Review", Approved: "Approval" };
  let changed = false;

  for (const task of db.tasks) {
    const next = taskMap[task.status] || (TASK_STAGES.includes(task.status) ? task.status : "Editor/Designer");
    if (next !== task.status) { task.status = next; changed = true; }
  }
  for (const script of db.scripts) {
    const next = scriptMap[script.status] || (SCRIPT_STAGES.includes(script.status) ? script.status : "HOD Review");
    if (next !== script.status) { script.status = next; changed = true; }
  }

  if (changed) saveData(db);
}

// Ensures the admin account is named correctly and retires the old hard-coded account.
// Idempotent: it never resets an existing password.
function ensureAccounts() {
  let changed = false;

  // Rename the original admin record (USR-001) instead of creating a second admin.
  const oldAdmin = db.users.find((u) => u.username.toLowerCase() === "svapnilhodve");
  const newAdminTaken = db.users.some((u) => u.username.toLowerCase() === "svapnil");
  if (oldAdmin && !newAdminTaken) {
    oldAdmin.username = "svapnil";
    changed = true;
  }

  // Optional fixed admin login from .env: ADMIN_USERNAME and ADMIN_PASSWORD.
  // When ADMIN_PASSWORD is set, it is the admin's password on every start, so no reset
  // command is needed. Change the password by editing .env and restarting the server.
  const adminUsername = process.env.ADMIN_USERNAME || "svapnil";
  const fixedPassword = process.env.ADMIN_PASSWORD;
  if (fixedPassword) {
    if (fixedPassword.length < 8) {
      console.warn("WARNING: ADMIN_PASSWORD in .env must be at least 8 characters. It was ignored.");
    } else {
      const admin = db.users.find(
        (u) => u.role === "Master Administrator" && u.username.toLowerCase() === adminUsername.toLowerCase()
      ) || db.users.find((u) => u.username.toLowerCase() === adminUsername.toLowerCase());
      if (admin && !bcrypt.compareSync(fixedPassword, admin.passwordHash)) {
        admin.passwordHash = bcrypt.hashSync(fixedPassword, 10);
        admin.passwordVersion = (admin.passwordVersion || 0) + 1;
        admin.passwordVault = vaultEncrypt(fixedPassword);
        changed = true;
        console.log(`Admin password for "${admin.username}" set from .env (ADMIN_PASSWORD).`);
      }
    }
  }

  // The hard-coded "scommedia" account is retired. Accounts are created only from the
  // Employees form. If the old record still exists, it is blocked and its password is
  // replaced with a random value, so the old password no longer works. The record stays
  // so existing chat membership and audit history keep their references.
  const retired = db.users.find((u) => u.username.toLowerCase() === "scommedia");
  if (retired && (retired.active !== false || retired.retiredAt === undefined)) {
    retired.active = false;
    retired.passwordHash = bcrypt.hashSync(require("crypto").randomBytes(32).toString("hex"), 10);
    retired.passwordVersion = (retired.passwordVersion || 0) + 1;
    retired.retiredAt = new Date().toISOString();
    changed = true;
  }

  if (changed) saveData(db);
}
ensureAccounts();

// Automatic backups: on startup and every 24 hours, copies the data into ./backups
// (crm-data.json or crm.sqlite, depending on STORAGE). Only the 14 newest automatic
// copies are kept. Manual and pre-change backups are never removed by this.
const BACKUP_KEEP = 14;

function backupData() {
  try {
    if (!storage.dataExists()) return;
    storage.backupData("auto");
    const files = fs
      .readdirSync(storage.BACKUP_DIR)
      .filter((name) => /^crm-(data-)?auto-.*\.(json|sqlite)$/.test(name))
      .sort();
    while (files.length > BACKUP_KEEP) {
      fs.unlinkSync(path.join(storage.BACKUP_DIR, files.shift()));
    }
  } catch (error) {
    console.error("Backup failed:", error.message);
  }
}

backupData();
setInterval(backupData, 24 * 60 * 60 * 1000).unref();

function nextId(prefix, collection) {
  // Never reuse an ID: deleting a record must not let a later record take its ID,
  // otherwise old audit entries would appear to belong to the new record.
  if (!db.idSequences) db.idSequences = {};

  let highest = collection.length;
  for (const item of collection) {
    const match = /-(\d+)$/.exec(String(item.id || ""));
    if (match) highest = Math.max(highest, parseInt(match[1], 10));
  }

  const next = Math.max(highest, Number(db.idSequences[prefix]) || 0) + 1;
  db.idSequences[prefix] = next;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    location: user.location,
    active: user.active,
    createdAt: user.createdAt,
    mustChangePassword: user.mustChangePassword === true,
    twoFactorEnabled: user.totpEnabled === true || user.emailOtpEnabled === true,
    twoFactorMethod: user.totpEnabled ? "app" : user.emailOtpEnabled ? "email" : null,
    hasEmail: Boolean(user.email)
  };
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      department: user.department,
      location: user.location,
      pv: user.passwordVersion || 0
    },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Authentication required"
    });
  }

  const token = header.slice(7);

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({
      error: "Invalid or expired token"
    });
  }

  // Use the live account record, not the claims stored in the token. This makes
  // blocks and role changes take effect immediately instead of after token expiry.
  const account = db.users.find((item) => item.id === payload.id);

  if (!account || account.active === false) {
    return res.status(401).json({
      error: "This account is blocked or no longer exists"
    });
  }

  // Sessions from before a password change or reset stop working.
  if ((payload.pv || 0) !== (account.passwordVersion || 0)) {
    return res.status(401).json({
      error: "Your password was changed. Please log in again."
    });
  }

  // Client logins may only use the client portal (and their own auth endpoints).
  const requestPath = req.originalUrl.split("?")[0];
  if (
    account.role === "Client" &&
    !requestPath.startsWith("/api/portal") &&
    !requestPath.startsWith("/api/auth")
  ) {
    return res.status(403).json({
      error: "Client accounts can only use the client portal"
    });
  }

  req.user = {
    id: account.id,
    username: account.username,
    role: account.role,
    department: account.department,
    location: account.location,
    clientId: account.clientId || null
  };

  next();
}

// Admin access is decided by role only. An employee in the "Management" department
// is a normal employee unless their role is one of the administrator roles.
const ADMIN_ROLES = ["Master Administrator", "CMO", "Administrator"];

function isAdmin(user) {
  return !!user && ADMIN_ROLES.includes(user.role);
}

function canAccessLocation(user, location) {
  if (!location) return true;
  if (isAdmin(user)) return true;

  return (
    user.location === "All Locations" ||
    user.location === location
  );
}

function filterByLocation(items, user) {
  if (isAdmin(user) || user.location === "All Locations") {
    return items;
  }

  return items.filter((item) => {
    if (!item.location) return true;
    return item.location === user.location;
  });
}

function addAudit(req, action, entity, entityId, details = {}) {
  db.auditLogs.push({
    id: nextId("AUD", db.auditLogs),
    action,
    entity,
    entityId,
    userId: req.user.id,
    username: req.user.username,
    details,
    createdAt: new Date().toISOString()
  });
}

// ----------------------------------------------------
// ROLE GATE: sales (leads and clients) areas are for administrators only.
// Enforced on the server so hiding menu items is not the only protection.
// ----------------------------------------------------

const ADMIN_ONLY_PREFIXES = [
  "/api/leads",
  "/api/clients"
];

app.use((req, res, next) => {
  const isAdminArea = ADMIN_ONLY_PREFIXES.some(
    (prefix) => req.path === prefix || req.path.startsWith(prefix + "/")
  );

  if (!isAdminArea) return next();

  auth(req, res, () => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({
        error: "This area is available to administrators only"
      });
    }
    next();
  });
});

// ----------------------------------------------------
// HEALTH
// ----------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Vids Production CRM",
    storage: storage.MODE === "sqlite" ? "SQLite" : "JSON",
    node: process.version
  });
});

// ----------------------------------------------------
// AUTH
// ----------------------------------------------------

// Login rate limiting: after 5 failed attempts for the same username from the same IP,
// further attempts are refused for 15 minutes. Kept in memory (resets on server restart).
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFailures = new Map();

function loginKey(req, username) {
  return `${req.ip}|${String(username).toLowerCase()}`;
}

function checkLoginLocked(key) {
  const entry = loginFailures.get(key);
  if (!entry) return 0;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return 0;
  }
  if (entry.count >= LOGIN_MAX_FAILURES) {
    return Math.ceil((entry.first + LOGIN_WINDOW_MS - Date.now()) / 60000);
  }
  return 0;
}

function recordLoginFailure(key) {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: "Username and password are required"
    });
  }

  const key = loginKey(req, username);
  const minutesLeft = checkLoginLocked(key);
  if (minutesLeft > 0) {
    return res.status(429).json({
      error: `Too many failed attempts. Try again in ${minutesLeft} minute(s).`
    });
  }

  const user = db.users.find(
    (item) =>
      item.username.toLowerCase() === String(username).toLowerCase()
  );

  if (!user) {
    recordLoginFailure(key);
    return res.status(401).json({
      error: "Invalid username or password"
    });
  }

  const valid = bcrypt.compareSync(password, user.passwordHash);

  if (!valid) {
    recordLoginFailure(key);
    return res.status(401).json({
      error: "Invalid username or password"
    });
  }

  // Only reached with the correct password, so this does not reveal anything to guessers.
  if (user.active === false) {
    return res.status(403).json({
      error: "This account is blocked. Please contact the administrator."
    });
  }

  if (user.totpEnabled) {
    if (!req.body.otp) {
      return res.json({ requires2fa: true, method: "app" });
    }
    const step = verifyTotp(user.totpSecret, req.body.otp);
    if (step === null || step <= (user.totpLastStep || 0)) {
      recordLoginFailure(key);
      return res.status(401).json({ error: "Invalid verification code" });
    }
    user.totpLastStep = step;
    saveData(db);
  } else if (user.emailOtpEnabled) {
    if (!req.body.otp) {
      // Step 1 of login: send a fresh code to the account email.
      const code = randomCode6();
      user.emailOtpHash = hashToken(code);
      user.emailOtpExpires = new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString();
      user.emailOtpAttempts = 0;
      saveData(db);
      try {
        await sendMail({
          to: user.email,
          subject: "Your Vids CRM sign-in code",
          text: `Hello ${user.name},\n\nYour sign-in code is: ${code}\n\nIt is valid for 10 minutes and works once. If you did not try to sign in, change your password.`
        });
      } catch (error) {
        console.error("Sign-in code email failed:", error.message);
        return res.status(500).json({ error: "Could not send the sign-in code. Please try again." });
      }
      return res.json({ requires2fa: true, method: "email" });
    }

    // Step 2: check the code.
    const valid =
      user.emailOtpHash &&
      user.emailOtpExpires &&
      Date.parse(user.emailOtpExpires) > Date.now() &&
      (user.emailOtpAttempts || 0) < EMAIL_CODE_MAX_ATTEMPTS &&
      hashToken(String(req.body.otp).trim()) === user.emailOtpHash;

    if (!valid) {
      user.emailOtpAttempts = (user.emailOtpAttempts || 0) + 1;
      saveData(db);
      recordLoginFailure(key);
      return res.status(401).json({ error: "The code is wrong or has expired. Request a new one by logging in again." });
    }

    // Single use: the code is removed as soon as it is accepted.
    delete user.emailOtpHash;
    delete user.emailOtpExpires;
    delete user.emailOtpAttempts;
    saveData(db);
  }

  loginFailures.delete(key);

  const token = signToken(user);

  res.json({
    token,
    user: publicUser(user)
  });
});

function passwordProblem(password) {
  if (typeof password !== "string") return "Password must be text";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password.length > 200) return "Password is too long";
  return null;
}

function randomTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = require("crypto").randomBytes(12);
  for (let i = 0; i < 12; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// The signed-in user changes their own password. Requires the current password.
app.post("/api/auth/change-password", auth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = db.users.find((item) => item.id === req.user.id);

  if (!user) return res.status(404).json({ error: "User not found" });
  if (!currentPassword || !bcrypt.compareSync(String(currentPassword), user.passwordHash)) {
    return res.status(400).json({ error: "Current password is incorrect" });
  }

  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: "New password must be different from the current one" });
  }

  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  delete user.passwordVault;
  user.passwordChangedAt = new Date().toISOString();
  user.passwordVersion = (user.passwordVersion || 0) + 1;
  user.mustChangePassword = false;
  addAudit(req, "PASSWORD_CHANGED", "user", user.id, {});
  notifyAdmins(
    "Password changed",
    `${user.name} (${user.username}) changed their own password.`,
    "warning",
    user.id
  );
  saveData(db);

  res.json({ ok: true, token: signToken(user) });
});

// Administrator resets another employee's password. A temporary password is generated
// and shown ONCE to the administrator; the employee must change it at next login.
app.post("/api/users/:id/reset-password", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "Only administrators can reset passwords" });
  }

  const target = db.users.find((item) => item.id === req.params.id);
  if (!target) return res.status(404).json({ error: "Employee not found" });

  const temporary = randomTempPassword();
  target.passwordHash = bcrypt.hashSync(temporary, 10);
  target.passwordVault = vaultEncrypt(temporary);
  target.passwordChangedAt = new Date().toISOString();
  target.passwordVersion = (target.passwordVersion || 0) + 1;
  target.mustChangePassword = true;
  addAudit(req, "PASSWORD_RESET", "user", target.id, { by: req.user.username });
  saveData(db);

  res.json({ ok: true, temporaryPassword: temporary });
});

// Administrators can view the password they set for an employee. Every view is audited
// (the audit entry records who looked, never the password itself).
app.get("/api/users/:id/password", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "Only administrators can view passwords" });
  }

  const target = db.users.find((item) => item.id === req.params.id);
  if (!target) return res.status(404).json({ error: "Employee not found" });
  if (target.role === "Client") return res.status(404).json({ error: "Not an employee account" });
  if (!canAccessLocation(req.user, target.location)) {
    return res.status(403).json({ error: "Location access denied" });
  }
  if (isMasterAdmin(target) && !isMasterAdmin(req.user)) {
    return res.status(403).json({ error: "Only a Master Administrator can view this account" });
  }

  const password = target.passwordVault ? vaultDecrypt(target.passwordVault) : null;
  addAudit(req, "VIEW", "USER_PASSWORD", target.id, { username: target.username });
  saveData(db);

  res.json({ password });
});

app.get("/api/auth/me", auth, (req, res) => {
  const user = db.users.find((item) => item.id === req.user.id);

  if (!user) {
    return res.status(404).json({
      error: "User not found"
    });
  }

  res.json({
    user: publicUser(user)
  });
});

// ----------------------------------------------------
// DASHBOARD
// ----------------------------------------------------

app.get("/api/dashboard", auth, (req, res) => {
  const projects = filterByLocation(db.projects, req.user);
  const tasks = filterByLocation(db.tasks, req.user);
  const scripts = filterByLocation(db.scripts, req.user);

  const today = new Date().toISOString().slice(0, 10);

  res.json({
    stats: {
      projects: projects.length,
      activeProjects: projects.filter(
        (p) => p.status !== "Completed"
      ).length,
      tasks: tasks.length,
      pendingTasks: tasks.filter(
        (t) => t.status !== "Final Delivery"
      ).length,
      scripts: scripts.length,
      pendingScripts: scripts.filter(
        (s) => s.status !== "Approval"
      ).length,
      overdue: tasks.filter(
        (t) =>
          t.dueDate &&
          t.dueDate < today &&
          t.status !== "Final Delivery"
      ).length
    },

    projects,
    tasks,
    scripts
  });
});

// ----------------------------------------------------
// USERS / EMPLOYEES
// ----------------------------------------------------

const EMPLOYEE_DEPARTMENTS = [
  "Management",
  "Video HOD",
  "Graphic HOD",
  "Video Production",
  "Graphic Production",
  "Content Writer"
];

// Gujarat cities offered as suggestions. Any other valid place name can also be typed.
const CITY_LOCATIONS = [
  "Ahmedabad", "Gandhinagar", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar",
  "Junagadh", "Anand", "Nadiad", "Morbi", "Mehsana", "Bharuch", "Vapi", "Navsari",
  "Gandhidham", "Patan", "Bhuj", "Porbandar", "Valsad", "Godhra", "Palanpur",
  "Himatnagar", "Amreli", "Surendranagar", "Botad", "Dahod", "Modasa", "Ankleshwar"
];
const LOCATION_PATTERN = /^[A-Za-z][A-Za-z .'-]{0,39}$/;

// Returns a canonical location name, or null when the text is not a valid location.
function normalizeLocation(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.toLowerCase() === "all locations") return "All Locations";
  const known = CITY_LOCATIONS.find((c) => c.toLowerCase() === text.toLowerCase());
  if (known) return known;
  return LOCATION_PATTERN.test(text) ? text : null;
}

// Location for a new record: the value sent, or the creator's own location when none is sent.
function locationFromBody(body, user) {
  if (body.location === undefined || body.location === null || body.location === "") {
    return user.location;
  }
  return normalizeLocation(body.location);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

function isMasterAdmin(user) {
  return user.role === "Master Administrator";
}

// Validates and normalises employee input. Missing fields on update keep their existing value.
function validateEmployeeInput(body, { existing = null, isCreate = false, actor }) {
  const errors = [];
  const values = {};

  const pick = (key) => {
    if (body[key] !== undefined) return body[key];
    return existing ? existing[key] : undefined;
  };

  const readText = (key, label, { required = false, max = 100 } = {}) => {
    let raw = pick(key);
    if (raw === undefined || raw === null) raw = "";

    if (typeof raw !== "string") {
      errors.push(`${label} must be text`);
      return;
    }

    const value = raw.trim();

    if (!value) {
      if (required) errors.push(`${label} is required`);
      values[key] = "";
      return;
    }

    if (value.length > max) {
      errors.push(`${label} must be ${max} characters or fewer`);
      return;
    }

    values[key] = value;
  };

  readText("name", "Full name", { required: true, max: 100 });
  readText("username", "Username", { required: true, max: 32 });

  if (values.username) {
    if (values.username.length < 3) {
      errors.push("Username must be at least 3 characters");
    } else if (!USERNAME_PATTERN.test(values.username)) {
      errors.push("Username may only contain letters, numbers, dots, dashes and underscores");
    }
  }

  readText("email", "Email", { max: 120 });

  if (values.email && !EMAIL_PATTERN.test(values.email)) {
    errors.push("Enter a valid email address");
  }

  // The role is never taken from the Employees form. New employees are always "Employee",
  // and an existing account keeps its current role. Administrator roles are granted only
  // by the system owner with set-role.js.
  const requestedRole = body.role;
  if (isCreate) {
    values.role = "Employee";
  } else {
    values.role = existing ? existing.role : "Employee";
  }
  if (
    requestedRole !== undefined &&
    requestedRole !== null &&
    requestedRole !== "" &&
    requestedRole !== values.role
  ) {
    errors.push(
      isCreate
        ? "New employees are created with the Employee role"
        : "The role cannot be changed here"
    );
  }

  const department = pick("department");
  if (!EMPLOYEE_DEPARTMENTS.includes(department)) {
    errors.push("Select a valid department");
  } else {
    values.department = department;
  }

  let location = pick("location");
  if (location === undefined || location === null || location === "") {
    location = isCreate ? "Ahmedabad" : "";
  }
  const normalized = normalizeLocation(location);
  if (!normalized) {
    errors.push("Enter a valid location");
  } else {
    values.location = normalized;
  }

  const password = body.password;
  if (password !== undefined && password !== null && password !== "") {
    if (typeof password !== "string") {
      errors.push("Password must be text");
    } else if (password.length < 8) {
      errors.push("Password must be at least 8 characters");
    } else if (password.length > 200) {
      errors.push("Password is too long");
    }
  } else if (isCreate) {
    errors.push("Temporary password is required");
  }

  return { errors, values };
}

function usernameTaken(username, exceptId = null) {
  return db.users.some(
    (user) =>
      user.id !== exceptId &&
      user.username.toLowerCase() === username.toLowerCase()
  );
}

// Treats a field as a reference to a user ID when it equals the ID anywhere in the record.
// "members" and "mentions" are membership lists, not ownership, so they are ignored.
const REFERENCE_IGNORED_KEYS = new Set(["members", "mentions"]);

function containsUserReference(value, userId) {
  if (value === userId) return true;

  if (Array.isArray(value)) {
    return value.some((item) => containsUserReference(item, userId));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, item]) =>
        !REFERENCE_IGNORED_KEYS.has(key) && containsUserReference(item, userId)
    );
  }

  return false;
}

// Counts records that depend on this employee's history. Audit logs, notifications and
// the user list itself are not counted: audit logs keep the username, notifications are personal.
function countLinkedRecords(userId) {
  const skip = new Set(["users", "notifications", "auditLogs"]);
  const counts = {};

  for (const [collection, rows] of Object.entries(db)) {
    if (skip.has(collection) || !Array.isArray(rows)) continue;

    const count = rows.filter((row) => containsUserReference(row, userId)).length;
    if (count) counts[collection] = count;
  }

  return counts;
}

function employeeResponse(user) {
  return publicUser(user);
}

app.get("/api/users", auth, (req, res) => {
  // Administrators and HODs see the employee directory (HODs need it to assign work).
  // Other users see only their own record.
  const users = isHod(req.user)
    ? db.users.filter((user) => user.role !== "Client" && canAccessLocation(req.user, user.location))
    : db.users.filter((user) => user.id === req.user.id);

  res.json(users.map(publicUser));
});

app.post("/api/users", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({
      error: "Only Management/Admin can create users"
    });
  }

  const { errors, values } = validateEmployeeInput(req.body, {
    isCreate: true,
    actor: req.user
  });

  if (errors.length) {
    return res.status(400).json({
      error: "Please correct the highlighted details",
      errors
    });
  }

  if (usernameTaken(values.username)) {
    return res.status(409).json({
      error: "Username already exists",
      errors: ["Username already exists"]
    });
  }

  const user = {
    id: nextId("USR", db.users),
    username: values.username,
    passwordHash: bcrypt.hashSync(req.body.password, 10),
    passwordVault: vaultEncrypt(req.body.password),
    name: values.name,
    email: values.email || "",
    role: values.role,
    department: values.department,
    location: values.location,
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id
  };

  db.users.push(user);

  addAudit(req, "CREATE", "USER", user.id, {
    username: user.username,
    name: user.name,
    department: user.department,
    role: user.role,
    location: user.location
  });

  saveData(db);

  res.status(201).json({
    user: employeeResponse(user)
  });
});

app.patch("/api/users/:id", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({
      error: "Only Management/Admin can update users"
    });
  }

  const user = db.users.find((item) => item.id === req.params.id);

  if (!user) {
    return res.status(404).json({
      error: "User not found"
    });
  }

  if (isMasterAdmin(user) && !isMasterAdmin(req.user)) {
    return res.status(403).json({
      error: "Only a Master Administrator can change this account"
    });
  }

  const { errors, values } = validateEmployeeInput(req.body, {
    existing: user,
    actor: req.user
  });

  if (errors.length) {
    return res.status(400).json({
      error: "Please correct the highlighted details",
      errors
    });
  }

  if (usernameTaken(values.username, user.id)) {
    return res.status(409).json({
      error: "Username already exists",
      errors: ["Username already exists"]
    });
  }

  // Prevent an administrator from removing their own admin access by editing themselves.
  if (user.id === req.user.id && !isAdmin(values)) {
    return res.status(400).json({
      error: "You cannot remove your own administrator access. Ask another administrator to make this change."
    });
  }

  const changed = [];
  ["name", "username", "email", "role", "department", "location"].forEach((field) => {
    if (user[field] !== values[field]) {
      changed.push(field);
      user[field] = values[field];
    }
  });

  if (req.body.password) {
    user.passwordHash = bcrypt.hashSync(req.body.password, 10);
    user.passwordVault = vaultEncrypt(req.body.password);
    changed.push("password");
  }

  user.updatedAt = new Date().toISOString();
  user.updatedBy = req.user.id;

  // Audit records list the changed field names only, never the values of passwords.
  addAudit(req, "UPDATE", "USER", user.id, { changed });

  saveData(db);

  res.json({
    user: employeeResponse(user)
  });
});

app.post("/api/users/:id/block", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({
      error: "Only Management/Admin can block employees"
    });
  }

  const user = db.users.find((item) => item.id === req.params.id);

  if (!user) {
    return res.status(404).json({
      error: "User not found"
    });
  }

  if (user.id === req.user.id) {
    return res.status(400).json({
      error: "You cannot block your own account"
    });
  }

  if (isMasterAdmin(user) && !isMasterAdmin(req.user)) {
    return res.status(403).json({
      error: "Only a Master Administrator can change this account"
    });
  }

  if (user.active === false) {
    return res.status(409).json({
      error: "This employee is already blocked"
    });
  }

  user.active = false;
  user.blockedAt = new Date().toISOString();
  user.blockedBy = req.user.id;

  addAudit(req, "BLOCK", "USER", user.id, { username: user.username });

  saveData(db);

  res.json({
    user: employeeResponse(user)
  });
});

app.post("/api/users/:id/unblock", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({
      error: "Only Management/Admin can unblock employees"
    });
  }

  const user = db.users.find((item) => item.id === req.params.id);

  if (!user) {
    return res.status(404).json({
      error: "User not found"
    });
  }

  if (isMasterAdmin(user) && !isMasterAdmin(req.user)) {
    return res.status(403).json({
      error: "Only a Master Administrator can change this account"
    });
  }

  if (user.active !== false) {
    return res.status(409).json({
      error: "This employee is not blocked"
    });
  }

  user.active = true;
  delete user.blockedAt;
  delete user.blockedBy;

  addAudit(req, "UNBLOCK", "USER", user.id, { username: user.username });

  saveData(db);

  res.json({
    user: employeeResponse(user)
  });
});

app.delete("/api/users/:id", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({
      error: "Only Management/Admin can delete employees"
    });
  }

  const index = db.users.findIndex((item) => item.id === req.params.id);

  if (index < 0) {
    return res.status(404).json({
      error: "User not found"
    });
  }

  const user = db.users[index];

  if (user.id === req.user.id) {
    return res.status(400).json({
      error: "You cannot delete your own account"
    });
  }

  if (isMasterAdmin(user) && !isMasterAdmin(req.user)) {
    return res.status(403).json({
      error: "Only a Master Administrator can change this account"
    });
  }

  const linked = countLinkedRecords(user.id);
  const linkedTotal = Object.values(linked).reduce((sum, n) => sum + n, 0);

  if (linkedTotal > 0) {
    return res.status(409).json({
      error: `${user.name} is linked to ${linkedTotal} existing record(s) (tasks, projects, scripts or other work). They cannot be deleted without losing history. Block the account instead.`,
      linked
    });
  }

  db.users.splice(index, 1);

  // Personal notifications and chat membership are safe to remove with the account.
  db.notifications = db.notifications.filter(
    (item) => item.userId !== user.id
  );

  db.chats.forEach((chat) => {
    if (Array.isArray(chat.members)) {
      chat.members = chat.members.filter((memberId) => memberId !== user.id);
    }
  });

  addAudit(req, "DELETE", "USER", user.id, {
    username: user.username,
    name: user.name
  });

  saveData(db);

  res.json({
    success: true,
    id: user.id
  });
});

// ----------------------------------------------------
// LEADS
// ----------------------------------------------------

app.get("/api/leads", auth, (req, res) => {
  res.json(filterByLocation(db.leads, req.user));
});

app.post("/api/leads", auth, (req, res) => {
  const location = locationFromBody(req.body, req.user);
  if (!location) return res.status(400).json({ error: "Enter a valid location" });

  if (!canAccessLocation(req.user, location)) {
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  const lead = {
    id: nextId("LED", db.leads),
    company: req.body.company || "",
    contactName: req.body.contactName || "",
    email: req.body.email || "",
    phone: req.body.phone || "",
    source: req.body.source || "",
    status: req.body.status || "New",
    notes: req.body.notes || "",
    location,
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };

  db.leads.push(lead);
  addAudit(req, "CREATE", "LEAD", lead.id);

  saveData(db);

  res.status(201).json(lead);
});

// ----------------------------------------------------
// CLIENTS
// ----------------------------------------------------

app.get("/api/clients", auth, (req, res) => {
  res.json(filterByLocation(db.clients, req.user));
});

app.post("/api/clients", auth, (req, res) => {
  const location = locationFromBody(req.body, req.user);
  if (!location) return res.status(400).json({ error: "Enter a valid location" });

  if (!canAccessLocation(req.user, location)) {
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  const client = {
    id: nextId("CLI", db.clients),
    company: req.body.company || "",
    contactName: req.body.contactName || "",
    email: req.body.email || "",
    phone: req.body.phone || "",
    location,
    notes: req.body.notes || "",
    createdAt: new Date().toISOString()
  };

  db.clients.push(client);

  addAudit(req, "CREATE", "CLIENT", client.id);

  saveData(db);

  res.status(201).json(client);
});

// ----------------------------------------------------
// PROJECTS
// ----------------------------------------------------

app.get("/api/projects", auth, (req, res) => {
  res.json(filterByLocation(db.projects, req.user));
});

app.post("/api/projects", auth, (req, res) => {
  // Projects, scripts and tasks have no location field: admins create shared items (no location),
  // other users create items in their own location.
  const sharedItem = req.user.location === "All Locations" && !req.body.location;
  const location = sharedItem ? null : locationFromBody(req.body, req.user);
  if (!sharedItem && !location) {
    return res.status(400).json({ error: "Enter a valid location" });
  }

  if (!canAccessLocation(req.user, location)) {
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  const project = {
    id: nextId("PRJ", db.projects),
    name: req.body.name || "Untitled Project",
    clientId: req.body.clientId || null,
    projectType: req.body.projectType || "Video",
    status: req.body.status || "Planning",
    priority: req.body.priority || "Normal",
    location,
    description: req.body.description || "",
    dueDate: req.body.dueDate || "",
    assignedTo: req.body.assignedTo || null,
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };

  db.projects.push(project);

  addAudit(req, "CREATE", "PROJECT", project.id);

  saveData(db);

  res.status(201).json(project);
});

// ----------------------------------------------------
// SCRIPTS
// ----------------------------------------------------

app.get("/api/scripts", auth, (req, res) => {
  res.json(filterByLocation(db.scripts, req.user));
});

app.post("/api/scripts", auth, (req, res) => {
  // Projects, scripts and tasks have no location field: admins create shared items (no location),
  // other users create items in their own location.
  const sharedItem = req.user.location === "All Locations" && !req.body.location;
  const location = sharedItem ? null : locationFromBody(req.body, req.user);
  if (!sharedItem && !location) {
    return res.status(400).json({ error: "Enter a valid location" });
  }

  if (!canAccessLocation(req.user, location)) {
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  const script = {
    id: nextId("SCR", db.scripts),
    title: req.body.title || "Untitled Script",
    projectId: req.body.projectId || null,
    type: req.body.type || "TVC",
    content: req.body.content || "",
    referenceFiles: req.body.referenceFiles || [],
    notes: req.body.notes || "",
    status: "HOD Review",
    writerId: req.user.id,
    hodId: req.body.hodId || null,
    location,
    feedback: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.scripts.push(script);

  addAudit(req, "CREATE", "SCRIPT", script.id);

  saveData(db);

  res.status(201).json(script);
});

app.patch("/api/scripts/:id", auth, (req, res) => {
  const script = db.scripts.find((item) => item.id === req.params.id);
  if (!script) return res.status(404).json({ error: "Script not found" });

  if (!canAccessLocation(req.user, script.location)) {
    return res.status(403).json({ error: "Location access denied" });
  }

  const contentFields = ["title", "type", "content", "notes", "referenceFiles", "hodId"];

  // Editing the text is for the writer while the script is with them, or for the HOD.
  const changingContent = contentFields.some((field) => req.body[field] !== undefined);
  const writerOwnsDraft =
    script.writerId === req.user.id && ["Writer", "Revision"].includes(script.status);
  if (changingContent && !isHod(req.user) && !writerOwnsDraft) {
    return res.status(403).json({
      error: "Only the writer (while the script is with them) or the HOD can edit this script"
    });
  }

  if (req.body.status !== undefined && req.body.status !== script.status) {
    const problem = scriptMoveError(req.user, script, req.body.status);
    if (problem) return res.status(403).json({ error: problem });
    script.status = req.body.status;
  }

  contentFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      script[field] = req.body[field];
    }
  });

  if (req.body.feedback) {
    script.feedback.push({
      id: nextId("FDB", script.feedback),
      userId: req.user.id,
      username: req.user.username,
      message: req.body.feedback,
      createdAt: new Date().toISOString()
    });
  }

  script.updatedAt = new Date().toISOString();

  addAudit(req, "UPDATE", "SCRIPT", script.id, {
    status: script.status
  });

  saveData(db);

  res.json(script);
});

// ----------------------------------------------------
// PRODUCTION CHAIN
// Writer -> HOD Review -> Approval -> Editor/Designer -> QC -> Revision -> Final Delivery
// Scripts move through: Writer, HOD Review, Approval, Revision (sent back to the writer).
// Work (tasks) starts at Editor/Designer and moves through QC, Revision and Final Delivery.
// ----------------------------------------------------
const SCRIPT_STAGES = ["Writer", "HOD Review", "Approval", "Revision"];
const SCRIPT_MOVES = {
  Writer: ["HOD Review"],
  Revision: ["HOD Review"],
  "HOD Review": ["Approval", "Revision"],
  Approval: []
};
const TASK_STAGES = ["Editor/Designer", "QC", "Revision", "Final Delivery"];
const TASK_MOVES = {
  "Editor/Designer": ["QC"],
  QC: ["Revision", "Final Delivery"],
  Revision: ["QC", "Final Delivery"],
  "Final Delivery": []
};

// Runs once the stage lists above exist.
migrateWorkflowStatuses();

// HODs and administrators run the review, approval, QC and work assignment steps.
function isHod(user) {
  return isAdmin(user) || ["Video HOD", "Graphic HOD"].includes(user.department);
}

// Returns an error message when the user may not move the script to the given stage.
function scriptMoveError(user, script, to) {
  if (!(SCRIPT_MOVES[script.status] || []).includes(to)) {
    return `A script cannot move from "${script.status}" to "${to}"`;
  }
  // The writer may send their own script to HOD review (first submit or resubmit).
  if (to === "HOD Review" && script.writerId === user.id) return null;
  if (isHod(user)) return null;
  return "Only the writer (to submit) or the HOD (to review) can move this script";
}

// Returns an error message when the user may not move the work to the given stage.
function taskMoveError(user, task, to) {
  if (!(TASK_MOVES[task.status] || []).includes(to)) {
    return `Work cannot move from "${task.status}" to "${to}"`;
  }
  if (isHod(user)) return null;
  // The assigned editor or designer sends finished work to QC.
  if (to === "QC" && task.assignedTo === user.id) return null;
  return "Only the HOD or an administrator can move work to this stage";
}

// ----------------------------------------------------
// TASKS / ASSIGNMENTS
// ----------------------------------------------------

app.get("/api/tasks", auth, (req, res) => {
  let tasks = filterByLocation(db.tasks, req.user);

  if (!isAdmin(req.user)) {
    tasks = tasks.filter(
      (task) =>
        task.assignedTo === req.user.id ||
        task.createdBy === req.user.id ||
        task.hodId === req.user.id ||
        task.assignedBy === req.user.id
    );
  }

  res.json(tasks);
});

app.post("/api/tasks", auth, (req, res) => {
  // Only the HOD or an administrator assigns work.
  if (!isHod(req.user)) {
    return res.status(403).json({ error: "Only the HOD or an administrator can assign work" });
  }

  // Projects, scripts and tasks have no location field: admins create shared items (no location),
  // other users create items in their own location.
  const sharedItem = req.user.location === "All Locations" && !req.body.location;
  const location = sharedItem ? null : locationFromBody(req.body, req.user);
  if (!sharedItem && !location) {
    return res.status(400).json({ error: "Enter a valid location" });
  }

  if (!canAccessLocation(req.user, location)) {
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  const assignee = db.users.find(
    (u) => u.id === req.body.assignedTo && u.role !== "Client" && u.active !== false
  );
  if (!assignee) {
    return res.status(400).json({ error: "Choose the editor or designer for this work" });
  }

  let script = null;
  if (req.body.scriptId) {
    script = db.scripts.find((item) => item.id === req.body.scriptId);
    if (!script) return res.status(400).json({ error: "Script not found" });
    if (script.status !== "Approval") {
      return res.status(400).json({ error: "Work can only be assigned for an approved script" });
    }
  }

  const task = {
    id: nextId("TSK", db.tasks),
    projectId: req.body.projectId || null,
    scriptId: script ? script.id : null,
    title: req.body.title || (script ? script.title : "Untitled Task"),
    type: req.body.type || "Video",
    department:
      req.body.department ||
      (req.body.type === "Graphic"
        ? "Graphic Production"
        : "Video Production"),
    // New work always starts at the first production stage.
    status: "Editor/Designer",
    priority: req.body.priority || "Normal",
    assignedTo: assignee.id,
    assignedBy: req.user.id,
    hodId: req.body.hodId || req.user.id,
    location,
    instructions: req.body.instructions || "",
    referenceFiles: req.body.referenceFiles || [],
    dueDate: req.body.dueDate || "",
    qcStatus: "Pending",
    revisionNotes: [],
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.tasks.push(task);

  addAudit(req, "CREATE", "TASK", task.id);

  saveData(db);

  res.status(201).json(task);
});

app.patch("/api/tasks/:id", auth, (req, res) => {
  const task = db.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  if (!canAccessLocation(req.user, task.location)) {
    return res.status(403).json({ error: "Location access denied" });
  }

  // Changing the details of the work (who it is for, deadline, instructions) is for the HOD.
  const detailFields = ["title", "priority", "assignedTo", "instructions", "referenceFiles", "dueDate", "qcStatus"];
  const changingDetails = detailFields.some((field) => req.body[field] !== undefined);
  if (changingDetails && !isHod(req.user)) {
    return res.status(403).json({ error: "Only the HOD or an administrator can change the details of this work" });
  }

  if (req.body.status !== undefined && req.body.status !== task.status) {
    const problem = taskMoveError(req.user, task, req.body.status);
    if (problem) return res.status(403).json({ error: problem });
    task.status = req.body.status;
  }

  detailFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      task[field] = req.body[field];
    }
  });

  if (req.body.revisionNote) {
    task.revisionNotes.push({
      id: nextId("REV", task.revisionNotes),
      userId: req.user.id,
      username: req.user.username,
      note: req.body.revisionNote,
      createdAt: new Date().toISOString()
    });
  }

  task.updatedAt = new Date().toISOString();

  addAudit(req, "UPDATE", "TASK", task.id, {
    status: task.status,
    qcStatus: task.qcStatus
  });

  saveData(db);

  res.json(task);
});

// ----------------------------------------------------
// CHAT
// ----------------------------------------------------

app.get("/api/chats", auth, (req, res) => {
  const chats = db.chats.filter((chat) =>
    canAccessLocation(req.user, chat.location)
  );

  res.json(chats);
});

app.post("/api/chats", auth, (req, res) => {
  const location = locationFromBody(req.body, req.user);
  if (!location) return res.status(400).json({ error: "Enter a valid location" });

  if (!canAccessLocation(req.user, location)) {
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  const chat = {
    id: nextId("CHT", db.chats),
    name: req.body.name || "Project Chat",
    type: req.body.type || "project",
    projectId: req.body.projectId || null,
    location,
    members: req.body.members || [req.user.id],
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };

  db.chats.push(chat);

  saveData(db);

  res.status(201).json(chat);
});

app.get("/api/chats/:chatId/messages", auth, (req, res) => {
  const chat = db.chats.find(
    (item) => item.id === req.params.chatId
  );

  if (!chat) {
    return res.status(404).json({
      error: "Chat not found"
    });
  }

  if (!canAccessLocation(req.user, chat.location)) {
    return res.status(403).json({ error: "Location access denied" });
  }
  if (!isAdmin(req.user) && !chat.members.includes(req.user.id)) {
    return res.status(403).json({ error: "You are not a member of this chat" });
  }

  res.json(
    db.messages.filter((message) => message.chatId === req.params.chatId)
  );
});

app.post("/api/chats/:chatId/messages", auth, (req, res) => {
  const chat = db.chats.find(
    (item) => item.id === req.params.chatId
  );

  if (!chat) {
    return res.status(404).json({
      error: "Chat not found"
    });
  }

  if (!canAccessLocation(req.user, chat.location)) {
    return res.status(403).json({ error: "Location access denied" });
  }
  if (!isAdmin(req.user) && !chat.members.includes(req.user.id)) {
    return res.status(403).json({ error: "You are not a member of this chat" });
  }

  if (!req.body.message && !req.body.fileUrl) {
    return res.status(400).json({
      error: "Message or file is required"
    });
  }

  const message = {
    id: nextId("MSG", db.messages),
    chatId: chat.id,
    senderId: req.user.id,
    senderName: req.user.username,
    message: req.body.message || "",
    fileUrl: req.body.fileUrl || "",
    fileName: req.body.fileName || "",
    mentions: req.body.mentions || [],
    createdAt: new Date().toISOString()
  };

  db.messages.push(message);

  saveData(db);

  res.status(201).json(message);
});

// ----------------------------------------------------
// NOTIFICATIONS
// ----------------------------------------------------

app.get("/api/notifications", auth, (req, res) => {
  res.json(
    db.notifications.filter(
      (notification) =>
        notification.userId === req.user.id
    )
  );
});

// Administrators send notifications to one employee, or to everyone ("ALL").
const NOTIFICATION_TYPES = ["info", "warning", "success", "holiday", "leave", "work"];

app.post("/api/notifications", auth, async (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "Only administrators can send notifications" });
  }

  const { userId, title, message, type } = req.body || {};
  const cleanTitle = String(title || "").trim().slice(0, 120);
  const cleanMessage = String(message || "").trim().slice(0, 1000);
  if (!cleanTitle) return res.status(400).json({ error: "Enter a title" });

  let recipients;
  if (userId === "ALL") {
    recipients = db.users.filter(
      (u) => u.role !== "Client" && u.active !== false && canAccessLocation(req.user, u.location)
    );
  } else {
    const one = db.users.find((u) => u.id === userId && u.role !== "Client");
    if (!one) return res.status(404).json({ error: "Employee not found" });
    recipients = [one];
  }
  if (!recipients.length) return res.status(400).json({ error: "No employees to send to" });

  const now = new Date().toISOString();
  const created = recipients.map((u) => ({
    id: nextId("NTF", db.notifications),
    userId: u.id,
    title: cleanTitle,
    message: cleanMessage,
    type: NOTIFICATION_TYPES.includes(type) ? type : "info",
    read: false,
    createdAt: now,
    sentBy: req.user.username
  }));
  created.forEach((n) => db.notifications.push(n));

  addAudit(req, "CREATE", "NOTIFICATION", created[0].id, { recipients: created.length, title: cleanTitle });
  saveData(db);

  // Live: push to anyone who has the CRM open right now.
  created.forEach((n) => pushNotification(n.userId, n));

  // Optional email copy, one email per employee who has an address.
  let emailed = 0;
  let emailFailed = 0;
  let noEmail = 0;
  if ((req.body || {}).alsoEmail === true) {
    for (const u of recipients) {
      if (!u.email) {
        noEmail += 1;
        continue;
      }
      try {
        await sendMail({
          to: u.email,
          subject: `Vids CRM: ${cleanTitle}`,
          text: `${cleanMessage || cleanTitle}\n\nSent by ${req.user.username}. Open the CRM for details.`
        });
        emailed += 1;
      } catch (error) {
        emailFailed += 1;
        console.error("Notification email failed:", error.message);
      }
    }
  }

  res.status(201).json({ sent: created.length, emailed, emailFailed, noEmail });
});

// ----------------------------------------------------
// LIVE NOTIFICATIONS (Server-Sent Events). The page keeps one connection open and gets new items instantly.
// ----------------------------------------------------
const notificationStreams = new Map(); // userId -> Set of open responses

// Sends a system notification to every active administrator, except the account that
// caused the event. Used for security events such as an employee changing their password.
function notifyAdmins(title, message, type, excludeUserId = null) {
  const now = new Date().toISOString();
  const admins = db.users.filter(
    (u) => isAdmin(u) && u.active !== false && u.id !== excludeUserId
  );

  for (const admin of admins) {
    const note = {
      id: nextId("NTF", db.notifications),
      userId: admin.id,
      title,
      message,
      type: NOTIFICATION_TYPES.includes(type) ? type : "warning",
      read: false,
      createdAt: now,
      sentBy: "SYSTEM"
    };
    db.notifications.push(note);
    pushNotification(admin.id, note);
  }
}

function pushNotification(userId, payload) {
  const set = notificationStreams.get(userId);
  if (!set) return;
  const data = `event: notification\ndata: ${JSON.stringify(payload)}\n\n`;
  set.forEach((res) => res.write(data));
}

app.get("/api/notifications/stream", auth, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("retry: 5000\n\n");

  const set = notificationStreams.get(req.user.id) || new Set();
  set.add(res);
  notificationStreams.set(req.user.id, set);

  // Keeps the connection alive through routers and proxies.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    set.delete(res);
    if (set.size === 0) notificationStreams.delete(req.user.id);
  });
});

app.patch("/api/notifications/:id/read", auth, (req, res) => {
  const notification = db.notifications.find(
    (item) =>
      item.id === req.params.id &&
      item.userId === req.user.id
  );

  if (!notification) {
    return res.status(404).json({
      error: "Notification not found"
    });
  }

  notification.read = true;

  saveData(db);

  res.json(notification);
});

// ----------------------------------------------------
// CRM WORKFLOW EXTENSIONS: CRUD, lead conversion
// ----------------------------------------------------
const editableCollections = {
  leads: { prefix: "LED", entity: "LEAD", fields: ["company","contactName","email","phone","source","status","notes","location"] },
  clients: { prefix: "CLI", entity: "CLIENT", fields: ["company","contactName","email","phone","location","notes"] },
  projects: { prefix: "PRJ", entity: "PROJECT", fields: ["name","clientId","projectType","status","priority","location","description","dueDate","assignedTo"] }
};
for (const [route, config] of Object.entries(editableCollections)) {
  app.patch(`/api/${route}/:id`, auth, (req, res) => {
    const rows = db[route];
    const item = rows.find(x => x.id === req.params.id);
    if (!item) return res.status(404).json({ error: `${config.entity} not found` });
    if (!canAccessLocation(req.user, item.location)) return res.status(403).json({ error: "Location access denied" });
    if (req.body.location && !canAccessLocation(req.user, req.body.location)) return res.status(403).json({ error: "Location access denied" });
    for (const field of config.fields) if (Object.prototype.hasOwnProperty.call(req.body, field)) item[field] = req.body[field];
    item.updatedAt = new Date().toISOString();
    addAudit(req, "UPDATE", config.entity, item.id);
    saveData(db);
    res.json(item);
  });
  app.delete(`/api/${route}/:id`, auth, (req, res) => {
    const rows = db[route];
    const index = rows.findIndex(x => x.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: `${config.entity} not found` });
    if (!canAccessLocation(req.user, rows[index].location)) return res.status(403).json({ error: "Location access denied" });
    if (route === "clients" || route === "leads") {
      if (!isAdmin(req.user)) return res.status(403).json({ error: "Only an administrator can delete this record" });
    }
    if (route === "clients") {
      const linkedProjects = db.projects.filter(p => p.clientId === rows[index].id).length;
      if (linkedProjects > 0) {
        return res.status(409).json({ error: `This client has ${linkedProjects} project(s). Delete or reassign them first.` });
      }
    }
    if (route === "projects") {
      if (!isAdmin(req.user)) return res.status(403).json({ error: "Only an administrator can delete a project" });
      const linkedWork = db.tasks.filter(t => t.projectId === rows[index].id).length;
      const linkedScripts = db.scripts.filter(sc => sc.projectId === rows[index].id).length;
      if (linkedWork + linkedScripts > 0) {
        return res.status(409).json({ error: `This project has ${linkedWork} work item(s) and ${linkedScripts} script(s) linked to it. Delete or move them first.` });
      }
    }
    const [removed] = rows.splice(index, 1);
    const filesRemoved = removeFilesFor(route, removed.id);
    addAudit(req, "DELETE", config.entity, removed.id, { name: removed.name || removed.company || "", files: filesRemoved });
    saveData(db);
    res.json({ success: true, id: removed.id });
  });
}

// Removes the attached files of a record: the file records and the stored files on disk.
function removeFilesFor(recordType, recordId) {
  const attached = db.files.filter((f) => f.recordType === recordType && f.recordId === recordId);
  for (const f of attached) {
    try {
      const p = path.join(UPLOAD_DIR, f.storedName);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (_) {
      // A file that cannot be removed does not block the delete; the record is what matters.
    }
  }
  db.files = db.files.filter((f) => !(f.recordType === recordType && f.recordId === recordId));
  return attached.length;
}

// HOD or administrator deletes a script. Blocked while work is still linked to it.
app.delete("/api/scripts/:id", auth, (req, res) => {
  if (!isHod(req.user)) {
    return res.status(403).json({ error: "Only the HOD or an administrator can delete a script" });
  }
  const index = db.scripts.findIndex((x) => x.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Script not found" });
  const script = db.scripts[index];
  if (!canAccessLocation(req.user, script.location)) return res.status(403).json({ error: "Location access denied" });

  const linkedWork = db.tasks.filter((t) => t.scriptId === script.id).length;
  if (linkedWork > 0) {
    return res.status(409).json({ error: `This script has ${linkedWork} work item(s) linked to it. Delete the work first.` });
  }

  const [removed] = db.scripts.splice(index, 1);
  const filesRemoved = removeFilesFor("scripts", removed.id);
  addAudit(req, "DELETE", "SCRIPT", removed.id, { title: removed.title, files: filesRemoved });
  saveData(db);
  res.json({ success: true, id: removed.id });
});

// HOD or administrator deletes a work item (and its attached files).
app.delete("/api/tasks/:id", auth, (req, res) => {
  if (!isHod(req.user)) {
    return res.status(403).json({ error: "Only the HOD or an administrator can delete work" });
  }
  const index = db.tasks.findIndex((x) => x.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Work item not found" });
  const task = db.tasks[index];
  if (!canAccessLocation(req.user, task.location)) return res.status(403).json({ error: "Location access denied" });

  const [removed] = db.tasks.splice(index, 1);
  const filesRemoved = removeFilesFor("tasks", removed.id);
  addAudit(req, "DELETE", "TASK", removed.id, { title: removed.title, files: filesRemoved });
  saveData(db);
  res.json({ success: true, id: removed.id });
});

app.post("/api/leads/:id/convert", auth, (req, res) => {
  const lead = db.leads.find(x => x.id === req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (!canAccessLocation(req.user, lead.location)) return res.status(403).json({ error: "Location access denied" });
  if (lead.convertedClientId) return res.status(409).json({ error: "Lead has already been converted", clientId: lead.convertedClientId });
  const client = { id: nextId("CLI", db.clients), company: lead.company || lead.contactName || "New Client", contactName: lead.contactName || "", email: lead.email || "", phone: lead.phone || "", location: lead.location, notes: lead.notes || `Converted from ${lead.id}`, sourceLeadId: lead.id, createdAt: new Date().toISOString() };
  db.clients.push(client);
  lead.status = "Won";
  lead.convertedClientId = client.id;
  lead.updatedAt = new Date().toISOString();
  addAudit(req, "CONVERT", "LEAD", lead.id, { clientId: client.id });
  saveData(db);
  res.status(201).json({ lead, client });
});

app.get("/api/search", auth, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (q.length < 2) return res.json([]);

  // Leads and clients are administrator-only, so regular users do not see them.
  const types = ["projects", "tasks"].concat(isAdmin(req.user) ? ["leads", "clients"] : []);
  const results = [];

  for (const type of types) {
    for (const item of filterByLocation(db[type] || [], req.user)) {
      const haystack = Object.values(item)
        .filter((v) => typeof v === "string" || typeof v === "number")
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) continue;

      results.push({
        type: type.slice(0, -1),
        id: item.id,
        label: item.company || item.name || item.title || item.id,
        status: item.status || "",
        location: item.location || ""
      });
      if (results.length >= 100) return res.json(results);
    }
  }

  res.json(results);
});

// ----------------------------------------------------
// AUDIT LOG
// ----------------------------------------------------

app.get("/api/audit-logs", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({
      error: "Only Management/Admin can view audit logs"
    });
  }

  res.json(db.auditLogs);
});

// ----------------------------------------------------
// CATCH-ALL
// ----------------------------------------------------

// ----------------------------------------------------
// FILE ATTACHMENTS (tasks, projects, scripts)
// ----------------------------------------------------
const UPLOAD_DIR = path.join(__dirname, "uploads");
const UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
const UPLOAD_ALLOWED_EXT = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".mov", ".mp3",
  ".wav", ".zip", ".ai", ".psd"
]);
const ATTACHABLE = { tasks: "TASK", projects: "PROJECT", scripts: "SCRIPT" };
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!Array.isArray(db.files)) db.files = [];

// Same visibility rules as the list endpoints: location first, then assignment for regular users on tasks.
function canSeeAttachable(user, type, record) {
  if (!record) return false;
  if (!canAccessLocation(user, record.location)) return false;
  if (type === "tasks" && !isAdmin(user)) {
    return [record.assignedTo, record.createdBy, record.hodId, record.assignedBy].includes(user.id);
  }
  return true;
}

function publicFile(file, user) {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    recordType: file.recordType,
    recordId: file.recordId,
    uploadedBy: file.uploadedBy,
    uploadedByName: file.uploadedByName,
    createdAt: file.createdAt,
    canDelete: isAdmin(user) || file.uploadedBy === user.id
  };
}

app.get("/api/files", auth, (req, res) => {
  const { recordType, recordId } = req.query;
  const record = ATTACHABLE[recordType] ? (db[recordType] || []).find((x) => x.id === recordId) : null;
  if (!canSeeAttachable(req.user, recordType, record)) {
    return res.status(404).json({ error: "Record not found" });
  }
  res.json(
    db.files
      .filter((f) => f.recordType === recordType && f.recordId === recordId)
      .map((f) => publicFile(f, req.user))
  );
});

app.post("/api/files", auth, (req, res) => {
  const { recordType, recordId, name, data } = req.body || {};
  if (!ATTACHABLE[recordType]) {
    return res.status(400).json({ error: "Files can be attached to tasks, projects or scripts only" });
  }

  const record = (db[recordType] || []).find((x) => x.id === recordId);
  if (!canSeeAttachable(req.user, recordType, record)) {
    return res.status(404).json({ error: "Record not found" });
  }

  const originalName = path.basename(String(name || "").trim()).slice(0, 150);
  const ext = path.extname(originalName).toLowerCase();
  if (!originalName || !UPLOAD_ALLOWED_EXT.has(ext)) {
    return res.status(400).json({ error: "This file type is not allowed" });
  }

  if (typeof data !== "string" || !data) {
    return res.status(400).json({ error: "No file data received" });
  }

  const buffer = Buffer.from(data.replace(/^data:[^,]*,/, ""), "base64");
  if (!buffer.length) return res.status(400).json({ error: "The file is empty" });
  if (buffer.length > UPLOAD_MAX_BYTES) {
    return res.status(413).json({ error: "The file is larger than 12 MB" });
  }

  const id = nextId("FIL", db.files);
  // The stored name is built from the generated ID, never from the user's file name.
  fs.writeFileSync(path.join(UPLOAD_DIR, `${id}${ext}`), buffer);

  const file = {
    id,
    name: originalName,
    size: buffer.length,
    recordType,
    recordId,
    storedName: `${id}${ext}`,
    uploadedBy: req.user.id,
    uploadedByName: req.user.name,
    createdAt: new Date().toISOString()
  };
  db.files.push(file);

  addAudit(req, "CREATE", "FILE", id, { recordType, recordId, name: originalName });
  saveData(db);

  res.status(201).json(publicFile(file, req.user));
});

app.get("/api/files/:id/download", auth, (req, res) => {
  const file = db.files.find((f) => f.id === req.params.id);
  if (!file) return res.status(404).json({ error: "File not found" });

  const record = (db[file.recordType] || []).find((x) => x.id === file.recordId);
  if (!canSeeAttachable(req.user, file.recordType, record)) {
    return res.status(404).json({ error: "File not found" });
  }

  const fullPath = path.join(UPLOAD_DIR, path.basename(file.storedName));
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "File is missing on the server" });

  res.download(fullPath, file.name);
});

app.delete("/api/files/:id", auth, (req, res) => {
  const index = db.files.findIndex((f) => f.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "File not found" });

  const file = db.files[index];
  if (!isAdmin(req.user) && file.uploadedBy !== req.user.id) {
    return res.status(403).json({ error: "Only the uploader or an administrator can delete this file" });
  }

  const [removed] = db.files.splice(index, 1);
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(removed.storedName)));
  } catch (_) {}

  addAudit(req, "DELETE", "FILE", removed.id, { recordType: removed.recordType, recordId: removed.recordId });
  saveData(db);
  res.json({ success: true, id: removed.id });
});

// ----------------------------------------------------
// EMPLOYEE REPORT (administrators only)
// ----------------------------------------------------
app.get("/api/reports/employees", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "Only administrators can view reports" });
  }

  const today = new Date().toISOString().slice(0, 10);
  const doneStatuses = ["Final Delivery"];
  const tasks = filterByLocation(db.tasks, req.user);
  const scripts = filterByLocation(db.scripts, req.user);

  const rows = db.users
    .filter((u) => u.role !== "Client" && canAccessLocation(req.user, u.location))
    .map((u) => {
      const mine = tasks.filter((t) => t.assignedTo === u.id);
      const open = mine.filter((t) => !doneStatuses.includes(t.status));
      const written = scripts.filter((s) => s.writerId === u.id);

      return {
        id: u.id,
        name: u.name,
        username: u.username,
        department: u.department,
        location: u.location,
        active: u.active !== false,
        tasksAssigned: mine.length,
        tasksCompleted: mine.length - open.length,
        tasksOpen: open.length,
        tasksOverdue: open.filter((t) => t.dueDate && String(t.dueDate).slice(0, 10) < today).length,
        revisionRequests: mine.reduce((n, t) => n + (t.revisionNotes || []).length, 0),
        scriptsSubmitted: written.length,
        scriptsApproved: written.filter((s) => s.status === "Approval").length
      };
    });

  res.json(rows);
});

// ----------------------------------------------------
// EMAIL (password reset). Uses SMTP when SMTP_HOST is set; otherwise writes to outbox/.
// ----------------------------------------------------
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const OUTBOX_DIR = path.join(__dirname, "outbox");
const mailTransport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    })
  : null;

async function sendMail({ to, subject, text }) {
  if (mailTransport) {
    return mailTransport.sendMail({
      from: process.env.SMTP_FROM || "Vids CRM <no-reply@localhost>",
      to,
      subject,
      text
    });
  }
  // Development fallback: nothing is emailed; the message is saved so the link can be read.
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUTBOX_DIR, `${Date.now()}-${randomBytes(3).toString("hex")}.txt`),
    `To: ${to}\nSubject: ${subject}\n\n${text}\n`
  );
  console.warn("SMTP_HOST is not set. Email saved to outbox/ instead of being sent.");
}

// ----------------------------------------------------
// TWO-FACTOR SIGN-IN (TOTP, RFC 6238: 6 digits, 30 seconds, SHA-1)
// ----------------------------------------------------
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of String(text).toUpperCase().replace(/[\s=]/g, "")) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totpCode(secretBuffer, step) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const hash = createHmac("sha1", secretBuffer).update(message).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    (hash[offset + 1] << 16) |
    (hash[offset + 2] << 8) |
    hash[offset + 3];
  return String(binary % 1000000).padStart(6, "0");
}

// Returns the matching time step, or null. Allows one step either side for clock drift.
function verifyTotp(secretBase32, code) {
  const text = String(code || "").replace(/\s/g, "");
  if (!secretBase32 || !/^\d{6}$/.test(text)) return null;

  const secret = base32Decode(secretBase32);
  const now = Math.floor(Date.now() / 1000 / 30);
  for (const step of [now - 1, now, now + 1]) {
    if (totpCode(secret, step) === text) return step;
  }
  return null;
}

app.post("/api/auth/2fa/setup", auth, (req, res) => {
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.totpEnabled) {
    return res.status(409).json({ error: "Two-factor sign-in is already on. Turn it off first." });
  }

  // Reuse a key that was already issued, so the key in the authenticator app never goes stale.
  const secret = user.totpPendingSecret || base32Encode(randomBytes(20));
  if (user.totpPendingSecret !== secret) {
    user.totpPendingSecret = secret;
    saveData(db);
  }

  const issuer = encodeURIComponent("Vids CRM");
  res.json({
    secret,
    otpauth: `otpauth://totp/${issuer}:${encodeURIComponent(user.username)}?secret=${secret}&issuer=${issuer}`
  });
});

// Email codes: the user confirms with a code sent to their email, then it is used at every sign-in.
app.post("/api/auth/2fa/email/start", auth, async (req, res) => {
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.email) {
    return res.status(400).json({ error: "Add an email address to your account first (ask the administrator)." });
  }
  if (user.emailOtpEnabled) {
    return res.status(409).json({ error: "Email code sign-in is already on." });
  }

  const code = randomCode6();
  user.emailSetupHash = hashToken(code);
  user.emailSetupExpires = new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString();
  saveData(db);
  try {
    await sendMail({
      to: user.email,
      subject: "Confirm email sign-in for Vids CRM",
      text: `Hello ${user.name},\n\nYour confirmation code is: ${code}\n\nIt is valid for 10 minutes. If you did not ask for this, ignore this email.`
    });
  } catch (error) {
    console.error("Email set-up code failed:", error.message);
    return res.status(500).json({ error: "Could not send the code. Check the email settings." });
  }
  res.json({ sentTo: maskEmail(user.email) });
});

app.post("/api/auth/2fa/email/confirm", auth, (req, res) => {
  const user = db.users.find((item) => item.id === req.user.id);
  const code = String((req.body || {}).code || "").trim();
  const valid =
    user &&
    user.emailSetupHash &&
    user.emailSetupExpires &&
    Date.parse(user.emailSetupExpires) > Date.now() &&
    hashToken(code) === user.emailSetupHash;
  if (!valid) {
    return res.status(400).json({ error: "The code is wrong or has expired. Request a new code." });
  }

  user.emailOtpEnabled = true;
  delete user.emailSetupHash;
  delete user.emailSetupExpires;
  addAudit(req, "UPDATE", "USER", user.id, { twoFactor: "email code enabled" });
  saveData(db);
  res.json({ success: true, twoFactorEnabled: true });
});

app.post("/api/auth/2fa/email/disable", auth, (req, res) => {
  const user = db.users.find((item) => item.id === req.user.id);
  const password = (req.body || {}).password;
  if (!user || !user.emailOtpEnabled) {
    return res.status(400).json({ error: "Email code sign-in is not on" });
  }
  if (typeof password !== "string" || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(400).json({ error: "Current password is incorrect" });
  }

  user.emailOtpEnabled = false;
  delete user.emailOtpHash;
  delete user.emailOtpExpires;
  delete user.emailOtpAttempts;
  addAudit(req, "UPDATE", "USER", user.id, { twoFactor: "email code disabled" });
  saveData(db);
  res.json({ success: true, twoFactorEnabled: false });
});

// Throws away an unfinished set-up so the next set-up creates a brand-new key.
app.post("/api/auth/2fa/cancel", auth, (req, res) => {
  const user = db.users.find((item) => item.id === req.user.id);
  if (user && user.totpPendingSecret) {
    delete user.totpPendingSecret;
    saveData(db);
  }
  res.json({ success: true });
});

app.post("/api/auth/2fa/enable", auth, (req, res) => {
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user || !user.totpPendingSecret) {
    return res.status(400).json({ error: "Start the set-up first" });
  }

  const step = verifyTotp(user.totpPendingSecret, (req.body || {}).code);
  if (step === null) {
    return res.status(400).json({
      error: "The code is not correct. Check that you entered this key in the app, that the app shows the newest code, and that your phone's date and time are set automatically."
    });
  }

  user.totpSecret = user.totpPendingSecret;
  delete user.totpPendingSecret;
  user.totpEnabled = true;
  user.totpLastStep = step;
  addAudit(req, "UPDATE", "USER", user.id, { twoFactor: "enabled" });
  saveData(db);
  res.json({ success: true, twoFactorEnabled: true });
});

app.post("/api/auth/2fa/disable", auth, (req, res) => {
  const user = db.users.find((item) => item.id === req.user.id);
  const { password, code } = req.body || {};
  if (!user || !user.totpEnabled) {
    return res.status(400).json({ error: "Two-factor sign-in is not on" });
  }
  if (typeof password !== "string" || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(400).json({ error: "Current password is incorrect" });
  }
  if (verifyTotp(user.totpSecret, code) === null) {
    return res.status(400).json({ error: "Enter a valid code from your authenticator app" });
  }

  user.totpEnabled = false;
  delete user.totpSecret;
  delete user.totpLastStep;
  addAudit(req, "UPDATE", "USER", user.id, { twoFactor: "disabled" });
  saveData(db);
  res.json({ success: true, twoFactorEnabled: false });
});

// Administrator help for someone who lost their phone.
app.post("/api/users/:id/reset-2fa", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "Only administrators can reset two-factor sign-in" });
  }
  const target = db.users.find((item) => item.id === req.params.id);
  if (!target) return res.status(404).json({ error: "Employee not found" });

  delete target.totpSecret;
  delete target.totpPendingSecret;
  delete target.totpLastStep;
  target.totpEnabled = false;
  target.emailOtpEnabled = false;
  delete target.emailOtpHash;
  delete target.emailOtpExpires;
  delete target.emailOtpAttempts;
  addAudit(req, "UPDATE", "USER", target.id, { twoFactor: "reset by administrator" });
  saveData(db);
  res.json({ success: true });
});

// ----------------------------------------------------
// PASSWORD RESET BY EMAIL
// ----------------------------------------------------
const forgotRequests = new Map();
const FORGOT_MAX_REQUESTS = 5;
const FORGOT_WINDOW_MS = 15 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const GENERIC_RESET_MESSAGE = "If that email belongs to an active account, a reset link has been sent.";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;

function randomCode6() {
  return String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, "0");
}

function maskEmail(email) {
  const [name, domain] = String(email).split("@");
  return `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
}

app.post("/api/auth/forgot", async (req, res) => {
  const now = Date.now();
  const entry = forgotRequests.get(req.ip);
  if (entry && now - entry.first < FORGOT_WINDOW_MS && entry.count >= FORGOT_MAX_REQUESTS) {
    return res.status(429).json({ error: "Too many reset requests. Try again in 15 minutes." });
  }
  if (!entry || now - entry.first >= FORGOT_WINDOW_MS) {
    forgotRequests.set(req.ip, { count: 1, first: now });
  } else {
    entry.count += 1;
  }

  const email = String((req.body || {}).email || "").trim().toLowerCase();
  const user = EMAIL_PATTERN.test(email)
    ? db.users.find((u) => (u.email || "").toLowerCase() === email && u.active !== false)
    : null;

  if (user) {
    const token = randomBytes(32).toString("hex");
    user.resetTokenHash = hashToken(token);
    user.resetExpires = new Date(now + RESET_TTL_MS).toISOString();
    saveData(db);

    try {
      await sendMail({
        to: user.email,
        subject: "Reset your Vids CRM password",
        text: `Hello ${user.name},\n\nUse this link to choose a new password. It works once and expires in 30 minutes:\n${APP_URL}/#reset=${token}\n\nIf you did not ask for this, you can ignore this email.`
      });
    } catch (error) {
      console.error("Password reset email failed:", error.message);
    }
  }

  // Same answer whether or not the email exists.
  res.json({ message: GENERIC_RESET_MESSAGE });
});

app.post("/api/auth/reset", (req, res) => {
  const { token, newPassword } = req.body || {};

  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: "This reset link is not valid" });
  }

  const hash = hashToken(token);
  const user = db.users.find(
    (u) => u.resetTokenHash === hash && u.resetExpires && Date.parse(u.resetExpires) > Date.now()
  );
  if (!user) {
    return res.status(400).json({ error: "This reset link is invalid or has expired. Request a new one." });
  }

  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  delete user.passwordVault;
  user.passwordChangedAt = new Date().toISOString();
  user.passwordVersion = (user.passwordVersion || 0) + 1;
  user.mustChangePassword = false;
  delete user.resetTokenHash;
  delete user.resetExpires;
  notifyAdmins(
    "Password reset by email",
    `${user.name} (${user.username}) reset their password using the email link.`,
    "warning",
    user.id
  );
  saveData(db);

  res.json({ success: true });
});

// ----------------------------------------------------
// CLIENT PORTAL
// ----------------------------------------------------

// Administrators create a login for a client company.
app.post("/api/clients/:id/portal", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: "Only administrators can create client logins" });
  }

  const client = db.clients.find((item) => item.id === req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });
  if (!canAccessLocation(req.user, client.location)) {
    return res.status(403).json({ error: "Location access denied" });
  }
  if (client.portalUserId && db.users.some((u) => u.id === client.portalUserId)) {
    return res.status(409).json({ error: "This client already has a login" });
  }

  const { username, password } = req.body || {};
  if (typeof username !== "string" || username.length < 3 || username.length > 32 || !USERNAME_PATTERN.test(username)) {
    return res.status(400).json({ error: "Username must be 3 to 32 letters, numbers, dots, dashes or underscores" });
  }
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "That username is already taken" });
  }
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  const user = {
    id: nextId("USR", db.users),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    name: client.contactName || client.company,
    email: client.email || "",
    role: "Client",
    department: "Client",
    location: client.location || "Ahmedabad",
    active: true,
    clientId: client.id,
    mustChangePassword: true,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  client.portalUserId = user.id;

  addAudit(req, "CREATE", "CLIENT_LOGIN", user.id, { clientId: client.id, username });
  saveData(db);
  res.status(201).json(publicUser(user));
});

function clientOnly(req, res) {
  if (req.user.role !== "Client") {
    res.status(403).json({ error: "The client portal is only for client logins" });
    return false;
  }
  return true;
}

app.get("/api/portal/summary", auth, (req, res) => {
  if (!clientOnly(req, res)) return;

  const client = db.clients.find((c) => c.id === req.user.clientId);
  if (!client) return res.status(404).json({ error: "Client record not found" });

  const projects = db.projects
    .filter((p) => p.clientId === client.id)
    .map((p) => ({
      id: p.id,
      name: p.name,
      projectType: p.projectType || "",
      status: p.status || "",
      dueDate: p.dueDate || ""
    }));

  res.json({
    client: {
      company: client.company,
      contactName: client.contactName || "",
      email: client.email || "",
      phone: client.phone || ""
    },
    projects
  });
});

// Unknown API paths return JSON 404 instead of the HTML page.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ----------------------------------------------------
// ERROR HANDLER
// ----------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    error: "Internal server error"
  });
});

// ----------------------------------------------------
// START
// ----------------------------------------------------

app.listen(PORT, () => {
  console.log("");
  console.log("==============================================");
  console.log("       VIDS PRODUCTION CRM");
  console.log("==============================================");
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Storage: ${sqliteStore ? SQLITE_FILE + " (SQLite)" : DATA_FILE + " (JSON)"}`);
  console.log(`Node: ${process.version}`);
  console.log("");
  console.log("Admin login:");
  console.log("Username: svapnil");
  console.log("Use the password configured during setup.");
  console.log("==============================================");
  console.log("");
});