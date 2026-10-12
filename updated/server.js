const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const JWT_SECRET =
  process.env.JWT_SECRET || "vids-crm-change-this-secret-in-production";

const DATA_FILE = path.join(__dirname, "crm-data.json");
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(express.static(PUBLIC_DIR));

function createInitialData() {
  const passwordHash = bcrypt.hashSync("ChangeMe123!", 10);

  return {
    users: [
      {
        id: "USR-001",
        username: "admin",
        passwordHash,
        name: "Master Administrator",
        email: "",
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
    invoices: [],
    quotations: [],
    payments: [],
    auditLogs: []
  };
}

function loadData() {
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
  const tempFile = `${DATA_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(tempFile, DATA_FILE);
}

let db = loadData();

function nextId(prefix, collection) {
  return `${prefix}-${String(collection.length + 1).padStart(4, "0")}`;
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
    createdAt: user.createdAt
  };
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      department: user.department,
      location: user.location
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

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({
      error: "Invalid or expired token"
    });
  }
}

function isAdmin(user) {
  return (
    user.role === "Master Administrator" ||
    user.role === "CMO" ||
    user.department === "Management"
  );
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
// HEALTH
// ----------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Vids Production CRM",
    storage: "JSON",
    node: process.version
  });
});

// ----------------------------------------------------
// AUTH
// ----------------------------------------------------

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: "Username and password are required"
    });
  }

  const user = db.users.find(
    (item) =>
      item.username.toLowerCase() === String(username).toLowerCase() &&
      item.active !== false
  );

  if (!user) {
    return res.status(401).json({
      error: "Invalid username or password"
    });
  }

  const valid = bcrypt.compareSync(password, user.passwordHash);

  if (!valid) {
    return res.status(401).json({
      error: "Invalid username or password"
    });
  }

  const token = signToken(user);

  res.json({
    token,
    user: publicUser(user)
  });
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
        (t) => !["Completed", "Delivered"].includes(t.status)
      ).length,
      scripts: scripts.length,
      pendingScripts: scripts.filter(
        (s) => s.status !== "Approved"
      ).length,
      overdue: tasks.filter(
        (t) =>
          t.dueDate &&
          t.dueDate < today &&
          !["Completed", "Delivered"].includes(t.status)
      ).length
    },

    projects,
    tasks,
    scripts
  });
});

// ----------------------------------------------------
// USERS
// ----------------------------------------------------

app.get("/api/users", auth, (req, res) => {
  let users = db.users.filter((user) =>
    canAccessLocation(req.user, user.location)
  );

  res.json(users.map(publicUser));
});

app.post("/api/users", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({
      error: "Only Management/Admin can create users"
    });
  }

  const {
    username,
    password,
    name,
    email = "",
    role = "Employee",
    department = "",
    location = "Ahmedabad"
  } = req.body;

  if (!username || !password || !name) {
    return res.status(400).json({
      error: "username, password and name are required"
    });
  }

  if (
    db.users.some(
      (user) =>
        user.username.toLowerCase() === username.toLowerCase()
    )
  ) {
    return res.status(409).json({
      error: "Username already exists"
    });
  }

  const user = {
    id: nextId("USR", db.users),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    name,
    email,
    role,
    department,
    location,
    active: true,
    createdAt: new Date().toISOString()
  };

  db.users.push(user);

  addAudit(req, "CREATE", "USER", user.id, {
    username: user.username,
    department,
    location
  });

  saveData(db);

  res.status(201).json({
    user: publicUser(user)
  });
});

app.patch("/api/users/:id", auth, (req, res) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({
      error: "Only Management/Admin can update users"
    });
  }

  const user = db.users.find(
    (item) => item.id === req.params.id
  );

  if (!user) {
    return res.status(404).json({
      error: "User not found"
    });
  }

  const allowed = [
    "name",
    "email",
    "role",
    "department",
    "location",
    "active"
  ];

  allowed.forEach((key) => {
    if (req.body[key] !== undefined) {
      user[key] = req.body[key];
    }
  });

  if (req.body.password) {
    user.passwordHash = bcrypt.hashSync(req.body.password, 10);
  }

  addAudit(req, "UPDATE", "USER", user.id, req.body);

  saveData(db);

  res.json({
    user: publicUser(user)
  });
});

// ----------------------------------------------------
// LEADS
// ----------------------------------------------------

app.get("/api/leads", auth, (req, res) => {
  res.json(filterByLocation(db.leads, req.user));
});

app.post("/api/leads", auth, (req, res) => {
  const location = req.body.location || req.user.location;

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
  const location = req.body.location || req.user.location;

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
  const location = req.body.location || req.user.location;

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
  const location = req.body.location || req.user.location;

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
    status: "Submitted",
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
  const script = db.scripts.find(
    (item) => item.id === req.params.id
  );

  if (!script) {
    return res.status(404).json({
      error: "Script not found"
    });
  }

  if (!canAccessLocation(req.user, script.location)) {
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  const fields = [
    "title",
    "content",
    "notes",
    "status",
    "hodId",
    "referenceFiles"
  ];

  fields.forEach((field) => {
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
  const location = req.body.location || req.user.location;

  if (!canAccessLocation(req.user, location)) {
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  const task = {
    id: nextId("TSK", db.tasks),
    projectId: req.body.projectId || null,
    scriptId: req.body.scriptId || null,
    title: req.body.title || "Untitled Task",
    type: req.body.type || "Video",
    department:
      req.body.department ||
      (req.body.type === "Graphic"
        ? "Graphic Production"
        : "Video Production"),
    status: req.body.status || "Assigned",
    priority: req.body.priority || "Normal",
    assignedTo: req.body.assignedTo || null,
    assignedBy: req.user.id,
    hodId: req.body.hodId || req.user.id,
    location,
    instructions: req.body.instructions || "",
    referenceFiles: req.body.referenceFiles || [],
    dueDate: req.body.dueDate || "",
    qcStatus: req.body.qcStatus || "Pending",
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
  const task = db.tasks.find(
    (item) => item.id === req.params.id
  );

  if (!task) {
    return res.status(404).json({
      error: "Task not found"
    });
  }

  if (!canAccessLocation(req.user, task.location)) {
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  const fields = [
    "title",
    "status",
    "priority",
    "assignedTo",
    "instructions",
    "referenceFiles",
    "dueDate",
    "qcStatus"
  ];

  fields.forEach((field) => {
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
  const location = req.body.location || req.user.location;

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
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  res.json(
    db.messages.filter(
      (message) => message.chatId === req.params.chatId
    )
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
    return res.status(403).json({
      error: "Location access denied"
    });
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

app.post("/api/notifications", auth, (req, res) => {
  const notification = {
    id: nextId("NTF", db.notifications),
    userId: req.body.userId,
    title: req.body.title || "Notification",
    message: req.body.message || "",
    type: req.body.type || "info",
    read: false,
    createdAt: new Date().toISOString()
  };

  db.notifications.push(notification);

  saveData(db);

  res.status(201).json(notification);
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
// QUOTATIONS
// ----------------------------------------------------

app.get("/api/quotations", auth, (req, res) => {
  res.json(filterByLocation(db.quotations, req.user));
});

app.post("/api/quotations", auth, (req, res) => {
  const location = req.body.location || req.user.location;

  if (!canAccessLocation(req.user, location)) {
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  const quotation = {
    id: nextId("QUO", db.quotations),
    quotationNumber:
      req.body.quotationNumber ||
      `QUO-${new Date().getFullYear()}-${String(
        db.quotations.length + 1
      ).padStart(4, "0")}`,
    clientId: req.body.clientId || null,
    projectId: req.body.projectId || null,
    amount: Number(req.body.amount || 0),
    status: req.body.status || "Draft",
    location,
    notes: req.body.notes || "",
    createdAt: new Date().toISOString()
  };

  db.quotations.push(quotation);

  saveData(db);

  res.status(201).json(quotation);
});

// ----------------------------------------------------
// INVOICES
// ----------------------------------------------------

app.get("/api/invoices", auth, (req, res) => {
  res.json(filterByLocation(db.invoices, req.user));
});

app.post("/api/invoices", auth, (req, res) => {
  const location = req.body.location || req.user.location;

  if (!canAccessLocation(req.user, location)) {
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  const invoice = {
    id: nextId("INV", db.invoices),
    invoiceNumber:
      req.body.invoiceNumber ||
      `INV-${new Date().getFullYear()}-${String(
        db.invoices.length + 1
      ).padStart(4, "0")}`,
    clientId: req.body.clientId || null,
    projectId: req.body.projectId || null,
    amount: Number(req.body.amount || 0),
    status: req.body.status || "Unpaid",
    location,
    notes: req.body.notes || "",
    createdAt: new Date().toISOString()
  };

  db.invoices.push(invoice);

  saveData(db);

  res.status(201).json(invoice);
});

// ----------------------------------------------------
// PAYMENTS
// ----------------------------------------------------

app.get("/api/payments", auth, (req, res) => {
  res.json(filterByLocation(db.payments, req.user));
});

app.post("/api/payments", auth, (req, res) => {
  const location = req.body.location || req.user.location;

  if (!canAccessLocation(req.user, location)) {
    return res.status(403).json({
      error: "Location access denied"
    });
  }

  const payment = {
    id: nextId("PAY", db.payments),
    invoiceId: req.body.invoiceId || null,
    clientId: req.body.clientId || null,
    amount: Number(req.body.amount || 0),
    method: req.body.method || "",
    status: req.body.status || "Received",
    location,
    notes: req.body.notes || "",
    receivedAt:
      req.body.receivedAt || new Date().toISOString()
  };

  db.payments.push(payment);

  const invoice = db.invoices.find(
    (item) => item.id === payment.invoiceId
  );

  if (invoice) {
    const received = db.payments
      .filter((item) => item.invoiceId === invoice.id)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    invoice.status =
      received >= Number(invoice.amount || 0)
        ? "Paid"
        : "Partially Paid";
  }

  saveData(db);

  res.status(201).json(payment);
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
  console.log(`Storage: ${DATA_FILE}`);
  console.log(`Node: ${process.version}`);
  console.log("");
  console.log("Demo login:");
  console.log("Username: admin");
  console.log("Password: ChangeMe123!");
  console.log("==============================================");
  console.log("");
});