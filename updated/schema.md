# Vids Production CRM data model

## Users

`id`, `username`, `passwordHash`, `name`, `email`, `role`, `department`, `location`, `active`, `createdAt`

Departments include:

- Management
- Video HOD
- Graphic HOD
- Video Production
- Graphic Production
- Content Writer

Locations:

- Ahmedabad
- Gandhinagar
- All Locations

## Production

### Scripts
Writer-created scripts with HOD assignment, status, feedback, notes and reference files.

### Projects
Client-linked production projects with project type, priority, status, location, assignee and deadline.

### Tasks
Assigned video/graphic work with HOD, department, instructions, reference files, QC status, revisions and deadline.

## CRM

### Leads
Lead pipeline with company/contact/source/status/location.

### Clients
Client records linked to projects.

### Quotations
Quotation number, client/project, amount, status and location.

### Invoices
Invoice number, client/project, amount and payment status.

### Payments
Invoice-linked received payments.

## Communication

### Chats
Project-linked internal chat rooms.

### Messages
Chat messages with sender, optional file metadata and mentions.

### Notifications
User-specific assignment/review/QC/deadline/chat alerts.

## Audit

Immutable-style activity records containing actor, action, entity, entity ID, details and timestamp.

## Location routing

Video → Video HOD → Video Production  
Graphic → Graphic HOD → Graphic Production

The API enforces location access. Master Administrator, CMO and Management can access all locations.
