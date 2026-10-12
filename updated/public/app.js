let token = localStorage.getItem("token");
let user = JSON.parse(localStorage.getItem("user") || "null");
const app = document.getElementById("app");

async function api(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    "Content-Type": "application/json"
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    throw new Error("Server returned invalid JSON");
  }

  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function login() {
  app.innerHTML = `
    <div class="login">
      <div class="card">
        <h1>Vids Production CRM</h1>
        <p>Secure production management</p>
        <input id="loginUsername" placeholder="Username" autocomplete="username">
        <input id="loginPassword" type="password" placeholder="Password" autocomplete="current-password">
        <button onclick="doLogin()">Login</button>
        <p id="loginError"></p>
        <small>Work-only CRM · Video · Graphic · Content</small>
      </div>
    </div>`;
}

async function doLogin() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });

    token = data.token;
    user = data.user;
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    render();
  } catch (error) {
    document.getElementById("loginError").textContent = error.message;
  }
}

async function render() {
  if (!token) return login();

  try {
    const data = await api("/api/auth/me");
    user = data.user;
    localStorage.setItem("user", JSON.stringify(user));
  } catch (_) {
    logout();
    return;
  }

  const admin =
    user.role === "Master Administrator" ||
    user.role === "CMO" ||
    user.department === "Management";

  app.innerHTML = `
    <div class="layout">
      <aside class="side">
        <div class="brand"><div class="brandMark">V</div><h2>Vids Production</h2></div>
        <div class="userBox">
          <b>${escapeHtml(user.name)}</b><br>
          <small>${escapeHtml(user.username)} · ${escapeHtml(user.department)}</small><br><small>${escapeHtml(user.location)} access</small>
        </div>

        <div class="nav" onclick="page('dashboard')">🏠 War Room</div>
        <div class="nav" onclick="page('projects')">🎬 Projects</div>
        <div class="nav" onclick="page('scripts')">📝 Scripts</div>
        <div class="nav" onclick="page('tasks')">⚙️ Work / QC</div>
        <div class="nav" onclick="page('clients')">👥 Clients</div>
        <div class="nav" onclick="page('notifications')">🔔 Notifications</div>
        <div class="nav" onclick="page('chat')">💬 Project Chat</div>
        ${admin ? `
          <div class="nav" onclick="page('users')">👤 Employees</div>
          <div class="nav" onclick="page('audit')">🧾 Audit</div>
        ` : ""}
        <div class="nav" onclick="logout()">🚪 Logout</div>
      </aside>

      <main class="main">
        <div id="content"></div>
      </main>
    </div>`;

  page("dashboard");
}

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  token = null;
  user = null;
  login();
}

async function page(name) {
  const content = document.getElementById("content");
  if (!content) return;
  content.classList.remove("page-enter");
  void content.offsetWidth;
  content.classList.add("page-enter");
  document.querySelectorAll(".nav").forEach(el => el.classList.remove("active"));
  const titles = {dashboard:"War Room",projects:"Projects",scripts:"Scripts",tasks:"Work / QC",clients:"Clients",notifications:"Notifications",chat:"Project Chat",users:"Employees",audit:"Audit"};
  document.querySelectorAll(".nav").forEach(el => { if ((el.textContent||"").includes(titles[name]||"__none__")) el.classList.add("active"); });

  try {
    if (name === "dashboard") await dashboardPage(content);
    if (name === "projects") await projectsPage(content);
    if (name === "scripts") await scriptsPage(content);
    if (name === "tasks") await tasksPage(content);
    if (name === "clients") await clientsPage(content);
    if (name === "notifications") await notificationsPage(content);
    if (name === "users") await usersPage(content);
    if (name === "audit") await auditPage(content);
    if (name === "chat") await chatPage(content);
  } catch (error) {
    content.innerHTML = `<div class="panel"><b>Error:</b> ${escapeHtml(error.message)}</div>`;
  }
}

async function dashboardPage(c) {
  const data = await api("/api/dashboard");
  const s = data.stats || {};

  c.innerHTML = `
    <div class="top">
      <h1>CMO War Room</h1>
      <span class="badge">${escapeHtml(user.location)} access</span>
    </div>

    <div class="grid">
      <div class="stat"><b>Projects</b><h2>${s.projects || 0}</h2></div>
      <div class="stat"><b>Active Projects</b><h2>${s.activeProjects || 0}</h2></div>
      <div class="stat"><b>Open Work</b><h2>${s.pendingTasks || 0}</h2></div>
      <div class="stat"><b>Pending Scripts</b><h2>${s.pendingScripts || 0}</h2></div>
      <div class="stat"><b>Overdue</b><h2>${s.overdue || 0}</h2></div>
    </div>

    <div class="panel">
      <h3>Production Chain</h3>
      <p>Writer → HOD Review → Approval → Editor/Designer → QC → Revision → Final Delivery</p>
    </div>`;
}

async function projectsPage(c) {
  const rows = await api("/api/projects");

  c.innerHTML = `
    <div class="top">
      <h1>Projects</h1>
      <button onclick="newProject()">+ New Project</button>
    </div>
    <div class="panel">
      ${rows.length ? `
      <table class="table">
        <tr><th>Project</th><th>Type</th><th>Status</th><th>Priority</th><th>Location</th><th>Deadline</th></tr>
        ${rows.map(x => `
          <tr onclick="openProject('${x.id}')">
            <td>${escapeHtml(x.name)}</td>
            <td>${escapeHtml(x.projectType)}</td>
            <td>${escapeHtml(x.status)}</td>
            <td>${escapeHtml(x.priority)}</td>
            <td>${escapeHtml(x.location)}</td>
            <td>${escapeHtml(x.dueDate || "-")}</td>
          </tr>`).join("")}
      </table>` : "<p>No projects yet.</p>"}
    </div>`;
}

async function scriptsPage(c) {
  const rows = await api("/api/scripts");

  c.innerHTML = `
    <div class="top">
      <h1>Scripts</h1>
      <button onclick="newScript()">+ New Script</button>
    </div>
    <div class="panel">
      ${rows.length ? `
      <table class="table">
        <tr><th>Title</th><th>Type</th><th>Status</th><th>Location</th><th>Updated</th></tr>
        ${rows.map(x => `
          <tr>
            <td>${escapeHtml(x.title)}</td>
            <td>${escapeHtml(x.type)}</td>
            <td>${escapeHtml(x.status)}</td>
            <td>${escapeHtml(x.location)}</td>
            <td>${escapeHtml(x.updatedAt || x.createdAt)}</td>
          </tr>`).join("")}
      </table>` : "<p>No scripts yet.</p>"}
    </div>`;
}

async function tasksPage(c) {
  const rows = await api("/api/tasks");

  c.innerHTML = `
    <div class="top">
      <h1>Work / QC</h1>
      <button onclick="newTask()">+ Assign Work</button>
    </div>
    <div class="panel">
      ${rows.length ? `
      <table class="table">
        <tr><th>Task</th><th>Department</th><th>Status</th><th>QC</th><th>Assignee</th><th>Deadline</th></tr>
        ${rows.map(x => `
          <tr>
            <td>${escapeHtml(x.title)}</td>
            <td>${escapeHtml(x.department)}</td>
            <td>${escapeHtml(x.status)}</td>
            <td>${escapeHtml(x.qcStatus)}</td>
            <td>${escapeHtml(x.assignedTo || "-")}</td>
            <td>${escapeHtml(x.dueDate || "-")}</td>
          </tr>`).join("")}
      </table>` : "<p>No work assigned.</p>"}
    </div>`;
}

async function clientsPage(c) {
  const rows = await api("/api/clients");

  c.innerHTML = `
    <div class="top">
      <h1>Clients</h1>
      <button onclick="newClient()">+ New Client</button>
    </div>
    <div class="panel">
      ${rows.length ? `
      <table class="table">
        <tr><th>Company</th><th>Contact</th><th>Email</th><th>Phone</th><th>Location</th></tr>
        ${rows.map(x => `
          <tr>
            <td>${escapeHtml(x.company)}</td>
            <td>${escapeHtml(x.contactName || "-")}</td>
            <td>${escapeHtml(x.email || "-")}</td>
            <td>${escapeHtml(x.phone || "-")}</td>
            <td>${escapeHtml(x.location)}</td>
          </tr>`).join("")}
      </table>` : "<p>No clients yet.</p>"}
    </div>`;
}

async function notificationsPage(c) {
  const rows = await api("/api/notifications");

  c.innerHTML = `
    <h1>Notifications</h1>
    <div class="panel">
      ${rows.length ? rows.map(x => `
        <div class="msg">
          <b>${escapeHtml(x.title)}</b>
          <p>${escapeHtml(x.message || "")}</p>
          <small>${escapeHtml(x.createdAt || "")}</small>
          ${!x.read ? `<button onclick="readNotification('${x.id}')">Mark read</button>` : ""}
        </div>`).join("") : "No notifications"}
    </div>`;
}

async function usersPage(c) {
  const rows = await api("/api/users");

  c.innerHTML = `
    <div class="top">
      <h1>Employees</h1>
      <button onclick="newUser()">+ Add Employee</button>
    </div>
    <div class="panel">
      <table class="table">
        <tr><th>Username</th><th>Name</th><th>Department</th><th>Role</th><th>Location</th><th>Active</th></tr>
        ${rows.map(x => `
          <tr>
            <td>${escapeHtml(x.username)}</td>
            <td>${escapeHtml(x.name)}</td>
            <td>${escapeHtml(x.department)}</td>
            <td>${escapeHtml(x.role)}</td>
            <td>${escapeHtml(x.location)}</td>
            <td>${x.active ? "Yes" : "No"}</td>
          </tr>`).join("")}
      </table>
    </div>`;
}

async function auditPage(c) {
  const rows = await api("/api/audit-logs");

  c.innerHTML = `
    <h1>Audit Trail</h1>
    <div class="panel">
      ${rows.length ? `
      <table class="table">
        <tr><th>User</th><th>Action</th><th>Entity</th><th>Time</th></tr>
        ${rows.map(x => `
          <tr>
            <td>${escapeHtml(x.username || "-")}</td>
            <td>${escapeHtml(x.action)}</td>
            <td>${escapeHtml(x.entity)} #${escapeHtml(x.entityId || "")}</td>
            <td>${escapeHtml(x.createdAt)}</td>
          </tr>`).join("")}
      </table>` : "No audit records yet."}
    </div>`;
}

async function chatPage(c) {
  const projects = await api("/api/projects");
  const chats = await api("/api/chats");

  c.innerHTML = `
    <h1>Project Chat</h1>
    <div class="panel">
      <label>Project</label>
      <select id="chatProject">
        <option value="">Select project</option>
        ${projects.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("")}
      </select>
      <button onclick="createProjectChat()">Open / Create Chat</button>
      <div id="chatArea"></div>
    </div>
    <div class="panel">
      <h3>Existing Chats</h3>
      ${chats.length ? chats.map(x => `
        <div class="msg">
          <b>${escapeHtml(x.name)}</b>
          <button onclick="openChat('${x.id}')">Open</button>
        </div>`).join("") : "No chats yet."}
    </div>`;
}

async function createProjectChat() {
  const projectId = document.getElementById("chatProject").value;
  if (!projectId) return alert("Select a project first.");

  const projects = await api("/api/projects");
  const project = projects.find(x => x.id === projectId);
  const existing = (await api("/api/chats")).find(x => x.projectId === projectId);

  if (existing) return openChat(existing.id);

  const chat = await api("/api/chats", {
    method: "POST",
    body: JSON.stringify({
      name: `${project ? project.name : "Project"} Chat`,
      type: "project",
      projectId,
      members: [user.id]
    })
  });

  openChat(chat.id);
}

async function openChat(chatId) {
  const area = document.getElementById("chatArea");
  if (!area) return;

  const rows = await api(`/api/chats/${chatId}/messages`);

  area.innerHTML = `
    <h3>Messages</h3>
    <div class="chat">
      ${rows.length ? rows.map(x => `
        <div class="msg">
          <b>${escapeHtml(x.senderName || "")}</b>
          <p>${escapeHtml(x.message || "")}</p>
          <small>${escapeHtml(x.createdAt || "")}</small>
        </div>`).join("") : "No messages yet."}
    </div>
    <input id="messageBox" placeholder="Type message">
    <button onclick="sendMessage('${chatId}')">Send</button>`;
}

async function sendMessage(chatId) {
  const box = document.getElementById("messageBox");
  const message = box.value.trim();
  if (!message) return;

  await api(`/api/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message })
  });

  openChat(chatId);
}


function toast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

async function newClient() {
  const company = prompt("Company");
  if (!company) return;

  const contactName = prompt("Contact name", "");
  const email = prompt("Email", "");
  const phone = prompt("Phone", "");
  const location = prompt("Location (Ahmedabad/Gandhinagar)", user.location === "All Locations" ? "Ahmedabad" : user.location);

  await api("/api/clients", {
    method: "POST",
    body: JSON.stringify({ company, contactName, email, phone, location })
  });

  toast("Client created successfully");
  page("clients");
}

async function newProject() {
  const name = prompt("Project name");
  if (!name) return;

  const projectType = prompt("Project type: Video or Graphic", "Video");
  const location = prompt("Location", user.location === "All Locations" ? "Ahmedabad" : user.location);
  const dueDate = prompt("Deadline (YYYY-MM-DD)", "");
  const description = prompt("Project description / brief", "");

  await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, projectType, location, dueDate, description })
  });

  toast("Project created successfully");
  page("projects");
}

async function newScript() {
  const title = prompt("Script title");
  if (!title) return;

  const type = prompt("Script type: TVC / Film / Reel / Other", "TVC");
  const content = prompt("Script / content", "");
  const notes = prompt("Notes for HOD", "");
  const location = prompt("Location", user.location === "All Locations" ? "Ahmedabad" : user.location);

  await api("/api/scripts", {
    method: "POST",
    body: JSON.stringify({ title, type, content, notes, location })
  });

  toast("Script submitted to HOD");
  page("scripts");
}

async function newTask() {
  const title = prompt("Work title");
  if (!title) return;

  const type = prompt("Type: Video or Graphic", "Video");
  const instructions = prompt("Instructions", "");
  const dueDate = prompt("Deadline (YYYY-MM-DD)", "");
  const location = prompt("Location", user.location === "All Locations" ? "Ahmedabad" : user.location);

  await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title,
      type,
      instructions,
      dueDate,
      location
    })
  });

  toast("Work assigned");
  page("tasks");
}

async function newUser() {
  const name = prompt("Employee name");
  if (!name) return;

  const username = prompt("Username");
  const password = prompt("Temporary password");
  const email = prompt("Email", "");
  const department = prompt(
    "Department: Management / Video HOD / Graphic HOD / Video Production / Graphic Production / Content Writer",
    "Video Production"
  );
  const role = prompt("Role", "Employee");
  const location = prompt("Location: Ahmedabad / Gandhinagar / All Locations", "Ahmedabad");

  await api("/api/users", {
    method: "POST",
    body: JSON.stringify({
      name,
      username,
      password,
      email,
      department,
      role,
      location
    })
  });

  toast("Employee created");
  page("users");
}

async function readNotification(id) {
  await api(`/api/notifications/${id}/read`, { method: "PATCH" });
  page("notifications");
}

async function openProject(id) {
  const rows = await api("/api/projects");
  const project = rows.find(x => x.id === id);

  if (!project) return;

  document.getElementById("content").innerHTML = `
    <div class="top">
      <h1>${escapeHtml(project.name)}</h1>
      <button onclick="page('projects')">← Back</button>
    </div>
    <div class="panel">
      <p><b>Type:</b> ${escapeHtml(project.projectType)}</p>
      <p><b>Status:</b> ${escapeHtml(project.status)}</p>
      <p><b>Priority:</b> ${escapeHtml(project.priority)}</p>
      <p><b>Location:</b> ${escapeHtml(project.location)}</p>
      <p><b>Deadline:</b> ${escapeHtml(project.dueDate || "-")}</p>
      <p>${escapeHtml(project.description || "")}</p>
      <button onclick="page('chat')">Open Project Chat</button>
    </div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

render();
