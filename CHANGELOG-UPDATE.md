# Update notes

## Current state (2026-10-11, latest)

- **Billing removed.** Quotations, invoices, payments and finance are gone from the server (APIs return 404), the menu, the Client Portal and search. Existing data in `crm-data.json` is kept, not deleted.
- **Admin access is decided by role, not department.** Administrator console: roles `Master Administrator`, `CMO`, `Administrator`. Any other role (including an employee in the Management department) opens My Workspace. Previously an employee with department Management saw the admin console.
- **Employee logins from the Employees form work end to end:** admin enters username and password, the employee signs in with them and opens My Workspace. The Add Employee form now explains this and the Role field accepts `Administrator`.
- **Role is locked.** The Employees form always creates the `Employee` role, and an existing account's role cannot be changed there (the Role field is read-only). Admin roles are granted only with `set-role.js <username> <role>` run by the system owner. Previously an administrator could type `CMO` in the form and give that access.
- **Client Portal shows projects only.**
- **Unknown `/api/*` paths return a JSON 404** instead of the HTML page.
- Startup banner shows the correct admin username (`svapnil`).
- **SQLite storage (recommended for live):** `STORAGE=sqlite` in `.env` keeps data in `crm.sqlite`. Saves write only changed rows. Helper scripts and automatic backups work with both JSON and SQLite. Load test: 60 concurrent users, 0 errors, p95 about 250 ms.
- **Production chain:** Writer → HOD Review → Approval → Editor/Designer → QC → Revision → Final Delivery.
  - Scripts: the writer submits (HOD Review). The HOD approves (Approval) or sends it back (Revision, with feedback). The writer resubmits from Revision.
  - Work: only the HOD or an administrator assigns work, from an approved script or as general work, to an employee in a Production department. It starts at Editor/Designer. The assigned editor sends it to QC. The HOD moves it to Revision or Final Delivery, and Revision goes to QC or Final Delivery.
  - The server enforces these moves and roles. Employees do not see Assign Work, and the Work/QC board uses the chain columns.
  - Records saved with the old status names are moved to the new names when the server starts.
  - HODs (Video HOD, Graphic HOD) can see the employee directory so they can pick an assignee. They still cannot create or edit employees.
- **Password change alerts:** when an employee changes their own password, or resets it by email, every active administrator gets a Warning notification ("Password changed" / "Password reset by email"). The employee who made the change is not notified.
- **Stored passwords:** administrators can view the password they set for an employee on the Edit form. Passwords are encrypted (`PASSWORD_VAULT_KEY` in `.env`, or derived from `JWT_SECRET`). Each view is audited without the value. Employee-chosen passwords are not stored.
- **Fixed admin login:** optional `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env`. When `ADMIN_PASSWORD` is set (8+ characters), it becomes the admin password at every start, so reset commands are not needed. Without it, behaviour is unchanged.
- The hard-coded `scommedia` / `scom99` account is no longer created. An existing `scommedia` record is blocked on startup and its password is replaced with a random value. Employees are created only from the Employees form.
- Stale items removed from the open list: SSE is already live (`/api/notifications/stream`), so WebSocket is no longer listed as missing.

Still open: database migration (SQLite/PostgreSQL), pagination, automated tests, mobile/dark-mode QA, task calendar view.

---

## Earlier history
Implemented in this iteration:
- Lead pipeline UI with drag-and-drop status changes, edit/delete, and lead conversion.
- Location-checked PATCH/DELETE routes for Leads, Clients and Projects.
- Quotations UI with print/save-to-PDF and WhatsApp draft share.
- Invoice and payment UI with outstanding balance display, due dates and overdue labels.
- Finance dashboard and `/api/finance/summary` API.
- Authenticated `/api/search?q=` endpoint.

Not yet complete: PostgreSQL/SQLite migration, task Kanban/calendar, client portal, file upload, automated communications, WebSocket/SSE, 2FA, rate limiting, password reset, backups, pagination, comprehensive test suite and full mobile/dark-mode QA. Do not deploy for live client data until these are completed.

## Employees management update
- Employees page: Add Employee form hidden by default, toggled by the button, closes after a successful save, keeps validation messages visible on error.
- Department is a required dropdown starting on "Select Department" (no automatic selection).
- Edit, Block/Unblock and Delete actions per employee, with confirmation dialogs and table refresh after each action.
- New/updated API: POST /api/users (validated), PATCH /api/users/:id (validated, no status changes), POST /api/users/:id/block, POST /api/users/:id/unblock, DELETE /api/users/:id (refused when the employee has linked records).
- Auth middleware now checks the live account on every request, so blocked users lose access immediately.
- Login: blocked accounts are refused after the password is verified, with a clear message.
- ID generation no longer reuses IDs after deletion (applies to all collections).
- Audit log for PATCH no longer records password values; it records changed field names only.

## Admin / user separation
- Administrator login opens the Admin Console (full menu). Regular user login opens My Workspace (Projects, Scripts, Work / QC, Chat, Notifications and personal work stats).
- Server-side gate: /api/leads, /api/clients, /api/quotations, /api/invoices, /api/payments and /api/finance are administrator-only (HTTP 403 otherwise). Search omits those record types for regular users.
- GET /api/users returns the full directory to administrators and only the requesting user's own record to everyone else.
- Admin username changed to `svapnil` (same account, same password). Regular account `scommedia` created at startup (password `scom99`).

## Shared form dialog
- Browser `prompt()` popups replaced with a form dialog styled like the Employee form, used for: New/Edit Lead, New Client, New Project, Submit Script, Assign Work, New Quotation, New Invoice and Add Payment.
- Required fields are marked *, dropdowns are used for fixed choices, and all validation messages are listed together. Escape or clicking outside closes the dialog; Enter submits.
- Existing API calls and payloads are unchanged. Confirmation prompts (delete, convert) are unchanged.

## Location fields
- Location is now a text box with suggestions for 30 Gujarat cities (Surat, Vadodara, Rajkot, ...). Type a city or pick from the list.
- Matching is case-insensitive and saved under the canonical name (e.g. "surat" saves as "Surat"). Other place names are accepted if they contain only letters, spaces, dots, apostrophes or hyphens.
- Non-admin users stay fixed to their own location, as before, because the server only lets them create records in their own location.
- Applies to Add/Edit Employee and to the Client, Project, Script and Work dialogs. The server validates the same rules.

## Location scope (update)
- Location is now asked only for Employees and Clients. New Project, Submit Script and Assign Work no longer show a location field.
- Projects, scripts and tasks created by an admin (All Locations) have no location and are visible to everyone. Items created by a regular user get that user's location.

## Features: Kanban, files, reminders, employee reports
- **Work / QC board:** Work page has a Board view (Assigned, In Progress, QC, Revision, Completed, Delivered) where cards can be dragged to change status. The Table view is still available and remembers your choice.
- **File attachments:** Tasks, projects and scripts have a 📎 Files button. Upload up to 12 MB per file (documents, images, video, audio, zip). Files are stored in the `uploads/` folder, not in `crm-data.json`. Only people who can see the record can download; only the uploader or an administrator can delete.
- **Deadline reminders:** The War Room and My Workspace show overdue items and items due in the next 3 days (tasks and projects).
- **Employee Reports (admin):** New page showing per employee: tasks assigned, completed, open, overdue, revision notes, scripts submitted and approved.
- New API: GET/POST /api/files, GET /api/files/:id/download, DELETE /api/files/:id, GET /api/reports/employees.
- **Backup note:** Back up both `crm-data.json` and the `uploads/` folder. Restoring only the JSON leaves attachment records without files.

## Not included yet
Client portal, 2FA, email password reset, database migration (SQLite/PostgreSQL), and full responsive/dark-mode QA.

## Security and client portal
- **Two-factor sign-in (TOTP):** Anyone can turn it on under Security (works with Google Authenticator, Microsoft Authenticator, Authy). Login asks for the 6-digit code once it is on. Codes cannot be reused. Turning it off needs the password and a current code. Administrators can reset it for an employee who lost their phone (Employees page → Reset 2FA).
- **Password reset by email:** "Forgot password?" on the login screen sends a link valid for 30 minutes, usable once. The reply is the same whether or not the email exists. Changing or resetting a password signs out all other sessions.
- **Security page:** change password (signs out other devices) and two-factor set-up for every user.
- **Client portal:** Administrators create a login for a client on the Clients page ("Create login"). The client sees their quotations (can approve or decline), invoices with balance, and projects. Client logins cannot open any other part of the CRM and are hidden from the Employees list.
- **Mobile fixes:** input font size 16px on phones (stops iPhone zoom on focus), dialogs use the full width on phones, Kanban stacks on small screens.

### Email settings (environment variables)
- `APP_URL`: public address of the CRM, used in reset links (for example `https://crm.example.com`).
- `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE` (`true` for port 465), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
- Without `SMTP_HOST` no email is sent. The reset message is saved in the `outbox/` folder so you can test the flow. Do not run production this way.

### Still not included
- Database migration to SQLite/PostgreSQL (needs a planned data move with a backup first).

## Email code sign-in
- Security page: choose **Authenticator app** or **Email code** for two-factor sign-in.
- Email code: at each sign-in a 6-digit code is emailed to the account address. It is valid for 10 minutes, works once, and locks after 5 wrong tries.
- Turning email codes on needs a code from the email first, so a wrong address is caught at set-up. Turning them off needs the password.
- Requires SMTP settings (see the email section above). Without SMTP the code is saved in `outbox/`.

## Notifications: live pop-ups and email copy
- **Live pop-up:** while the CRM is open, a new notification appears at the top-right (on phones, full width) with its type and sender. Click it to open Notifications. It disappears after 9 seconds.
- **Unread count:** the Notifications menu item shows the number of unread notifications, and updates live.
- **Desktop alerts:** on a secure page (localhost or https), the Notifications page offers "Enable desktop alerts", which shows an OS notification when one arrives.
- **Email copy:** the send form has "Also send this by email". Each employee with an email address gets it. The result shows how many were emailed, how many have no address, and how many failed.
- **Types:** Info, Holiday, Leave / absence, Work update, Warning, Success.
- Live feed uses Server-Sent Events (`GET /api/notifications/stream`). It reconnects automatically if the network drops.

### Not included yet
- Notifications when the browser or phone app is closed (true push). This needs HTTPS hosting and a service worker. A phone on `http://192.168.x.x` cannot receive it.


## Work-only update — 2026-10-11
- Removed billing navigation (quotations, invoices/payments, finance) from the app.
- Disabled legacy billing API paths with an explicit 404 response; local data is preserved, not deleted.
- Enforced explicit chat membership for non-admin users when reading or sending chat messages.
- JavaScript syntax checks pass after this update.
- This is a code update only: no hosting deployment was performed from this environment.
