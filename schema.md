# Vids Production CRM data model

## Users

`id`, `username`, `passwordHash`, `name`, `email`, `role`, `department`, `location`, `active`, `createdAt`, `createdBy`

Roles:

- `Master Administrator`, `CMO`, `Administrator`: administrator console (access to all locations, admin-only pages). Granted only with `set-role.js`.
- `Employee`: employee workspace. Every account created from the Employees form gets this role, and it cannot be changed there. Department does not change this.
- `Client`: client portal login, linked to a client record through `clientId`.

Departments:

- Management
- Video HOD
- Graphic HOD
- Video Production
- Graphic Production
- Content Writer

Locations: a Gujarat city (e.g. Ahmedabad, Surat, Vadodara) or `All Locations`.

## Production

### Scripts
Writer-created scripts with HOD assignment, stage (Writer, HOD Review, Approval, Revision), feedback, notes and reference files.

### Projects
Client-linked production projects with project type, priority, status, location, assignee and deadline.

### Tasks
Assigned video/graphic work with HOD, department, instructions, reference files, QC status, revisions and deadline. Stage: Editor/Designer, QC, Revision, Final Delivery. Work starts at Editor/Designer.

## CRM

### Leads
Lead pipeline with company, contact, source, status and location. Converting a lead creates a client.

### Clients
Client records linked to projects. A client can have a portal login (`portalUserId`).

## Communication

### Chats
Project-linked internal chat rooms with explicit members.

### Messages
Chat messages with sender, optional file metadata and mentions.

### Notifications
User-specific alerts with a type (Info, Holiday, Leave / absence, Work update, Warning, Success).

## Files

`id`, `name`, `size`, `recordType` (tasks, projects, scripts), `recordId`, `storedName` (stored under `uploads/`), `uploadedBy`, `uploadedByName`, `createdAt`

## Audit

Activity records containing actor, action, entity, entity ID, details and timestamp. Password values are never recorded; only changed field names are.

## Security fields on users

`totpSecret`, `totpPendingSecret`, `totpEnabled`, `totpLastStep`, `emailOtpEnabled`, `emailOtpHash`, `emailOtpExpires`, `emailOtpAttempts`, `passwordVersion`, `resetTokenHash`, `resetExpires`, `mustChangePassword`, `clientId`.

## Location routing

Video → Video HOD → Video Production
Graphic → Graphic HOD → Graphic Production

The API enforces location access. Administrators (Master Administrator, CMO, Administrator) can access all locations.

## Legacy data

`crm-data.json` may still contain `invoices`, `quotations` and `payments` arrays from before billing was removed. They are not read or shown by the app and are kept only as historical data.
