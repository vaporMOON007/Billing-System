-- ============================================================
--  BILLING SYSTEM — Full Database Schema
--  PostgreSQL >= 14
--
--  Run with:
--    psql -U postgres -d billing_db -f schema.sql
--
--  Or create the DB first then run:
--    psql -U postgres -c "CREATE DATABASE billing_db;"
--    psql -U postgres -d billing_db -f schema.sql
-- ============================================================

-- ----------------------------------------------------------------
-- 1. USERS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(50)  UNIQUE NOT NULL,
    email           VARCHAR(100) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(100) NOT NULL,
    phone           VARCHAR(15),
    role            VARCHAR(20)  NOT NULL DEFAULT 'EMPLOYEE'
                        CHECK (role IN ('CA', 'EMPLOYEE')),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------
-- 2. COMPANY MASTER  (header_master)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS header_master (
    id               SERIAL PRIMARY KEY,
    company_name     VARCHAR(200) NOT NULL,
    proprietor_name  VARCHAR(100),
    address_line1    VARCHAR(200),
    address_line2    VARCHAR(200),
    city             VARCHAR(100),
    state            VARCHAR(100),
    pincode          VARCHAR(10),
    phone            VARCHAR(15),
    email            VARCHAR(100),
    gstin            VARCHAR(15),
    pan              VARCHAR(10),
    bill_prefix      VARCHAR(20),
    upi_id           VARCHAR(100),
    qr_code_image    TEXT,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------
-- 3. COMPANY BANK DETAILS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS header_bank_details (
    id                   SERIAL PRIMARY KEY,
    header_id            INTEGER NOT NULL REFERENCES header_master(id) ON DELETE CASCADE,
    bank_name            VARCHAR(100),
    account_holder_name  VARCHAR(100),
    account_number       VARCHAR(20),
    ifsc_code            VARCHAR(15),
    branch_name          VARCHAR(100)
);

-- ----------------------------------------------------------------
-- 4. PARTICULARS / SERVICES MASTER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS particulars_master (
    id            SERIAL PRIMARY KEY,
    service_name  VARCHAR(200) NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------
-- 5. GST RATES MASTER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gst_rates_master (
    id               SERIAL PRIMARY KEY,
    rate_name        VARCHAR(50),
    rate_percentage  NUMERIC(5,2) NOT NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------
-- 6. PAYMENT TERMS MASTER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_terms_master (
    id           SERIAL PRIMARY KEY,
    term_name    VARCHAR(100) NOT NULL,
    days_to_add  INTEGER      NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------
-- 7. CLIENTS MASTER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients_master (
    id             SERIAL PRIMARY KEY,
    client_name    VARCHAR(200) NOT NULL,
    contact_person VARCHAR(100),
    phone          VARCHAR(15),
    email          VARCHAR(100),
    gstin          VARCHAR(15) UNIQUE,
    address_line1  VARCHAR(200),
    address_line2  VARCHAR(200),
    city           VARCHAR(100),
    state          VARCHAR(100),
    pincode        VARCHAR(10),
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------
-- 8. BILL NUMBER COUNTERS  (per company × per financial year)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_number_counters (
    id             SERIAL PRIMARY KEY,
    header_id      INTEGER     NOT NULL REFERENCES header_master(id) ON DELETE CASCADE,
    financial_year VARCHAR(10) NOT NULL,   -- e.g. '2526'  (short format used in bill_no)
    last_number    INTEGER     NOT NULL DEFAULT 0,
    UNIQUE (header_id, financial_year)
);

-- ----------------------------------------------------------------
-- 9. BILLS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bills (
    id                   SERIAL PRIMARY KEY,
    header_id            INTEGER      NOT NULL REFERENCES header_master(id),
    client_id            INTEGER      REFERENCES clients_master(id),
    bill_no              VARCHAR(50)  UNIQUE,                           -- assigned on FINALIZE
    bill_date            DATE         NOT NULL,
    due_date             DATE,
    financial_year       VARCHAR(10),                                    -- e.g. '2024-25'
    payment_term_id      INTEGER      REFERENCES payment_terms_master(id),
    notes                TEXT,
    status               VARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
                             CHECK (status IN ('DRAFT','FINALIZED')),
    payment_status       VARCHAR(20)  NOT NULL DEFAULT 'UNPAID'
                             CHECK (payment_status IN ('UNPAID','PARTIAL','PAID')),
    total_invoice_value  NUMERIC(12,2) NOT NULL DEFAULT 0,              -- maintained by trigger
    total_paid           NUMERIC(12,2) NOT NULL DEFAULT 0,              -- maintained by trigger
    override_header_id   INTEGER      REFERENCES header_master(id),     -- cross-company merge
    created_by           INTEGER      REFERENCES users(id),
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------
-- 10. BILL SERVICES  (line items)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_services (
    id               SERIAL PRIMARY KEY,
    bill_id          INTEGER      NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    sr_no            INTEGER      NOT NULL,
    particulars_id   INTEGER      REFERENCES particulars_master(id),
    particulars_other VARCHAR(200),                                     -- free-text if no master match
    service_date     DATE,
    service_year     INTEGER,                                            -- e.g. 2025  → fiscal 2024-25
    amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
    gst_rate_id      INTEGER      REFERENCES gst_rates_master(id),
    gst_amount       NUMERIC(12,2) GENERATED ALWAYS AS (               -- auto-computed
                         ROUND(amount * (
                             SELECT COALESCE(rate_percentage,0)/100
                             FROM gst_rates_master WHERE id = gst_rate_id
                         ), 2)
                     ) STORED,
    total_amount     NUMERIC(12,2) GENERATED ALWAYS AS (               -- auto-computed
                         ROUND(amount + amount * (
                             SELECT COALESCE(rate_percentage,0)/100
                             FROM gst_rates_master WHERE id = gst_rate_id
                         ), 2)
                     ) STORED
);

-- ----------------------------------------------------------------
-- 11. BILL PAYMENTS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_payments (
    id            SERIAL PRIMARY KEY,
    bill_id       INTEGER      NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    payment_date  DATE         NOT NULL,
    amount_paid   NUMERIC(12,2) NOT NULL,
    payment_mode  VARCHAR(10)  NOT NULL DEFAULT 'NEFT'
                      CHECK (payment_mode IN ('NEFT','UPI','CASH')),
    notes         TEXT,
    recorded_by   INTEGER      REFERENCES users(id),
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------
-- 12. BILL MERGES  (tracks which source bills were merged into a new bill)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_merges (
    id              SERIAL PRIMARY KEY,
    merged_bill_id  INTEGER   NOT NULL REFERENCES bills(id) ON DELETE CASCADE,  -- the NEW merged bill
    source_bill_id  INTEGER   NOT NULL REFERENCES bills(id),                    -- an original bill
    merged_by       INTEGER   REFERENCES users(id),
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------
-- 13. ACTIVITY LOG  (audit trail)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
    id           SERIAL PRIMARY KEY,
    performed_by INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    action       VARCHAR(50) NOT NULL,
    entity_type  VARCHAR(30),
    entity_id    INTEGER,
    description  TEXT,
    metadata     JSONB,
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ================================================================
-- TRIGGERS
-- ================================================================

-- ----------------------------------------------------------------
-- T1. Assign bill_no when a DRAFT bill is FINALIZED
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_bill_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix       VARCHAR(20);
    v_fy_short     VARCHAR(6);
    v_next_number  INTEGER;
BEGIN
    -- Only fires when status flips to FINALIZED and bill_no is not yet set
    IF NEW.status = 'FINALIZED' AND (OLD.status IS DISTINCT FROM 'FINALIZED') AND NEW.bill_no IS NULL THEN

        -- Get company prefix
        SELECT COALESCE(bill_prefix, 'INV')
        INTO v_prefix
        FROM header_master
        WHERE id = COALESCE(NEW.override_header_id, NEW.header_id);

        -- Build short FY  e.g. financial_year '2024-25' → '2425'
        v_fy_short := RIGHT(SPLIT_PART(NEW.financial_year, '-', 1), 2)
                   || SPLIT_PART(NEW.financial_year, '-', 2);

        -- Increment counter (upsert)
        INSERT INTO bill_number_counters (header_id, financial_year, last_number)
        VALUES (COALESCE(NEW.override_header_id, NEW.header_id), v_fy_short, 1)
        ON CONFLICT (header_id, financial_year)
        DO UPDATE SET last_number = bill_number_counters.last_number + 1
        RETURNING last_number INTO v_next_number;

        -- Assign bill_no: e.g.  INV/2425/001
        NEW.bill_no := v_prefix || '/' || v_fy_short || '/' || LPAD(v_next_number::TEXT, 3, '0');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_bill_number ON bills;
CREATE TRIGGER trg_assign_bill_number
    BEFORE UPDATE ON bills
    FOR EACH ROW
    EXECUTE FUNCTION assign_bill_number();

-- ----------------------------------------------------------------
-- T2. Recalculate total_invoice_value on bills after service INSERT/UPDATE/DELETE
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalculate_bill_total()
RETURNS TRIGGER AS $$
DECLARE
    v_bill_id INTEGER;
BEGIN
    v_bill_id := COALESCE(NEW.bill_id, OLD.bill_id);

    UPDATE bills
    SET total_invoice_value = (
        SELECT COALESCE(SUM(total_amount), 0)
        FROM bill_services
        WHERE bill_id = v_bill_id
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE id = v_bill_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalculate_bill_total ON bill_services;
CREATE TRIGGER trg_recalculate_bill_total
    AFTER INSERT OR UPDATE OR DELETE ON bill_services
    FOR EACH ROW
    EXECUTE FUNCTION recalculate_bill_total();

-- ----------------------------------------------------------------
-- T3. Update bill payment_status + total_paid after payment INSERT
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_bill_payment_status()
RETURNS TRIGGER AS $$
DECLARE
    v_total_invoice  NUMERIC;
    v_total_paid     NUMERIC;
    v_new_status     VARCHAR(20);
BEGIN
    SELECT COALESCE(SUM(amount_paid), 0)
    INTO v_total_paid
    FROM bill_payments
    WHERE bill_id = NEW.bill_id;

    SELECT COALESCE(total_invoice_value, 0)
    INTO v_total_invoice
    FROM bills
    WHERE id = NEW.bill_id;

    IF v_total_paid <= 0 THEN
        v_new_status := 'UNPAID';
    ELSIF v_total_paid < v_total_invoice THEN
        v_new_status := 'PARTIAL';
    ELSE
        v_new_status := 'PAID';
    END IF;

    UPDATE bills
    SET payment_status = v_new_status,
        total_paid     = v_total_paid,
        updated_at     = CURRENT_TIMESTAMP
    WHERE id = NEW.bill_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_bill_payment_status ON bill_payments;
CREATE TRIGGER trg_update_bill_payment_status
    AFTER INSERT ON bill_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_bill_payment_status();

-- ----------------------------------------------------------------
-- T4. Update bill payment_status + total_paid after payment DELETE
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_bill_payment_status_on_delete()
RETURNS TRIGGER AS $$
DECLARE
    v_total_invoice  NUMERIC;
    v_total_paid     NUMERIC;
    v_new_status     VARCHAR(20);
BEGIN
    SELECT COALESCE(SUM(amount_paid), 0)
    INTO v_total_paid
    FROM bill_payments
    WHERE bill_id = OLD.bill_id;

    SELECT COALESCE(total_invoice_value, 0)
    INTO v_total_invoice
    FROM bills
    WHERE id = OLD.bill_id;

    IF v_total_paid <= 0 THEN
        v_new_status := 'UNPAID';
    ELSIF v_total_paid < v_total_invoice THEN
        v_new_status := 'PARTIAL';
    ELSE
        v_new_status := 'PAID';
    END IF;

    UPDATE bills
    SET payment_status = v_new_status,
        total_paid     = v_total_paid,
        updated_at     = CURRENT_TIMESTAMP
    WHERE id = OLD.bill_id;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_bill_payment_status_on_delete ON bill_payments;
CREATE TRIGGER trg_update_bill_payment_status_on_delete
    AFTER DELETE ON bill_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_bill_payment_status_on_delete();

-- ================================================================
-- INDEXES  (for common query patterns)
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_bills_header_id       ON bills(header_id);
CREATE INDEX IF NOT EXISTS idx_bills_client_id       ON bills(client_id);
CREATE INDEX IF NOT EXISTS idx_bills_status          ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_payment_status  ON bills(payment_status);
CREATE INDEX IF NOT EXISTS idx_bills_bill_date       ON bills(bill_date);
CREATE INDEX IF NOT EXISTS idx_bills_financial_year  ON bills(financial_year);
CREATE INDEX IF NOT EXISTS idx_bill_services_bill_id ON bill_services(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id ON bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action   ON activity_log(action);
CREATE INDEX IF NOT EXISTS idx_activity_log_created  ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clients_name          ON clients_master(client_name);

-- ================================================================
-- DEFAULT SEED DATA
-- ================================================================

-- Default GST rates
INSERT INTO gst_rates_master (rate_name, rate_percentage) VALUES
    ('GST 0%',   0.00),
    ('GST 5%',   5.00),
    ('GST 12%', 12.00),
    ('GST 18%', 18.00),
    ('GST 28%', 28.00)
ON CONFLICT DO NOTHING;

-- Default payment terms
INSERT INTO payment_terms_master (term_name, days_to_add) VALUES
    ('Immediate',  0),
    ('Net 15',    15),
    ('Net 30',    30),
    ('Net 45',    45),
    ('Net 60',    60)
ON CONFLICT DO NOTHING;

-- Default CA admin user  (password: admin123)
-- Change this password immediately after first login!
INSERT INTO users (username, email, password_hash, full_name, phone, role)
VALUES (
    'admin',
    'admin@billingapp.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password: admin123
    'Administrator',
    '9999999999',
    'CA'
) ON CONFLICT (username) DO NOTHING;

-- ================================================================
-- DONE
-- ================================================================
-- After running this file:
--   1. Log in with  username: admin  /  password: admin123
--   2. Immediately change the admin password from the app
--   3. Add your company details under Masters > Company Master
-- ================================================================
