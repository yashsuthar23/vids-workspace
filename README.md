# Vids Production CRM — Work-only build

A Node.js/Express production-management app for video and graphic teams: scripts, projects, work/QC board, file attachments, project chat, notifications, and employee reports. Data is stored in `crm-data.json`; uploaded files go to `uploads/`.

Billing (quotations, invoices, payments and finance) has been removed from the app and the server. Existing records in `crm-data.json` are left untouched.

## Access levels

- **Administrator console:** roles `Master Administrator`, `CMO`, `Administrator`. Full menu, including Employees, Clients, Leads, Employee Reports and Audit. These roles are granted only by the system owner with `set-role.js` (see below).
- **Employee workspace:** any other role (for example `Employee`). Opens My Workspace with Projects, Scripts, Work / QC, Chat, Notifications and Security.
- **Client portal:** logins created on the Clients page. Shows the client's projects only.

Department does not grant admin access. An employee in the `Management` department with role `Employee` opens the employee workspace.

## Database (SQLite, for the live team)

The data is kept in `crm.sqlite` when `.env` has `STORAGE=sqlite`. This is the recommended setting for 50+ users. It handles the load on one server (in our test: 60 users at the same time, about 350 requests per second, no errors).

Switching from the JSON file (one time, server stopped):

1. Add `STORAGE=sqlite` to `.env`.
2. Run `node migrate-json-to-sqlite.js`. It copies `crm-data.json` into `crm.sqlite`, checks every collection, and does not change the JSON file.
3. Run `npm start`. Log in and check the data.

The helper scripts (`set-role.js`, `reset-password.js`, `cleanup-test-data.js`) read the same setting, so they work on the right database. Always stop the server before running them.

Backups: on every start and every 24 hours the server saves a copy into `backups\` (`crm-auto-...sqlite`) and keeps the 14 newest. Copy the `backups` folder and `uploads` folder to another drive every day as well. A copy on the same PC does not protect against a lost or broken PC.

Limits: SQLite works with one server running `npm start`. If the company later runs more than one server, or needs 200+ people at once, move to PostgreSQL.

## Production chain

Writer → HOD Review → Approval → Editor/Designer → QC → Revision → Final Delivery

- **Writer** submits a script. **HOD** (Video HOD / Graphic HOD) or an administrator approves it or sends it back with feedback. The writer resubmits.
- **HOD or administrator** assigns work from an approved script to an editor or designer (Production department).
- **Editor/designer** sends the work to QC. **HOD** moves it to Revision or Final Delivery. Revision goes back to QC or on to Final Delivery.

## Creating an employee login

1. Sign in as an administrator and open **Employees → + Add Employee**.
2. Fill in name, username, temporary password (at least 8 characters), department and location. The role is always `Employee`; it cannot be set from this form.
3. Save. The employee signs in at the login screen with that username and password and opens their workspace.

## Run locally (Windows PowerShell)

1. Install Node.js 18 or newer.
2. Extract this folder, e.g. `E:\Flutter\Projects\vids_production_crm`.
3. Copy `.env.example` to `.env` and set a long random `JWT_SECRET`. Configure SMTP if password-reset emails should be sent. Never share `.env`.
4. Run:

   ```powershell
   npm install
   npm run check
   npm start
   ```

5. Open `http://localhost:3000` and sign in with your administrator account.

To give an account administrator access (stop the server first). The Employees form cannot grant it, so this is the only way:

```powershell
node set-role.js <username> Administrator
```

Allowed roles: `Employee`, `Administrator`, `CMO`, `Master Administrator`. The account is signed out everywhere, so the new role applies at its next login. A backup of the data is saved first.

Fixed admin password (recommended): add these lines to `.env` and restart the server. The admin can then always sign in with the same username and password, with no reset command needed:

```
ADMIN_USERNAME=svapnil
ADMIN_PASSWORD=YourStrongPassword
```

When `ADMIN_PASSWORD` is set, changing the admin password on the Security page is overwritten at the next start, so change it in `.env` instead.

To reset an account password without losing data (stop the server first):

```powershell
node reset-password.js <username> "<new password>"
```

## Deploy to a live server

Use a host that keeps a Node process running and has persistent disk storage. Upload the project folder (not `node_modules` or `.env`), set `JWT_SECRET`, `APP_URL` and SMTP values in the host's environment settings, run `npm install`, and start with `npm start`. Keep HTTPS on and persistent storage for `crm-data.json` and `uploads/`. Take a backup before every deployment.

## Notes

- `crm-data.json` holds all records and account data (password hashes included). Keep it private and back it up together with `uploads/`.
- Before real client or employee data goes in, test login, employee creation, task/script workflow, chat, notifications and role permissions on your hosting environment.
- Not yet included: database migration (SQLite/PostgreSQL), pagination, stronger login rate limiting, automated tests, and full mobile/dark-mode QA.

## Clean test data before going live

Stop the server, then run from the project folder:

```powershell
node cleanup-test-data.js
```

This is a dry run: it lists what would change and writes nothing. When the list looks right, run:

```powershell
node cleanup-test-data.js --apply
```

It first saves a backup to `backups\crm-data-before-cleanup-<date>.json`, then blocks the test accounts (raj, abhi, riya, priya, graphic.hod), removes the test scripts ("Reel", "Riya Test Script", "Graphic Test Banner", "30-sec TVC — Festival Special Launch") with their work and files, and keeps the audit history. Accounts are blocked rather than deleted so the history still makes sense.

## Two-factor sign-in (authenticator app)

1. Sign in, open **Security**, click **Authenticator app**. A setup key appears.
2. On the phone install Google Authenticator or Microsoft Authenticator. Tap **+**, choose **Enter a setup key**, type any name, paste the key (spaces do not matter), and choose time-based.
3. The app shows a 6-digit code that changes every 30 seconds. Type the current code on the Security page and click **Turn on**.
4. Next sign-in: enter the password, then the 6-digit code from the app.

If the phone is lost, stop the server and run `node reset-2fa.js <username>`. It turns two-factor sign-in off for that account only. The account then signs in with the password, and the user can turn it on again.
