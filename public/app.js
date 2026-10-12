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

  if (!response.ok) {
    const error = new Error(data.error || "Request failed");
    error.details = Array.isArray(data.errors) ? data.errors : [];
    throw error;
  }
  return data;
}



// Must match server.js ADMIN_ROLES. Department does not grant admin access.
const ADMIN_ROLES = ["Master Administrator", "CMO", "Administrator"];

function isAdminUser(u) {
  return !!u && ADMIN_ROLES.includes(u.role);
}

// Pages that only administrators may open (the server enforces the same for the data behind them).
const ADMIN_ONLY_PAGES = ["clients", "leads", "users", "audit", "reports"];

const ADMIN_NAV = [
  ["dashboard", "🏠 War Room"],
  ["projects", "🎬 Projects"],
  ["scripts", "📝 Scripts"],
  ["tasks", "⚙️ Work / QC"],
  ["clients", "👥 Clients"],
  ["leads", "🎯 Leads Pipeline"],
  ["notifications", "🔔 Notifications"],
  ["chat", "💬 Project Chat"],
  ["users", "👤 Employees"],
  ["reports", "📊 Employee Reports"],
  ["audit", "🧾 Audit"],
  ["security", "🔐 Security"]
];

const CLIENT_NAV = [
  ["portal", "🏠 My Portal"],
  ["security", "🔐 Security"]
];

const USER_NAV = [
  ["dashboard", "🏠 My Workspace"],
  ["projects", "🎬 Projects"],
  ["scripts", "📝 Scripts"],
  ["tasks", "⚙️ Work / QC"],
  ["notifications", "🔔 Notifications"],
  ["chat", "💬 Project Chat"],
  ["security", "🔐 Security"]
];

async function render() {
  // Password reset link from email: #reset=TOKEN
  if (location.hash.startsWith("#reset=")) {
    return showReset(location.hash.slice("#reset=".length));
  }

  if (!token) return login();

  try {
    const data = await api("/api/auth/me");
    user = data.user;
    localStorage.setItem("user", JSON.stringify(user));
  } catch (_) {
    logout();
    return;
  }

  const admin = isAdminUser(user);
  const isClient = user.role === "Client";
  const navItems = isClient ? CLIENT_NAV : admin ? ADMIN_NAV : USER_NAV;

  app.innerHTML = `
    <div class="layout">
      <aside class="side">
        <div class="brand">
          <div class="brandMark">V</div>
          <div>
            <h2>Vids Production</h2>
            <div class="brandSub">${isClient ? "Client Portal" : admin ? "Admin Console" : "My Workspace"}</div>
          </div>
        </div>
        <div class="userBox">
          <b>${escapeHtml(user.name)}</b><br>
          <small>${escapeHtml(user.username)} · ${escapeHtml(user.department)}</small><br><small>${escapeHtml(user.location)} access</small>
        </div>

        ${navItems.map(([key, label]) => `<div class="nav" data-page="${key}" onclick="page('${key}')">${label}</div>`).join("")}
        <div class="nav" onclick="logout()">🚪 Logout</div>
      </aside>

      <main class="main">
        <div id="content"></div>
      </main>
    </div>`;

  page(isClient ? "portal" : "dashboard");
  if (!isClient) startLiveNotifications();
}

function logout() {
  stopLiveNotifications();
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  token = null;
  user = null;
  login();
}

async function page(name) {
  const content = document.getElementById("content");
  if (!content) return;

  if (user && user.role === "Client" && !["portal", "security"].includes(name)) name = "portal";

  if (!isAdminUser(user) && ADMIN_ONLY_PAGES.includes(name)) {
    content.innerHTML = `<div class="top"><h1>Access restricted</h1></div><div class="panel"><p>This area is available to administrators only. Use the menu to open your workspace pages.</p></div>`;
    return;
  }

  content.classList.remove("page-enter");
  void content.offsetWidth;
  content.classList.add("page-enter");
  document.querySelectorAll(".nav").forEach(el => el.classList.toggle("active", el.dataset.page === name));

  try {
    if (name === "dashboard") await dashboardPage(content);
    if (name === "projects") await projectsPage(content);
    if (name === "scripts") await scriptsPage(content);
    if (name === "tasks") await tasksPage(content);
    if (name === "clients") await clientsPage(content);
    if (name === "leads") await leadsPage(content);
    if (name === "notifications") await notificationsPage(content);
    if (name === "users") await usersPage(content);
    if (name === "reports") await reportsPage(content);
    if (name === "portal") await clientPortalPage(content);
    if (name === "security") await securityPage(content);
    if (name === "audit") await auditPage(content);
    if (name === "chat") await chatPage(content);
  } catch (error) {
    content.innerHTML = `<div class="panel"><b>Error:</b> ${escapeHtml(error.message)}</div>`;
  }
}

async function myWorkspacePage(c) {
  const [tasks, scripts] = await Promise.all([api("/api/tasks"), api("/api/scripts")]);
  const today = new Date().toISOString().slice(0, 10);
  const doneStatuses = ["Final Delivery"];

  const openWork = tasks.filter(t => !doneStatuses.includes(t.status));
  const overdue = openWork.filter(t => t.dueDate && String(t.dueDate).slice(0, 10) < today);
  const myScripts = scripts.filter(s => s.writerId === user.id || s.hodId === user.id);
  const pendingScripts = myScripts.filter(s => s.status !== "Approval");

  c.innerHTML = `
    <div class="top">
      <h1>My Workspace</h1>
      <span class="badge">${escapeHtml(user.location)} access</span>
    </div>

    <div class="grid">
      <div class="stat"><b>My open work</b><h2>${openWork.length}</h2></div>
      <div class="stat"><b>Overdue</b><h2>${overdue.length}</h2></div>
      <div class="stat"><b>My scripts</b><h2>${myScripts.length}</h2></div>
      <div class="stat"><b>Scripts pending</b><h2>${pendingScripts.length}</h2></div>
    </div>

    <div class="panel">
      <h3>Work assigned to me</h3>
      ${openWork.length ? `
      <div class="tableWrap">
        <table class="table">
          <tr><th>Task</th><th>Department</th><th>Status</th><th>QC</th><th>Deadline</th></tr>
          ${openWork.map(x => `
            <tr>
              <td>${escapeHtml(x.title)}</td>
              <td>${escapeHtml(x.department)}</td>
              <td>${escapeHtml(x.status)}</td>
              <td>${escapeHtml(x.qcStatus)}</td>
              <td>${escapeHtml(x.dueDate || "-")}</td>
            </tr>`).join("")}
        </table>
      </div>` : "<p>No open work assigned to you right now.</p>"}
    </div>`;
  c.insertAdjacentHTML("beforeend", await deadlinePanelHtml());
}

async function dashboardPage(c) {
  if (!isAdminUser(user)) return myWorkspacePage(c);

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
  c.insertAdjacentHTML("beforeend", await deadlinePanelHtml());
}





async function leadsPage(c) {
  const rows = await api("/api/leads");
  const stages = ["New","Contacted","Quoted","Won","Lost"];
  c.innerHTML = `<div class="top"><h1>Leads Pipeline</h1><button onclick="newLead()">+ New Lead</button></div><div class="grid">${stages.map(stage => `<div class="panel" ondragover="event.preventDefault()" ondrop="moveLead(event,'${stage}')"><h3>${stage} <span class="badge">${rows.filter(x=>x.status===stage).length}</span></h3>${rows.filter(x=>(x.status||"New")===stage).map(x=>`<div class="msg" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${x.id}')"><b>${escapeHtml(x.company||x.contactName||"Unnamed lead")}</b><p>${escapeHtml(x.contactName||"")} · ${escapeHtml(x.phone||"")}</p><small>${escapeHtml(x.email||"")}</small><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button onclick="editLead('${x.id}')">Edit</button>${stage!=="Won"&&stage!=="Lost"?`<button onclick="convertLead('${x.id}')">Convert to Client</button>`:""}<button onclick="deleteRecord('leads','${x.id}')">Delete</button></div></div>`).join("")||`<p class="muted">No leads</p>`}</div>`).join("")}</div><p class="muted">Drag a lead card to another stage to update its status.</p>`;
}
async function moveLead(event,status) { const id=event.dataTransfer.getData("text/plain"); try { await api(`/api/leads/${id}`,{method:"PATCH",body:JSON.stringify({status})}); page("leads"); } catch(e){alert(e.message);} }
async function convertLead(id) { if(!confirm("Convert this lead into a client?"))return; try{await api(`/api/leads/${id}/convert`,{method:"POST",body:"{}"});alert("Lead converted to client.");page("leads");}catch(e){alert(e.message);} }
async function deleteRecord(type,id) { if(!confirm("Delete this record permanently?"))return; try{await api(`/api/${type}/${id}`,{method:"DELETE"});page(type==="leads"?"leads":type);}catch(e){alert(e.message);} }
const NOTIFICATION_LABELS = { info: "Info", holiday: "Holiday", leave: "Leave", work: "Work update", warning: "Warning", success: "Success" };

async function notificationsPage(c) {
  const rows = await api("/api/notifications");
  const admin = isAdminUser(user);
  const people = admin ? (await api("/api/users")).filter(u => u.role !== "Client" && u.active !== false) : [];

  const sendForm = admin ? `
    <div class="panel">
      <h3>Send notification</h3>
      <p class="muted">Each employee gets it in their own Notifications list.</p>
      <div class="row">
        <div class="field">
          <label for="ntfAudience">Send to *</label>
          <select id="ntfAudience">
            <option value="ALL">All employees (${people.length})</option>
            ${people.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.username)})</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="ntfType">Type</label>
          <select id="ntfType">
            <option value="info">Info</option>
            <option value="holiday">Holiday</option>
            <option value="leave">Leave / absence</option>
            <option value="work">Work update</option>
            <option value="warning">Warning</option>
            <option value="success">Success</option>
          </select>
        </div>
        <div class="field wide">
          <label for="ntfTitle">Title *</label>
          <input id="ntfTitle" maxlength="120" placeholder="e.g. Office closed tomorrow">
        </div>
        <div class="field wide">
          <label for="ntfMessage">Message</label>
          <textarea id="ntfMessage" rows="3" maxlength="1000" placeholder="Details for the team"></textarea>
        </div>
        <div class="field wide">
          <label class="checkRow"><input type="checkbox" id="ntfEmail"> Also send this by email to each employee's address</label>
        </div>
      </div>
      <div class="formActions"><button onclick="sendNotification()">Send</button></div>
    </div>` : "";

  const canDesktop = window.isSecureContext && "Notification" in window && Notification.permission !== "granted";

  c.innerHTML = `
    <h1>Notifications</h1>
    ${canDesktop ? `<div class="panel"><p class="muted">Get a pop-up on this computer when a new notification arrives.</p><button onclick="enableDesktopAlerts()">Enable desktop alerts</button></div>` : ""}
    ${sendForm}
    <div class="panel">
      ${rows.length ? rows.map(x => `
        <div class="msg">
          <span class="badge ${x.type === "warning" ? "warning" : x.type === "success" ? "success" : ""}">${escapeHtml(NOTIFICATION_LABELS[x.type] || "Info")}</span>
          <b>${escapeHtml(x.title)}</b>
          <p>${escapeHtml(x.message || "")}</p>
          <small>${escapeHtml(x.createdAt || "")}${x.sentBy ? " · from " + escapeHtml(x.sentBy) : ""}</small>
          ${!x.read ? `<button onclick="readNotification('${x.id}')">Mark read</button>` : ""}
        </div>`).join("") : "No notifications"}
    </div>`;

  updateNotificationBadge(rows.filter(x => !x.read).length);
}

async function sendNotification() {
  const userId = document.getElementById("ntfAudience").value;
  const title = document.getElementById("ntfTitle").value.trim();
  const message = document.getElementById("ntfMessage").value.trim();
  const type = document.getElementById("ntfType").value;

  if (!title) return alert("Enter a title.");
  const who = userId === "ALL" ? "all employees" : document.getElementById("ntfAudience").selectedOptions[0].text;
  if (!confirm(`Send "${title}" to ${who}?`)) return;

  try {
    const alsoEmail = document.getElementById("ntfEmail").checked;
    const data = await api("/api/notifications", {
      method: "POST",
      body: JSON.stringify({ userId, title, message, type, alsoEmail })
    });
    let text = `Sent to ${data.sent} ${data.sent === 1 ? "person" : "people"}`;
    if (alsoEmail) {
      text += `. Email: ${data.emailed} sent`;
      if (data.noEmail) text += `, ${data.noEmail} without an email address`;
      if (data.emailFailed) text += `, ${data.emailFailed} failed`;
    }
    toast(text);
    page("notifications");
  } catch (error) {
    alert(error.message);
  }
}

async function usersPage(c) {
  c.innerHTML = `
    <div class="top">
      <h1>Employees</h1>
      <button id="employeeToggleBtn" onclick="toggleEmployeeForm()">+ Add Employee</button>
    </div>

    <div id="employeeNotice" class="notice" hidden></div>

    <div id="employeeListPanel" class="panel">
      <p class="muted">Loading employees…</p>
    </div>

    <div id="employeeFormPanel" class="panel" hidden>
      <h3 id="employeeFormTitle">Add Employee</h3>
      <p class="formHint" id="employeeFormHint">Fill in the required fields (*). Give the employee a username and temporary password; they sign in with them to open their My Workspace. New employees always get the Employee role.</p>

      <div id="employeeFormErrors" class="formErrors" hidden></div>

      <div class="row">
        <div class="field">
          <label for="empName">Full name *</label>
          <input id="empName" autocomplete="off" maxlength="100" placeholder="e.g. Riya Shah" oninput="suggestUsername()">
        </div>
        <div class="field">
          <label for="empUsername">Username *</label>
          <input id="empUsername" autocomplete="off" maxlength="32" placeholder="e.g. riya" oninput="this.dataset.auto=''">
        </div>
        <div class="field">
          <label for="empPassword" id="empPasswordLabel">Temporary password *</label>
          <input id="empPassword" type="text" autocomplete="off" maxlength="200" placeholder="At least 8 characters">
          <button type="button" class="smallBtn" onclick="generateTempPassword()" style="margin-top:6px">Generate password</button>
        </div>
        <div class="field">
          <label for="empEmail">Email</label>
          <input id="empEmail" type="email" autocomplete="off" maxlength="120" placeholder="name@example.com">
        </div>
        <div class="field">
          <label for="empDepartment">Department *</label>
          <select id="empDepartment">
            <option value="">Select Department</option>
            ${EMPLOYEE_DEPARTMENTS.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="empRole">Role</label>
          <input id="empRole" readonly value="Employee" title="Role is set by the system owner and cannot be changed here">
        </div>
        <div class="field">
          <label for="empLocation">Location *</label>
          <input id="empLocation" list="empLocationList" autocomplete="off" maxlength="40" value="Ahmedabad" placeholder="Type or pick a city">
          <datalist id="empLocationList">${EMPLOYEE_LOCATIONS.map(l => `<option value="${escapeHtml(l)}"></option>`).join("")}</datalist>
        </div>
      </div>

      <div class="formActions">
        <button id="employeeSaveBtn" onclick="saveEmployee()">Save Employee</button>
        <button class="ghostBtn" onclick="closeEmployeeForm()">Cancel</button>
      </div>
    </div>`;

  await refreshEmployeeList();
}

async function refreshEmployeeList() {
  const listEl = document.getElementById("employeeListPanel");
  if (!listEl) return;

  try {
    employeeRows = await api("/api/users");
  } catch (error) {
    listEl.innerHTML = `<p>Could not load employees: ${escapeHtml(error.message)}</p>`;
    return;
  }

  listEl.innerHTML = employeeRows.length
    ? `
      <div class="tableWrap">
        <table class="table">
          <tr><th>Name</th><th>Username</th><th>Department</th><th>Role</th><th>Location</th><th>Status</th><th>Actions</th></tr>
          ${employeeRows.map(renderEmployeeRow).join("")}
        </table>
      </div>`
    : "<p>No employees yet. Use “+ Add Employee” to create the first one.</p>";
}

let employeeRows = [];
let editingEmployeeId = null;
let loadedEmployeePassword = null;

// Must match the lists enforced by the server (server.js: validateEmployeeInput).
const EMPLOYEE_DEPARTMENTS = [
  "Management",
  "Video HOD",
  "Graphic HOD",
  "Video Production",
  "Graphic Production",
  "Content Writer"
];
const CITY_LOCATIONS = [
  "Ahmedabad", "Gandhinagar", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar",
  "Junagadh", "Anand", "Nadiad", "Morbi", "Mehsana", "Bharuch", "Vapi", "Navsari",
  "Gandhidham", "Patan", "Bhuj", "Porbandar", "Valsad", "Godhra", "Palanpur",
  "Himatnagar", "Amreli", "Surendranagar", "Botad", "Dahod", "Modasa", "Ankleshwar"
];
const EMPLOYEE_LOCATIONS = [...CITY_LOCATIONS, "All Locations"];

function isCurrentUserMaster() {
  return user && user.role === "Master Administrator";
}

function renderEmployeeRow(x) {
  const isSelf = x.id === user.id;
  const isMaster = x.role === "Master Administrator";
  const blocked = x.active === false;

  // Non-master administrators cannot change Master Administrator accounts; the server enforces this too.
  const masterLocked = isMaster && !isCurrentUserMaster();
  const blockDeleteLocked = isSelf || masterLocked;

  let blockDeleteTitle = "";
  if (isSelf) blockDeleteTitle = "You cannot block or delete your own account";
  else if (masterLocked) blockDeleteTitle = "Only a Master Administrator can change this account";

  return `
    <tr>
      <td>${escapeHtml(x.name)}${isSelf ? ` <span class="badge">You</span>` : ""}</td>
      <td>${escapeHtml(x.username)}</td>
      <td>${escapeHtml(x.department)}</td>
      <td>${escapeHtml(x.role)}</td>
      <td>${escapeHtml(x.location)}</td>
      <td>${blocked ? `<span class="badge danger">Blocked</span>` : `<span class="badge success">Active</span>`}</td>
      <td class="actionCell">
        ${x.twoFactorEnabled ? `<button class="smallBtn warn" onclick="resetTwoFactor('${escapeHtml(x.id)}')">Reset 2FA</button>` : ""}
        <button class="smallBtn" data-action="edit" data-id="${escapeHtml(x.id)}" ${masterLocked ? "disabled" : ""} title="${masterLocked ? "Only a Master Administrator can change this account" : "Edit details"}" onclick="employeeAction(this)">Edit</button>
        <button class="smallBtn warn" data-action="${blocked ? "unblock" : "block"}" data-id="${escapeHtml(x.id)}" ${blockDeleteLocked ? "disabled" : ""} title="${escapeHtml(blockDeleteTitle)}" onclick="employeeAction(this)">${blocked ? "Unblock" : "Block"}</button>
        <button class="smallBtn danger" data-action="delete" data-id="${escapeHtml(x.id)}" ${blockDeleteLocked ? "disabled" : ""} title="${escapeHtml(blockDeleteTitle || "Delete this employee (only if they have no linked records)")}" onclick="employeeAction(this)">Delete</button>
      </td>
    </tr>`;
}

// Fills the password field with the password the admin set (only admins can read it).
async function loadEmployeePassword(id) {
  try {
    const data = await api(`/api/users/${id}/password`);
    if (editingEmployeeId !== id) return;
    loadedEmployeePassword = data.password || null;
    const el = document.getElementById("empPassword");
    if (el) el.value = loadedEmployeePassword || "";
    document.getElementById("employeeFormHint").textContent = loadedEmployeePassword
      ? "This is the password set for the employee. Change it here and save to set a new one."
      : "The password for this employee is not stored (it was set by the employee or before this feature). Type or generate a new one and save to set it.";
  } catch (error) {
    showEmployeeFormErrors([error.message]);
  }
}

// Creates a random temporary password (no look-alike characters) and fills the field.
function generateTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  const pw = Array.from(bytes, b => chars[b % chars.length]).join("");
  const el = document.getElementById("empPassword");
  if (el) el.value = pw;
}

// Suggests a username from the first name while adding an employee. The admin can type over it.
function suggestUsername() {
  if (editingEmployeeId) return;
  const nameEl = document.getElementById("empName");
  const userEl = document.getElementById("empUsername");
  if (!nameEl || !userEl) return;
  if (userEl.value && userEl.dataset.auto !== "1") return;

  const first = (nameEl.value.trim().split(/\s+/)[0] || "").toLowerCase();
  const clean = first.replace(/[^a-z0-9._-]/g, "");
  userEl.value = clean;
  userEl.dataset.auto = clean ? "1" : "";
}

function showEmployeeNotice(type, text) {
  const el = document.getElementById("employeeNotice");
  if (!el) return;
  el.className = `notice ${type}`;
  el.textContent = text;
  el.hidden = false;
}

function setToggleLabel(open) {
  const btn = document.getElementById("employeeToggleBtn");
  if (btn) btn.textContent = open ? "Close form" : "+ Add Employee";
}

function resetEmployeeForm() {
  ["empName", "empUsername", "empPassword", "empEmail"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  const department = document.getElementById("empDepartment");
  if (department) {
    department.value = "";
    department.classList.remove("invalid");
  }

  const role = document.getElementById("empRole");
  if (role) role.value = "Employee";

  const location = document.getElementById("empLocation");
  if (location) location.value = "Ahmedabad";

  const errors = document.getElementById("employeeFormErrors");
  if (errors) {
    errors.hidden = true;
    errors.innerHTML = "";
  }
}

function openEmployeeForm(employee = null) {
  const panel = document.getElementById("employeeFormPanel");
  if (!panel) return;

  editingEmployeeId = employee ? employee.id : null;
  resetEmployeeForm();

  document.getElementById("employeeFormTitle").textContent = employee ? `Edit Employee: ${employee.name}` : "Add Employee";
  document.getElementById("employeeFormHint").textContent = employee
    ? "This is the password set for the employee. Change it here and save to set a new one."
    : "Fill in the required fields (*). Department must be selected before saving.";
  document.getElementById("empPasswordLabel").textContent = employee ? "Temporary password" : "Temporary password *";
  loadedEmployeePassword = null;
  if (employee) loadEmployeePassword(employee.id);
  document.getElementById("employeeSaveBtn").textContent = employee ? "Save Changes" : "Save Employee";

  if (employee) {
    document.getElementById("empName").value = employee.name || "";
    document.getElementById("empUsername").value = employee.username || "";
    document.getElementById("empEmail").value = employee.email || "";
    document.getElementById("empRole").value = employee.role || "Employee";
    document.getElementById("empDepartment").value = employee.department || "";
    document.getElementById("empLocation").value = employee.location || "Ahmedabad";
  }

  panel.hidden = false;
  setToggleLabel(true);
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("empName").focus({ preventScroll: true });
}

function closeEmployeeForm() {
  const panel = document.getElementById("employeeFormPanel");
  if (panel) panel.hidden = true;
  editingEmployeeId = null;
  resetEmployeeForm();
  setToggleLabel(false);
}

function toggleEmployeeForm() {
  const panel = document.getElementById("employeeFormPanel");
  if (!panel) return;

  if (panel.hidden) openEmployeeForm();
  else closeEmployeeForm();
}

function readEmployeeForm() {
  const val = id => document.getElementById(id).value;

  return {
    name: val("empName").trim(),
    username: val("empUsername").trim(),
    password: val("empPassword"),
    email: val("empEmail").trim(),
    department: val("empDepartment"),
    location: val("empLocation")
  };
}

function validateEmployeeForm(form, isEdit) {
  const errors = [];

  if (!form.name) errors.push("Full name is required.");
  if (!form.username) errors.push("Username is required.");
  else if (!/^[A-Za-z0-9._-]{3,32}$/.test(form.username)) {
    errors.push("Username must be 3–32 characters: letters, numbers, dots, dashes or underscores.");
  }

  if (!isEdit && !form.password) errors.push("Temporary password is required.");
  if (form.password && form.password.length < 8) errors.push("Password must be at least 8 characters.");

  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.push("Enter a valid email address or leave it empty.");
  }

  const departmentEl = document.getElementById("empDepartment");
  if (!form.department) {
    errors.push("Please select a department.");
    departmentEl.classList.add("invalid");
  } else {
    departmentEl.classList.remove("invalid");
  }

  if (!form.location) errors.push("Please select a location.");

  return errors;
}

function showEmployeeFormErrors(messages) {
  const box = document.getElementById("employeeFormErrors");
  if (!box) return;

  const list = Array.isArray(messages) ? messages : [messages];
  box.innerHTML = list.length > 1
    ? `<ul>${list.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul>`
    : escapeHtml(list[0] || "Something went wrong. Please try again.");
  box.hidden = false;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setEmployeeSaving(saving) {
  const btn = document.getElementById("employeeSaveBtn");
  if (!btn) return;
  btn.disabled = saving;
  btn.textContent = saving ? "Saving…" : (editingEmployeeId ? "Save Changes" : "Save Employee");
}

async function saveEmployee() {
  const isEdit = !!editingEmployeeId;
  const form = readEmployeeForm();
  const errors = validateEmployeeForm(form, isEdit);

  if (errors.length) {
    showEmployeeFormErrors(errors);
    return;
  }

  const payload = {
    name: form.name,
    username: form.username,
    email: form.email,
    department: form.department,
    location: form.location
  };
  const passwordChanged = !!form.password && (!isEdit || form.password !== loadedEmployeePassword);
  if (passwordChanged) payload.password = form.password;

  setEmployeeSaving(true);

  try {
    if (isEdit) {
      await api(`/api/users/${editingEmployeeId}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await api("/api/users", { method: "POST", body: JSON.stringify(payload) });
    }

    let message = isEdit
      ? `Employee "${form.name}" updated successfully.`
      : `Employee "${form.name}" added successfully.`;
    if (passwordChanged) {
      message += isEdit
        ? ` New password: ${form.password}`
        : ` Login: username "${form.username}", password "${form.password}". Share it privately with the employee.`;
    }

    closeEmployeeForm();
    showEmployeeNotice("success", message);
    toast(message);
    await refreshEmployeeList();
  } catch (error) {
    showEmployeeFormErrors(error.details && error.details.length ? error.details : [error.message]);
  } finally {
    setEmployeeSaving(false);
  }
}

async function employeeAction(btn) {
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const employee = employeeRows.find(x => x.id === id);
  if (!employee) return;

  if (action === "edit") {
    openEmployeeForm(employee);
    return;
  }

  if (action === "block") {
    if (!confirm(`Block ${employee.name} (${employee.username})?\n\nThey will not be able to log in. Their tasks, projects and history are kept.`)) return;
    return changeEmployeeStatus(btn, "POST", `/api/users/${id}/block`, `${employee.name} has been blocked.`);
  }

  if (action === "unblock") {
    if (!confirm(`Unblock ${employee.name} (${employee.username})?\n\nThey will be able to log in again.`)) return;
    return changeEmployeeStatus(btn, "POST", `/api/users/${id}/unblock`, `${employee.name} has been unblocked.`);
  }

  if (action === "delete") {
    if (!confirm(`Permanently delete ${employee.name} (${employee.username})?\n\nThis cannot be undone. Employees linked to tasks, projects or other records cannot be deleted. Block them instead to keep their history.`)) return;
    return changeEmployeeStatus(btn, "DELETE", `/api/users/${id}`, `${employee.name} has been deleted.`);
  }
}

async function changeEmployeeStatus(btn, method, url, successText) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Working…";

  try {
    await api(url, { method });
    showEmployeeNotice("success", successText);
    toast(successText);
  } catch (error) {
    showEmployeeNotice("error", error.message);
  } finally {
    await refreshEmployeeList();
  }
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

/* ---- Shared form dialog (replaces the browser prompt() popups) ---- */
let activeFormDialog = null;
const LEAD_STAGES = ["New", "Contacted", "Quoted", "Won", "Lost"];

function defaultLocation() {
  return user.location === "All Locations" ? "Ahmedabad" : user.location;
}

// Location field for dialogs: admins (All Locations) can type or pick any city;
// everyone else is fixed to their own location, as the server only allows that.
function locationField(key = "location") {
  return {
    key,
    label: "Location",
    type: "location",
    required: true,
    locked: user.location !== "All Locations",
    value: defaultLocation()
  };
}

function closeFormDialog() {
  if (!activeFormDialog) return;
  document.removeEventListener("keydown", activeFormDialog.onKey);
  activeFormDialog.root.remove();
  activeFormDialog = null;
}

function dialogFieldHtml(f) {
  const id = `dlg_${f.key}`;
  const label = `${escapeHtml(f.label)}${f.required ? " *" : ""}`;
  const placeholder = f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : "";
  let control;

  if (f.type === "select") {
    const options = f.options.map(o => {
      const value = typeof o === "string" ? o : o.value;
      const text = typeof o === "string" ? o : o.label;
      const selected = String(value) === String(f.value ?? "") ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(text)}</option>`;
    }).join("");
    const placeholderOpt = f.placeholderOption ? `<option value="">${escapeHtml(f.placeholderOption)}</option>` : "";
    control = `<select id="${id}">${placeholderOpt}${options}</select>`;
  } else if (f.type === "location") {
    const listId = `${id}_list`;
    const readonly = f.locked ? " readonly" : "";
    const options = CITY_LOCATIONS.map(c => `<option value="${escapeHtml(c)}"></option>`).join("");
    control = `<input id="${id}" type="text" list="${listId}" autocomplete="off" maxlength="40" value="${escapeHtml(f.value ?? "")}"${readonly}${placeholder}><datalist id="${listId}">${options}</datalist>`;
  } else if (f.type === "textarea") {
    control = `<textarea id="${id}" rows="3" maxlength="${f.maxlength || 2000}"${placeholder}>${escapeHtml(f.value || "")}</textarea>`;
  } else if (f.type === "number") {
    const min = f.min !== undefined ? ` min="${f.min}"` : "";
    const step = ` step="${f.step || "any"}"`;
    control = `<input id="${id}" type="number" autocomplete="off" value="${escapeHtml(f.value ?? "")}"${min}${step}${placeholder}>`;
  } else {
    const type = f.type || "text";
    control = `<input id="${id}" type="${type}" autocomplete="off" maxlength="${f.maxlength || 200}" value="${escapeHtml(f.value ?? "")}"${placeholder}>`;
  }

  return `<div class="field${f.type === "textarea" ? " wide" : ""}"><label for="${id}">${label}</label>${control}</div>`;
}

function openFormDialog({ title, hint = "", fields, submitLabel = "Save", onSubmit }) {
  closeFormDialog();

  const root = document.createElement("div");
  root.className = "dialogBackdrop";
  root.innerHTML = `
    <div class="dialogPanel panel" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
      <h3 id="dlgTitle">${escapeHtml(title)}</h3>
      ${hint ? `<p class="formHint">${escapeHtml(hint)}</p>` : ""}
      <div id="dlgErrors" class="formErrors" hidden></div>
      <div class="row">${fields.map(dialogFieldHtml).join("")}</div>
      <div class="formActions">
        <button type="button" id="dlgSave">${escapeHtml(submitLabel)}</button>
        <button type="button" class="ghostBtn" id="dlgCancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const saveBtn = root.querySelector("#dlgSave");
  const errorBox = root.querySelector("#dlgErrors");
  const fieldEl = f => root.querySelector(`#dlg_${f.key}`);

  const showErrors = msgs => {
    errorBox.hidden = !msgs.length;
    errorBox.innerHTML = msgs.length > 1
      ? `<ul>${msgs.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul>`
      : msgs.map(m => escapeHtml(m)).join("");
  };

  const readValues = () => Object.fromEntries(fields.map(f => [f.key, fieldEl(f).value.trim()]));

  const validate = values => {
    const errors = [];
    fields.forEach(f => {
      const el = fieldEl(f);
      el.classList.remove("invalid");
      const v = values[f.key];
      let problem = "";

      if (f.required && !v) {
        problem = `${f.label} is required.`;
      } else if (v && f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        problem = `${f.label} must be a valid email address.`;
      } else if (v && f.type === "number") {
        const n = Number(v);
        if (!Number.isFinite(n)) problem = `${f.label} must be a number.`;
        else if (f.min !== undefined && n < f.min) problem = f.minMessage || `${f.label} must be at least ${f.min}.`;
        else if (f.max !== undefined && n > f.max) problem = f.maxMessage || `${f.label} cannot be more than ${f.max}.`;
      }

      if (problem) {
        errors.push(problem);
        el.classList.add("invalid");
      }
    });
    return errors;
  };

  const submit = async () => {
    if (saveBtn.disabled) return;
    const values = readValues();
    const errors = validate(values);
    showErrors(errors);
    if (errors.length) return;

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await onSubmit(values);
      closeFormDialog();
    } catch (error) {
      showErrors(error.details && error.details.length ? error.details : [error.message]);
      saveBtn.disabled = false;
      saveBtn.textContent = submitLabel;
    }
  };

  const onKey = e => {
    if (e.key === "Escape") closeFormDialog();
    if (e.key === "Enter" && e.target.tagName === "INPUT") {
      e.preventDefault();
      submit();
    }
  };

  document.addEventListener("keydown", onKey);
  root.addEventListener("click", e => { if (e.target === root) closeFormDialog(); });
  root.querySelector("#dlgCancel").onclick = closeFormDialog;
  saveBtn.onclick = submit;
  activeFormDialog = { root, onKey };

  const first = root.querySelector("input, select, textarea");
  if (first) first.focus();
}

/* ---- Leads ---- */
function newLead() {
  openFormDialog({
    title: "New Lead",
    hint: "Only the company / lead name is required.",
    fields: [
      { key: "company", label: "Company / lead name", required: true, placeholder: "e.g. Sunrise Foods" },
      { key: "contactName", label: "Contact person", placeholder: "e.g. Riya Shah" },
      { key: "phone", label: "Phone", type: "tel", placeholder: "e.g. 98xxxxxxxx" },
      { key: "email", label: "Email", type: "email", placeholder: "name@example.com" }
    ],
    submitLabel: "Save Lead",
    onSubmit: async v => {
      await api("/api/leads", { method: "POST", body: JSON.stringify({ ...v, status: "New" }) });
      page("leads");
    }
  });
}

async function editLead(id) {
  const rows = await api("/api/leads");
  const x = rows.find(r => r.id === id);
  if (!x) return;

  openFormDialog({
    title: "Edit Lead",
    hint: "Update the lead details or move it to another stage.",
    fields: [
      { key: "company", label: "Company / lead name", required: true, value: x.company || "" },
      { key: "status", label: "Stage", type: "select", required: true, options: LEAD_STAGES, value: x.status || "New" }
    ],
    submitLabel: "Save Changes",
    onSubmit: async v => {
      await api(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify({ company: v.company, status: v.status }) });
      page("leads");
    }
  });
}

/* ---- Clients ---- */
function newClient() {
  openFormDialog({
    title: "New Client",
    hint: "Company name is required. Other details can be added later.",
    fields: [
      { key: "company", label: "Company", required: true, placeholder: "e.g. Sunrise Foods Pvt Ltd" },
      { key: "contactName", label: "Contact name", placeholder: "e.g. Riya Shah" },
      { key: "email", label: "Email", type: "email", placeholder: "name@example.com" },
      { key: "phone", label: "Phone", type: "tel", placeholder: "e.g. 98xxxxxxxx" },
      locationField()
    ],
    submitLabel: "Save Client",
    onSubmit: async v => {
      await api("/api/clients", { method: "POST", body: JSON.stringify(v) });
      toast("Client created successfully");
      page("clients");
    }
  });
}

/* ---- Projects ---- */
function newProject() {
  openFormDialog({
    title: "New Project",
    fields: [
      { key: "name", label: "Project name", required: true, placeholder: "e.g. Diwali TVC 2026" },
      { key: "projectType", label: "Project type", type: "select", required: true, options: ["Video", "Graphic"], value: "Video" },
      { key: "dueDate", label: "Deadline", type: "date" },
      { key: "description", label: "Project description / brief", type: "textarea", placeholder: "Short brief for the team…" }
    ],
    submitLabel: "Create Project",
    onSubmit: async v => {
      await api("/api/projects", { method: "POST", body: JSON.stringify(v) });
      toast("Project created successfully");
      page("projects");
    }
  });
}

/* ---- Scripts ---- */
function newScript() {
  openFormDialog({
    title: "Submit Script to HOD",
    fields: [
      { key: "title", label: "Script title", required: true, placeholder: "e.g. 30-sec TVC — Monsoon launch" },
      { key: "type", label: "Script type", type: "select", required: true, options: ["TVC", "Film", "Reel", "Other"], value: "TVC" },
      { key: "content", label: "Script / content", type: "textarea", placeholder: "Paste or write the script…" },
      { key: "notes", label: "Notes for HOD", type: "textarea", placeholder: "Anything the HOD should know" }
    ],
    submitLabel: "Submit Script",
    onSubmit: async v => {
      await api("/api/scripts", { method: "POST", body: JSON.stringify(v) });
      toast("Script submitted to HOD");
      page("scripts");
    }
  });
}

/* ---- Work / tasks ---- */
// Assigns work to an editor or designer. Work can come from an approved script.
async function newTask(scriptId = null) {
  const [users, scripts] = await Promise.all([api("/api/users"), api("/api/scripts")]);
  const approved = scripts.filter(x => x.status === "Approval");
  const script = scriptId ? approved.find(x => x.id === scriptId) : null;
  const people = users
    .filter(u => u.role !== "Client" && u.active !== false && /Production/.test(u.department))
    .map(u => ({ value: u.id, label: `${u.name} (${u.department})` }));

  openFormDialog({
    title: "Assign Work",
    hint: "Work goes to the editor or designer first, then QC, Revision and Final Delivery.",
    fields: [
      { key: "scriptId", label: "Approved script", type: "select", placeholderOption: "No script (general work)",
        options: approved.map(x => ({ value: x.id, label: x.title })), value: scriptId || "" },
      { key: "title", label: "Work title", required: true, placeholder: "e.g. Edit reel v2", value: script ? script.title : "" },
      { key: "assignedTo", label: "Assign to (editor / designer)", type: "select", required: true,
        placeholderOption: "Select employee", options: people },
      { key: "type", label: "Type", type: "select", required: true, options: ["Video", "Graphic"], value: "Video" },
      { key: "dueDate", label: "Deadline", type: "date" },
      { key: "instructions", label: "Instructions", type: "textarea", placeholder: "What needs to be done…" }
    ],
    submitLabel: "Assign Work",
    onSubmit: async v => {
      await api("/api/tasks", { method: "POST", body: JSON.stringify(v) });
      toast("Work assigned");
      page("tasks");
    }
  });
}

/* ---- Shared helpers for the new features ---- */
const KANBAN_COLUMNS = ["Editor/Designer", "QC", "Revision", "Final Delivery"];
const MAX_UPLOAD_MB = 12;
let workView = localStorage.getItem("workView") || "board";

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

/* ---- Work / QC: Kanban board + table ---- */
async function tasksPage(c) {
  const rows = await api("/api/tasks");

  c.innerHTML = `
    <div class="top">
      <h1>Work / QC</h1>
      <div class="toggleGroup">
        <button class="${workView === "board" ? "" : "ghostBtn"}" onclick="setWorkView('board')">Board</button>
        <button class="${workView === "table" ? "" : "ghostBtn"}" onclick="setWorkView('table')">Table</button>
        ${isHodUser(user) ? `<button onclick="newTask()">+ Assign Work</button>` : ""}
      </div>
    </div>
    ${chainHtml()}
    ${rows.length
      ? (workView === "board" ? taskBoardHtml(rows) : taskTableHtml(rows))
      : `<div class="panel"><p>No work assigned.</p></div>`}`;
}

function setWorkView(view) {
  workView = view;
  localStorage.setItem("workView", view);
  page("tasks");
}

function taskBoardHtml(rows) {
  const statusOf = t => (KANBAN_COLUMNS.includes(t.status) ? t.status : KANBAN_COLUMNS[0]);

  return `<div class="kanban">${KANBAN_COLUMNS.map(col => {
    const items = rows.filter(t => statusOf(t) === col);
    return `
      <div class="panel kanbanCol" ondragover="event.preventDefault()" ondrop="dropTask(event,'${col}')">
        <h3>${col} <span class="badge">${items.length}</span></h3>
        ${items.map(x => `
          <div class="msg kanbanCard" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${x.id}')">
            <b>${escapeHtml(x.title)}</b>
            <p>${escapeHtml(x.department)} · QC: ${escapeHtml(x.qcStatus)}</p>
            <small>Deadline: ${escapeHtml(x.dueDate || "-")}</small>
            <div>
              <button class="smallBtn" onclick="openFiles('tasks','${x.id}')">📎 Files</button>
              ${isHodUser(user) ? `<button class="smallBtn danger" onclick="deleteRecord('tasks','${x.id}')">Delete</button>` : ""}
            </div>
          </div>`).join("") || `<p class="muted">Nothing here</p>`}
      </div>`;
  }).join("")}</div>
  <p class="muted">Drag a card to another column to change its status.</p>`;
}

function taskTableHtml(rows) {
  return `
    <div class="panel tableWrap">
      <table class="table">
        <tr><th>Task</th><th>Department</th><th>Status</th><th>QC</th><th>Assignee</th><th>Deadline</th><th>Files</th></tr>
        ${rows.map(x => `
          <tr>
            <td>${escapeHtml(x.title)}</td>
            <td>${escapeHtml(x.department)}</td>
            <td>${escapeHtml(x.status)}</td>
            <td>${escapeHtml(x.qcStatus)}</td>
            <td>${escapeHtml(x.assignedTo || "-")}</td>
            <td>${escapeHtml(x.dueDate || "-")}</td>
            <td>
              <button class="smallBtn" onclick="openFiles('tasks','${x.id}')">📎 Files</button>
              ${isHodUser(user) ? `<button class="smallBtn danger" onclick="deleteRecord('tasks','${x.id}')">Delete</button>` : ""}
            </td>
          </tr>`).join("")}
      </table>
    </div>`;
}

async function dropTask(event, status) {
  const id = event.dataTransfer.getData("text/plain");
  if (!id) return;
  try {
    await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    page("tasks");
  } catch (error) {
    alert(error.message);
  }
}

/* ---- Projects and scripts: Files column ---- */
async function projectsPage(c) {
  const rows = await api("/api/projects");

  c.innerHTML = `
    <div class="top">
      <h1>Projects</h1>
      <button onclick="newProject()">+ New Project</button>
    </div>
    <div class="panel tableWrap">
      ${rows.length ? `
      <table class="table">
        <tr><th>Project</th><th>Type</th><th>Status</th><th>Priority</th><th>Location</th><th>Deadline</th><th>Files</th></tr>
        ${rows.map(x => `
          <tr onclick="openProject('${x.id}')">
            <td>${escapeHtml(x.name)}</td>
            <td>${escapeHtml(x.projectType)}</td>
            <td>${escapeHtml(x.status)}</td>
            <td>${escapeHtml(x.priority)}</td>
            <td>${escapeHtml(x.location || "All")}</td>
            <td>${escapeHtml(x.dueDate || "-")}</td>
            <td>
              <button class="smallBtn" onclick="event.stopPropagation();openFiles('projects','${x.id}')">📎 Files</button>
              ${isAdminUser(user) ? `<button class="smallBtn danger" onclick="event.stopPropagation();deleteRecord('projects','${x.id}')">Delete</button>` : ""}
            </td>
          </tr>`).join("")}
      </table>` : "<p>No projects yet.</p>"}
    </div>`;
}

// Production chain shown as a line. The current stage is highlighted.
const CHAIN_STAGES = ["Writer", "HOD Review", "Approval", "Editor/Designer", "QC", "Revision", "Final Delivery"];
function chainHtml(current = null) {
  return `<p class="chain">${CHAIN_STAGES.map(stage =>
    stage === current ? `<b>${escapeHtml(stage)}</b>` : `<span class="muted">${escapeHtml(stage)}</span>`
  ).join(" → ")}</p>`;
}

function isHodUser(u) {
  return !!u && (isAdminUser(u) || ["Video HOD", "Graphic HOD"].includes(u.department));
}

async function scriptsPage(c) {
  const rows = await api("/api/scripts");

  const actionsFor = x => {
    const buttons = [];
    if (x.writerId === user.id && x.status === "Revision") {
      buttons.push(`<button class="smallBtn" onclick="resubmitScript('${x.id}')">Resubmit to HOD</button>`);
    }
    if (isHodUser(user) && x.status === "HOD Review") {
      buttons.push(`<button class="smallBtn" onclick="reviewScript('${x.id}','Approval')">Approve</button>`);
      buttons.push(`<button class="smallBtn danger" onclick="reviewScript('${x.id}','Revision')">Send back</button>`);
    }
    if (isHodUser(user) && x.status === "Approval") {
      buttons.push(`<button class="smallBtn" onclick="newTask('${x.id}')">Assign work</button>`);
    }
    if (isHodUser(user)) {
      buttons.push(`<button class="smallBtn danger" onclick="deleteRecord('scripts','${x.id}')">Delete</button>`);
    }
    return buttons.join(" ") || "<span class=\"muted\">-</span>";
  };

  c.innerHTML = `
    <div class="top">
      <h1>Scripts</h1>
      <button onclick="newScript()">+ New Script</button>
    </div>
    ${chainHtml()}
    <div class="panel tableWrap">
      ${rows.length ? `
      <table class="table">
        <tr><th>Title</th><th>Type</th><th>Stage</th><th>Location</th><th>Updated</th><th>Actions</th><th>Files</th></tr>
        ${rows.map(x => `
          <tr>
            <td>${escapeHtml(x.title)}</td>
            <td>${escapeHtml(x.type)}</td>
            <td>${escapeHtml(x.status)}</td>
            <td>${escapeHtml(x.location || "All")}</td>
            <td>${escapeHtml(x.updatedAt || x.createdAt)}</td>
            <td>${actionsFor(x)}</td>
            <td><button class="smallBtn" onclick="openFiles('scripts','${x.id}')">📎 Files</button></td>
          </tr>`).join("")}
      </table>` : "<p>No scripts yet.</p>"}
    </div>`;
}

// HOD approves, or sends the script back to the writer with feedback.
async function reviewScript(id, to) {
  if (to === "Approval") {
    try {
      await api(`/api/scripts/${id}`, { method: "PATCH", body: JSON.stringify({ status: "Approval" }) });
      toast("Script approved");
      page("scripts");
    } catch (error) {
      alert(error.message);
    }
    return;
  }

  openFormDialog({
    title: "Send script back to writer",
    hint: "Tell the writer what needs to change. The script returns to them as Revision.",
    fields: [{ key: "feedback", label: "Feedback", type: "textarea", required: true, placeholder: "What should change…" }],
    submitLabel: "Send back",
    onSubmit: async v => {
      await api(`/api/scripts/${id}`, { method: "PATCH", body: JSON.stringify({ status: "Revision", feedback: v.feedback }) });
      toast("Sent back to writer");
      page("scripts");
    }
  });
}

// Writer makes the requested changes and sends the script back to HOD review.
async function resubmitScript(id) {
  const script = (await api("/api/scripts")).find(x => x.id === id);
  if (!script) return alert("Script not found");

  openFormDialog({
    title: "Resubmit script",
    hint: "Make the changes the HOD asked for, then send it back for review.",
    fields: [
      { key: "content", label: "Script / content", type: "textarea", value: script.content || "" },
      { key: "notes", label: "Notes for HOD", type: "textarea", value: script.notes || "" }
    ],
    submitLabel: "Resubmit to HOD",
    onSubmit: async v => {
      await api(`/api/scripts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: v.content, notes: v.notes, status: "HOD Review" })
      });
      toast("Resubmitted to HOD");
      page("scripts");
    }
  });
}

/* ---- Attached files dialog ---- */
function openFiles(recordType, recordId) {
  const root = document.createElement("div");
  root.className = "dialogBackdrop";
  root.innerHTML = `
    <div class="dialogPanel panel" role="dialog" aria-modal="true">
      <h3>Attached files</h3>
      <p class="formHint">Up to ${MAX_UPLOAD_MB} MB per file. Documents, images, video, audio and zip files are allowed.</p>
      <div id="filesNotice" class="formErrors" hidden></div>
      <div id="filesList"><p class="muted">Loading…</p></div>
      <div class="fileUploadRow">
        <input type="file" id="filesInput">
        <button type="button" id="filesUpload">Upload</button>
        <button type="button" class="ghostBtn" id="filesClose">Close</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const close = () => root.remove();
  const listEl = root.querySelector("#filesList");
  const notice = messages => {
    const box = root.querySelector("#filesNotice");
    box.hidden = !messages.length;
    box.innerHTML = messages.length > 1
      ? `<ul>${messages.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul>`
      : escapeHtml(messages[0] || "");
  };

  const load = async () => {
    const files = await api(`/api/files?recordType=${recordType}&recordId=${encodeURIComponent(recordId)}`);
    listEl.innerHTML = files.length ? files.map(f => `
      <div class="msg fileRow">
        <div>
          <b>${escapeHtml(f.name)}</b><br>
          <small>${formatBytes(f.size)} · ${escapeHtml(f.uploadedByName || "")} · ${escapeHtml((f.createdAt || "").slice(0, 10))}</small>
        </div>
        <div>
          <button class="smallBtn" data-download="${f.id}" data-name="${escapeHtml(f.name)}">Download</button>
          ${f.canDelete ? `<button class="smallBtn danger" data-delete="${f.id}">Delete</button>` : ""}
        </div>
      </div>`).join("") : `<p class="muted">No files yet.</p>`;
  };

  root.addEventListener("click", async e => {
    if (e.target === root || e.target.id === "filesClose") return close();

    const dl = e.target.closest("[data-download]");
    if (dl) {
      try { await downloadFile(dl.dataset.download, dl.dataset.name); }
      catch (error) { notice([error.message]); }
      return;
    }

    const del = e.target.closest("[data-delete]");
    if (del) {
      if (!confirm("Delete this file?")) return;
      try {
        await api(`/api/files/${del.dataset.delete}`, { method: "DELETE" });
        notice([]);
        await load();
      } catch (error) { notice([error.message]); }
    }
  });

  root.querySelector("#filesUpload").onclick = async () => {
    const input = root.querySelector("#filesInput");
    const button = root.querySelector("#filesUpload");
    const file = input.files[0];

    if (!file) return notice(["Choose a file first."]);
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return notice([`"${file.name}" is larger than ${MAX_UPLOAD_MB} MB.`]);

    button.disabled = true;
    button.textContent = "Uploading…";
    try {
      const data = await readFileAsDataUrl(file);
      await api("/api/files", {
        method: "POST",
        body: JSON.stringify({ recordType, recordId, name: file.name, data })
      });
      input.value = "";
      notice([]);
      await load();
      toast("File uploaded");
    } catch (error) {
      notice(error.details && error.details.length ? error.details : [error.message]);
    } finally {
      button.disabled = false;
      button.textContent = "Upload";
    }
  };

  load().catch(error => notice([error.message]));
}

async function downloadFile(id, name) {
  const response = await fetch(`/api/files/${id}/download`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Download failed");
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---- Deadline reminders (dashboards) ---- */
async function deadlinePanelHtml() {
  let tasks, projects;
  try {
    [tasks, projects] = await Promise.all([api("/api/tasks"), api("/api/projects")]);
  } catch (_) {
    return "";
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const doneStatuses = ["Final Delivery"];
  const daysLeft = item => Math.round((new Date(String(item.due).slice(0, 10) + "T00:00:00") - today) / 86400000);

  const items = [
    ...tasks.filter(t => t.dueDate && !doneStatuses.includes(t.status))
      .map(t => ({ kind: "Work", title: t.title, due: t.dueDate, status: t.status })),
    ...projects.filter(p => p.dueDate && p.status !== "Completed")
      .map(p => ({ kind: "Project", title: p.name, due: p.dueDate, status: p.status }))
  ];

  const overdue = items.filter(i => daysLeft(i) < 0).sort((a, b) => daysLeft(a) - daysLeft(b));
  const soon = items.filter(i => daysLeft(i) >= 0 && daysLeft(i) <= 3).sort((a, b) => daysLeft(a) - daysLeft(b));

  const label = item => {
    const d = daysLeft(item);
    if (d < 0) return `Overdue by ${-d} day${-d === 1 ? "" : "s"}`;
    if (d === 0) return "Due today";
    return `Due in ${d} day${d === 1 ? "" : "s"}`;
  };

  const row = (item, tone) => `
    <div class="msg">
      <b>${escapeHtml(item.title)}</b>
      <p>${escapeHtml(item.kind)} · ${escapeHtml(item.status)} · ${escapeHtml(String(item.due).slice(0, 10))}</p>
      <span class="badge ${tone}">${label(item)}</span>
    </div>`;

  return `
    <div class="panel">
      <h3>Deadline reminders</h3>
      ${overdue.length || soon.length ? `
        ${overdue.map(i => row(i, "danger")).join("")}
        ${soon.map(i => row(i, "warning")).join("")}`
        : `<p>No deadlines in the next 3 days.</p>`}
    </div>`;
}

/* ---- Employee reports (administrators) ---- */
async function reportsPage(c) {
  const rows = await api("/api/reports/employees");

  c.innerHTML = `
    <div class="top"><h1>Employee Reports</h1></div>
    <div class="panel">
      <p class="muted">Work counts come from task assignments and deadlines. "Revisions" counts revision notes on the employee's tasks. Scripts are counted for the writer.</p>
      <div class="tableWrap">
        <table class="table">
          <tr><th>Employee</th><th>Department</th><th>Location</th><th>Assigned</th><th>Completed</th><th>Open</th><th>Overdue</th><th>Revisions</th><th>Scripts</th><th>Approved</th></tr>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.name)}${r.active ? "" : ` <span class="badge danger">Blocked</span>`}</td>
              <td>${escapeHtml(r.department)}</td>
              <td>${escapeHtml(r.location)}</td>
              <td>${r.tasksAssigned}</td>
              <td>${r.tasksCompleted}</td>
              <td>${r.tasksOpen}</td>
              <td>${r.tasksOverdue ? `<span class="badge danger">${r.tasksOverdue}</span>` : "0"}</td>
              <td>${r.revisionRequests}</td>
              <td>${r.scriptsSubmitted}</td>
              <td>${r.scriptsApproved}</td>
            </tr>`).join("")}
        </table>
      </div>
    </div>`;
}


/* ---- Sign-in: password, two-factor code, forgot password, reset ---- */
function login(message = "") {
  app.innerHTML = `
    <div class="login">
      <div class="card">
        <h1>Vids Production CRM</h1>
        <p>Secure production management</p>
        <input id="loginUsername" placeholder="Username" autocomplete="username">
        <input id="loginPassword" type="password" placeholder="Password" autocomplete="current-password">
        <div id="otpBox" hidden>
          <input id="loginOtp" placeholder="6-digit code from your authenticator app" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
        </div>
        <button onclick="doLogin()">Login</button>
        <p id="loginError">${escapeHtml(message)}</p>
        <a href="#" class="linkBtn" onclick="showForgot();return false;">Forgot password?</a>
        <small>Work-only CRM · Video · Graphic · Content</small>
      </div>
    </div>`;

  document.getElementById("loginPassword").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  document.getElementById("loginOtp").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
}

async function doLogin() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const otpBox = document.getElementById("otpBox");
  const otp = document.getElementById("loginOtp").value.trim();
  const errorEl = document.getElementById("loginError");

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, otp: otpBox.hidden ? undefined : otp })
    });

    if (data.requires2fa) {
      otpBox.hidden = false;
      errorEl.textContent = data.method === "email"
        ? "We emailed you a 6-digit code. Enter it below (valid 10 minutes)."
        : "Enter the 6-digit code from your authenticator app.";
      document.getElementById("loginOtp").focus();
      return;
    }

    token = data.token;
    user = data.user;
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    render();
  } catch (error) {
    errorEl.textContent = error.message;
  }
}

function showForgot() {
  app.innerHTML = `
    <div class="login">
      <div class="card">
        <h1>Reset password</h1>
        <p>Enter the email address on your account and we will send you a reset link.</p>
        <input id="forgotEmail" type="email" placeholder="name@example.com" autocomplete="email">
        <button onclick="sendReset()">Send reset link</button>
        <p id="loginError"></p>
        <a href="#" class="linkBtn" onclick="login();return false;">Back to login</a>
      </div>
    </div>`;
}

async function sendReset() {
  const email = document.getElementById("forgotEmail").value.trim();
  const errorEl = document.getElementById("loginError");
  try {
    const data = await api("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) });
    errorEl.textContent = data.message;
  } catch (error) {
    errorEl.textContent = error.message;
  }
}

function showReset(token) {
  app.innerHTML = `
    <div class="login">
      <div class="card">
        <h1>Choose a new password</h1>
        <p>At least 8 characters.</p>
        <input id="newPassword" type="password" placeholder="New password" autocomplete="new-password">
        <input id="confirmPassword" type="password" placeholder="Repeat new password" autocomplete="new-password">
        <button onclick="resetPassword('${escapeHtml(token)}')">Save new password</button>
        <p id="loginError"></p>
      </div>
    </div>`;
}

async function resetPassword(token) {
  const newPassword = document.getElementById("newPassword").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  const errorEl = document.getElementById("loginError");

  if (newPassword !== confirmPassword) {
    errorEl.textContent = "The two passwords do not match.";
    return;
  }

  try {
    await api("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, newPassword }) });
    history.replaceState(null, "", location.pathname);
    login("Password updated. Please log in with your new password.");
  } catch (error) {
    errorEl.textContent = error.message;
  }
}

/* ---- Clients: create a client login ---- */
async function clientsPage(c) {
  const rows = await api("/api/clients");

  c.innerHTML = `
    <div class="top">
      <h1>Clients</h1>
      <button onclick="newClient()">+ New Client</button>
    </div>
    <div class="panel tableWrap">
      ${rows.length ? `
      <table class="table">
        <tr><th>Company</th><th>Contact</th><th>Email</th><th>Phone</th><th>Location</th><th>Client portal</th><th>Actions</th></tr>
        ${rows.map(x => `
          <tr>
            <td>${escapeHtml(x.company)}</td>
            <td>${escapeHtml(x.contactName || "-")}</td>
            <td>${escapeHtml(x.email || "-")}</td>
            <td>${escapeHtml(x.phone || "-")}</td>
            <td>${escapeHtml(x.location)}</td>
            <td>${x.portalUserId
              ? `<span class="badge success">Login active</span>`
              : `<button class="smallBtn" onclick="createPortalLogin('${x.id}')">Create login</button>`}</td>
            <td>${isAdminUser(user) ? `<button class="smallBtn danger" onclick="deleteRecord('clients','${x.id}')">Delete</button>` : ""}</td>
          </tr>`).join("")}
      </table>` : "<p>No clients yet.</p>"}
    </div>`;
}

function createPortalLogin(clientId) {
  openFormDialog({
    title: "Create client login",
    hint: "The client signs in to the Client Portal with these details to see their projects. Share the temporary password privately.",
    fields: [
      { key: "username", label: "Username", required: true, placeholder: "e.g. sunrise.foods" },
      { key: "password", label: "Temporary password", type: "password", required: true, placeholder: "At least 8 characters" }
    ],
    submitLabel: "Create login",
    onSubmit: async v => {
      await api(`/api/clients/${clientId}/portal`, { method: "POST", body: JSON.stringify(v) });
      toast("Client login created");
      page("clients");
    }
  });
}

/* ---- Client portal (projects only) ---- */
async function clientPortalPage(c) {
  const d = await api("/api/portal/summary");

  c.innerHTML = `
    <div class="top">
      <h1>Welcome, ${escapeHtml(d.client.contactName || d.client.company)}</h1>
      <span class="badge">${escapeHtml(d.client.company)}</span>
    </div>

    <div class="panel tableWrap">
      <h3>Your projects</h3>
      ${d.projects.length ? `
      <table class="table">
        <tr><th>Project</th><th>Type</th><th>Status</th><th>Deadline</th></tr>
        ${d.projects.map(p => `
          <tr>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.projectType || "-")}</td>
            <td>${escapeHtml(p.status || "-")}</td>
            <td>${escapeHtml(p.dueDate || "-")}</td>
          </tr>`).join("")}
      </table>` : "<p>No projects yet.</p>"}
    </div>`;
}

/* ---- Security: password and two-factor sign-in ---- */
async function securityPage(c) {
  const me = (await api("/api/auth/me")).user;

  c.innerHTML = `
    <div class="top"><h1>Security</h1></div>

    <div class="panel">
      <h3>Change password</h3>
      <div class="field"><label for="curPw">Current password</label><input id="curPw" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="newPw">New password</label><input id="newPw" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
      <div class="field"><label for="confPw">Repeat new password</label><input id="confPw" type="password" autocomplete="new-password"></div>
      <div class="formActions"><button onclick="changeMyPassword()">Change password</button></div>
    </div>

    <div class="panel" id="twoFactorPanel">
      <h3>Two-factor sign-in</h3>
      <p>Status: ${me.twoFactorEnabled ? `<span class="badge success">On (${me.twoFactorMethod === "email" ? "email code" : "authenticator app"})</span>` : `<span class="badge warning">Off</span>`}</p>
      ${me.twoFactorEnabled
        ? (me.twoFactorMethod === "email" ? emailTwoFactorDisableHtml() : twoFactorDisableHtml())
        : `<p>Choose how you want to receive the code when you sign in:</p>
           <div class="formActions">
             <button onclick="startTwoFactorSetup(this)">Authenticator app</button>
             <button class="ghostBtn" onclick="startEmailSetup(this)">Email code</button>
           </div>
           ${me.hasEmail ? "" : `<p class="muted">The email code needs an email address on your account. Ask the administrator to add one.</p>`}`}
    </div>`;
}

function emailTwoFactorDisableHtml() {
  return `
    <p>Each sign-in sends a 6-digit code to your email.</p>
    <div class="field" style="max-width:360px"><label for="efPw">Current password</label><input id="efPw" type="password" autocomplete="current-password"></div>
    <div class="formActions"><button class="smallBtn danger" onclick="disableEmailTwoFactor()">Turn off email code</button></div>`;
}

async function startEmailSetup(button) {
  if (button) button.disabled = true;
  try {
    const { sentTo } = await api("/api/auth/2fa/email/start", { method: "POST", body: "{}" });
    document.getElementById("twoFactorPanel").innerHTML = `
      <h3>Two-factor sign-in</h3>
      <p>We sent a 6-digit code to <b>${escapeHtml(sentTo)}</b>. Enter it to turn email code sign-in on.</p>
      <div class="field" style="max-width:360px"><label for="emailSetupCode">Code from the email</label><input id="emailSetupCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
      <div class="formActions">
        <button onclick="confirmEmailSetup()">Turn on</button>
        <button class="ghostBtn" onclick="page('security')">Cancel</button>
      </div>`;
  } catch (error) {
    alert(error.message);
    if (button) button.disabled = false;
  }
}

async function confirmEmailSetup() {
  const code = document.getElementById("emailSetupCode").value.trim();
  try {
    await api("/api/auth/2fa/email/confirm", { method: "POST", body: JSON.stringify({ code }) });
    toast("Email code sign-in is on");
    page("security");
  } catch (error) {
    alert(error.message);
  }
}

async function disableEmailTwoFactor() {
  const password = document.getElementById("efPw").value;
  if (!confirm("Turn off email code sign-in?")) return;
  try {
    await api("/api/auth/2fa/email/disable", { method: "POST", body: JSON.stringify({ password }) });
    toast("Email code sign-in is off");
    page("security");
  } catch (error) {
    alert(error.message);
  }
}

function twoFactorDisableHtml() {
  return `
    <p>Turning this off makes your password the only sign-in check.</p>
    <div class="row">
      <div class="field"><label for="tfPw">Current password</label><input id="tfPw" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="tfCode">Code from your app</label><input id="tfCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
    </div>
    <div class="formActions"><button class="smallBtn danger" onclick="disableTwoFactor()">Turn off two-factor sign-in</button></div>`;
}

async function changeMyPassword() {
  const currentPassword = document.getElementById("curPw").value;
  const newPassword = document.getElementById("newPw").value;
  const confirmPassword = document.getElementById("confPw").value;

  if (newPassword !== confirmPassword) return alert("The new passwords do not match.");
  try {
    const data = await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
    // Other sessions are signed out by the change; keep this one signed in with the fresh token.
    token = data.token;
    localStorage.setItem("token", token);
    toast("Password changed. Other devices have been signed out.");
    page("security");
  } catch (error) {
    alert(error.message);
  }
}

async function startTwoFactorSetup(button) {
  if (button) button.disabled = true;
  try {
    const { secret, otpauth } = await api("/api/auth/2fa/setup", { method: "POST", body: "{}" });
    const grouped = secret.match(/.{1,4}/g).join(" ");
    document.getElementById("twoFactorPanel").innerHTML = `
      <h3>Two-factor sign-in</h3>
      <p>In Google Authenticator, Microsoft Authenticator or Authy, choose "Enter a setup key" and type this key:</p>
      <div class="setupBox">
        <code class="setupKey" id="setupKeyText">${escapeHtml(grouped)}</code>
        <button type="button" class="smallBtn" onclick="copySetupKey()">Copy key</button>
      </div>
      <p class="muted">Spaces in the key do not matter. On a phone you can also <a href="${escapeHtml(otpauth)}">open the setup link</a>.</p>
      <div class="row">
        <div class="field"><label for="tfEnableCode">Six-digit code from the app</label><input id="tfEnableCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
      </div>
      <div class="formActions">
        <button onclick="enableTwoFactor()">Turn on</button>
        <button class="ghostBtn" onclick="startTwoFactorSetupAgain()">Get a new key</button>
        <button class="ghostBtn" onclick="cancelTwoFactorSetup()">Cancel</button>
      </div>`;
  } catch (error) {
    alert(error.message);
  }
}

function selectSetupKeyText() {
  const range = document.createRange();
  range.selectNodeContents(document.getElementById("setupKeyText"));
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

// Tries the modern clipboard API first, then a classic fallback that works on plain http pages too.
async function copySetupKey() {
  const text = document.getElementById("setupKeyText").textContent.replace(/\s/g, "");
  let copied = false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (_) {
    copied = false;
  }

  if (!copied) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      copied = document.execCommand("copy");
    } catch (_) {
      copied = false;
    }
    area.remove();
  }

  if (copied) {
    toast("Key copied. Paste it into your authenticator app.");
  } else {
    selectSetupKeyText();
    toast("Automatic copy is blocked here. The key is selected: press Ctrl+C.");
  }
}

async function cancelTwoFactorSetup() {
  try { await api("/api/auth/2fa/cancel", { method: "POST", body: "{}" }); } catch (_) {}
  page("security");
}

async function startTwoFactorSetupAgain() {
  try { await api("/api/auth/2fa/cancel", { method: "POST", body: "{}" }); } catch (_) {}
  startTwoFactorSetup();
}

async function enableTwoFactor() {
  const code = document.getElementById("tfEnableCode").value.trim();
  try {
    await api("/api/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code }) });
    toast("Two-factor sign-in is on");
    page("security");
  } catch (error) {
    alert(error.message);
  }
}

async function disableTwoFactor() {
  const password = document.getElementById("tfPw").value;
  const code = document.getElementById("tfCode").value.trim();
  if (!confirm("Turn off two-factor sign-in?")) return;
  try {
    await api("/api/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password, code }) });
    toast("Two-factor sign-in is off");
    page("security");
  } catch (error) {
    alert(error.message);
  }
}

async function resetTwoFactor(id) {
  if (!confirm("Reset two-factor sign-in for this employee? They will set it up again on next use.")) return;
  try {
    await api(`/api/users/${id}/reset-2fa`, { method: "POST", body: "{}" });
    toast("Two-factor sign-in reset");
    refreshEmployeeList();
  } catch (error) {
    alert(error.message);
  }
}


/* ---- Live notifications: pop-up while the CRM is open ---- */
let liveAbort = null;
let unreadNotifications = 0;

function updateNotificationBadge(count) {
  unreadNotifications = count;
  const item = document.querySelector('.nav[data-page="notifications"]');
  if (!item) return;
  const base = item.dataset.label || item.textContent.replace(/\s*\(\d+\)$/, "").trim();
  item.dataset.label = base;
  item.textContent = count ? `${base} (${count})` : base;
}

function showNotificationPopup(n) {
  let stack = document.getElementById("notifStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "notifStack";
    stack.className = "notifStack";
    document.body.appendChild(stack);
  }

  const pop = document.createElement("div");
  pop.className = "notifPop";
  pop.innerHTML = `
    <small>${escapeHtml(NOTIFICATION_LABELS[n.type] || "Info")} · from ${escapeHtml(n.sentBy || "CRM")}</small>
    <b>${escapeHtml(n.title)}</b>
    ${n.message ? `<p>${escapeHtml(n.message)}</p>` : ""}`;
  pop.onclick = () => { pop.remove(); page("notifications"); };
  stack.appendChild(pop);
  setTimeout(() => pop.remove(), 9000);
}

function showDesktopNotification(n) {
  if (!window.isSecureContext || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const alert = new Notification(n.title, { body: n.message || "", tag: n.id });
    alert.onclick = () => { window.focus(); page("notifications"); alert.close(); };
  } catch (_) {}
}

function handleLiveNotification(n) {
  updateNotificationBadge(unreadNotifications + 1);
  showNotificationPopup(n);
  showDesktopNotification(n);
  const open = document.querySelector(".nav.active");
  if (open && open.dataset.page === "notifications") page("notifications");
}

async function enableDesktopAlerts() {
  if (!("Notification" in window)) return alert("This browser does not support desktop alerts.");
  const result = await Notification.requestPermission();
  if (result === "granted") {
    toast("Desktop alerts are on");
    page("notifications");
  } else {
    alert("Desktop alerts were not allowed. You can allow them from the browser's site settings.");
  }
}

function stopLiveNotifications() {
  if (liveAbort) liveAbort.abort();
  liveAbort = null;
}

// Keeps one connection open; reconnects with a short back-off if the network drops.
async function startLiveNotifications() {
  stopLiveNotifications();
  const controller = new AbortController();
  liveAbort = controller;

  try {
    const rows = await api("/api/notifications");
    updateNotificationBadge(rows.filter(x => !x.read).length);
  } catch (_) {}

  let delay = 2000;
  while (!controller.signal.aborted) {
    try {
      const response = await fetch("/api/notifications/stream", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) return;
      if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);

      delay = 2000;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const lines = block.split("\n");
          const event = lines.find(l => l.startsWith("event:"));
          const data = lines.filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("\n");
          if (event && event.slice(6).trim() === "notification" && data) {
            handleLiveNotification(JSON.parse(data));
          }
        }
      }
    } catch (_) {
      if (controller.signal.aborted) return;
    }

    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 30000);
  }
}
