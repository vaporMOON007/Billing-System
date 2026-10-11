-- ============================================================
-- Billing System — Clean Schema
-- Generated: 2026-06-08
--
-- This file supersedes schema_prod.sql and all migrations.
-- It reflects the actual current state of the database after:
--   - Migration 001: unique bill prefix
--   - Migration 002: bill_writeoffs table
--   - Migration 003: fix delete trigger
--   - Migration 004: finalize zero-value guard
--   - Migration 005: schema cleanup (dropped bill_number_sequence)
--   - Migration 006: multi-bank accounts per company
--   - Migration 007: users username NOT NULL
--   - Migration 008: password_reset_requests table
--   - Migration 009: DB-backed edit locks on bills
--
-- Dead tables removed vs schema_prod.sql:
--   - bill_history        (never written to by backend — planned, not implemented)
--   - bill_number_sequence (dropped by migration 005, still in old schema file)
--   - password_reset_tokens (old design, replaced by password_reset_requests)
-- ============================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- ============================================================
-- FUNCTIONS
-- ============================================================

CREATE FUNCTION public.assign_bill_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;

ALTER FUNCTION public.assign_bill_number() OWNER TO postgres;


CREATE FUNCTION public.trigger_calculate_gst() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;

ALTER FUNCTION public.trigger_calculate_gst() OWNER TO postgres;


CREATE FUNCTION public.trigger_update_bill_totals() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;

ALTER FUNCTION public.trigger_update_bill_totals() OWNER TO postgres;


CREATE FUNCTION public.trigger_update_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.trigger_update_timestamp() OWNER TO postgres;


CREATE FUNCTION public.update_bill_payment_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;

ALTER FUNCTION public.update_bill_payment_status() OWNER TO postgres;


CREATE FUNCTION public.update_bill_payment_status_on_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_total_invoice  NUMERIC;
    v_total_paid     NUMERIC;
    v_new_status     TEXT;
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

    UPDATE public.bills
    SET payment_status = v_new_status,
        total_paid     = v_total_paid,
        updated_at     = CURRENT_TIMESTAMP
    WHERE id = OLD.bill_id;

    RETURN OLD;
END;
$$;

ALTER FUNCTION public.update_bill_payment_status_on_delete() OWNER TO postgres;


-- ============================================================
-- TABLES
-- ============================================================

SET default_tablespace = '';
SET default_table_access_method = heap;

-- ------------------------------------------------------------
-- activity_log
-- ------------------------------------------------------------
CREATE TABLE public.activity_log (
    id bigint NOT NULL,
    performed_by integer,
    action character varying(50) NOT NULL,
    entity_type character varying(30) NOT NULL,
    entity_id integer,
    description text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.activity_log OWNER TO postgres;

CREATE SEQUENCE public.activity_log_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.activity_log_id_seq OWNER TO postgres;
ALTER SEQUENCE public.activity_log_id_seq OWNED BY public.activity_log.id;


-- ------------------------------------------------------------
-- bill_merges
-- ------------------------------------------------------------
CREATE TABLE public.bill_merges (
    id integer NOT NULL,
    merged_bill_id integer NOT NULL,
    source_bill_id integer NOT NULL,
    merged_at timestamp with time zone DEFAULT now() NOT NULL,
    merged_by integer
);

ALTER TABLE public.bill_merges OWNER TO postgres;

CREATE SEQUENCE public.bill_merges_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.bill_merges_id_seq OWNER TO postgres;
ALTER SEQUENCE public.bill_merges_id_seq OWNED BY public.bill_merges.id;


-- ------------------------------------------------------------
-- bill_number_counters
-- Per-company per-FY counter used by assign_bill_number() trigger.
-- Replaces the old bill_number_sequence table (dropped in migration 005).
-- ------------------------------------------------------------
CREATE TABLE public.bill_number_counters (
    id integer NOT NULL,
    header_id integer NOT NULL,
    financial_year character varying(10),
    last_number integer DEFAULT 0,
    prefix character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.bill_number_counters OWNER TO postgres;

CREATE SEQUENCE public.bill_number_counters_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.bill_number_counters_id_seq OWNER TO postgres;
ALTER SEQUENCE public.bill_number_counters_id_seq OWNED BY public.bill_number_counters.id;


-- ------------------------------------------------------------
-- bill_payments
-- ------------------------------------------------------------
CREATE TABLE public.bill_payments (
    id integer NOT NULL,
    bill_id integer NOT NULL,
    payment_date date NOT NULL,
    amount_paid numeric(15,2) NOT NULL,
    notes text,
    recorded_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    payment_mode character varying(10) DEFAULT 'NEFT'::character varying,
    cheque_no character varying(50),
    utr character varying(100),
    cash_collected_by character varying(150),
    received_in_account_id integer,     -- FK → header_bank_details(id), fixed by migration 006
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bill_payments_amount_paid_check CHECK ((amount_paid > (0)::numeric)),
    CONSTRAINT bill_payments_payment_mode_check CHECK (((payment_mode)::text = ANY (
        (ARRAY['NEFT'::character varying, 'UPI'::character varying, 'CASH'::character varying, 'CHEQUE'::character varying])::text[]
    )))
);

ALTER TABLE public.bill_payments OWNER TO postgres;

CREATE SEQUENCE public.bill_payments_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.bill_payments_id_seq OWNER TO postgres;
ALTER SEQUENCE public.bill_payments_id_seq OWNED BY public.bill_payments.id;


-- ------------------------------------------------------------
-- bill_services
-- ------------------------------------------------------------
CREATE TABLE public.bill_services (
    id integer NOT NULL,
    bill_id integer NOT NULL,
    sr_no integer NOT NULL,
    particulars_id integer NOT NULL,
    particulars_other text,
    service_date date,
    service_year character varying(10),
    amount numeric(15,2) NOT NULL,
    gst_rate_id integer NOT NULL,
    gst_amount numeric(15,2) DEFAULT 0,
    total_amount numeric(15,2) GENERATED ALWAYS AS ((amount + gst_amount)) STORED,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    description text
);

ALTER TABLE public.bill_services OWNER TO postgres;

COMMENT ON TABLE  public.bill_services              IS 'Individual service line items in each bill';
COMMENT ON COLUMN public.bill_services.sr_no        IS 'Auto-numbered serial number (1, 2, 3...)';
COMMENT ON COLUMN public.bill_services.particulars_other IS 'Free text when "Other" is selected';

CREATE SEQUENCE public.bill_services_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.bill_services_id_seq OWNER TO postgres;
ALTER SEQUENCE public.bill_services_id_seq OWNED BY public.bill_services.id;


-- ------------------------------------------------------------
-- bill_writeoffs
-- Audit trail of write-offs applied to partially paid finalized bills.
-- Added by migration 002.
-- ------------------------------------------------------------
CREATE TABLE public.bill_writeoffs (
    id integer NOT NULL,
    bill_id integer NOT NULL,
    writeoff_amount numeric(15,2) NOT NULL,
    written_off_by integer,
    writeoff_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bill_writeoffs_writeoff_amount_check CHECK ((writeoff_amount > (0)::numeric))
);

ALTER TABLE public.bill_writeoffs OWNER TO postgres;

COMMENT ON TABLE  public.bill_writeoffs              IS 'Audit trail of write-offs applied to partially paid finalized bills';
COMMENT ON COLUMN public.bill_writeoffs.writeoff_amount IS 'Amount written off (remaining balance at time of write-off)';
COMMENT ON COLUMN public.bill_writeoffs.written_off_by  IS 'User ID of the SUPERADMIN who applied the write-off';

CREATE SEQUENCE public.bill_writeoffs_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.bill_writeoffs_id_seq OWNER TO postgres;
ALTER SEQUENCE public.bill_writeoffs_id_seq OWNED BY public.bill_writeoffs.id;


-- ------------------------------------------------------------
-- bills
-- Includes columns added by migrations 006 (bank_account_id)
-- and 009 (lock_held_by, lock_expires_at).
-- ------------------------------------------------------------
CREATE TABLE public.bills (
    id integer NOT NULL,
    bill_no character varying(50),
    header_id integer NOT NULL,
    created_by integer NOT NULL,
    bill_date date NOT NULL,
    financial_year character varying(10) NOT NULL,
    payment_term_id integer NOT NULL,
    due_date date NOT NULL,
    subtotal numeric(15,2) DEFAULT 0,
    gst_total numeric(15,2) DEFAULT 0,
    total_invoice_value numeric(15,2) DEFAULT 0,
    status character varying(50) DEFAULT 'DRAFT'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    client_id integer,
    total_paid numeric(15,2) DEFAULT 0,
    payment_status character varying(20) DEFAULT 'UNPAID'::character varying,
    last_payment_date date,
    override_header_id integer,
    -- Migration 006: which bank account is printed on this bill
    bank_account_id integer NOT NULL,
    -- Migration 009: DB-backed edit lock (survives server restarts)
    lock_held_by integer,
    lock_expires_at timestamp without time zone,
    CONSTRAINT bills_payment_status_check CHECK (((payment_status)::text = ANY (
        (ARRAY['UNPAID'::character varying, 'PARTIAL'::character varying, 'PAID'::character varying])::text[]
    ))),
    CONSTRAINT bills_status_check CHECK (((status)::text = ANY (
        (ARRAY['DRAFT'::character varying, 'FINALIZED'::character varying, 'ABSORBED'::character varying])::text[]
    )))
);

ALTER TABLE public.bills OWNER TO postgres;

COMMENT ON TABLE  public.bills               IS 'Main invoice/bill information';
COMMENT ON COLUMN public.bills.bill_no       IS 'Format: INV/2425/001 (per company per FY). NULL while in DRAFT.';
COMMENT ON COLUMN public.bills.financial_year IS 'Format: 2024-25 (Apr-Mar)';
COMMENT ON COLUMN public.bills.status        IS 'DRAFT, FINALIZED, ABSORBED';
COMMENT ON COLUMN public.bills.bank_account_id   IS 'Which bank account of the company is printed on this bill (FK → header_bank_details.id)';
COMMENT ON COLUMN public.bills.lock_held_by      IS 'User currently holding the edit lock (NULL = unlocked)';
COMMENT ON COLUMN public.bills.lock_expires_at   IS 'When the edit lock auto-expires (5 min from last refresh)';

CREATE SEQUENCE public.bills_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.bills_id_seq OWNER TO postgres;
ALTER SEQUENCE public.bills_id_seq OWNED BY public.bills.id;


-- ------------------------------------------------------------
-- clients_master
-- ------------------------------------------------------------
CREATE TABLE public.clients_master (
    id integer NOT NULL,
    client_name character varying(200) NOT NULL,
    contact_person character varying(200),
    phone character varying(15),
    email character varying(150),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    gstin character varying(15),
    address_line1 character varying(255),
    address_line2 character varying(255),
    city character varying(100),
    state character varying(100),
    pincode character varying(10),
    pan character varying(10),
    CONSTRAINT gstin_format_check CHECK (((gstin IS NULL) OR ((gstin)::text ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'::text))),
    CONSTRAINT pan_format_check CHECK (((pan IS NULL) OR ((pan)::text ~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$'::text)))
);

ALTER TABLE public.clients_master OWNER TO postgres;

COMMENT ON TABLE public.clients_master IS 'Client/customer information with search capability';

CREATE SEQUENCE public.clients_master_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.clients_master_id_seq OWNER TO postgres;
ALTER SEQUENCE public.clients_master_id_seq OWNED BY public.clients_master.id;


-- ------------------------------------------------------------
-- gst_rates_master
-- ------------------------------------------------------------
CREATE TABLE public.gst_rates_master (
    id integer NOT NULL,
    rate_percentage numeric(5,2) NOT NULL,
    description character varying(100),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    rate_name character varying(100)
);

ALTER TABLE public.gst_rates_master OWNER TO postgres;

COMMENT ON TABLE public.gst_rates_master IS 'GST rate percentages (CAs can add/edit)';

CREATE SEQUENCE public.gst_rates_master_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.gst_rates_master_id_seq OWNER TO postgres;
ALTER SEQUENCE public.gst_rates_master_id_seq OWNED BY public.gst_rates_master.id;


-- ------------------------------------------------------------
-- header_bank_details
-- Migration 006: removed UNIQUE(header_id) to support 1:many,
-- added nick_name and is_primary columns.
-- ------------------------------------------------------------
CREATE TABLE public.header_bank_details (
    id integer NOT NULL,
    header_id integer NOT NULL,
    bank_name character varying(200),
    account_holder_name character varying(200),
    account_number character varying(30),
    ifsc_code character varying(11),
    branch_name character varying(200),
    upi_id character varying(100),
    qr_code_image text,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    -- Migration 006
    nick_name character varying(100),
    is_primary boolean NOT NULL DEFAULT false
);

ALTER TABLE public.header_bank_details OWNER TO postgres;

COMMENT ON TABLE  public.header_bank_details            IS 'Bank accounts per company (1:many). One account marked is_primary per company.';
COMMENT ON COLUMN public.header_bank_details.is_primary IS 'True for the default/primary account. Only one row per header_id should be true.';
COMMENT ON COLUMN public.header_bank_details.nick_name  IS 'Optional label to distinguish accounts, e.g. "HDFC Current", "SBI Savings"';
COMMENT ON COLUMN public.header_bank_details.qr_code_image IS 'Base64 encoded QR code or file path';

CREATE SEQUENCE public.header_bank_details_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.header_bank_details_id_seq OWNER TO postgres;
ALTER SEQUENCE public.header_bank_details_id_seq OWNED BY public.header_bank_details.id;


-- ------------------------------------------------------------
-- header_master
-- ------------------------------------------------------------
CREATE TABLE public.header_master (
    id integer NOT NULL,
    company_name character varying(200) NOT NULL,
    proprietor_name character varying(200),
    address_line1 character varying(300),
    address_line2 character varying(300),
    city character varying(100),
    state character varying(100),
    pincode character varying(10),
    phone character varying(15),
    email character varying(150),
    gstin character varying(15),
    pan character varying(10),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    bill_prefix character varying(20) DEFAULT 'INV'::character varying,
    upi_id character varying(100)
);

ALTER TABLE public.header_master OWNER TO postgres;

CREATE SEQUENCE public.header_master_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.header_master_id_seq OWNER TO postgres;
ALTER SEQUENCE public.header_master_id_seq OWNED BY public.header_master.id;


-- ------------------------------------------------------------
-- particulars_master
-- ------------------------------------------------------------
CREATE TABLE public.particulars_master (
    id integer NOT NULL,
    service_name text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.particulars_master OWNER TO postgres;

CREATE SEQUENCE public.particulars_master_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.particulars_master_id_seq OWNER TO postgres;
ALTER SEQUENCE public.particulars_master_id_seq OWNED BY public.particulars_master.id;


-- ------------------------------------------------------------
-- password_reset_requests
-- Added by migration 008. Replaces the old password_reset_tokens
-- table which used a stateless email-link approach. This flow
-- requires SUPERADMIN approval instead.
-- ------------------------------------------------------------
CREATE TABLE public.password_reset_requests (
    id integer NOT NULL,
    user_id integer NOT NULL,
    hashed_new_password character varying(255) NOT NULL,
    status character varying(20) NOT NULL DEFAULT 'PENDING',
    expires_at timestamp without time zone NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '12 hours'),
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at timestamp without time zone,
    reviewed_by integer,
    CONSTRAINT password_reset_requests_status_check CHECK ((status IN ('PENDING', 'APPROVED', 'REJECTED')))
);

ALTER TABLE public.password_reset_requests OWNER TO postgres;

CREATE SEQUENCE public.password_reset_requests_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.password_reset_requests_id_seq OWNER TO postgres;
ALTER SEQUENCE public.password_reset_requests_id_seq OWNED BY public.password_reset_requests.id;


-- ------------------------------------------------------------
-- payment_terms_master
-- ------------------------------------------------------------
CREATE TABLE public.payment_terms_master (
    id integer NOT NULL,
    term_name character varying(50) NOT NULL,
    days_to_add integer NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.payment_terms_master OWNER TO postgres;

CREATE SEQUENCE public.payment_terms_master_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.payment_terms_master_id_seq OWNER TO postgres;
ALTER SEQUENCE public.payment_terms_master_id_seq OWNED BY public.payment_terms_master.id;


-- ------------------------------------------------------------
-- users
-- Migration 007: username NOT NULL
-- Roles: CA | EMPLOYEE | SUPERADMIN
-- ------------------------------------------------------------
CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(100) NOT NULL,
    email character varying(150),
    password_hash character varying(255),
    full_name character varying(200),
    role character varying(50) DEFAULT 'CA'::character varying,
    phone character varying(15),
    is_active boolean DEFAULT true,
    last_login timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_approved boolean DEFAULT false NOT NULL,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY (
        (ARRAY['CA'::character varying, 'EMPLOYEE'::character varying, 'SUPERADMIN'::character varying])::text[]
    )))
);

ALTER TABLE public.users OWNER TO postgres;

CREATE SEQUENCE public.users_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNER TO postgres;
ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


-- ============================================================
-- DEFAULT VALUES (sequence linkage)
-- ============================================================

ALTER TABLE ONLY public.activity_log              ALTER COLUMN id SET DEFAULT nextval('public.activity_log_id_seq'::regclass);
ALTER TABLE ONLY public.bill_merges               ALTER COLUMN id SET DEFAULT nextval('public.bill_merges_id_seq'::regclass);
ALTER TABLE ONLY public.bill_number_counters      ALTER COLUMN id SET DEFAULT nextval('public.bill_number_counters_id_seq'::regclass);
ALTER TABLE ONLY public.bill_payments             ALTER COLUMN id SET DEFAULT nextval('public.bill_payments_id_seq'::regclass);
ALTER TABLE ONLY public.bill_services             ALTER COLUMN id SET DEFAULT nextval('public.bill_services_id_seq'::regclass);
ALTER TABLE ONLY public.bill_writeoffs            ALTER COLUMN id SET DEFAULT nextval('public.bill_writeoffs_id_seq'::regclass);
ALTER TABLE ONLY public.bills                     ALTER COLUMN id SET DEFAULT nextval('public.bills_id_seq'::regclass);
ALTER TABLE ONLY public.clients_master            ALTER COLUMN id SET DEFAULT nextval('public.clients_master_id_seq'::regclass);
ALTER TABLE ONLY public.gst_rates_master          ALTER COLUMN id SET DEFAULT nextval('public.gst_rates_master_id_seq'::regclass);
ALTER TABLE ONLY public.header_bank_details       ALTER COLUMN id SET DEFAULT nextval('public.header_bank_details_id_seq'::regclass);
ALTER TABLE ONLY public.header_master             ALTER COLUMN id SET DEFAULT nextval('public.header_master_id_seq'::regclass);
ALTER TABLE ONLY public.particulars_master        ALTER COLUMN id SET DEFAULT nextval('public.particulars_master_id_seq'::regclass);
ALTER TABLE ONLY public.password_reset_requests   ALTER COLUMN id SET DEFAULT nextval('public.password_reset_requests_id_seq'::regclass);
ALTER TABLE ONLY public.payment_terms_master      ALTER COLUMN id SET DEFAULT nextval('public.payment_terms_master_id_seq'::regclass);
ALTER TABLE ONLY public.users                     ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


-- ============================================================
-- PRIMARY KEYS & UNIQUE CONSTRAINTS
-- ============================================================

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bill_merges
    ADD CONSTRAINT bill_merges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bill_merges
    ADD CONSTRAINT bill_merges_source_bill_id_key UNIQUE (source_bill_id);

ALTER TABLE ONLY public.bill_number_counters
    ADD CONSTRAINT bill_number_counters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bill_number_counters
    ADD CONSTRAINT bill_number_counters_header_id_financial_year_key UNIQUE (header_id, financial_year);

ALTER TABLE ONLY public.bill_payments
    ADD CONSTRAINT bill_payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bill_services
    ADD CONSTRAINT bill_services_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bill_writeoffs
    ADD CONSTRAINT bill_writeoffs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_bill_no_key UNIQUE (bill_no);

ALTER TABLE ONLY public.clients_master
    ADD CONSTRAINT clients_master_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.clients_master
    ADD CONSTRAINT clients_gstin_unique UNIQUE (gstin);

ALTER TABLE ONLY public.clients_master
    ADD CONSTRAINT clients_pan_unique UNIQUE (pan);

ALTER TABLE ONLY public.gst_rates_master
    ADD CONSTRAINT gst_rates_master_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.header_bank_details
    ADD CONSTRAINT header_bank_details_pkey PRIMARY KEY (id);
-- NOTE: No UNIQUE on header_id — migration 006 dropped it to support multiple accounts per company.

ALTER TABLE ONLY public.header_master
    ADD CONSTRAINT header_master_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.header_master
    ADD CONSTRAINT header_master_bill_prefix_key UNIQUE (bill_prefix);

ALTER TABLE ONLY public.particulars_master
    ADD CONSTRAINT particulars_master_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.password_reset_requests
    ADD CONSTRAINT password_reset_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.payment_terms_master
    ADD CONSTRAINT payment_terms_master_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


-- ============================================================
-- INDEXES
-- ============================================================

-- activity_log
CREATE INDEX idx_activity_log_created_at    ON public.activity_log USING btree (created_at DESC);
CREATE INDEX idx_activity_log_entity        ON public.activity_log USING btree (entity_type, entity_id);
CREATE INDEX idx_activity_log_performed_by  ON public.activity_log USING btree (performed_by);

-- bill_number_counters
CREATE INDEX idx_bill_counters_header_fy    ON public.bill_number_counters USING btree (header_id, financial_year);

-- bill_merges
CREATE INDEX idx_bill_merges_merged         ON public.bill_merges USING btree (merged_bill_id);
CREATE INDEX idx_bill_merges_source         ON public.bill_merges USING btree (source_bill_id);

-- bill_payments
CREATE INDEX idx_bill_payments_bill_id      ON public.bill_payments USING btree (bill_id);
CREATE INDEX idx_bill_payments_date         ON public.bill_payments USING btree (payment_date);

-- bill_services
CREATE INDEX idx_bill_services_bill_id      ON public.bill_services USING btree (bill_id);

-- bill_writeoffs
CREATE INDEX idx_bill_writeoffs_bill_id     ON public.bill_writeoffs USING btree (bill_id);

-- bills
CREATE INDEX idx_bills_bill_date            ON public.bills USING btree (bill_date);
CREATE INDEX idx_bills_bill_no              ON public.bills USING btree (bill_no);
CREATE INDEX idx_bills_client_id            ON public.bills USING btree (client_id);
CREATE INDEX idx_bills_created_by           ON public.bills USING btree (created_by);
CREATE INDEX idx_bills_financial_year       ON public.bills USING btree (financial_year);
CREATE INDEX idx_bills_header_id            ON public.bills USING btree (header_id);
CREATE INDEX idx_bills_payment_status       ON public.bills USING btree (payment_status);
CREATE INDEX idx_bills_status               ON public.bills USING btree (status);
CREATE INDEX idx_bills_bank_account_id      ON public.bills USING btree (bank_account_id);
-- Migration 009: partial index — only rows with an active lock (most bills are unlocked)
CREATE INDEX idx_bills_lock                 ON public.bills (lock_held_by, lock_expires_at)
    WHERE lock_held_by IS NOT NULL;

-- clients_master
CREATE INDEX idx_clients_master_client_name ON public.clients_master USING btree (client_name);
CREATE INDEX idx_clients_master_is_active   ON public.clients_master USING btree (is_active);

-- header_master
CREATE INDEX idx_header_master_is_active    ON public.header_master USING btree (is_active);

-- password_reset_requests (migration 008)
CREATE INDEX idx_prr_user_status            ON public.password_reset_requests (user_id, status);
CREATE INDEX idx_prr_status_expires         ON public.password_reset_requests (status, expires_at);

-- users
CREATE INDEX idx_users_email                ON public.users USING btree (email);
CREATE INDEX idx_users_role                 ON public.users USING btree (role);
CREATE INDEX idx_users_username             ON public.users USING btree (username);


-- ============================================================
-- TRIGGERS
-- ============================================================

-- Recalculate bill totals after any change to bill_services
CREATE TRIGGER after_insert_update_delete_bill_services
    AFTER INSERT OR DELETE OR UPDATE ON public.bill_services
    FOR EACH ROW EXECUTE FUNCTION public.trigger_update_bill_totals();

-- Calculate GST amount before inserting/updating a service line
CREATE TRIGGER before_insert_update_bill_services
    BEFORE INSERT OR UPDATE ON public.bill_services
    FOR EACH ROW EXECUTE FUNCTION public.trigger_calculate_gst();

-- Auto-update updated_at timestamps
CREATE TRIGGER before_update_bills
    BEFORE UPDATE ON public.bills
    FOR EACH ROW EXECUTE FUNCTION public.trigger_update_timestamp();

CREATE TRIGGER before_update_clients_master
    BEFORE UPDATE ON public.clients_master
    FOR EACH ROW EXECUTE FUNCTION public.trigger_update_timestamp();

CREATE TRIGGER before_update_particulars_master
    BEFORE UPDATE ON public.particulars_master
    FOR EACH ROW EXECUTE FUNCTION public.trigger_update_timestamp();

CREATE TRIGGER before_update_users
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.trigger_update_timestamp();

-- Assign bill_no on finalization
CREATE TRIGGER trigger_assign_bill_number
    BEFORE INSERT OR UPDATE ON public.bills
    FOR EACH ROW EXECUTE FUNCTION public.assign_bill_number();

-- Recalculate payment_status on bill_payments insert/update/delete
CREATE TRIGGER trigger_update_bill_payment_status
    AFTER INSERT OR DELETE OR UPDATE ON public.bill_payments
    FOR EACH ROW EXECUTE FUNCTION public.update_bill_payment_status();

CREATE TRIGGER update_payment_status_on_delete
    AFTER DELETE ON public.bill_payments
    FOR EACH ROW EXECUTE FUNCTION public.update_bill_payment_status_on_delete();

CREATE TRIGGER update_payment_status_on_insert
    AFTER INSERT ON public.bill_payments
    FOR EACH ROW EXECUTE FUNCTION public.update_bill_payment_status();


-- ============================================================
-- FOREIGN KEY CONSTRAINTS
-- ============================================================

-- activity_log
ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_performed_by_fkey
        FOREIGN KEY (performed_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- bill_merges
ALTER TABLE ONLY public.bill_merges
    ADD CONSTRAINT bill_merges_merged_bill_id_fkey
        FOREIGN KEY (merged_bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bill_merges
    ADD CONSTRAINT bill_merges_merged_by_fkey
        FOREIGN KEY (merged_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bill_merges
    ADD CONSTRAINT bill_merges_source_bill_id_fkey
        FOREIGN KEY (source_bill_id) REFERENCES public.bills(id) ON DELETE RESTRICT;

-- bill_number_counters
ALTER TABLE ONLY public.bill_number_counters
    ADD CONSTRAINT bill_number_counters_header_id_fkey
        FOREIGN KEY (header_id) REFERENCES public.header_master(id) ON DELETE CASCADE;

-- bill_payments
ALTER TABLE ONLY public.bill_payments
    ADD CONSTRAINT bill_payments_bill_id_fkey
        FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bill_payments
    ADD CONSTRAINT bill_payments_recorded_by_fkey
        FOREIGN KEY (recorded_by) REFERENCES public.users(id);

-- Migration 006: references header_bank_details(id), NOT header_bank_details(header_id)
-- The old schema_prod.sql had this wrong — it pointed to (header_id) which was only
-- valid when header_id had a UNIQUE constraint (before multi-bank support).
ALTER TABLE ONLY public.bill_payments
    ADD CONSTRAINT bill_payments_received_in_account_id_fkey
        FOREIGN KEY (received_in_account_id) REFERENCES public.header_bank_details(id) ON DELETE SET NULL;

-- bill_services
ALTER TABLE ONLY public.bill_services
    ADD CONSTRAINT bill_services_bill_id_fkey
        FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bill_services
    ADD CONSTRAINT bill_services_gst_rate_id_fkey
        FOREIGN KEY (gst_rate_id) REFERENCES public.gst_rates_master(id);

ALTER TABLE ONLY public.bill_services
    ADD CONSTRAINT bill_services_particulars_id_fkey
        FOREIGN KEY (particulars_id) REFERENCES public.particulars_master(id);

-- bill_writeoffs
ALTER TABLE ONLY public.bill_writeoffs
    ADD CONSTRAINT bill_writeoffs_bill_id_fkey
        FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bill_writeoffs
    ADD CONSTRAINT bill_writeoffs_written_off_by_fkey
        FOREIGN KEY (written_off_by) REFERENCES public.users(id);

-- bills
ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_client_id_fkey
        FOREIGN KEY (client_id) REFERENCES public.clients_master(id);

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_header_id_fkey
        FOREIGN KEY (header_id) REFERENCES public.header_master(id);

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_override_header_id_fkey
        FOREIGN KEY (override_header_id) REFERENCES public.header_master(id);

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_payment_term_id_fkey
        FOREIGN KEY (payment_term_id) REFERENCES public.payment_terms_master(id);

-- Migration 006
ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_bank_account_id_fkey
        FOREIGN KEY (bank_account_id) REFERENCES public.header_bank_details(id) ON DELETE RESTRICT;

-- Migration 009
ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_lock_held_by_fkey
        FOREIGN KEY (lock_held_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- header_bank_details
ALTER TABLE ONLY public.header_bank_details
    ADD CONSTRAINT header_bank_details_header_id_fkey
        FOREIGN KEY (header_id) REFERENCES public.header_master(id) ON DELETE CASCADE;

-- password_reset_requests (migration 008)
ALTER TABLE ONLY public.password_reset_requests
    ADD CONSTRAINT password_reset_requests_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.password_reset_requests
    ADD CONSTRAINT password_reset_requests_reviewed_by_fkey
        FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;
