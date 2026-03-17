-- ============================================================
--  BILLING SYSTEM — Full Database Schema
--  PostgreSQL >= 14
--
--  Run:
--    psql -U postgres -c "CREATE DATABASE CA_FIRM;" -W
--    psql -U postgres -d CA_FIRM -f schema.sql -W
-- ============================================================


-- ================================================================
-- TRIGGER FUNCTIONS  (must exist before triggers are created)
-- ================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION trigger_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Assign bill_no when status flips to FINALIZED
CREATE OR REPLACE FUNCTION assign_bill_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix       VARCHAR(20);
    v_fy_short     VARCHAR(6);
    v_next_number  INTEGER;
BEGIN
    IF NEW.status = 'FINALIZED'
       AND (OLD.status IS DISTINCT FROM 'FINALIZED')
       AND NEW.bill_no IS NULL
    THEN
        SELECT COALESCE(bill_prefix, 'INV')
        INTO v_prefix
        FROM header_master
        WHERE id = COALESCE(NEW.override_header_id, NEW.header_id);

        -- '2024-25'  →  '2425'
        v_fy_short := RIGHT(SPLIT_PART(NEW.financial_year, '-', 1), 2)
                   || SPLIT_PART(NEW.financial_year, '-', 2);

        INSERT INTO bill_number_counters (header_id, financial_year, last_number, prefix)
        VALUES (COALESCE(NEW.override_header_id, NEW.header_id), v_fy_short, 1, v_prefix)
        ON CONFLICT (header_id, financial_year)
        DO UPDATE SET
            last_number = bill_number_counters.last_number + 1,
            updated_at  = CURRENT_TIMESTAMP
        RETURNING last_number INTO v_next_number;

        -- e.g. INV/2425/001
        NEW.bill_no := v_prefix || '/' || v_fy_short || '/' || LPAD(v_next_number::TEXT, 3, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Compute gst_amount on bill_services before insert/update
CREATE OR REPLACE FUNCTION trigger_calculate_gst()
RETURNS TRIGGER AS $$
DECLARE
    v_rate NUMERIC(5,2) := 0;
BEGIN
    IF NEW.gst_rate_id IS NOT NULL THEN
        SELECT COALESCE(rate_percentage, 0)
        INTO v_rate
        FROM gst_rates_master
        WHERE id = NEW.gst_rate_id;
    END IF;

    NEW.gst_amount := ROUND(NEW.amount * v_rate / 100, 2);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recalculate bills.subtotal / gst_total / total_invoice_value after service change
CREATE OR REPLACE FUNCTION trigger_update_bill_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_bill_id       INTEGER;
    v_subtotal      NUMERIC(15,2);
    v_gst_total     NUMERIC(15,2);
    v_invoice_total NUMERIC(15,2);
BEGIN
    v_bill_id := COALESCE(NEW.bill_id, OLD.bill_id);

    SELECT
        COALESCE(SUM(amount), 0),
        COALESCE(SUM(gst_amount), 0),
        COALESCE(SUM(total_amount), 0)
    INTO v_subtotal, v_gst_total, v_invoice_total
    FROM bill_services
    WHERE bill_id = v_bill_id;

    UPDATE bills
    SET subtotal            = v_subtotal,
        gst_total           = v_gst_total,
        total_invoice_value = v_invoice_total,
        updated_at          = CURRENT_TIMESTAMP
    WHERE id = v_bill_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Update bills.payment_status + total_paid after payment insert/update
CREATE OR REPLACE FUNCTION update_bill_payment_status()
RETURNS TRIGGER AS $$
DECLARE
    v_total_invoice  NUMERIC(15,2);
    v_total_paid     NUMERIC(15,2);
    v_new_status     VARCHAR(20);
    v_last_date      DATE;
BEGIN
    SELECT COALESCE(SUM(amount_paid), 0), MAX(payment_date)
    INTO v_total_paid, v_last_date
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
    SET payment_status    = v_new_status,
        total_paid        = v_total_paid,
        last_payment_date = v_last_date,
        updated_at        = CURRENT_TIMESTAMP
    WHERE id = NEW.bill_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update bills.payment_status + total_paid after payment delete
CREATE OR REPLACE FUNCTION update_bill_payment_status_on_delete()
RETURNS TRIGGER AS $$
DECLARE
    v_total_invoice  NUMERIC(15,2);
    v_total_paid     NUMERIC(15,2);
    v_new_status     VARCHAR(20);
    v_last_date      DATE;
BEGIN
    SELECT COALESCE(SUM(amount_paid), 0), MAX(payment_date)
    INTO v_total_paid, v_last_date
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
    SET payment_status    = v_new_status,
        total_paid        = v_total_paid,
        last_payment_date = v_last_date,
        updated_at        = CURRENT_TIMESTAMP
    WHERE id = OLD.bill_id;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;


-- ================================================================
-- TABLES
-- ================================================================

-- ----------------------------------------------------------------
-- 1. USERS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(100) UNIQUE,
    email           VARCHAR(150) UNIQUE,
    password_hash   VARCHAR(255),
    full_name       VARCHAR(200),
    role            VARCHAR(50)  DEFAULT 'CA'
                        CHECK (role IN ('CA', 'EMPLOYEE', 'ADMIN', 'VIEWER')),
    phone           VARCHAR(15),
    is_active       BOOLEAN      DEFAULT TRUE,
    last_login      TIMESTAMP,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

CREATE OR REPLACE TRIGGER before_update_users
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION trigger_update_timestamp();


-- ----------------------------------------------------------------
-- 2. COMPANY MASTER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS header_master (
    id               SERIAL PRIMARY KEY,
    company_name     VARCHAR(200) NOT NULL,
    proprietor_name  VARCHAR(200),
    address_line1    VARCHAR(300),
    address_line2    VARCHAR(300),
    city             VARCHAR(100),
    state            VARCHAR(100),
    pincode          VARCHAR(10),
    phone            VARCHAR(15),
    email            VARCHAR(150),
    gstin            VARCHAR(15),
    pan              VARCHAR(10),
    is_active        BOOLEAN      DEFAULT TRUE,
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    bill_prefix      VARCHAR(20)  DEFAULT 'INV',
    upi_id           VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_header_master_is_active ON header_master (is_active);


-- ----------------------------------------------------------------
-- 3. COMPANY BANK DETAILS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS header_bank_details (
    id                   SERIAL PRIMARY KEY,
    header_id            INTEGER      NOT NULL UNIQUE REFERENCES header_master(id) ON DELETE CASCADE,
    bank_name            VARCHAR(200),
    account_holder_name  VARCHAR(200),
    account_number       VARCHAR(30),
    ifsc_code            VARCHAR(11),
    branch_name          VARCHAR(200),
    upi_id               VARCHAR(100),
    qr_code_image        TEXT,
    is_active            BOOLEAN      DEFAULT TRUE,
    created_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  header_bank_details                IS 'One bank account per company (1:1 relationship)';
COMMENT ON COLUMN header_bank_details.qr_code_image  IS 'Base64 encoded QR code or file path';


-- ----------------------------------------------------------------
-- 4. PARTICULARS / SERVICES MASTER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS particulars_master (
    id            SERIAL PRIMARY KEY,
    service_name  TEXT         NOT NULL,
    is_active     BOOLEAN      DEFAULT TRUE,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE TRIGGER before_update_particulars_master
    BEFORE UPDATE ON particulars_master
    FOR EACH ROW EXECUTE FUNCTION trigger_update_timestamp();


-- ----------------------------------------------------------------
-- 5. GST RATES MASTER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gst_rates_master (
    id               SERIAL PRIMARY KEY,
    rate_percentage  NUMERIC(5,2) NOT NULL,
    description      VARCHAR(100),
    is_active        BOOLEAN      DEFAULT TRUE,
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE gst_rates_master IS 'GST rate percentages (CAs can add/edit)';


-- ----------------------------------------------------------------
-- 6. PAYMENT TERMS MASTER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_terms_master (
    id           SERIAL PRIMARY KEY,
    term_name    VARCHAR(50)  NOT NULL,
    days_to_add  INTEGER      NOT NULL,
    is_active    BOOLEAN      DEFAULT TRUE,
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);


-- ----------------------------------------------------------------
-- 7. CLIENTS MASTER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients_master (
    id             SERIAL PRIMARY KEY,
    client_name    VARCHAR(200) NOT NULL,
    contact_person VARCHAR(200),
    phone          VARCHAR(15),
    email          VARCHAR(150),
    is_active      BOOLEAN      DEFAULT TRUE,
    created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    gstin          VARCHAR(15)  CONSTRAINT clients_gstin_unique UNIQUE,
    address_line1  VARCHAR(255),
    address_line2  VARCHAR(255),
    city           VARCHAR(100),
    state          VARCHAR(100),
    pincode        VARCHAR(10),
    CONSTRAINT gstin_format_check CHECK (
        gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'
    )
);

COMMENT ON TABLE clients_master IS 'Client/customer information with search capability';

CREATE INDEX IF NOT EXISTS idx_clients_master_client_name ON clients_master (client_name);
CREATE INDEX IF NOT EXISTS idx_clients_master_is_active   ON clients_master (is_active);

CREATE OR REPLACE TRIGGER before_update_clients_master
    BEFORE UPDATE ON clients_master
    FOR EACH ROW EXECUTE FUNCTION trigger_update_timestamp();


-- ----------------------------------------------------------------
-- 8. BILL NUMBER COUNTERS  (per company × per financial year)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_number_counters (
    id             SERIAL PRIMARY KEY,
    header_id      INTEGER      NOT NULL REFERENCES header_master(id) ON DELETE CASCADE,
    financial_year VARCHAR(10),
    last_number    INTEGER      DEFAULT 0,
    prefix         VARCHAR(50),
    created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (header_id, financial_year)
);

CREATE INDEX IF NOT EXISTS idx_bill_counters_header_fy
    ON bill_number_counters (header_id, financial_year);


-- ----------------------------------------------------------------
-- 9. BILL NUMBER SEQUENCE  (global per financial year)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_number_sequence (
    id             SERIAL PRIMARY KEY,
    financial_year VARCHAR(4)   NOT NULL UNIQUE,
    last_sequence  INTEGER      DEFAULT 0,
    updated_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  bill_number_sequence                IS 'Tracks last bill number for each financial year';
COMMENT ON COLUMN bill_number_sequence.financial_year IS 'Format: 2425 for FY 2024-25';


-- ----------------------------------------------------------------
-- 10. PASSWORD RESET TOKENS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    token       VARCHAR(255) NOT NULL UNIQUE,
    expires_at  TIMESTAMP    NOT NULL,
    used        BOOLEAN      DEFAULT FALSE,
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens (token);
CREATE INDEX IF NOT EXISTS idx_password_reset_user  ON password_reset_tokens (user_id);


-- ----------------------------------------------------------------
-- 11. BILLS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bills (
    id                   SERIAL PRIMARY KEY,
    bill_no              VARCHAR(50)   UNIQUE,
    header_id            INTEGER       NOT NULL REFERENCES header_master(id),
    created_by           INTEGER       NOT NULL REFERENCES users(id),
    bill_date            DATE          NOT NULL,
    financial_year       VARCHAR(10)   NOT NULL,
    payment_term_id      INTEGER       NOT NULL REFERENCES payment_terms_master(id),
    due_date             DATE          NOT NULL,
    subtotal             NUMERIC(15,2) DEFAULT 0,
    gst_total            NUMERIC(15,2) DEFAULT 0,
    total_invoice_value  NUMERIC(15,2) DEFAULT 0,
    status               VARCHAR(50)   DEFAULT 'DRAFT'
                             CHECK (status IN ('DRAFT', 'FINALIZED', 'ABSORBED')),
    notes                TEXT,
    created_at           TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    client_id            INTEGER       REFERENCES clients_master(id),
    total_paid           NUMERIC(15,2) DEFAULT 0,
    payment_status       VARCHAR(20)   DEFAULT 'UNPAID'
                             CHECK (payment_status IN ('UNPAID', 'PARTIAL', 'PAID')),
    last_payment_date    DATE,
    override_header_id   INTEGER       REFERENCES header_master(id)
);

COMMENT ON TABLE  bills              IS 'Main invoice/bill information';
COMMENT ON COLUMN bills.bill_no      IS 'Format: INV/2425/001 (per company per FY)';
COMMENT ON COLUMN bills.financial_year IS 'Format: 2024-25 (Apr-Mar)';
COMMENT ON COLUMN bills.status       IS 'DRAFT, FINALIZED, ABSORBED';

CREATE INDEX IF NOT EXISTS idx_bills_bill_date       ON bills (bill_date);
CREATE INDEX IF NOT EXISTS idx_bills_bill_no         ON bills (bill_no);
CREATE INDEX IF NOT EXISTS idx_bills_client_id       ON bills (client_id);
CREATE INDEX IF NOT EXISTS idx_bills_created_by      ON bills (created_by);
CREATE INDEX IF NOT EXISTS idx_bills_financial_year  ON bills (financial_year);
CREATE INDEX IF NOT EXISTS idx_bills_header_id       ON bills (header_id);
CREATE INDEX IF NOT EXISTS idx_bills_payment_status  ON bills (payment_status);
CREATE INDEX IF NOT EXISTS idx_bills_status          ON bills (status);

CREATE OR REPLACE TRIGGER before_update_bills
    BEFORE UPDATE ON bills
    FOR EACH ROW EXECUTE FUNCTION trigger_update_timestamp();

CREATE OR REPLACE TRIGGER trigger_assign_bill_number
    BEFORE INSERT OR UPDATE ON bills
    FOR EACH ROW EXECUTE FUNCTION assign_bill_number();


-- ----------------------------------------------------------------
-- 12. BILL SERVICES  (line items)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_services (
    id                SERIAL PRIMARY KEY,
    bill_id           INTEGER       NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    sr_no             INTEGER       NOT NULL,
    particulars_id    INTEGER       NOT NULL REFERENCES particulars_master(id),
    particulars_other TEXT,
    service_date      DATE,
    service_year      VARCHAR(10),
    amount            NUMERIC(15,2) NOT NULL,
    gst_rate_id       INTEGER       NOT NULL REFERENCES gst_rates_master(id),
    gst_amount        NUMERIC(15,2) DEFAULT 0,
    total_amount      NUMERIC(15,2) GENERATED ALWAYS AS ((amount + gst_amount)) STORED,
    created_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE  bill_services               IS 'Individual service line items in each bill';
COMMENT ON COLUMN bill_services.sr_no         IS 'Auto-numbered serial number (1, 2, 3...)';
COMMENT ON COLUMN bill_services.particulars_other IS 'Free text when "Other" is selected';

CREATE INDEX IF NOT EXISTS idx_bill_services_bill_id ON bill_services (bill_id);

CREATE OR REPLACE TRIGGER before_insert_update_bill_services
    BEFORE INSERT OR UPDATE ON bill_services
    FOR EACH ROW EXECUTE FUNCTION trigger_calculate_gst();

CREATE OR REPLACE TRIGGER after_insert_update_delete_bill_services
    AFTER INSERT OR UPDATE OR DELETE ON bill_services
    FOR EACH ROW EXECUTE FUNCTION trigger_update_bill_totals();


-- ----------------------------------------------------------------
-- 13. BILL PAYMENTS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_payments (
    id            SERIAL PRIMARY KEY,
    bill_id       INTEGER       NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    payment_date  DATE          NOT NULL,
    amount_paid   NUMERIC(15,2) NOT NULL,
    notes         TEXT,
    recorded_by   INTEGER       REFERENCES users(id),
    created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    payment_mode  VARCHAR(10)   DEFAULT 'NEFT',
    CONSTRAINT bill_payments_amount_paid_check CHECK (amount_paid > 0)
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id ON bill_payments (bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_date    ON bill_payments (payment_date);

CREATE OR REPLACE TRIGGER update_payment_status_on_insert
    AFTER INSERT ON bill_payments
    FOR EACH ROW EXECUTE FUNCTION update_bill_payment_status();

CREATE OR REPLACE TRIGGER update_payment_status_on_delete
    AFTER DELETE ON bill_payments
    FOR EACH ROW EXECUTE FUNCTION update_bill_payment_status_on_delete();

CREATE OR REPLACE TRIGGER trigger_update_bill_payment_status
    AFTER INSERT OR UPDATE OR DELETE ON bill_payments
    FOR EACH ROW EXECUTE FUNCTION update_bill_payment_status();


-- ----------------------------------------------------------------
-- 14. BILL MERGES
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_merges (
    id              SERIAL PRIMARY KEY,
    merged_bill_id  INTEGER    NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    source_bill_id  INTEGER    NOT NULL UNIQUE REFERENCES bills(id) ON DELETE RESTRICT,
    merged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    merged_by       INTEGER    REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bill_merges_merged ON bill_merges (merged_bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_merges_source ON bill_merges (source_bill_id);


-- ----------------------------------------------------------------
-- 15. BILL HISTORY  (PDF / email / WhatsApp audit)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_history (
    id                SERIAL PRIMARY KEY,
    bill_id           INTEGER      NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    action_type       VARCHAR(50),
    action_by         INTEGER      NOT NULL REFERENCES users(id),
    recipient_email   VARCHAR(150),
    recipient_phone   VARCHAR(15),
    action_timestamp  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    status            VARCHAR(50)  DEFAULT 'SUCCESS',
    error_message     TEXT
);

COMMENT ON TABLE  bill_history             IS 'Audit trail for PDF, email, WhatsApp actions';
COMMENT ON COLUMN bill_history.action_type IS 'PDF_GENERATED, EMAIL_SENT, WHATSAPP_SHARED';

CREATE INDEX IF NOT EXISTS idx_bill_history_bill_id     ON bill_history (bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_history_action_type ON bill_history (action_type);


-- ----------------------------------------------------------------
-- 16. ACTIVITY LOG  (audit trail)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
    id           BIGSERIAL PRIMARY KEY,
    performed_by INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    action       VARCHAR(50)  NOT NULL,
    entity_type  VARCHAR(30)  NOT NULL,
    entity_id    INTEGER,
    description  TEXT,
    metadata     JSONB,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at
    ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity
    ON activity_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_performed_by
    ON activity_log (performed_by);


-- ================================================================
-- DEFAULT SEED DATA
-- ================================================================

INSERT INTO gst_rates_master (rate_percentage, description) VALUES
    ( 0.00, 'GST 0%'),
    ( 5.00, 'GST 5%'),
    (12.00, 'GST 12%'),
    (18.00, 'GST 18%'),
    (28.00, 'GST 28%')
ON CONFLICT DO NOTHING;

INSERT INTO payment_terms_master (term_name, days_to_add) VALUES
    ('Immediate',  0),
    ('Net 15',    15),
    ('Net 30',    30),
    ('Net 45',    45),
    ('Net 60',    60)
ON CONFLICT DO NOTHING;

-- Default admin user  (password: admin123)
-- CHANGE THIS PASSWORD immediately after first login!
INSERT INTO users (username, email, password_hash, full_name, phone, role)
VALUES (
    'admin',
    'admin@billingapp.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'Administrator',
    '9999999999',
    'CA'
) ON CONFLICT (username) DO NOTHING;

-- ================================================================
-- DONE
-- Log in:  username → admin   password → admin123
-- ================================================================
