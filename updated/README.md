# Vids Production CRM

Node 24-compatible production CRM starter with JWT authentication, role/location access control, production workflow modules, internal project chat, notifications, and audit logs.

## Stack

- Node.js + Express
- JSON-file persistence (`crm-data.json`) — no native database dependency
- Vanilla HTML/CSS/JavaScript frontend
- JWT authentication
- bcryptjs password hashing
- Role + location based access

## Demo login

Username: `admin`  
Password: `ChangeMe123!`

Change the password and `JWT_SECRET` before production use.

## Run

```powershell
npm install
npm start
```

Open:

`http://localhost:3000`

## Data

Application data is stored in `crm-data.json` next to `server.js`. The file is created automatically on first start.

Do not commit `crm-data.json` to source control.

## Main workflow

Writer → HOD Review → HOD Approval → Editor/Designer Assignment → Work → QC → Revision → Final Delivery → Billing (disabled in UI)

Video work routes to Video HOD / Video Production and Graphic work routes to Graphic HOD / Graphic Production. Cross-department handling can be represented through the assignment fields while location access is enforced by the API.

## Security

- JWT sessions expire after 12 hours.
- Passwords are hashed with bcryptjs.
- Non-management users are restricted to their assigned location.
- Master Administrator / CMO / Management can access all locations.
- Audit records are written for important create/update actions.

This is a local/internal starter. For internet-facing production deployment, use HTTPS, a persistent production database, secure secret management, backups, rate limiting, and a proper file/object-storage service.
