# Billing System — CA Firm Invoice Manager

A full-stack billing and invoicing application built for Chartered Accountant firms. Supports multiple entities (companies), client management, GST-compliant invoicing, payment tracking, and role-based access control.

---

## Tech Stack

| Layer     | Technology                              |
|-----------|-----------------------------------------|
| Frontend  | React 19, Vite, Tailwind CSS            |
| Backend   | Node.js, Express v5                     |
| Database  | PostgreSQL                              |
| Auth      | JWT (JSON Web Tokens)                   |
| PDF       | jsPDF + html2canvas (client-side)       |
| Email     | Nodemailer                              |

---

## Project Structure

```
Billing-System/
├── backend/
│   ├── config/
│   │   └── database.js               # PostgreSQL connection pool
│   ├── controllers/
│   │   ├── activityLogController.js  # Audit log
│   │   ├── authController.js         # Login, register, user management
│   │   ├── billController.js         # Bills CRUD, finalize, merge, lock, email
│   │   ├── clientController.js       # Client master CRUD + bulk import/delete
│   │   ├── masterController.js       # Header, bank accounts, GST rates, payment terms
│   │   ├── passwordResetController.js# Password reset approval workflow
│   │   ├── paymentController.js      # Record & view payments
│   │   └── reportController.js       # Financial reports
│   ├── middleware/
│   │   └── auth.js                   # JWT verification + role-based authorization
│   ├── routes/                       # Express route definitions
│   └── server.js                     # App entry point (port 5000)
│
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.jsx         # Overview and KPI stats
│       │   ├── PrintBillPage.jsx     # Bill list, preview, print, payment
│       │   ├── ServicesFormPage.jsx  # Create / edit bills
│       │   ├── MastersPage.jsx       # Manage all master data
│       │   ├── ReportsPage.jsx       # Financial reports (SUPERADMIN only)
│       │   └── UserManagementPage.jsx# User management (CA only)
│       ├── components/
│       │   ├── modals/               # PaymentHistoryPopup, MarkPaymentModal, etc.
│       │   └── common/               # Shared UI components
│       ├── services/
│       │   └── api.js                # Axios API calls
│       └── context/
│           └── AuthContext.jsx       # Global auth state
│
├── schema.sql        # Complete DB schema — run this on a fresh environment
├── backup.sql        # Local database backup
└── backup_prod.sql   # Production database backup
```

---

## Database Setup (Fresh Environment)

1. Create a new PostgreSQL database (e.g. `billing_db`)
2. Open **pgAdmin → Query Tool**
3. Run `schema.sql` — creates all tables, trigger functions, indexes, and constraints
4. That's it — the schema is fully self-contained

### Tables

| Table                      | Purpose                                                        |
|----------------------------|----------------------------------------------------------------|
| `users`                    | Login accounts — roles: `CA`, `EMPLOYEE`, `SUPERADMIN`        |
| `header_master`            | Your firm's companies / entities                               |
| `header_bank_details`      | Bank accounts per entity (1:many — multiple accounts allowed)  |
| `clients_master`           | Clients you bill                                               |
| `particulars_master`       | Service types (e.g. "GST Filing", "ITR Filing")                |
| `gst_rates_master`         | GST rate percentages (0%, 5%, 12%, 18%, 28%)                   |
| `payment_terms_master`     | Due date rules (e.g. Net 30)                                   |
| `bill_number_counters`     | Per-entity per-FY sequence for auto bill numbering             |
| `bills`                    | Invoice headers                                                |
| `bill_services`            | Line items on each bill                                        |
| `bill_payments`            | Payments recorded against each bill                            |
| `bill_merges`              | Audit trail of which bills were merged                         |
| `bill_writeoffs`           | Audit trail of write-offs on partially paid bills              |
| `password_reset_requests`  | Password reset approval workflow (requires SUPERADMIN approval)|
| `activity_log`             | Audit log of all key actions across the system                 |

### Triggers

| Trigger                          | Fires On                          | Does                                                    |
|----------------------------------|-----------------------------------|---------------------------------------------------------|
| `trigger_assign_bill_number`     | BEFORE INSERT/UPDATE on `bills`   | Auto-assigns bill_no e.g. `INV/2425/001` on finalization|
| `before_insert_update_bill_services` | BEFORE INSERT/UPDATE on `bill_services` | Computes GST amount per line             |
| `after_insert_update_delete_bill_services` | AFTER INSERT/UPDATE/DELETE on `bill_services` | Rolls up subtotal, GST, total to bill |
| `trigger_update_bill_payment_status` | AFTER INSERT/UPDATE/DELETE on `bill_payments` | Updates `total_paid` + `payment_status` |
| `before_update_*`                | BEFORE UPDATE on several tables   | Auto-updates `updated_at` timestamp                     |

---

## Environment Variables

Create a `.env` file inside the `backend/` folder:

```env
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=billing_db
DB_USER=postgres
DB_PASSWORD=your_password
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=7d

# Optional — for sending invoices by email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

---

## Running the App

### Backend
```bash
cd backend
npm install
npm run dev       # development (nodemon)
# or
npm start         # production
```
Runs on `http://localhost:5000`

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Runs on `http://localhost:5173`

---

## User Roles

| Role          | Permissions                                                                          |
|---------------|--------------------------------------------------------------------------------------|
| `SUPERADMIN`  | Full access — all bills, reports, user approvals, password reset approvals, write-offs |
| `CA`          | Create, edit, finalize bills; record payments; manage masters; manage users          |
| `EMPLOYEE`    | Create and edit DRAFT bills; view finalized bills; no access to reports or masters   |

---

## Bill Workflow

```
DRAFT  →  FINALIZED  →  ABSORBED (if merged into another bill)
                   ↓
           Payment Recorded
           UNPAID → PARTIAL → PAID
```

- **DRAFT** — can be edited or deleted freely; protected by DB-backed edit locks (prevents simultaneous edits)
- **FINALIZED** — locked for editing; bill number assigned; payments can now be recorded
- **ABSORBED** — bill was merged into another bill; treated as closed
- **Payment Status** — automatically updated by DB trigger: `UNPAID` → `PARTIAL` → `PAID`

### Bill Numbering Format
```
{PREFIX}/{FYSHORT}/{SEQUENCE}
e.g.  INV/2425/001
```
- `PREFIX` — set per entity in Masters (e.g. `INV`, `ABC`)
- `FYSHORT` — 4-digit financial year code (2024-25 → `2425`)
- `SEQUENCE` — 3-digit auto-incrementing number, resets each FY per entity

---

## Key Features

- **Multiple entities** — manage billing for several companies from one app
- **GST-compliant invoices** — GST calculation, GSTIN on header and client
- **UPI QR code** — each entity's UPI ID generates a dynamic QR on the bill with the invoice amount pre-filled
- **Client-side PDF** — bill preview rendered in-browser with jsPDF + html2canvas
- **Email invoice** — send bill directly to client email via Nodemailer
- **Payment tracking** — full payment history per bill, partial payment support, write-off support
- **DB-backed edit locks** — prevents two users editing the same DRAFT simultaneously; locks survive server restarts
- **Bill merging** — merge multiple DRAFT bills into one; source bills marked ABSORBED
- **Bulk client import** — upload CSV/Excel to import clients in bulk
- **Password reset workflow** — employees request a password reset; SUPERADMIN approves/rejects
- **Audit log** — every key action (create, finalize, delete, payment, merge) is logged with user and timestamp
- **Role-based access** — CA / EMPLOYEE / SUPERADMIN permissions enforced on both frontend and backend

---

## API Endpoints (Summary)

| Method | Route                                  | Description                        |
|--------|----------------------------------------|------------------------------------|
| POST   | `/api/auth/login`                      | Login                              |
| POST   | `/api/auth/register`                   | Register user                      |
| GET    | `/api/auth/users`                      | List all users (CA only)           |
| GET    | `/api/bills`                           | List all bills (with filters)      |
| POST   | `/api/bills`                           | Create bill                        |
| GET    | `/api/bills/:id`                       | Get bill by ID                     |
| PUT    | `/api/bills/:id`                       | Update bill (DRAFT only)           |
| DELETE | `/api/bills/:id`                       | Delete bill (CA only)              |
| PUT    | `/api/bills/:id/finalize`              | Finalize bill (CA only)            |
| POST   | `/api/bills/:id/email`                 | Email invoice to client            |
| POST   | `/api/bills/merge`                     | Merge DRAFT bills                  |
| POST   | `/api/bills/:id/unmerge`               | Unmerge an absorbed bill           |
| POST   | `/api/bills/:id/writeoff`              | Write off remaining balance        |
| POST   | `/api/bills/:id/lock`                  | Acquire edit lock                  |
| PUT    | `/api/bills/:id/lock/refresh`          | Refresh edit lock                  |
| DELETE | `/api/bills/:id/lock`                  | Release edit lock                  |
| GET    | `/api/payments/bill/:billId`           | Get payment history for a bill     |
| POST   | `/api/payments`                        | Record a payment                   |
| GET    | `/api/masters/headers`                 | List all entities                  |
| GET    | `/api/masters/headers/:id/bank-accounts` | List bank accounts for an entity |
| GET    | `/api/masters/gst-rates`               | List GST rates                     |
| GET    | `/api/clients`                         | List clients                       |
| POST   | `/api/clients/bulk-import`             | Bulk import clients from CSV/Excel |
| POST   | `/api/clients/bulk-delete`             | Bulk delete clients                |
| GET    | `/api/reports/dashboard-kpis`          | Dashboard KPIs (SUPERADMIN only)   |
| GET    | `/api/reports/receivables`             | Receivables report (SUPERADMIN only)|
| GET    | `/api/reports/export-bills`            | Export bills to Excel (SUPERADMIN only)|
| POST   | `/api/password-reset/request`          | Submit password reset request      |
| GET    | `/api/password-reset/pending`          | List pending requests (SUPERADMIN) |
| PUT    | `/api/password-reset/:id/approve`      | Approve reset request (SUPERADMIN) |
| GET    | `/api/audit-log`                       | View activity log (CA only)        |
