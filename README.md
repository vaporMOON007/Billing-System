# Billing System — CA Firm Invoice Manager

A full-stack billing and invoicing application built for Chartered Accountant firms. Supports multiple entities (companies), client management, GST-compliant invoicing, payment tracking, and PDF generation.

---

## Tech Stack

| Layer     | Technology                              |
|-----------|-----------------------------------------|
| Frontend  | React 19, Vite, Tailwind CSS            |
| Backend   | Node.js, Express v5                     |
| Database  | PostgreSQL                              |
| Auth      | JWT (JSON Web Tokens)                   |
| PDF       | PDFKit (server-side generation)         |
| Email     | Nodemailer                              |

---

## Project Structure

```
Billing-System/
├── backend/
│   ├── config/
│   │   └── database.js          # PostgreSQL connection pool
│   ├── controllers/
│   │   ├── authController.js    # Login, register, user management
│   │   ├── billController.js    # Bills CRUD, finalize, PDF, email
│   │   ├── clientController.js  # Client master CRUD
│   │   ├── masterController.js  # Header, bank, GST rates, payment terms
│   │   ├── paymentController.js # Record & view payments
│   │   ├── reportController.js  # Financial reports
│   │   └── bulkImportController.js # Bulk client import via CSV/Excel
│   ├── middleware/
│   │   └── auth.js              # JWT verification middleware
│   ├── routes/                  # Express route definitions
│   └── server.js                # App entry point (port 5000)
│
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.jsx         # Overview and stats
│       │   ├── PrintBillPage.jsx     # Bill list, preview, print, payment
│       │   ├── ServicesFormPage.jsx  # Create / edit bills
│       │   └── MastersPage.jsx       # Manage all master data
│       ├── components/
│       │   ├── modals/               # PaymentHistoryPopup, MarkPaymentModal, etc.
│       │   └── common/               # Shared UI components
│       ├── services/
│       │   └── api.js                # Axios API calls
│       └── context/
│           └── AuthContext.jsx       # Global auth state
│
├── DATABASE_SETUP.sql            # Complete DB schema — run on fresh environment
└── FIX_trigger_and_backfill.sql  # Trigger fix + data backfill for existing DBs
```

---

## Database Setup (Fresh Environment)

1. Create a new PostgreSQL database (e.g. `billing_db`)
2. Open **pgAdmin → Query Tool**
3. Run `DATABASE_SETUP.sql` — creates all 11 tables, 4 trigger functions, indexes, and seed data
4. That's it — the schema is fully self-contained

### Tables

| Table                  | Purpose                                              |
|------------------------|------------------------------------------------------|
| `users`                | Login accounts — roles: `CA` or `EMPLOYEE`          |
| `header_master`        | Your firm's companies / entities                     |
| `header_bank_details`  | Bank account info per entity (separate table)        |
| `clients_master`       | Clients you bill                                     |
| `particulars_master`   | Service types (e.g. "GST Filing", "ITR Filing")      |
| `gst_rates_master`     | GST rate percentages (0%, 5%, 12%, 18%, 28%)         |
| `payment_terms_master` | Due date rules (e.g. Net 30)                         |
| `bill_number_counters` | Per-entity per-FY sequence for auto bill numbering   |
| `bills`                | Invoice headers                                      |
| `bill_services`        | Line items on each bill                              |
| `bill_payments`        | Payments recorded against each bill                  |

### Triggers

| Trigger                                    | Fires On                    | Does                                              |
|--------------------------------------------|-----------------------------|---------------------------------------------------|
| `trigger_generate_bill_number`             | BEFORE INSERT on `bills`    | Auto-assigns bill_no e.g. `INV/2425/001`          |
| `trigger_calculate_bill_totals`            | BEFORE INSERT/UPDATE on `bill_services` | Computes GST, total per line + rolls up to bill |
| `trigger_recalculate_bill_totals_on_delete`| AFTER DELETE on `bill_services` | Re-rolls up bill totals                       |
| `trigger_update_bill_payment_status`       | AFTER INSERT/UPDATE on `bill_payments` | Updates `total_paid` + `payment_status`      |
| `trigger_update_bill_payment_status_on_delete` | AFTER DELETE on `bill_payments` | Same, on payment deletion                  |

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

| Role       | Permissions                                                      |
|------------|------------------------------------------------------------------|
| `CA`       | Full access — create, edit, finalize bills, record payments, manage masters |
| `EMPLOYEE` | View bills and reports only — cannot finalize or record payments |

---

## Bill Workflow

```
DRAFT  →  FINALIZED  →  Payment Recorded
```

- **DRAFT** — can be edited or deleted freely
- **FINALIZED** — locked for editing; payments can now be recorded
- **Payment Status** — automatically updated by DB trigger: `UNPAID` → `PARTIAL` → `PAID`

### Bill Numbering Format
```
{PREFIX}/{FYSHORT}/{SEQUENCE}
e.g.  INV/2425/001
```
- `PREFIX` — set per entity in Masters (e.g. `INV`, `ABC`)
- `FYSHORT` — 4-digit financial year code (2024-25 → `2425`)
- `SEQUENCE` — 3-digit auto-incrementing number, resets each financial year per entity

---

## Key Features

- **Multiple entities** — manage billing for several CA firm companies from one app
- **GST-compliant invoices** — GST calculation, GSTIN on header and client, SAC codes
- **UPI QR code** — each entity's UPI ID generates a dynamic QR on the bill with the exact invoice amount pre-filled for the client to scan and pay
- **PDF generation** — server-side PDF download via PDFKit
- **Email invoice** — send bill directly to client's email with Nodemailer
- **Payment tracking** — full payment history per bill, partial payment support
- **Edit locks** — prevents two users from editing the same draft bill simultaneously (in-memory, resets on server restart)
- **Bulk client import** — upload CSV/Excel to import clients in bulk
- **Role-based access** — CA vs Employee permissions enforced on both frontend and backend

---

## API Endpoints (Summary)

| Method | Route                          | Description                  |
|--------|--------------------------------|------------------------------|
| POST   | `/api/auth/login`              | Login                        |
| POST   | `/api/auth/register`           | Register user                |
| GET    | `/api/bills`                   | List all bills (with filters)|
| POST   | `/api/bills`                   | Create bill                  |
| GET    | `/api/bills/:id`               | Get bill by ID               |
| PUT    | `/api/bills/:id`               | Update bill (DRAFT only)     |
| DELETE | `/api/bills/:id`               | Delete bill                  |
| POST   | `/api/bills/:id/finalize`      | Finalize bill                |
| GET    | `/api/bills/:id/pdf`           | Download PDF                 |
| POST   | `/api/bills/:id/email`         | Email invoice to client      |
| GET    | `/api/payments/:billId`        | Get payment history          |
| POST   | `/api/payments`                | Record a payment             |
| GET    | `/api/masters/headers`         | List all entities            |
| GET    | `/api/masters/gst-rates`       | List GST rates               |
| GET    | `/api/clients`                 | List clients                 |
| GET    | `/api/reports`                 | Financial reports            |

---

## Existing Database Fix (One-Time)

If you have an existing database that was set up before the trigger fix, run `FIX_trigger_and_backfill.sql` in pgAdmin. This:
- Corrects the wrong column name (`total_amount` → `total_invoice_value`) in both payment triggers
- Backfills all existing bills with the correct `total_paid` and `payment_status` values

Safe to run multiple times — all operations are idempotent.
