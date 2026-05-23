--
-- PostgreSQL database dump
--

\restrict T3PIM8JTA6pPYdLBKmeaCJhr2sO2c88TTdMeDFkaAsZ1uh6PalZJD9kohswEbon

-- Dumped from database version 17.9
-- Dumped by pg_dump version 17.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: assign_bill_number(); Type: FUNCTION; Schema: public; Owner: postgres
--

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

--
-- Name: trigger_calculate_gst(); Type: FUNCTION; Schema: public; Owner: postgres
--

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

--
-- Name: trigger_update_bill_totals(); Type: FUNCTION; Schema: public; Owner: postgres
--

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

--
-- Name: trigger_update_timestamp(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trigger_update_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.trigger_update_timestamp() OWNER TO postgres;

--
-- Name: update_bill_payment_status(); Type: FUNCTION; Schema: public; Owner: postgres
--

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

--
-- Name: update_bill_payment_status_on_delete(); Type: FUNCTION; Schema: public; Owner: postgres
--

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: postgres
--

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

--
-- Name: activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.activity_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.activity_log_id_seq OWNER TO postgres;

--
-- Name: activity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.activity_log_id_seq OWNED BY public.activity_log.id;


--
-- Name: bill_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bill_history (
    id integer NOT NULL,
    bill_id integer NOT NULL,
    action_type character varying(50),
    action_by integer NOT NULL,
    recipient_email character varying(150),
    recipient_phone character varying(15),
    action_timestamp timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(50) DEFAULT 'SUCCESS'::character varying,
    error_message text
);


ALTER TABLE public.bill_history OWNER TO postgres;

--
-- Name: TABLE bill_history; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.bill_history IS 'Audit trail for PDF, email, WhatsApp actions';


--
-- Name: COLUMN bill_history.action_type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bill_history.action_type IS 'PDF_GENERATED, EMAIL_SENT, WHATSAPP_SHARED';


--
-- Name: bill_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bill_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bill_history_id_seq OWNER TO postgres;

--
-- Name: bill_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bill_history_id_seq OWNED BY public.bill_history.id;


--
-- Name: bill_merges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bill_merges (
    id integer NOT NULL,
    merged_bill_id integer NOT NULL,
    source_bill_id integer NOT NULL,
    merged_at timestamp with time zone DEFAULT now() NOT NULL,
    merged_by integer
);


ALTER TABLE public.bill_merges OWNER TO postgres;

--
-- Name: bill_merges_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bill_merges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bill_merges_id_seq OWNER TO postgres;

--
-- Name: bill_merges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bill_merges_id_seq OWNED BY public.bill_merges.id;


--
-- Name: bill_number_counters; Type: TABLE; Schema: public; Owner: postgres
--

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

--
-- Name: bill_number_counters_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bill_number_counters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bill_number_counters_id_seq OWNER TO postgres;

--
-- Name: bill_number_counters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bill_number_counters_id_seq OWNED BY public.bill_number_counters.id;


--
-- Name: bill_number_sequence; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bill_number_sequence (
    id integer NOT NULL,
    financial_year character varying(4) NOT NULL,
    last_sequence integer DEFAULT 0,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.bill_number_sequence OWNER TO postgres;

--
-- Name: TABLE bill_number_sequence; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.bill_number_sequence IS 'Tracks last bill number for each financial year';


--
-- Name: COLUMN bill_number_sequence.financial_year; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bill_number_sequence.financial_year IS 'Format: 2425 for FY 2024-25';


--
-- Name: bill_number_sequence_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bill_number_sequence_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bill_number_sequence_id_seq OWNER TO postgres;

--
-- Name: bill_number_sequence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bill_number_sequence_id_seq OWNED BY public.bill_number_sequence.id;


--
-- Name: bill_payments; Type: TABLE; Schema: public; Owner: postgres
--

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
    received_in_account_id integer,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bill_payments_amount_paid_check CHECK ((amount_paid > (0)::numeric)),
    CONSTRAINT bill_payments_payment_mode_check CHECK (((payment_mode)::text = ANY ((ARRAY['NEFT'::character varying, 'UPI'::character varying, 'CASH'::character varying, 'CHEQUE'::character varying])::text[])))
);


ALTER TABLE public.bill_payments OWNER TO postgres;

--
-- Name: bill_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bill_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bill_payments_id_seq OWNER TO postgres;

--
-- Name: bill_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bill_payments_id_seq OWNED BY public.bill_payments.id;


--
-- Name: bill_services; Type: TABLE; Schema: public; Owner: postgres
--

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

--
-- Name: TABLE bill_services; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.bill_services IS 'Individual service line items in each bill';


--
-- Name: COLUMN bill_services.sr_no; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bill_services.sr_no IS 'Auto-numbered serial number (1, 2, 3...)';


--
-- Name: COLUMN bill_services.particulars_other; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bill_services.particulars_other IS 'Free text when "Other" is selected';


--
-- Name: bill_services_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bill_services_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bill_services_id_seq OWNER TO postgres;

--
-- Name: bill_services_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bill_services_id_seq OWNED BY public.bill_services.id;


--
-- Name: bill_writeoffs; Type: TABLE; Schema: public; Owner: postgres
--

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

--
-- Name: TABLE bill_writeoffs; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.bill_writeoffs IS 'Audit trail of write-offs applied to partially paid finalized bills';


--
-- Name: COLUMN bill_writeoffs.writeoff_amount; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bill_writeoffs.writeoff_amount IS 'Amount written off (remaining balance at time of write-off)';


--
-- Name: COLUMN bill_writeoffs.written_off_by; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bill_writeoffs.written_off_by IS 'User ID of the SUPERADMIN who applied the write-off';


--
-- Name: bill_writeoffs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bill_writeoffs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bill_writeoffs_id_seq OWNER TO postgres;

--
-- Name: bill_writeoffs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bill_writeoffs_id_seq OWNED BY public.bill_writeoffs.id;


--
-- Name: bills; Type: TABLE; Schema: public; Owner: postgres
--

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
    CONSTRAINT bills_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['UNPAID'::character varying, 'PARTIAL'::character varying, 'PAID'::character varying])::text[]))),
    CONSTRAINT bills_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'FINALIZED'::character varying, 'ABSORBED'::character varying])::text[])))
);


ALTER TABLE public.bills OWNER TO postgres;

--
-- Name: TABLE bills; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.bills IS 'Main invoice/bill information';


--
-- Name: COLUMN bills.bill_no; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bills.bill_no IS 'Format: INV/2425/001 (per company per FY)';


--
-- Name: COLUMN bills.financial_year; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bills.financial_year IS 'Format: 2024-25 (Apr-Mar)';


--
-- Name: COLUMN bills.status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bills.status IS 'DRAFT, FINALIZED, ABSORBED';


--
-- Name: bills_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bills_id_seq OWNER TO postgres;

--
-- Name: bills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bills_id_seq OWNED BY public.bills.id;


--
-- Name: clients_master; Type: TABLE; Schema: public; Owner: postgres
--

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

--
-- Name: TABLE clients_master; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.clients_master IS 'Client/customer information with search capability';


--
-- Name: clients_master_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.clients_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.clients_master_id_seq OWNER TO postgres;

--
-- Name: clients_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.clients_master_id_seq OWNED BY public.clients_master.id;


--
-- Name: gst_rates_master; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.gst_rates_master (
    id integer NOT NULL,
    rate_percentage numeric(5,2) NOT NULL,
    description character varying(100),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    rate_name character varying(100)
);


ALTER TABLE public.gst_rates_master OWNER TO postgres;

--
-- Name: TABLE gst_rates_master; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.gst_rates_master IS 'GST rate percentages (CAs can add/edit)';


--
-- Name: gst_rates_master_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.gst_rates_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.gst_rates_master_id_seq OWNER TO postgres;

--
-- Name: gst_rates_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.gst_rates_master_id_seq OWNED BY public.gst_rates_master.id;


--
-- Name: header_bank_details; Type: TABLE; Schema: public; Owner: postgres
--

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
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.header_bank_details OWNER TO postgres;

--
-- Name: TABLE header_bank_details; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.header_bank_details IS 'One bank account per company (1:1 relationship)';


--
-- Name: COLUMN header_bank_details.qr_code_image; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.header_bank_details.qr_code_image IS 'Base64 encoded QR code or file path';


--
-- Name: header_bank_details_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.header_bank_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.header_bank_details_id_seq OWNER TO postgres;

--
-- Name: header_bank_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.header_bank_details_id_seq OWNED BY public.header_bank_details.id;


--
-- Name: header_master; Type: TABLE; Schema: public; Owner: postgres
--

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

--
-- Name: header_master_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.header_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.header_master_id_seq OWNER TO postgres;

--
-- Name: header_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.header_master_id_seq OWNED BY public.header_master.id;


--
-- Name: particulars_master; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.particulars_master (
    id integer NOT NULL,
    service_name text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.particulars_master OWNER TO postgres;

--
-- Name: particulars_master_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.particulars_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.particulars_master_id_seq OWNER TO postgres;

--
-- Name: particulars_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.particulars_master_id_seq OWNED BY public.particulars_master.id;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.password_reset_tokens (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.password_reset_tokens OWNER TO postgres;

--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.password_reset_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.password_reset_tokens_id_seq OWNER TO postgres;

--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;


--
-- Name: payment_terms_master; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_terms_master (
    id integer NOT NULL,
    term_name character varying(50) NOT NULL,
    days_to_add integer NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.payment_terms_master OWNER TO postgres;

--
-- Name: payment_terms_master_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payment_terms_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payment_terms_master_id_seq OWNER TO postgres;

--
-- Name: payment_terms_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payment_terms_master_id_seq OWNED BY public.payment_terms_master.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(100),
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
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['CA'::character varying, 'EMPLOYEE'::character varying, 'SUPERADMIN'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: activity_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_log ALTER COLUMN id SET DEFAULT nextval('public.activity_log_id_seq'::regclass);


--
-- Name: bill_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_history ALTER COLUMN id SET DEFAULT nextval('public.bill_history_id_seq'::regclass);


--
-- Name: bill_merges id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_merges ALTER COLUMN id SET DEFAULT nextval('public.bill_merges_id_seq'::regclass);


--
-- Name: bill_number_counters id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_number_counters ALTER COLUMN id SET DEFAULT nextval('public.bill_number_counters_id_seq'::regclass);


--
-- Name: bill_number_sequence id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_number_sequence ALTER COLUMN id SET DEFAULT nextval('public.bill_number_sequence_id_seq'::regclass);


--
-- Name: bill_payments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_payments ALTER COLUMN id SET DEFAULT nextval('public.bill_payments_id_seq'::regclass);


--
-- Name: bill_services id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_services ALTER COLUMN id SET DEFAULT nextval('public.bill_services_id_seq'::regclass);


--
-- Name: bill_writeoffs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_writeoffs ALTER COLUMN id SET DEFAULT nextval('public.bill_writeoffs_id_seq'::regclass);


--
-- Name: bills id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bills ALTER COLUMN id SET DEFAULT nextval('public.bills_id_seq'::regclass);


--
-- Name: clients_master id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clients_master ALTER COLUMN id SET DEFAULT nextval('public.clients_master_id_seq'::regclass);


--
-- Name: gst_rates_master id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.gst_rates_master ALTER COLUMN id SET DEFAULT nextval('public.gst_rates_master_id_seq'::regclass);


--
-- Name: header_bank_details id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.header_bank_details ALTER COLUMN id SET DEFAULT nextval('public.header_bank_details_id_seq'::regclass);


--
-- Name: header_master id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.header_master ALTER COLUMN id SET DEFAULT nextval('public.header_master_id_seq'::regclass);


--
-- Name: particulars_master id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.particulars_master ALTER COLUMN id SET DEFAULT nextval('public.particulars_master_id_seq'::regclass);


--
-- Name: password_reset_tokens id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);


--
-- Name: payment_terms_master id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_terms_master ALTER COLUMN id SET DEFAULT nextval('public.payment_terms_master_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: activity_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.activity_log (id, performed_by, action, entity_type, entity_id, description, metadata, created_at) FROM stdin;
1	\N	CREATE_USER	USER	1	Created user "JATIN" with role CA	{"role": "CA", "username": "JATIN", "new_user_id": 1}	2026-03-16 20:41:56.000735+05:30
2	\N	CREATE_USER	USER	2	Created user "shrikant" with role EMPLOYEE	{"role": "EMPLOYEE", "username": "shrikant", "new_user_id": 2}	2026-03-16 20:50:04.122847+05:30
3	1	UPDATE_USER	USER	2	Updated user "shrikant" (CA)	{"username": "shrikant", "target_user_id": 2}	2026-03-16 20:51:25.125107+05:30
4	1	CREATE_BILL	BILL	1	Created bill #MSD-DRAFT-1 (2025-26)	{"bill_id": 1, "bill_no": "MSD-DRAFT-1", "financial_year": "2025-26"}	2026-03-16 21:11:03.713339+05:30
5	1	ADD_SERVICE	SERVICE	1	Added "Audit" — ₹65.00	{"amount": 65, "bill_id": 1, "bill_no": "MSD-DRAFT-1", "service_id": 1, "service_name": "Audit"}	2026-03-16 21:11:03.718531+05:30
6	1	FINALIZE_BILL	BILL	1	Total ₹76.70	{"bill_id": 1, "bill_no": "MSD/2526/001", "total_invoice_value": "76.70"}	2026-03-16 21:11:17.007173+05:30
7	1	MARK_PAYMENT	PAYMENT	1	Payment received — ₹76.70 via UPI	{"bill_id": 1, "bill_no": "MSD/2526/001", "payment_id": 1, "amount_paid": 76.7, "payment_date": "2026-03-16", "payment_mode": "UPI"}	2026-03-16 21:11:30.358826+05:30
8	2	CREATE_BILL	BILL	2	Created bill #MSD-DRAFT-2 (2025-26)	{"bill_id": 2, "bill_no": "MSD-DRAFT-2", "financial_year": "2025-26"}	2026-03-16 21:13:44.651347+05:30
9	2	ADD_SERVICE	SERVICE	2	Added "Audit" — ₹10.00	{"amount": 10, "bill_id": 2, "bill_no": "MSD-DRAFT-2", "service_id": 2, "service_name": "Audit"}	2026-03-16 21:13:44.657197+05:30
10	\N	CREATE_USER	USER	3	Created user "Urja" with role CA	{"role": "CA", "username": "Urja", "new_user_id": 3}	2026-03-17 12:28:04.79786+05:30
11	3	CREATE_BILL	BILL	3	Created bill #MSD-DRAFT-3 (2025-26)	{"bill_id": 3, "bill_no": "MSD-DRAFT-3", "financial_year": "2025-26"}	2026-03-17 16:37:06.723752+05:30
12	3	ADD_SERVICE	SERVICE	3	Added "Income Tax Return, Account Finalisation" — ₹10.00	{"amount": 10, "bill_id": 3, "bill_no": "MSD-DRAFT-3", "service_id": 3, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-17 16:37:06.728425+05:30
13	3	DELETE_BILL	BILL	1	Deleted bill #MSD/2526/001	{"bill_id": 1, "bill_no": "MSD/2526/001"}	2026-03-17 16:40:24.843331+05:30
14	1	MERGE_BILLS	BILL	4	Merged 2 bills into new draft	{"merged_bill_id": 4, "source_bill_ids": [3, 2], "source_bill_nos": []}	2026-03-22 15:44:55.601064+05:30
15	1	UNMERGE_BILL	BILL	4	Unmerged bill — restored 2 bills to Draft	{"merged_bill_id": 4, "source_bill_ids": [3, 2]}	2026-03-22 15:45:06.29172+05:30
16	1	MERGE_BILLS	BILL	5	Merged 2 bills into new draft	{"merged_bill_id": 5, "source_bill_ids": [3, 2], "source_bill_nos": []}	2026-03-22 15:45:17.026775+05:30
17	1	FINALIZE_BILL	BILL	5	Total ₹23.60	{"bill_id": 5, "bill_no": "MSD/2526/002", "total_invoice_value": "23.60"}	2026-03-22 15:45:21.599552+05:30
18	1	DELETE_BILL	BILL	5	Deleted bill #MSD/2526/002	{"bill_id": 5, "bill_no": "MSD/2526/002"}	2026-03-22 15:45:53.086363+05:30
19	1	CREATE_BILL	BILL	6	Created bill #MSD-DRAFT-6 (2025-26)	{"bill_id": 6, "bill_no": "MSD-DRAFT-6", "financial_year": "2025-26"}	2026-03-22 15:50:30.439015+05:30
20	1	ADD_SERVICE	SERVICE	8	Added "Account Writing" — ₹10000.00	{"amount": 10000, "bill_id": 6, "bill_no": "MSD-DRAFT-6", "service_id": 8, "service_name": "Account Writing"}	2026-03-22 15:50:30.44417+05:30
21	1	UPDATE_BILL	BILL	6	Updated bill #MSD-DRAFT-6	{"bill_id": 6, "bill_no": "MSD-DRAFT-6"}	2026-03-22 15:51:41.088333+05:30
22	1	FINALIZE_BILL	BILL	6	Total ₹11800.00	{"bill_id": 6, "bill_no": "MSD/2526/003", "total_invoice_value": "11800.00"}	2026-03-22 15:51:52.773132+05:30
23	1	MARK_PAYMENT	PAYMENT	2	Payment received — ₹11800.00 via NEFT	{"bill_id": 6, "bill_no": "MSD/2526/003", "payment_id": 2, "amount_paid": 11800, "payment_date": "2026-03-22", "payment_mode": "NEFT"}	2026-03-22 15:52:06.338838+05:30
24	1	CREATE_BILL	BILL	7	Created bill #MSD-DRAFT-7 (2025-26)	{"bill_id": 7, "bill_no": "MSD-DRAFT-7", "financial_year": "2025-26"}	2026-03-22 15:53:46.812795+05:30
25	1	ADD_SERVICE	SERVICE	10	Added "Preparation of Project Report/CMA" — ₹500.00	{"amount": 500, "bill_id": 7, "bill_no": "MSD-DRAFT-7", "service_id": 10, "service_name": "Preparation of Project Report/CMA"}	2026-03-22 15:53:46.817717+05:30
26	1	FINALIZE_BILL	BILL	7	Total ₹590.00	{"bill_id": 7, "bill_no": "MSD/2526/004", "total_invoice_value": "590.00"}	2026-03-22 15:53:59.540336+05:30
27	1	MARK_PAYMENT	PAYMENT	3	Payment received — ₹500.00 via NEFT	{"bill_id": 7, "bill_no": "MSD/2526/004", "payment_id": 3, "amount_paid": 500, "payment_date": "2026-03-22", "payment_mode": "NEFT"}	2026-03-22 15:54:08.630594+05:30
28	3	OVERRIDE_EDIT_PAYMENT	PAYMENT	2	[SUPERADMIN OVERRIDE] Edited payment #2 — ₹11800.00 via NEFT	{"bill_id": 6, "payment_id": 2, "amount_paid": "11800.00", "payment_mode": "NEFT"}	2026-03-23 12:08:00.888795+05:30
29	\N	CREATE_USER	USER	4	Created user "TESTE" with role EMPLOYEE (self-registered, pending approval)	{"role": "EMPLOYEE", "username": "TESTE", "is_approved": false, "new_user_id": 4}	2026-03-23 12:09:23.948341+05:30
30	3	APPROVE_USER	USER	4	Approved user "TESTE" (EMPLOYEE)	{"username": "TESTE", "target_user_id": 4}	2026-03-23 12:09:44.71385+05:30
31	3	UPDATE_USER	USER	4	Updated user "TESTE" (EMPLOYEE)	{"username": "TESTE", "target_user_id": 4}	2026-03-23 12:09:50.495952+05:30
32	3	UPDATE_USER	USER	4	Updated user "TESTE" (EMPLOYEE)	{"username": "TESTE", "target_user_id": 4}	2026-03-23 12:09:53.503326+05:30
33	3	UPDATE_USER	USER	4	Updated user "TESTE" (EMPLOYEE)	{"username": "TESTE", "target_user_id": 4}	2026-03-23 12:17:59.429616+05:30
34	3	UPDATE_USER	USER	1	Updated user "JATIN" (CA)	{"username": "JATIN", "target_user_id": 1}	2026-03-23 12:18:04.847713+05:30
35	3	UPDATE_USER	USER	1	Updated user "JATIN" (CA)	{"username": "JATIN", "target_user_id": 1}	2026-03-23 12:18:06.623013+05:30
36	3	UPDATE_USER	USER	4	Updated user "TESTE" (EMPLOYEE)	{"username": "TESTE", "target_user_id": 4}	2026-03-23 12:18:07.842783+05:30
37	3	UPDATE_USER	USER	4	Updated user "TESTE" (EMPLOYEE)	{"username": "TESTE", "target_user_id": 4}	2026-03-23 12:18:41.094333+05:30
38	3	DELETE_BILL	BILL	7	Deleted bill #MSD/2526/004	{"bill_id": 7, "bill_no": "MSD/2526/004"}	2026-03-23 12:35:11.308555+05:30
39	3	DELETE_BILL	BILL	6	Deleted bill #MSD/2526/003	{"bill_id": 6, "bill_no": "MSD/2526/003"}	2026-03-23 12:35:17.604897+05:30
40	3	CREATE_BILL	BILL	8	Created bill #MSD-DRAFT-8 (2025-26)	{"bill_id": 8, "bill_no": "MSD-DRAFT-8", "financial_year": "2025-26"}	2026-03-23 12:36:22.350847+05:30
41	3	ADD_SERVICE	SERVICE	11	Added "TDS Returns" — ₹4500.00	{"amount": 4500, "bill_id": 8, "bill_no": "MSD-DRAFT-8", "service_id": 11, "service_name": "TDS Returns"}	2026-03-23 12:36:22.35395+05:30
42	3	UPDATE_BILL	BILL	8	Updated bill #MSD-DRAFT-8	{"bill_id": 8, "bill_no": "MSD-DRAFT-8", "override_edit": false}	2026-03-23 12:36:51.812149+05:30
43	3	ADD_SERVICE	SERVICE	13	Added "Other Professional Services" — ₹100.00	{"amount": 100, "bill_id": 8, "bill_no": "MSD-DRAFT-8", "service_id": 13, "service_name": "Other Professional Services"}	2026-03-23 12:36:51.816919+05:30
44	3	CREATE_BILL	BILL	9	Created bill #MSD-DRAFT-9 (2025-26)	{"bill_id": 9, "bill_no": "MSD-DRAFT-9", "financial_year": "2025-26"}	2026-03-23 12:38:03.221816+05:30
45	3	ADD_SERVICE	SERVICE	14	Added "GST Audit" — ₹20000.00	{"amount": 20000, "bill_id": 9, "bill_no": "MSD-DRAFT-9", "service_id": 14, "service_name": "GST Audit"}	2026-03-23 12:38:03.225661+05:30
46	3	FINALIZE_BILL	BILL	9	Total ₹23600.00	{"bill_id": 9, "bill_no": "MSD/2526/005", "total_invoice_value": "23600.00"}	2026-03-23 12:38:41.549619+05:30
47	3	FINALIZE_BILL	BILL	8	Total ₹5428.00	{"bill_id": 8, "bill_no": "MSD/2526/006", "total_invoice_value": "5428.00"}	2026-03-23 12:38:43.98797+05:30
48	3	MARK_PAYMENT	PAYMENT	4	Payment received — ₹20000.00 via CHEQUE	{"bill_id": 9, "bill_no": "MSD/2526/005", "payment_id": 4, "amount_paid": 20000, "payment_date": "2026-03-23", "payment_mode": "CHEQUE"}	2026-03-23 12:40:45.720266+05:30
49	3	CREATE_BILL	BILL	13	Created bill #MSD-DRAFT-13 (2025-26)	{"bill_id": 13, "bill_no": "MSD-DRAFT-13", "financial_year": "2025-26"}	2026-03-23 12:41:50.009499+05:30
50	3	ADD_SERVICE	SERVICE	16	Added "Other Professional Services" — ₹15.00	{"amount": 15, "bill_id": 13, "bill_no": "MSD-DRAFT-13", "service_id": 16, "service_name": "Other Professional Services"}	2026-03-23 12:41:50.013658+05:30
51	3	ADD_SERVICE	SERVICE	15	Added "Other Professional Services" — ₹10.00	{"amount": 10, "bill_id": 13, "bill_no": "MSD-DRAFT-13", "service_id": 15, "service_name": "Other Professional Services"}	2026-03-23 12:41:50.013546+05:30
52	3	CREATE_BILL	BILL	14	Created bill #MSD-DRAFT-14 (2025-26)	{"bill_id": 14, "bill_no": "MSD-DRAFT-14", "financial_year": "2025-26"}	2026-03-23 12:42:14.698478+05:30
53	3	ADD_SERVICE	SERVICE	17	Added "Income Tax Assessment " — ₹1500.00	{"amount": 1500, "bill_id": 14, "bill_no": "MSD-DRAFT-14", "service_id": 17, "service_name": "Income Tax Assessment "}	2026-03-23 12:42:14.699962+05:30
54	3	MERGE_BILLS	BILL	15	Merged 2 bills into new draft	{"merged_bill_id": 15, "source_bill_ids": [14, 13], "source_bill_nos": []}	2026-03-23 12:42:35.720099+05:30
55	3	UNMERGE_BILL	BILL	15	Unmerged bill — restored 2 bills to Draft	{"merged_bill_id": 15, "source_bill_ids": [14, 13]}	2026-03-23 12:43:01.553636+05:30
56	3	MERGE_BILLS	BILL	16	Merged 2 bills into new draft	{"merged_bill_id": 16, "source_bill_ids": [14, 13], "source_bill_nos": []}	2026-03-23 12:44:40.872521+05:30
57	3	FINALIZE_BILL	BILL	16	Total ₹1799.50	{"bill_id": 16, "bill_no": "MSD/2526/007", "total_invoice_value": "1799.50"}	2026-03-23 12:44:43.044473+05:30
58	3	MARK_PAYMENT	PAYMENT	5	Payment received — ₹1600.00 via NEFT	{"bill_id": 16, "bill_no": "MSD/2526/007", "payment_id": 5, "amount_paid": 1600, "payment_date": "2026-03-23", "payment_mode": "NEFT"}	2026-03-23 12:45:21.487277+05:30
59	3	DELETE_BILL	BILL	16	Deleted bill #MSD/2526/007	{"bill_id": 16, "bill_no": "MSD/2526/007"}	2026-03-23 12:47:02.589133+05:30
60	3	DELETE_BILL	BILL	9	Deleted bill #MSD/2526/005	{"bill_id": 9, "bill_no": "MSD/2526/005"}	2026-03-23 12:47:42.966498+05:30
61	3	DELETE_BILL	BILL	8	Deleted bill #MSD/2526/006	{"bill_id": 8, "bill_no": "MSD/2526/006"}	2026-03-23 12:47:51.346658+05:30
62	3	CREATE_BILL	BILL	17	Created bill #MSD-DRAFT-17 (2025-26)	{"bill_id": 17, "bill_no": "MSD-DRAFT-17", "financial_year": "2025-26"}	2026-03-26 13:07:22.483516+05:30
63	3	ADD_SERVICE	SERVICE	24	Added "Income Tax Audit, Account Finalisation" — ₹10000.00	{"amount": 10000, "bill_id": 17, "bill_no": "MSD-DRAFT-17", "service_id": 24, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-26 13:07:22.489266+05:30
64	3	ADD_SERVICE	SERVICE	25	Added "Income Tax Return, Account Finalisation" — ₹5000.00	{"amount": 5000, "bill_id": 17, "bill_no": "MSD-DRAFT-17", "service_id": 25, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-26 13:07:22.618463+05:30
65	3	ADD_SERVICE	SERVICE	26	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 17, "bill_no": "MSD-DRAFT-17", "service_id": 26, "service_name": "GST Return - Monthly"}	2026-03-26 13:07:22.689934+05:30
66	3	ADD_SERVICE	SERVICE	27	Added "Income Tax Return, Account Finalisation" — ₹20000.00	{"amount": 20000, "bill_id": 17, "bill_no": "MSD-DRAFT-17", "service_id": 27, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-26 13:07:22.87602+05:30
67	3	CREATE_BILL	BILL	18	Created bill #MSD-DRAFT-18 (2025-26)	{"bill_id": 18, "bill_no": "MSD-DRAFT-18", "financial_year": "2025-26"}	2026-03-26 13:19:05.627028+05:30
68	3	ADD_SERVICE	SERVICE	28	Added "Other Professional Services" — ₹300000.00	{"amount": 300000, "bill_id": 18, "bill_no": "MSD-DRAFT-18", "service_id": 28, "service_name": "Other Professional Services"}	2026-03-26 13:19:05.631346+05:30
69	3	FINALIZE_BILL	BILL	18	Total ₹354000.00	{"bill_id": 18, "bill_no": "MSD/2526/008", "total_invoice_value": "354000.00"}	2026-03-26 13:23:06.312479+05:30
70	3	FINALIZE_BILL	BILL	17	Total ₹59000.00	{"bill_id": 17, "bill_no": "MSD/2526/009", "total_invoice_value": "59000.00"}	2026-03-26 13:23:08.833628+05:30
71	3	CREATE_BILL	BILL	19	Created bill #MSD-DRAFT-19 (2025-26)	{"bill_id": 19, "bill_no": "MSD-DRAFT-19", "financial_year": "2025-26"}	2026-03-28 12:41:57.252382+05:30
72	3	ADD_SERVICE	SERVICE	29	Added "GST Return - Monthly" — ₹108000.00	{"amount": 108000, "bill_id": 19, "bill_no": "MSD-DRAFT-19", "service_id": 29, "service_name": "GST Return - Monthly"}	2026-03-28 12:41:57.258114+05:30
73	3	ADD_SERVICE	SERVICE	30	Added "GST Return - Monthly" — ₹30000.00	{"amount": 30000, "bill_id": 19, "bill_no": "MSD-DRAFT-19", "service_id": 30, "service_name": "GST Return - Monthly"}	2026-03-28 12:41:57.382469+05:30
74	3	CREATE_BILL	BILL	23	Created bill #MSD-DRAFT-23 (2025-26)	{"bill_id": 23, "bill_no": "MSD-DRAFT-23", "financial_year": "2025-26"}	2026-03-28 12:44:56.787803+05:30
75	3	ADD_SERVICE	SERVICE	31	Added "GST Return - Monthly" — ₹132000.00	{"amount": 132000, "bill_id": 23, "bill_no": "MSD-DRAFT-23", "service_id": 31, "service_name": "GST Return - Monthly"}	2026-03-28 12:44:56.79265+05:30
76	3	UPDATE_BILL	BILL	23	Updated bill #MSD-DRAFT-23	{"bill_id": 23, "bill_no": "MSD-DRAFT-23", "override_edit": false}	2026-03-28 12:45:27.972033+05:30
77	3	ADD_SERVICE	SERVICE	34	Added "GST Return - Monthly" — ₹4000.00	{"amount": 4000, "bill_id": 23, "bill_no": "MSD-DRAFT-23", "service_id": 34, "service_name": "GST Return - Monthly"}	2026-03-28 12:45:27.976695+05:30
78	3	ADD_SERVICE	SERVICE	33	Added "GST Return - Monthly" — ₹30000.00	{"amount": 30000, "bill_id": 23, "bill_no": "MSD-DRAFT-23", "service_id": 33, "service_name": "GST Return - Monthly"}	2026-03-28 12:45:27.976514+05:30
79	3	CREATE_BILL	BILL	24	Created bill #MSD-DRAFT-24 (2025-26)	{"bill_id": 24, "bill_no": "MSD-DRAFT-24", "financial_year": "2025-26"}	2026-03-28 12:46:45.279342+05:30
80	3	ADD_SERVICE	SERVICE	35	Added "GST Return - Monthly" — ₹132000.00	{"amount": 132000, "bill_id": 24, "bill_no": "MSD-DRAFT-24", "service_id": 35, "service_name": "GST Return - Monthly"}	2026-03-28 12:46:45.284815+05:30
81	3	ADD_SERVICE	SERVICE	36	Added "GST Return - Monthly" — ₹30000.00	{"amount": 30000, "bill_id": 24, "bill_no": "MSD-DRAFT-24", "service_id": 36, "service_name": "GST Return - Monthly"}	2026-03-28 12:46:45.542256+05:30
82	3	UPDATE_BILL	BILL	24	Updated bill #MSD-DRAFT-24	{"bill_id": 24, "bill_no": "MSD-DRAFT-24", "override_edit": false}	2026-03-28 12:47:18.832376+05:30
83	3	ADD_SERVICE	SERVICE	39	Added "GST Return - Monthly" — ₹18000.00	{"amount": 18000, "bill_id": 24, "bill_no": "MSD-DRAFT-24", "service_id": 39, "service_name": "GST Return - Monthly"}	2026-03-28 12:47:18.836685+05:30
84	3	CREATE_BILL	BILL	25	Created bill #MSD-DRAFT-25 (2025-26)	{"bill_id": 25, "bill_no": "MSD-DRAFT-25", "financial_year": "2025-26"}	2026-03-28 12:52:59.662803+05:30
85	3	ADD_SERVICE	SERVICE	40	Added "Income Tax Audit, Account Finalisation" — ₹14000.00	{"amount": 14000, "bill_id": 25, "bill_no": "MSD-DRAFT-25", "service_id": 40, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-28 12:52:59.668052+05:30
86	3	ADD_SERVICE	SERVICE	41	Added "Other Professional Services" — ₹2000.00	{"amount": 2000, "bill_id": 25, "bill_no": "MSD-DRAFT-25", "service_id": 41, "service_name": "Other Professional Services"}	2026-03-28 12:52:59.802856+05:30
87	3	CREATE_BILL	BILL	26	Created bill #MSD-DRAFT-26 (2025-26)	{"bill_id": 26, "bill_no": "MSD-DRAFT-26", "financial_year": "2025-26"}	2026-03-28 12:58:36.369275+05:30
88	3	ADD_SERVICE	SERVICE	42	Added "Income Tax Audit, Account Finalisation" — ₹35000.00	{"amount": 35000, "bill_id": 26, "bill_no": "MSD-DRAFT-26", "service_id": 42, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-28 12:58:36.374037+05:30
89	3	CREATE_BILL	BILL	27	Created bill #MSD-DRAFT-27 (2025-26)	{"bill_id": 27, "bill_no": "MSD-DRAFT-27", "financial_year": "2025-26"}	2026-03-28 13:02:14.899665+05:30
90	3	ADD_SERVICE	SERVICE	43	Added "Other Professional Services" — ₹125000.00	{"amount": 125000, "bill_id": 27, "bill_no": "MSD-DRAFT-27", "service_id": 43, "service_name": "Other Professional Services"}	2026-03-28 13:02:14.903272+05:30
91	3	ADD_SERVICE	SERVICE	44	Added "Other Professional Services" — ₹125000.00	{"amount": 125000, "bill_id": 27, "bill_no": "MSD-DRAFT-27", "service_id": 44, "service_name": "Other Professional Services"}	2026-03-28 13:02:15.032707+05:30
92	3	ADD_SERVICE	SERVICE	46	Added "GST Audit" — ₹25000.00	{"amount": 25000, "bill_id": 27, "bill_no": "MSD-DRAFT-27", "service_id": 46, "service_name": "GST Audit"}	2026-03-28 13:02:15.189879+05:30
93	3	ADD_SERVICE	SERVICE	45	Added "GST Assessment" — ₹5000.00	{"amount": 5000, "bill_id": 27, "bill_no": "MSD-DRAFT-27", "service_id": 45, "service_name": "GST Assessment"}	2026-03-28 13:02:15.21515+05:30
94	3	UPDATE_BILL	BILL	27	Updated bill #MSD-DRAFT-27	{"bill_id": 27, "bill_no": "MSD-DRAFT-27", "override_edit": false}	2026-03-28 13:03:21.646566+05:30
95	3	CREATE_BILL	BILL	28	Created bill #MSD-DRAFT-28 (2025-26)	{"bill_id": 28, "bill_no": "MSD-DRAFT-28", "financial_year": "2025-26"}	2026-03-28 13:13:14.249828+05:30
96	3	ADD_SERVICE	SERVICE	52	Added "GST Assessment" — ₹5000.00	{"amount": 5000, "bill_id": 28, "bill_no": "MSD-DRAFT-28", "service_id": 52, "service_name": "GST Assessment"}	2026-03-28 13:13:14.254398+05:30
97	3	ADD_SERVICE	SERVICE	51	Added "Income Tax Audit, Account Finalisation" — ₹30000.00	{"amount": 30000, "bill_id": 28, "bill_no": "MSD-DRAFT-28", "service_id": 51, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-28 13:13:14.254232+05:30
98	3	CREATE_BILL	BILL	29	Created bill #MSD-DRAFT-29 (2025-26)	{"bill_id": 29, "bill_no": "MSD-DRAFT-29", "financial_year": "2025-26"}	2026-03-28 15:44:48.202616+05:30
99	3	ADD_SERVICE	SERVICE	53	Added "Other Professional Services" — ₹55000.00	{"amount": 55000, "bill_id": 29, "bill_no": "MSD-DRAFT-29", "service_id": 53, "service_name": "Other Professional Services"}	2026-03-28 15:44:48.207574+05:30
100	3	ADD_SERVICE	SERVICE	54	Added "Other Professional Services" — ₹2500.00	{"amount": 2500, "bill_id": 29, "bill_no": "MSD-DRAFT-29", "service_id": 54, "service_name": "Other Professional Services"}	2026-03-28 15:44:48.466772+05:30
101	3	ADD_SERVICE	SERVICE	55	Added "Other Professional Services" — ₹1500.00	{"amount": 1500, "bill_id": 29, "bill_no": "MSD-DRAFT-29", "service_id": 55, "service_name": "Other Professional Services"}	2026-03-28 15:44:48.545258+05:30
102	3	CREATE_BILL	BILL	30	Created bill #MSD-DRAFT-30 (2025-26)	{"bill_id": 30, "bill_no": "MSD-DRAFT-30", "financial_year": "2025-26"}	2026-03-28 15:52:19.033068+05:30
103	3	ADD_SERVICE	SERVICE	56	Added "Professional Services" — ₹55000.00	{"amount": 55000, "bill_id": 30, "bill_no": "MSD-DRAFT-30", "service_id": 56, "service_name": "Professional Services"}	2026-03-28 15:52:19.038196+05:30
104	3	CREATE_BILL	BILL	31	Created bill #MSD-DRAFT-31 (2025-26)	{"bill_id": 31, "bill_no": "MSD-DRAFT-31", "financial_year": "2025-26"}	2026-03-28 16:07:41.413556+05:30
105	3	ADD_SERVICE	SERVICE	57	Added "Professional Services" — ₹55000.00	{"amount": 55000, "bill_id": 31, "bill_no": "MSD-DRAFT-31", "service_id": 57, "service_name": "Professional Services"}	2026-03-28 16:07:41.419018+05:30
106	3	UPDATE_BILL	BILL	31	Updated bill #MSD-DRAFT-31	{"bill_id": 31, "bill_no": "MSD-DRAFT-31", "override_edit": false}	2026-03-28 16:08:03.399052+05:30
107	3	CREATE_BILL	BILL	32	Created bill #MSD-DRAFT-32 (2025-26)	{"bill_id": 32, "bill_no": "MSD-DRAFT-32", "financial_year": "2025-26"}	2026-03-28 16:10:41.123842+05:30
108	3	ADD_SERVICE	SERVICE	59	Added "Professional Services" — ₹55000.00	{"amount": 55000, "bill_id": 32, "bill_no": "MSD-DRAFT-32", "service_id": 59, "service_name": "Professional Services"}	2026-03-28 16:10:41.12978+05:30
109	3	CREATE_BILL	BILL	33	Created bill #MSD-DRAFT-33 (2025-26)	{"bill_id": 33, "bill_no": "MSD-DRAFT-33", "financial_year": "2025-26"}	2026-03-28 16:19:07.597621+05:30
110	3	ADD_SERVICE	SERVICE	61	Added "GST Assessment" — ₹7500.00	{"amount": 7500, "bill_id": 33, "bill_no": "MSD-DRAFT-33", "service_id": 61, "service_name": "GST Assessment"}	2026-03-28 16:19:07.602663+05:30
111	3	ADD_SERVICE	SERVICE	60	Added "Income Tax Audit, Account Finalisation" — ₹25000.00	{"amount": 25000, "bill_id": 33, "bill_no": "MSD-DRAFT-33", "service_id": 60, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-28 16:19:07.602497+05:30
112	3	CREATE_BILL	BILL	34	Created bill #URJ-DRAFT-34 (2025-26)	{"bill_id": 34, "bill_no": "URJ-DRAFT-34", "financial_year": "2025-26"}	2026-03-28 16:23:01.001675+05:30
113	3	ADD_SERVICE	SERVICE	63	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 34, "bill_no": "URJ-DRAFT-34", "service_id": 63, "service_name": "GST Return - Monthly"}	2026-03-28 16:23:01.007066+05:30
114	3	ADD_SERVICE	SERVICE	62	Added "TDS Returns" — ₹15000.00	{"amount": 15000, "bill_id": 34, "bill_no": "URJ-DRAFT-34", "service_id": 62, "service_name": "TDS Returns"}	2026-03-28 16:23:01.006898+05:30
115	3	ADD_SERVICE	SERVICE	64	Added "Income Tax Return, Account Finalisation" — ₹20000.00	{"amount": 20000, "bill_id": 34, "bill_no": "URJ-DRAFT-34", "service_id": 64, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-28 16:23:01.134337+05:30
116	3	FINALIZE_BILL	BILL	34	Total ₹50000.00	{"bill_id": 34, "bill_no": "URJ/2526/001", "total_invoice_value": "50000.00"}	2026-03-28 16:23:08.716709+05:30
117	3	FINALIZE_BILL	BILL	33	Total ₹38350.00	{"bill_id": 33, "bill_no": "MSD/2526/010", "total_invoice_value": "38350.00"}	2026-03-28 16:23:13.941494+05:30
118	3	MARK_PAYMENT	PAYMENT	6	Payment received — ₹50000.00 via NEFT	{"bill_id": 34, "bill_no": "URJ/2526/001", "payment_id": 6, "amount_paid": 50000, "payment_date": "2026-03-28", "payment_mode": "NEFT"}	2026-03-28 16:23:40.343148+05:30
119	3	MARK_PAYMENT	PAYMENT	7	Payment received — ₹38350.00 via NEFT	{"bill_id": 33, "bill_no": "MSD/2526/010", "payment_id": 7, "amount_paid": 38350, "payment_date": "2026-02-28", "payment_mode": "NEFT"}	2026-03-28 16:24:11.659638+05:30
120	3	CREATE_BILL	BILL	35	Created bill #MSD-DRAFT-35 (2025-26)	{"bill_id": 35, "bill_no": "MSD-DRAFT-35", "financial_year": "2025-26"}	2026-03-28 16:27:56.459957+05:30
121	3	ADD_SERVICE	SERVICE	65	Added "Professional Services" — ₹400000.00	{"amount": 400000, "bill_id": 35, "bill_no": "MSD-DRAFT-35", "service_id": 65, "service_name": "Professional Services"}	2026-03-28 16:27:56.46524+05:30
122	3	FINALIZE_BILL	BILL	35	Total ₹472000.00	{"bill_id": 35, "bill_no": "MSD/2526/011", "total_invoice_value": "472000.00"}	2026-03-28 16:28:02.366375+05:30
123	3	MARK_PAYMENT	PAYMENT	8	Payment received — ₹472000.00 via NEFT	{"bill_id": 35, "bill_no": "MSD/2526/011", "payment_id": 8, "amount_paid": 472000, "payment_date": "2025-11-05", "payment_mode": "NEFT"}	2026-03-28 16:28:18.882957+05:30
124	3	CREATE_BILL	BILL	36	Created bill #MSD-DRAFT-36 (2025-26)	{"bill_id": 36, "bill_no": "MSD-DRAFT-36", "financial_year": "2025-26"}	2026-03-28 17:38:47.462862+05:30
125	3	ADD_SERVICE	SERVICE	66	Added "Professional Services" — ₹25000.00	{"amount": 25000, "bill_id": 36, "bill_no": "MSD-DRAFT-36", "service_id": 66, "service_name": "Professional Services"}	2026-03-28 17:38:47.468517+05:30
126	3	ADD_SERVICE	SERVICE	67	Added "Professional Services" — ₹25000.00	{"amount": 25000, "bill_id": 36, "bill_no": "MSD-DRAFT-36", "service_id": 67, "service_name": "Professional Services"}	2026-03-28 17:38:47.624121+05:30
127	3	ADD_SERVICE	SERVICE	68	Added "TDS Returns" — ₹2500.00	{"amount": 2500, "bill_id": 36, "bill_no": "MSD-DRAFT-36", "service_id": 68, "service_name": "TDS Returns"}	2026-03-28 17:38:47.695114+05:30
128	3	ADD_SERVICE	SERVICE	69	Added "TDS Returns" — ₹7500.00	{"amount": 7500, "bill_id": 36, "bill_no": "MSD-DRAFT-36", "service_id": 69, "service_name": "TDS Returns"}	2026-03-28 17:38:47.771426+05:30
129	3	ADD_SERVICE	SERVICE	70	Added "GST Returns - Quarterly" — ₹6000.00	{"amount": 6000, "bill_id": 36, "bill_no": "MSD-DRAFT-36", "service_id": 70, "service_name": "GST Returns - Quarterly"}	2026-03-28 17:38:47.945908+05:30
130	3	ADD_SERVICE	SERVICE	73	Added "GST Annual Return" — ₹10000.00	{"amount": 10000, "bill_id": 36, "bill_no": "MSD-DRAFT-36", "service_id": 73, "service_name": "GST Annual Return"}	2026-03-28 17:38:48.015226+05:30
131	3	ADD_SERVICE	SERVICE	71	Added "GST Returns - Quarterly" — ₹6000.00	{"amount": 6000, "bill_id": 36, "bill_no": "MSD-DRAFT-36", "service_id": 71, "service_name": "GST Returns - Quarterly"}	2026-03-28 17:38:48.03072+05:30
132	3	ADD_SERVICE	SERVICE	72	Added "GST Annual Return" — ₹10000.00	{"amount": 10000, "bill_id": 36, "bill_no": "MSD-DRAFT-36", "service_id": 72, "service_name": "GST Annual Return"}	2026-03-28 17:38:48.091953+05:30
133	3	CREATE_BILL	BILL	37	Created bill #URJ-DRAFT-37 (2025-26)	{"bill_id": 37, "bill_no": "URJ-DRAFT-37", "financial_year": "2025-26"}	2026-03-28 17:43:38.507969+05:30
134	3	ADD_SERVICE	SERVICE	74	Added "Income Tax Return, Account Finalisation" — ₹15000.00	{"amount": 15000, "bill_id": 37, "bill_no": "URJ-DRAFT-37", "service_id": 74, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-28 17:43:38.514251+05:30
135	3	ADD_SERVICE	SERVICE	75	Added "Income Tax Return, Account Finalisation" — ₹15000.00	{"amount": 15000, "bill_id": 37, "bill_no": "URJ-DRAFT-37", "service_id": 75, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-28 17:43:38.655255+05:30
136	3	UPDATE_BILL	BILL	37	Updated bill #URJ-DRAFT-37	{"bill_id": 37, "bill_no": "URJ-DRAFT-37", "override_edit": false}	2026-03-28 17:48:11.797116+05:30
137	3	CREATE_BILL	BILL	38	Created bill #URJ-DRAFT-38 (2025-26)	{"bill_id": 38, "bill_no": "URJ-DRAFT-38", "financial_year": "2025-26"}	2026-03-28 17:49:22.577654+05:30
138	3	ADD_SERVICE	SERVICE	78	Added "Professional Services" — ₹10000.00	{"amount": 10000, "bill_id": 38, "bill_no": "URJ-DRAFT-38", "service_id": 78, "service_name": "Professional Services"}	2026-03-28 17:49:22.582262+05:30
139	3	ADD_SERVICE	SERVICE	79	Added "TDS Returns" — ₹2500.00	{"amount": 2500, "bill_id": 38, "bill_no": "URJ-DRAFT-38", "service_id": 79, "service_name": "TDS Returns"}	2026-03-28 17:49:22.817828+05:30
140	3	CREATE_BILL	BILL	39	Created bill #MSD-DRAFT-39 (2025-26)	{"bill_id": 39, "bill_no": "MSD-DRAFT-39", "financial_year": "2025-26"}	2026-03-28 17:53:19.217109+05:30
269	3	CREATE_BILL	BILL	63	Created bill #MSD-DRAFT-63 (2025-26)	{"bill_id": 63, "bill_no": "MSD-DRAFT-63", "financial_year": "2025-26"}	2026-04-01 17:57:23.032939+05:30
141	3	ADD_SERVICE	SERVICE	80	Added "Professional Services" — ₹85000.00	{"amount": 85000, "bill_id": 39, "bill_no": "MSD-DRAFT-39", "service_id": 80, "service_name": "Professional Services"}	2026-03-28 17:53:19.22822+05:30
142	3	FINALIZE_BILL	BILL	39	Total ₹100300.00	{"bill_id": 39, "bill_no": "MSD/2526/012", "total_invoice_value": "100300.00"}	2026-03-28 17:53:24.097915+05:30
143	3	MARK_PAYMENT	PAYMENT	9	Payment received — ₹100300.00 via CHEQUE	{"bill_id": 39, "bill_no": "MSD/2526/012", "payment_id": 9, "amount_paid": 100300, "payment_date": "2026-03-09", "payment_mode": "CHEQUE"}	2026-03-28 17:53:46.074067+05:30
144	3	CREATE_BILL	BILL	43	Created bill #MSD-DRAFT-43 (2025-26)	{"bill_id": 43, "bill_no": "MSD-DRAFT-43", "financial_year": "2025-26"}	2026-03-28 18:19:22.391638+05:30
145	3	ADD_SERVICE	SERVICE	81	Added "Professional Services" — ₹25000.00	{"amount": 25000, "bill_id": 43, "bill_no": "MSD-DRAFT-43", "service_id": 81, "service_name": "Professional Services"}	2026-03-28 18:19:22.397741+05:30
146	3	FINALIZE_BILL	BILL	43	Total ₹29500.00	{"bill_id": 43, "bill_no": "MSD/2526/013", "total_invoice_value": "29500.00"}	2026-03-28 18:19:32.237287+05:30
147	3	MARK_PAYMENT	PAYMENT	10	Payment received — ₹29500.00 via CHEQUE	{"bill_id": 43, "bill_no": "MSD/2526/013", "payment_id": 10, "amount_paid": 29500, "payment_date": "2026-03-04", "payment_mode": "CHEQUE"}	2026-03-28 18:19:57.774914+05:30
148	3	CREATE_BILL	BILL	44	Created bill #URJ-DRAFT-44 (2025-26)	{"bill_id": 44, "bill_no": "URJ-DRAFT-44", "financial_year": "2025-26"}	2026-03-28 18:20:27.201491+05:30
149	3	ADD_SERVICE	SERVICE	82	Added "Professional Services" — ₹20000.00	{"amount": 20000, "bill_id": 44, "bill_no": "URJ-DRAFT-44", "service_id": 82, "service_name": "Professional Services"}	2026-03-28 18:20:27.206288+05:30
150	3	FINALIZE_BILL	BILL	44	Total ₹20000.00	{"bill_id": 44, "bill_no": "URJ/2526/002", "total_invoice_value": "20000.00"}	2026-03-28 18:20:33.538081+05:30
151	3	MARK_PAYMENT	PAYMENT	11	Payment received — ₹20000.00 via NEFT	{"bill_id": 44, "bill_no": "URJ/2526/002", "payment_id": 11, "amount_paid": 20000, "payment_date": "2026-03-04", "payment_mode": "NEFT"}	2026-03-28 18:21:00.472135+05:30
152	3	UPDATE_BILL	BILL	27	Updated bill #MSD-DRAFT-27	{"bill_id": 27, "bill_no": "MSD-DRAFT-27", "override_edit": false}	2026-03-28 18:23:10.320142+05:30
153	3	ADD_SERVICE	SERVICE	86	Added "GST Assessment" — ₹25000.00	{"amount": 25000, "bill_id": 27, "bill_no": "MSD-DRAFT-27", "service_id": 86, "service_name": "GST Assessment"}	2026-03-28 18:23:10.324324+05:30
154	3	DELETE_SERVICE	SERVICE	50	Removed "GST Audit" — ₹25000.00	{"amount": 25000, "bill_id": 27, "bill_no": "MSD-DRAFT-27", "service_id": 50, "service_name": "GST Audit"}	2026-03-28 18:23:10.324211+05:30
155	3	CREATE_BILL	BILL	45	Created bill #MSD-DRAFT-45 (2025-26)	{"bill_id": 45, "bill_no": "MSD-DRAFT-45", "financial_year": "2025-26"}	2026-03-28 18:31:23.065286+05:30
156	3	ADD_SERVICE	SERVICE	87	Added "Professional Services" — ₹77000.00	{"amount": 77000, "bill_id": 45, "bill_no": "MSD-DRAFT-45", "service_id": 87, "service_name": "Professional Services"}	2026-03-28 18:31:23.069022+05:30
157	3	FINALIZE_BILL	BILL	45	Total ₹90860.00	{"bill_id": 45, "bill_no": "MSD/2526/014", "total_invoice_value": "90860.00"}	2026-03-28 18:31:31.569463+05:30
158	3	MARK_PAYMENT	PAYMENT	12	Payment received — ₹90860.00 via CHEQUE	{"bill_id": 45, "bill_no": "MSD/2526/014", "payment_id": 12, "amount_paid": 90860, "payment_date": "2026-03-12", "payment_mode": "CHEQUE"}	2026-03-28 18:31:52.600032+05:30
159	3	CREATE_BILL	BILL	46	Created bill #MSD-DRAFT-46 (2025-26)	{"bill_id": 46, "bill_no": "MSD-DRAFT-46", "financial_year": "2025-26"}	2026-03-28 18:44:57.358512+05:30
160	3	ADD_SERVICE	SERVICE	88	Added "Professional Services" — ₹10000.00	{"amount": 10000, "bill_id": 46, "bill_no": "MSD-DRAFT-46", "service_id": 88, "service_name": "Professional Services"}	2026-03-28 18:44:57.362+05:30
161	3	FINALIZE_BILL	BILL	46	Total ₹11800.00	{"bill_id": 46, "bill_no": "MSD/2526/015", "total_invoice_value": "11800.00"}	2026-03-28 18:45:03.664788+05:30
162	3	MARK_PAYMENT	PAYMENT	13	Payment received — ₹11800.00 via CHEQUE	{"bill_id": 46, "bill_no": "MSD/2526/015", "payment_id": 13, "amount_paid": 11800, "payment_date": "2025-11-14", "payment_mode": "CHEQUE"}	2026-03-28 18:45:31.683563+05:30
163	3	CREATE_BILL	BILL	47	Created bill #URJ-DRAFT-47 (2025-26)	{"bill_id": 47, "bill_no": "URJ-DRAFT-47", "financial_year": "2025-26"}	2026-03-28 18:46:04.411236+05:30
164	3	ADD_SERVICE	SERVICE	89	Added "Other Professional Services" — ₹11000.00	{"amount": 11000, "bill_id": 47, "bill_no": "URJ-DRAFT-47", "service_id": 89, "service_name": "Other Professional Services"}	2026-03-28 18:46:04.415682+05:30
165	3	FINALIZE_BILL	BILL	47	Total ₹11000.00	{"bill_id": 47, "bill_no": "URJ/2526/003", "total_invoice_value": "11000.00"}	2026-03-28 18:46:09.226479+05:30
166	3	MARK_PAYMENT	PAYMENT	14	Payment received — ₹11000.00 via NEFT	{"bill_id": 47, "bill_no": "URJ/2526/003", "payment_id": 14, "amount_paid": 11000, "payment_date": "2025-11-14", "payment_mode": "NEFT"}	2026-03-28 18:46:19.681149+05:30
167	3	CREATE_BILL	BILL	48	Created bill #MSD-DRAFT-48 (2025-26)	{"bill_id": 48, "bill_no": "MSD-DRAFT-48", "financial_year": "2025-26"}	2026-03-28 18:52:10.210554+05:30
168	3	ADD_SERVICE	SERVICE	90	Added "Professional Services" — ₹27000.00	{"amount": 27000, "bill_id": 48, "bill_no": "MSD-DRAFT-48", "service_id": 90, "service_name": "Professional Services"}	2026-03-28 18:52:10.215399+05:30
169	3	FINALIZE_BILL	BILL	48	Total ₹31860.00	{"bill_id": 48, "bill_no": "MSD/2526/016", "total_invoice_value": "31860.00"}	2026-03-28 18:52:18.380835+05:30
170	3	MARK_PAYMENT	PAYMENT	15	Payment received — ₹31860.00 via NEFT	{"bill_id": 48, "bill_no": "MSD/2526/016", "payment_id": 15, "amount_paid": 31860, "payment_date": "2026-03-12", "payment_mode": "NEFT"}	2026-03-28 18:52:38.190913+05:30
171	3	FINALIZE_BILL	BILL	36	Total ₹108560.00	{"bill_id": 36, "bill_no": "MSD/2526/017", "total_invoice_value": "108560.00"}	2026-03-30 11:06:24.773471+05:30
172	3	CREATE_BILL	BILL	49	Created bill #MSD-DRAFT-49 (2025-26)	{"bill_id": 49, "bill_no": "MSD-DRAFT-49", "financial_year": "2025-26"}	2026-03-30 13:21:48.625671+05:30
173	3	ADD_SERVICE	SERVICE	91	Added "Professional Services" — ₹30000.00	{"amount": 30000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 91, "service_name": "Professional Services"}	2026-03-30 13:21:48.631485+05:30
174	3	ADD_SERVICE	SERVICE	92	Added "Professional Services" — ₹7000.00	{"amount": 7000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 92, "service_name": "Professional Services"}	2026-03-30 13:21:48.779459+05:30
175	3	ADD_SERVICE	SERVICE	93	Added "GST Return - Monthly" — ₹42000.00	{"amount": 42000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 93, "service_name": "GST Return - Monthly"}	2026-03-30 13:21:48.860165+05:30
176	3	ADD_SERVICE	SERVICE	94	Added "GST Return - Monthly" — ₹30000.00	{"amount": 30000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 94, "service_name": "GST Return - Monthly"}	2026-03-30 13:21:48.948231+05:30
177	3	ADD_SERVICE	SERVICE	95	Added "GST Registration " — ₹4000.00	{"amount": 4000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 95, "service_name": "GST Registration "}	2026-03-30 13:21:49.015275+05:30
178	3	ADD_SERVICE	SERVICE	96	Added "TDS Returns" — ₹16000.00	{"amount": 16000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 96, "service_name": "TDS Returns"}	2026-03-30 13:21:49.105425+05:30
179	3	ADD_SERVICE	SERVICE	97	Added "GST Assessment" — ₹20000.00	{"amount": 20000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 97, "service_name": "GST Assessment"}	2026-03-30 13:21:49.283943+05:30
180	3	UPDATE_BILL	BILL	49	Updated bill #MSD-DRAFT-49	{"bill_id": 49, "bill_no": "MSD-DRAFT-49", "override_edit": false}	2026-03-30 13:31:24.59187+05:30
181	3	DELETE_SERVICE	SERVICE	92	Removed "Professional Services" — ₹7000.00	{"amount": 7000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 92, "service_name": "Professional Services"}	2026-03-30 13:31:24.596671+05:30
182	3	DELETE_SERVICE	SERVICE	91	Removed "Professional Services" — ₹30000.00	{"amount": 30000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 91, "service_name": "Professional Services"}	2026-03-30 13:31:24.596508+05:30
183	3	ADD_SERVICE	SERVICE	98	Added "Professional Services" — ₹50000.00	{"amount": 50000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 98, "service_name": "Professional Services"}	2026-03-30 13:31:24.799454+05:30
184	3	DELETE_SERVICE	SERVICE	97	Removed "GST Assessment" — ₹20000.00	{"amount": 20000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 97, "service_name": "GST Assessment"}	2026-03-30 13:31:24.824885+05:30
185	3	ADD_SERVICE	SERVICE	99	Added "Professional Services" — ₹10000.00	{"amount": 10000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 99, "service_name": "Professional Services"}	2026-03-30 13:31:24.875901+05:30
186	3	ADD_SERVICE	SERVICE	104	Added "GST Assessment" — ₹25000.00	{"amount": 25000, "bill_id": 49, "bill_no": "MSD-DRAFT-49", "service_id": 104, "service_name": "GST Assessment"}	2026-03-30 13:31:24.952573+05:30
187	3	UPDATE_BILL	BILL	49	Updated bill #MSD-DRAFT-49	{"bill_id": 49, "bill_no": "MSD-DRAFT-49", "override_edit": false}	2026-03-30 13:32:26.478525+05:30
188	3	UPDATE_BILL	BILL	49	Updated bill #MSD-DRAFT-49	{"bill_id": 49, "bill_no": "MSD-DRAFT-49", "override_edit": false}	2026-03-30 16:05:55.847178+05:30
189	3	UPDATE_BILL	BILL	49	Updated bill #MSD-DRAFT-49	{"bill_id": 49, "bill_no": "MSD-DRAFT-49", "override_edit": false}	2026-03-30 16:06:09.299619+05:30
190	3	FINALIZE_BILL	BILL	28	Total ₹41300.00	{"bill_id": 28, "bill_no": "MSD/2526/018", "total_invoice_value": "41300.00"}	2026-03-31 10:50:07.609726+05:30
191	3	MARK_PAYMENT	PAYMENT	16	Payment received — ₹41300.00 via NEFT	{"bill_id": 28, "bill_no": "MSD/2526/018", "payment_id": 16, "amount_paid": 41300, "payment_date": "2026-03-30", "payment_mode": "NEFT"}	2026-03-31 10:50:33.908624+05:30
192	3	CREATE_BILL	BILL	50	Created bill #MSD-DRAFT-50 (2025-26)	{"bill_id": 50, "bill_no": "MSD-DRAFT-50", "financial_year": "2025-26"}	2026-03-31 10:52:01.615257+05:30
193	3	ADD_SERVICE	SERVICE	127	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 50, "bill_no": "MSD-DRAFT-50", "service_id": 127, "service_name": "GST Return - Monthly"}	2026-03-31 10:52:01.620086+05:30
194	3	ADD_SERVICE	SERVICE	126	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 50, "bill_no": "MSD-DRAFT-50", "service_id": 126, "service_name": "GST Return - Monthly"}	2026-03-31 10:52:01.619949+05:30
195	3	ADD_SERVICE	SERVICE	128	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 50, "bill_no": "MSD-DRAFT-50", "service_id": 128, "service_name": "GST Return - Monthly"}	2026-03-31 10:52:01.839802+05:30
196	3	FINALIZE_BILL	BILL	50	Total ₹53100.00	{"bill_id": 50, "bill_no": "MSD/2526/019", "total_invoice_value": "53100.00"}	2026-03-31 10:52:07.641893+05:30
197	3	MARK_PAYMENT	PAYMENT	17	Payment received — ₹53100.00 via NEFT	{"bill_id": 50, "bill_no": "MSD/2526/019", "payment_id": 17, "amount_paid": 53100, "payment_date": "2026-03-30", "payment_mode": "NEFT"}	2026-03-31 10:52:19.870135+05:30
198	3	FINALIZE_BILL	BILL	49	Total ₹208860.00	{"bill_id": 49, "bill_no": "MSD/2526/020", "total_invoice_value": "208860.00"}	2026-03-31 10:57:10.922583+05:30
199	3	MARK_PAYMENT	PAYMENT	18	Payment received — ₹208860.00 via NEFT	{"bill_id": 49, "bill_no": "MSD/2526/020", "payment_id": 18, "amount_paid": 208860, "payment_date": "2026-03-31", "payment_mode": "NEFT"}	2026-03-31 10:57:21.695024+05:30
200	3	FINALIZE_BILL	BILL	23	Total ₹195880.00	{"bill_id": 23, "bill_no": "MSD/2526/021", "total_invoice_value": "195880.00"}	2026-03-31 10:57:31.367536+05:30
201	3	FINALIZE_BILL	BILL	24	Total ₹212400.00	{"bill_id": 24, "bill_no": "MSD/2526/022", "total_invoice_value": "212400.00"}	2026-03-31 10:57:35.324194+05:30
202	3	FINALIZE_BILL	BILL	19	Total ₹162840.00	{"bill_id": 19, "bill_no": "MSD/2526/023", "total_invoice_value": "162840.00"}	2026-03-31 10:57:50.664881+05:30
203	3	MARK_PAYMENT	PAYMENT	19	Payment received — ₹162840.00 via NEFT	{"bill_id": 19, "bill_no": "MSD/2526/023", "payment_id": 19, "amount_paid": 162840, "payment_date": "2026-03-31", "payment_mode": "NEFT"}	2026-03-31 10:57:56.592613+05:30
204	3	MARK_PAYMENT	PAYMENT	20	Payment received — ₹195880.00 via NEFT	{"bill_id": 23, "bill_no": "MSD/2526/021", "payment_id": 20, "amount_paid": 195880, "payment_date": "2026-03-31", "payment_mode": "NEFT"}	2026-03-31 10:58:07.817737+05:30
205	3	MARK_PAYMENT	PAYMENT	21	Payment received — ₹212400.00 via NEFT	{"bill_id": 24, "bill_no": "MSD/2526/022", "payment_id": 21, "amount_paid": 212400, "payment_date": "2026-03-31", "payment_mode": "NEFT"}	2026-03-31 10:58:12.266182+05:30
206	3	MARK_PAYMENT	PAYMENT	22	Payment received — ₹354000.00 via NEFT	{"bill_id": 18, "bill_no": "MSD/2526/008", "payment_id": 22, "amount_paid": 354000, "payment_date": "2026-03-26", "payment_mode": "NEFT"}	2026-03-31 11:05:00.584463+05:30
207	3	CREATE_BILL	BILL	51	Created bill #MSD-DRAFT-51 (2025-26)	{"bill_id": 51, "bill_no": "MSD-DRAFT-51", "financial_year": "2025-26"}	2026-03-31 16:31:27.02444+05:30
208	3	ADD_SERVICE	SERVICE	129	Added "Professional Services" — ₹20000.00	{"amount": 20000, "bill_id": 51, "bill_no": "MSD-DRAFT-51", "service_id": 129, "service_name": "Professional Services"}	2026-03-31 16:31:27.031028+05:30
209	3	ADD_SERVICE	SERVICE	131	Added "Professional Services" — ₹25000.00	{"amount": 25000, "bill_id": 51, "bill_no": "MSD-DRAFT-51", "service_id": 131, "service_name": "Professional Services"}	2026-03-31 16:31:27.25064+05:30
210	3	ADD_SERVICE	SERVICE	130	Added "Income Tax Return, Account Finalisation" — ₹3000.00	{"amount": 3000, "bill_id": 51, "bill_no": "MSD-DRAFT-51", "service_id": 130, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-31 16:31:27.28709+05:30
211	3	ADD_SERVICE	SERVICE	132	Added "Income Tax Return, Account Finalisation" — ₹5000.00	{"amount": 5000, "bill_id": 51, "bill_no": "MSD-DRAFT-51", "service_id": 132, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-31 16:31:27.332841+05:30
212	3	ADD_SERVICE	SERVICE	133	Added "TDS Returns" — ₹1500.00	{"amount": 1500, "bill_id": 51, "bill_no": "MSD-DRAFT-51", "service_id": 133, "service_name": "TDS Returns"}	2026-03-31 16:31:27.406922+05:30
213	3	UPDATE_BILL	BILL	51	Updated bill #MSD-DRAFT-51	{"bill_id": 51, "bill_no": "MSD-DRAFT-51", "override_edit": false}	2026-03-31 16:38:07.54711+05:30
214	3	DELETE_SERVICE	SERVICE	131	Removed "Professional Services" — ₹25000.00	{"amount": 25000, "bill_id": 51, "bill_no": "MSD-DRAFT-51", "service_id": 131, "service_name": "Professional Services"}	2026-03-31 16:38:07.553193+05:30
215	3	DELETE_SERVICE	SERVICE	129	Removed "Professional Services" — ₹20000.00	{"amount": 20000, "bill_id": 51, "bill_no": "MSD-DRAFT-51", "service_id": 129, "service_name": "Professional Services"}	2026-03-31 16:38:07.553035+05:30
216	3	ADD_SERVICE	SERVICE	134	Added "Income Tax Audit, Account Finalisation" — ₹20000.00	{"amount": 20000, "bill_id": 51, "bill_no": "MSD-DRAFT-51", "service_id": 134, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-31 16:38:07.679373+05:30
217	3	ADD_SERVICE	SERVICE	136	Added "Income Tax Audit, Account Finalisation" — ₹25000.00	{"amount": 25000, "bill_id": 51, "bill_no": "MSD-DRAFT-51", "service_id": 136, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-31 16:38:07.752252+05:30
218	3	CREATE_BILL	BILL	52	Created bill #MSD-DRAFT-52 (2025-26)	{"bill_id": 52, "bill_no": "MSD-DRAFT-52", "financial_year": "2025-26"}	2026-03-31 17:02:46.221866+05:30
219	3	ADD_SERVICE	SERVICE	139	Added "Income Tax Audit, Account Finalisation" — ₹25000.00	{"amount": 25000, "bill_id": 52, "bill_no": "MSD-DRAFT-52", "service_id": 139, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-31 17:02:46.225929+05:30
220	3	ADD_SERVICE	SERVICE	141	Added "TDS Returns" — ₹6000.00	{"amount": 6000, "bill_id": 52, "bill_no": "MSD-DRAFT-52", "service_id": 141, "service_name": "TDS Returns"}	2026-03-31 17:02:46.42288+05:30
221	3	ADD_SERVICE	SERVICE	140	Added "Income Tax Return, Account Finalisation" — ₹5000.00	{"amount": 5000, "bill_id": 52, "bill_no": "MSD-DRAFT-52", "service_id": 140, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-31 17:02:46.449841+05:30
222	3	ADD_SERVICE	SERVICE	142	Added "Income Tax Audit, Account Finalisation" — ₹25000.00	{"amount": 25000, "bill_id": 52, "bill_no": "MSD-DRAFT-52", "service_id": 142, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-31 17:02:46.612253+05:30
223	3	ADD_SERVICE	SERVICE	143	Added "Income Tax Return, Account Finalisation" — ₹5000.00	{"amount": 5000, "bill_id": 52, "bill_no": "MSD-DRAFT-52", "service_id": 143, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-31 17:02:46.674405+05:30
224	3	ADD_SERVICE	SERVICE	144	Added "TDS Returns" — ₹4500.00	{"amount": 4500, "bill_id": 52, "bill_no": "MSD-DRAFT-52", "service_id": 144, "service_name": "TDS Returns"}	2026-03-31 17:02:46.759664+05:30
225	3	UPDATE_BILL	BILL	51	Updated bill #MSD-DRAFT-51	{"bill_id": 51, "bill_no": "MSD-DRAFT-51", "override_edit": false}	2026-03-31 17:08:55.308603+05:30
226	3	DELETE_SERVICE	SERVICE	136	Removed "Income Tax Audit, Account Finalisation" — ₹25000.00	{"amount": 25000, "bill_id": 51, "bill_no": "MSD-DRAFT-51", "service_id": 136, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-31 17:08:55.312235+05:30
227	3	ADD_SERVICE	SERVICE	145	Added "Income Tax Audit, Account Finalisation" — ₹15000.00	{"amount": 15000, "bill_id": 51, "bill_no": "MSD-DRAFT-51", "service_id": 145, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-31 17:08:55.312377+05:30
228	3	CREATE_BILL	BILL	53	Created bill #MSD-DRAFT-53 (2025-26)	{"bill_id": 53, "bill_no": "MSD-DRAFT-53", "financial_year": "2025-26"}	2026-03-31 17:12:52.574161+05:30
229	3	ADD_SERVICE	SERVICE	150	Added "Income Tax Audit, Account Finalisation" — ₹15000.00	{"amount": 15000, "bill_id": 53, "bill_no": "MSD-DRAFT-53", "service_id": 150, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-31 17:12:52.578289+05:30
230	3	ADD_SERVICE	SERVICE	152	Added "Income Tax Return, Account Finalisation" — ₹7500.00	{"amount": 7500, "bill_id": 53, "bill_no": "MSD-DRAFT-53", "service_id": 152, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-31 17:12:52.71193+05:30
231	3	ADD_SERVICE	SERVICE	151	Added "Income Tax Return, Account Finalisation" — ₹5000.00	{"amount": 5000, "bill_id": 53, "bill_no": "MSD-DRAFT-53", "service_id": 151, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-31 17:12:52.784316+05:30
232	3	ADD_SERVICE	SERVICE	153	Added "TDS Returns" — ₹3000.00	{"amount": 3000, "bill_id": 53, "bill_no": "MSD-DRAFT-53", "service_id": 153, "service_name": "TDS Returns"}	2026-03-31 17:12:52.964846+05:30
233	3	CREATE_BILL	BILL	54	Created bill #URJ-DRAFT-54 (2025-26)	{"bill_id": 54, "bill_no": "URJ-DRAFT-54", "financial_year": "2025-26"}	2026-03-31 17:14:47.036349+05:30
234	3	ADD_SERVICE	SERVICE	155	Added "Income Tax Return, Account Finalisation" — ₹9000.00	{"amount": 9000, "bill_id": 54, "bill_no": "URJ-DRAFT-54", "service_id": 155, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-31 17:14:47.040491+05:30
235	3	ADD_SERVICE	SERVICE	154	Added "Income Tax Return, Account Finalisation" — ₹9000.00	{"amount": 9000, "bill_id": 54, "bill_no": "URJ-DRAFT-54", "service_id": 154, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-31 17:14:47.040364+05:30
236	3	UPDATE_BILL	BILL	54	Updated bill #URJ-DRAFT-54	{"bill_id": 54, "bill_no": "URJ-DRAFT-54", "override_edit": false}	2026-03-31 17:15:00.004489+05:30
237	3	CREATE_BILL	BILL	55	Created bill #MSD-DRAFT-55 (2025-26)	{"bill_id": 55, "bill_no": "MSD-DRAFT-55", "financial_year": "2025-26"}	2026-03-31 17:42:41.288075+05:30
238	3	ADD_SERVICE	SERVICE	158	Added "Income Tax Audit, Account Finalisation" — ₹16500.00	{"amount": 16500, "bill_id": 55, "bill_no": "MSD-DRAFT-55", "service_id": 158, "service_name": "Income Tax Audit, Account Finalisation"}	2026-03-31 17:42:41.291808+05:30
239	3	ADD_SERVICE	SERVICE	159	Added "GST Annual Return" — ₹16500.00	{"amount": 16500, "bill_id": 55, "bill_no": "MSD-DRAFT-55", "service_id": 159, "service_name": "GST Annual Return"}	2026-03-31 17:42:41.412877+05:30
240	3	ADD_SERVICE	SERVICE	160	Added "GST Audit" — ₹16500.00	{"amount": 16500, "bill_id": 55, "bill_no": "MSD-DRAFT-55", "service_id": 160, "service_name": "GST Audit"}	2026-03-31 17:42:41.488039+05:30
241	3	ADD_SERVICE	SERVICE	161	Added "GST Return - Monthly" — ₹33000.00	{"amount": 33000, "bill_id": 55, "bill_no": "MSD-DRAFT-55", "service_id": 161, "service_name": "GST Return - Monthly"}	2026-03-31 17:42:41.559122+05:30
242	3	ADD_SERVICE	SERVICE	162	Added "Income Tax Return, Account Finalisation" — ₹16500.00	{"amount": 16500, "bill_id": 55, "bill_no": "MSD-DRAFT-55", "service_id": 162, "service_name": "Income Tax Return, Account Finalisation"}	2026-03-31 17:42:41.749107+05:30
243	3	ADD_SERVICE	SERVICE	163	Added "TDS Returns" — ₹13200.00	{"amount": 13200, "bill_id": 55, "bill_no": "MSD-DRAFT-55", "service_id": 163, "service_name": "TDS Returns"}	2026-03-31 17:42:41.818193+05:30
244	3	OVERRIDE_EDIT_BILL	BILL	17	[SUPERADMIN OVERRIDE] Edited finalized bill #MSD/2526/009	{"bill_id": 17, "bill_no": "MSD/2526/009", "override_edit": true}	2026-03-31 17:45:35.147398+05:30
245	3	CREATE_BILL	BILL	57	Created bill #MSD-DRAFT-57 (2025-26)	{"bill_id": 57, "bill_no": "MSD-DRAFT-57", "financial_year": "2025-26"}	2026-03-31 17:59:37.15637+05:30
246	3	ADD_SERVICE	SERVICE	168	Added "Professional Services" — ₹60000.00	{"amount": 60000, "bill_id": 57, "bill_no": "MSD-DRAFT-57", "service_id": 168, "service_name": "Professional Services"}	2026-03-31 17:59:37.16134+05:30
247	3	FINALIZE_BILL	BILL	57	Total ₹70800.00	{"bill_id": 57, "bill_no": "MSD/2526/024", "total_invoice_value": "70800.00"}	2026-03-31 17:59:57.510444+05:30
248	3	MARK_PAYMENT	PAYMENT	23	Payment received — ₹70800.00 via NEFT	{"bill_id": 57, "bill_no": "MSD/2526/024", "payment_id": 23, "amount_paid": 70800, "payment_date": "2026-03-04", "payment_mode": "NEFT"}	2026-03-31 18:00:12.971135+05:30
249	3	CREATE_BILL	BILL	58	Created bill #CA.-DRAFT-58 (2026-27)	{"bill_id": 58, "bill_no": "CA.-DRAFT-58", "financial_year": "2026-27"}	2026-04-01 17:13:55.151941+05:30
250	3	ADD_SERVICE	SERVICE	169	Added "Income Tax Audit, Account Finalisation" — ₹7500.00	{"amount": 7500, "bill_id": 58, "bill_no": "CA.-DRAFT-58", "service_id": 169, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-01 17:13:55.169437+05:30
251	3	FINALIZE_BILL	BILL	58	Total ₹7500.00	{"bill_id": 58, "bill_no": "CA./2627/001", "total_invoice_value": "7500.00"}	2026-04-01 17:14:33.360643+05:30
252	3	OVERRIDE_EDIT_BILL	BILL	58	[SUPERADMIN OVERRIDE] Edited finalized bill #CA./2627/001	{"bill_id": 58, "bill_no": "CA./2627/001", "override_edit": true}	2026-04-01 17:15:06.518047+05:30
253	3	CREATE_BILL	BILL	59	Created bill #MSD-DRAFT-59 (2025-26)	{"bill_id": 59, "bill_no": "MSD-DRAFT-59", "financial_year": "2025-26"}	2026-04-01 17:15:53.816656+05:30
254	3	ADD_SERVICE	SERVICE	171	Added "Professional Services" — ₹50000.00	{"amount": 50000, "bill_id": 59, "bill_no": "MSD-DRAFT-59", "service_id": 171, "service_name": "Professional Services"}	2026-04-01 17:15:53.820643+05:30
255	3	FINALIZE_BILL	BILL	59	Total ₹59000.00	{"bill_id": 59, "bill_no": "MSD/2526/025", "total_invoice_value": "59000.00"}	2026-04-01 17:16:00.044303+05:30
256	3	MARK_PAYMENT	PAYMENT	24	Payment received — ₹59000.00 via UPI	{"bill_id": 59, "bill_no": "MSD/2526/025", "payment_id": 24, "amount_paid": 59000, "payment_date": "2026-03-24", "payment_mode": "UPI"}	2026-04-01 17:16:27.50189+05:30
257	3	MARK_PAYMENT	PAYMENT	25	Payment received — ₹7500.00 via UPI	{"bill_id": 58, "bill_no": "CA./2627/001", "payment_id": 25, "amount_paid": 7500, "payment_date": "2026-03-24", "payment_mode": "UPI"}	2026-04-01 17:16:59.391658+05:30
258	3	CREATE_BILL	BILL	60	Created bill #MSD-DRAFT-60 (2025-26)	{"bill_id": 60, "bill_no": "MSD-DRAFT-60", "financial_year": "2025-26"}	2026-04-01 17:44:17.999907+05:30
259	3	ADD_SERVICE	SERVICE	172	Added "Income Tax Audit, Account Finalisation" — ₹15000.00	{"amount": 15000, "bill_id": 60, "bill_no": "MSD-DRAFT-60", "service_id": 172, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-01 17:44:18.00538+05:30
260	3	CREATE_BILL	BILL	61	Created bill #MSD-DRAFT-61 (2025-26)	{"bill_id": 61, "bill_no": "MSD-DRAFT-61", "financial_year": "2025-26"}	2026-04-01 17:48:06.810058+05:30
261	3	ADD_SERVICE	SERVICE	174	Added "Income Tax Audit, Account Finalisation" — ₹45000.00	{"amount": 45000, "bill_id": 61, "bill_no": "MSD-DRAFT-61", "service_id": 174, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-01 17:48:06.814307+05:30
262	3	ADD_SERVICE	SERVICE	173	Added "Income Tax Audit, Account Finalisation" — ₹45000.00	{"amount": 45000, "bill_id": 61, "bill_no": "MSD-DRAFT-61", "service_id": 173, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-01 17:48:06.814197+05:30
263	3	ADD_SERVICE	SERVICE	175	Added "Income Tax Audit, Account Finalisation" — ₹45000.00	{"amount": 45000, "bill_id": 61, "bill_no": "MSD-DRAFT-61", "service_id": 175, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-01 17:48:06.94317+05:30
264	3	ADD_SERVICE	SERVICE	176	Added "Professional Services" — ₹55000.00	{"amount": 55000, "bill_id": 61, "bill_no": "MSD-DRAFT-61", "service_id": 176, "service_name": "Professional Services"}	2026-04-01 17:48:07.021882+05:30
265	3	CREATE_BILL	BILL	62	Created bill #MSD-DRAFT-62 (2025-26)	{"bill_id": 62, "bill_no": "MSD-DRAFT-62", "financial_year": "2025-26"}	2026-04-01 17:53:49.197241+05:30
266	3	ADD_SERVICE	SERVICE	178	Added "Income Tax Return, Account Finalisation" — ₹7500.00	{"amount": 7500, "bill_id": 62, "bill_no": "MSD-DRAFT-62", "service_id": 178, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-01 17:53:49.20188+05:30
267	3	ADD_SERVICE	SERVICE	177	Added "Income Tax Return, Account Finalisation" — ₹7500.00	{"amount": 7500, "bill_id": 62, "bill_no": "MSD-DRAFT-62", "service_id": 177, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-01 17:53:49.20173+05:30
268	3	ADD_SERVICE	SERVICE	179	Added "Income Tax Return, Account Finalisation" — ₹7500.00	{"amount": 7500, "bill_id": 62, "bill_no": "MSD-DRAFT-62", "service_id": 179, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-01 17:53:49.422928+05:30
270	3	ADD_SERVICE	SERVICE	180	Added "Professional Services" — ₹30000.00	{"amount": 30000, "bill_id": 63, "bill_no": "MSD-DRAFT-63", "service_id": 180, "service_name": "Professional Services"}	2026-04-01 17:57:23.036519+05:30
271	3	CREATE_BILL	BILL	64	Created bill #URJ-DRAFT-64 (2026-27)	{"bill_id": 64, "bill_no": "URJ-DRAFT-64", "financial_year": "2026-27"}	2026-04-01 18:04:28.00365+05:30
272	3	ADD_SERVICE	SERVICE	181	Added "Professional Services" — ₹60000.00	{"amount": 60000, "bill_id": 64, "bill_no": "URJ-DRAFT-64", "service_id": 181, "service_name": "Professional Services"}	2026-04-01 18:04:28.008134+05:30
273	3	CREATE_BILL	BILL	65	Created bill #URJ-DRAFT-65 (2026-27)	{"bill_id": 65, "bill_no": "URJ-DRAFT-65", "financial_year": "2026-27"}	2026-04-01 18:05:34.617407+05:30
274	3	ADD_SERVICE	SERVICE	182	Added "Professional Services" — ₹40000.00	{"amount": 40000, "bill_id": 65, "bill_no": "URJ-DRAFT-65", "service_id": 182, "service_name": "Professional Services"}	2026-04-01 18:05:34.620577+05:30
275	3	CREATE_BILL	BILL	66	Created bill #MSD-DRAFT-66 (2025-26)	{"bill_id": 66, "bill_no": "MSD-DRAFT-66", "financial_year": "2025-26"}	2026-04-01 18:09:08.718855+05:30
276	3	ADD_SERVICE	SERVICE	183	Added "Professional Services" — ₹62000.00	{"amount": 62000, "bill_id": 66, "bill_no": "MSD-DRAFT-66", "service_id": 183, "service_name": "Professional Services"}	2026-04-01 18:09:08.722689+05:30
277	3	CREATE_BILL	BILL	67	Created bill #MSD-DRAFT-67 (2025-26)	{"bill_id": 67, "bill_no": "MSD-DRAFT-67", "financial_year": "2025-26"}	2026-04-01 18:12:58.202033+05:30
278	3	ADD_SERVICE	SERVICE	184	Added "Professional Services" — ₹15000.00	{"amount": 15000, "bill_id": 67, "bill_no": "MSD-DRAFT-67", "service_id": 184, "service_name": "Professional Services"}	2026-04-01 18:12:58.206049+05:30
279	3	FINALIZE_BILL	BILL	67	Total ₹17700.00	{"bill_id": 67, "bill_no": "MSD/2526/026", "total_invoice_value": "17700.00"}	2026-04-01 18:15:35.282618+05:30
280	3	MARK_PAYMENT	PAYMENT	26	Payment received — ₹17700.00 via CHEQUE	{"bill_id": 67, "bill_no": "MSD/2526/026", "payment_id": 26, "amount_paid": 17700, "payment_date": "2026-02-16", "payment_mode": "CHEQUE"}	2026-04-01 18:27:42.085543+05:30
281	3	CREATE_BILL	BILL	68	Created bill #MSD-DRAFT-68 (2026-27)	{"bill_id": 68, "bill_no": "MSD-DRAFT-68", "financial_year": "2026-27"}	2026-04-01 18:32:16.627663+05:30
282	3	ADD_SERVICE	SERVICE	186	Added "Income Tax Audit, Account Finalisation" — ₹25000.00	{"amount": 25000, "bill_id": 68, "bill_no": "MSD-DRAFT-68", "service_id": 186, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-01 18:32:16.632069+05:30
283	3	ADD_SERVICE	SERVICE	185	Added "Income Tax Audit, Account Finalisation" — ₹25000.00	{"amount": 25000, "bill_id": 68, "bill_no": "MSD-DRAFT-68", "service_id": 185, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-01 18:32:16.631918+05:30
284	3	ADD_SERVICE	SERVICE	187	Added "Income Tax Return, Account Finalisation" — ₹5000.00	{"amount": 5000, "bill_id": 68, "bill_no": "MSD-DRAFT-68", "service_id": 187, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-01 18:32:16.785443+05:30
285	3	ADD_SERVICE	SERVICE	188	Added "Income Tax Return, Account Finalisation" — ₹5000.00	{"amount": 5000, "bill_id": 68, "bill_no": "MSD-DRAFT-68", "service_id": 188, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-01 18:32:16.850022+05:30
286	3	ADD_SERVICE	SERVICE	190	Added "GST Return - Monthly" — ₹4500.00	{"amount": 4500, "bill_id": 68, "bill_no": "MSD-DRAFT-68", "service_id": 190, "service_name": "GST Return - Monthly"}	2026-04-01 18:32:17.004331+05:30
287	3	ADD_SERVICE	SERVICE	189	Added "GST Registration " — ₹5000.00	{"amount": 5000, "bill_id": 68, "bill_no": "MSD-DRAFT-68", "service_id": 189, "service_name": "GST Registration "}	2026-04-01 18:32:17.029803+05:30
288	3	ADD_SERVICE	SERVICE	191	Added "GST Return - Monthly" — ₹18000.00	{"amount": 18000, "bill_id": 68, "bill_no": "MSD-DRAFT-68", "service_id": 191, "service_name": "GST Return - Monthly"}	2026-04-01 18:32:17.080122+05:30
289	3	ADD_SERVICE	SERVICE	192	Added "GST Registration " — ₹5000.00	{"amount": 5000, "bill_id": 68, "bill_no": "MSD-DRAFT-68", "service_id": 192, "service_name": "GST Registration "}	2026-04-01 18:32:17.15353+05:30
290	3	ADD_SERVICE	SERVICE	194	Added "GST Return - Monthly" — ₹18000.00	{"amount": 18000, "bill_id": 68, "bill_no": "MSD-DRAFT-68", "service_id": 194, "service_name": "GST Return - Monthly"}	2026-04-01 18:32:17.307722+05:30
291	3	ADD_SERVICE	SERVICE	193	Added "GST Return - Monthly" — ₹10500.00	{"amount": 10500, "bill_id": 68, "bill_no": "MSD-DRAFT-68", "service_id": 193, "service_name": "GST Return - Monthly"}	2026-04-01 18:32:17.334534+05:30
292	3	ADD_SERVICE	SERVICE	195	Added "TDS Returns" — ₹3000.00	{"amount": 3000, "bill_id": 68, "bill_no": "MSD-DRAFT-68", "service_id": 195, "service_name": "TDS Returns"}	2026-04-01 18:32:17.491832+05:30
293	3	CREATE_BILL	BILL	69	Created bill #MSD-DRAFT-69 (2025-26)	{"bill_id": 69, "bill_no": "MSD-DRAFT-69", "financial_year": "2025-26"}	2026-04-01 18:34:24.24699+05:30
294	3	ADD_SERVICE	SERVICE	197	Added "GST Return - Monthly" — ₹36000.00	{"amount": 36000, "bill_id": 69, "bill_no": "MSD-DRAFT-69", "service_id": 197, "service_name": "GST Return - Monthly"}	2026-04-01 18:34:24.250874+05:30
295	3	ADD_SERVICE	SERVICE	196	Added "TDS Returns" — ₹13750.00	{"amount": 13750, "bill_id": 69, "bill_no": "MSD-DRAFT-69", "service_id": 196, "service_name": "TDS Returns"}	2026-04-01 18:34:24.250674+05:30
296	3	ADD_SERVICE	SERVICE	198	Added "Income Tax Return, Account Finalisation" — ₹10000.00	{"amount": 10000, "bill_id": 69, "bill_no": "MSD-DRAFT-69", "service_id": 198, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-01 18:34:24.377217+05:30
297	3	ADD_SERVICE	SERVICE	199	Added "GST Annual Return" — ₹12000.00	{"amount": 12000, "bill_id": 69, "bill_no": "MSD-DRAFT-69", "service_id": 199, "service_name": "GST Annual Return"}	2026-04-01 18:34:24.45829+05:30
298	3	FINALIZE_BILL	BILL	69	Total ₹84665.00	{"bill_id": 69, "bill_no": "MSD/2526/027", "total_invoice_value": "84665.00"}	2026-04-01 18:34:33.120291+05:30
299	3	MARK_PAYMENT	PAYMENT	27	Payment received — ₹84665.00 via NEFT	{"bill_id": 69, "bill_no": "MSD/2526/027", "payment_id": 27, "amount_paid": 84665, "payment_date": "2025-11-29", "payment_mode": "NEFT"}	2026-04-01 18:34:57.744598+05:30
300	3	CREATE_BILL	BILL	70	Created bill #MSD-DRAFT-70 (2025-26)	{"bill_id": 70, "bill_no": "MSD-DRAFT-70", "financial_year": "2025-26"}	2026-04-01 18:37:23.384319+05:30
335	3	CREATE_BILL	BILL	80	Created bill #MSD-DRAFT-80 (2025-26)	{"bill_id": 80, "bill_no": "MSD-DRAFT-80", "financial_year": "2025-26"}	2026-04-01 19:17:28.110646+05:30
301	3	ADD_SERVICE	SERVICE	200	Added "Professional Services" — ₹13500.00	{"amount": 13500, "bill_id": 70, "bill_no": "MSD-DRAFT-70", "service_id": 200, "service_name": "Professional Services"}	2026-04-01 18:37:23.388324+05:30
302	3	FINALIZE_BILL	BILL	70	Total ₹15930.00	{"bill_id": 70, "bill_no": "MSD/2526/028", "total_invoice_value": "15930.00"}	2026-04-01 18:37:30.159961+05:30
303	3	MARK_PAYMENT	PAYMENT	28	Payment received — ₹15930.00 via NEFT	{"bill_id": 70, "bill_no": "MSD/2526/028", "payment_id": 28, "amount_paid": 15930, "payment_date": "2026-02-07", "payment_mode": "NEFT"}	2026-04-01 18:38:09.42274+05:30
304	3	OVERRIDE_EDIT_PAYMENT	PAYMENT	8	[SUPERADMIN OVERRIDE] Edited payment #8 — ₹472000.00 via NEFT	{"bill_id": 35, "payment_id": 8, "amount_paid": "472000.00", "payment_mode": "NEFT"}	2026-04-01 18:40:39.039344+05:30
305	3	CREATE_BILL	BILL	71	Created bill #MSD-DRAFT-71 (2025-26)	{"bill_id": 71, "bill_no": "MSD-DRAFT-71", "financial_year": "2025-26"}	2026-04-01 18:41:41.30095+05:30
306	3	ADD_SERVICE	SERVICE	201	Added "Professional Services" — ₹18000.00	{"amount": 18000, "bill_id": 71, "bill_no": "MSD-DRAFT-71", "service_id": 201, "service_name": "Professional Services"}	2026-04-01 18:41:41.303589+05:30
307	3	FINALIZE_BILL	BILL	71	Total ₹21240.00	{"bill_id": 71, "bill_no": "MSD/2526/029", "total_invoice_value": "21240.00"}	2026-04-01 18:41:46.520509+05:30
308	3	MARK_PAYMENT	PAYMENT	29	Payment received — ₹21240.00 via NEFT	{"bill_id": 71, "bill_no": "MSD/2526/029", "payment_id": 29, "amount_paid": 21240, "payment_date": "2025-09-09", "payment_mode": "NEFT"}	2026-04-01 18:42:11.628178+05:30
309	3	CREATE_BILL	BILL	72	Created bill #MSD-DRAFT-72 (2025-26)	{"bill_id": 72, "bill_no": "MSD-DRAFT-72", "financial_year": "2025-26"}	2026-04-01 18:53:51.072078+05:30
310	3	ADD_SERVICE	SERVICE	202	Added "Professional Services" — ₹16780.00	{"amount": 16780, "bill_id": 72, "bill_no": "MSD-DRAFT-72", "service_id": 202, "service_name": "Professional Services"}	2026-04-01 18:53:51.076223+05:30
311	3	FINALIZE_BILL	BILL	72	Total ₹19800.40	{"bill_id": 72, "bill_no": "MSD/2526/030", "total_invoice_value": "19800.40"}	2026-04-01 18:53:58.183631+05:30
312	3	MARK_PAYMENT	PAYMENT	30	Payment received — ₹19800.40 via NEFT	{"bill_id": 72, "bill_no": "MSD/2526/030", "payment_id": 30, "amount_paid": 19800.4, "payment_date": "2025-12-10", "payment_mode": "NEFT"}	2026-04-01 18:54:29.825366+05:30
313	3	CREATE_BILL	BILL	74	Created bill #MSD-DRAFT-74 (2026-27)	{"bill_id": 74, "bill_no": "MSD-DRAFT-74", "financial_year": "2026-27"}	2026-04-01 18:56:44.790618+05:30
314	3	ADD_SERVICE	SERVICE	203	Added "Income Tax Audit, Account Finalisation" — ₹16500.00	{"amount": 16500, "bill_id": 74, "bill_no": "MSD-DRAFT-74", "service_id": 203, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-01 18:56:44.795278+05:30
315	3	UPDATE_BILL	BILL	74	Updated bill #MSD-DRAFT-74	{"bill_id": 74, "bill_no": "MSD-DRAFT-74", "override_edit": false}	2026-04-01 18:57:04.301175+05:30
316	3	FINALIZE_BILL	BILL	74	Total ₹19470.00	{"bill_id": 74, "bill_no": "MSD/2627/001", "total_invoice_value": "19470.00"}	2026-04-01 18:57:56.362905+05:30
317	3	MARK_PAYMENT	PAYMENT	31	Payment received — ₹19470.00 via NEFT	{"bill_id": 74, "bill_no": "MSD/2627/001", "payment_id": 31, "amount_paid": 19470, "payment_date": "2025-10-26", "payment_mode": "NEFT"}	2026-04-01 18:58:13.27681+05:30
318	3	CREATE_BILL	BILL	76	Created bill #MSD-DRAFT-76 (2026-27)	{"bill_id": 76, "bill_no": "MSD-DRAFT-76", "financial_year": "2026-27"}	2026-04-01 19:00:55.821503+05:30
319	3	ADD_SERVICE	SERVICE	205	Added "Income Tax Audit, Account Finalisation" — ₹17000.00	{"amount": 17000, "bill_id": 76, "bill_no": "MSD-DRAFT-76", "service_id": 205, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-01 19:00:55.824746+05:30
320	3	FINALIZE_BILL	BILL	76	Total ₹20060.00	{"bill_id": 76, "bill_no": "MSD/2627/002", "total_invoice_value": "20060.00"}	2026-04-01 19:01:02.297006+05:30
321	3	MARK_PAYMENT	PAYMENT	32	Payment received — ₹20060.00 via UPI	{"bill_id": 76, "bill_no": "MSD/2627/002", "payment_id": 32, "amount_paid": 20060, "payment_date": "2026-03-28", "payment_mode": "UPI"}	2026-04-01 19:02:06.14635+05:30
322	3	OVERRIDE_EDIT_BILL	BILL	76	[SUPERADMIN OVERRIDE] Edited finalized bill #MSD/2627/002	{"bill_id": 76, "bill_no": "MSD/2627/002", "override_edit": true}	2026-04-01 19:02:18.457462+05:30
323	3	CREATE_BILL	BILL	77	Created bill #MSD-DRAFT-77 (2025-26)	{"bill_id": 77, "bill_no": "MSD-DRAFT-77", "financial_year": "2025-26"}	2026-04-01 19:05:55.463426+05:30
324	3	ADD_SERVICE	SERVICE	207	Added "Professional Services" — ₹16000.00	{"amount": 16000, "bill_id": 77, "bill_no": "MSD-DRAFT-77", "service_id": 207, "service_name": "Professional Services"}	2026-04-01 19:05:55.46774+05:30
325	3	CREATE_BILL	BILL	78	Created bill #MSD-DRAFT-78 (2025-26)	{"bill_id": 78, "bill_no": "MSD-DRAFT-78", "financial_year": "2025-26"}	2026-04-01 19:07:59.224278+05:30
326	3	ADD_SERVICE	SERVICE	208	Added "Professional Services" — ₹18000.00	{"amount": 18000, "bill_id": 78, "bill_no": "MSD-DRAFT-78", "service_id": 208, "service_name": "Professional Services"}	2026-04-01 19:07:59.2281+05:30
327	3	FINALIZE_BILL	BILL	78	Total ₹21240.00	{"bill_id": 78, "bill_no": "MSD/2526/031", "total_invoice_value": "21240.00"}	2026-04-01 19:08:06.54746+05:30
328	3	MARK_PAYMENT	PAYMENT	33	Payment received — ₹21239.99 via NEFT	{"bill_id": 78, "bill_no": "MSD/2526/031", "payment_id": 33, "amount_paid": 21239.99, "payment_date": "2025-09-10", "payment_mode": "NEFT"}	2026-04-01 19:08:29.558397+05:30
329	3	OVERRIDE_EDIT_BILL	BILL	78	[SUPERADMIN OVERRIDE] Edited finalized bill #MSD/2526/031	{"bill_id": 78, "bill_no": "MSD/2526/031", "override_edit": true}	2026-04-01 19:09:37.373822+05:30
330	3	OVERRIDE_EDIT_PAYMENT	PAYMENT	33	[SUPERADMIN OVERRIDE] Edited payment #33 — ₹21240.00 via NEFT	{"bill_id": 78, "payment_id": 33, "amount_paid": "21240.00", "payment_mode": "NEFT"}	2026-04-01 19:09:57.345206+05:30
331	3	CREATE_BILL	BILL	79	Created bill #MSD-DRAFT-79 (2025-26)	{"bill_id": 79, "bill_no": "MSD-DRAFT-79", "financial_year": "2025-26"}	2026-04-01 19:13:58.824624+05:30
332	3	ADD_SERVICE	SERVICE	210	Added "Income Tax Audit, Account Finalisation" — ₹15500.00	{"amount": 15500, "bill_id": 79, "bill_no": "MSD-DRAFT-79", "service_id": 210, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-01 19:13:58.828161+05:30
333	3	FINALIZE_BILL	BILL	79	Total ₹18290.00	{"bill_id": 79, "bill_no": "MSD/2526/032", "total_invoice_value": "18290.00"}	2026-04-01 19:14:04.974969+05:30
334	3	MARK_PAYMENT	PAYMENT	34	Payment received — ₹18290.00 via NEFT	{"bill_id": 79, "bill_no": "MSD/2526/032", "payment_id": 34, "amount_paid": 18290, "payment_date": "2026-02-04", "payment_mode": "NEFT"}	2026-04-01 19:14:22.801257+05:30
336	3	ADD_SERVICE	SERVICE	211	Added "Professional Services" — ₹15000.00	{"amount": 15000, "bill_id": 80, "bill_no": "MSD-DRAFT-80", "service_id": 211, "service_name": "Professional Services"}	2026-04-01 19:17:28.114121+05:30
337	3	FINALIZE_BILL	BILL	80	Total ₹17700.00	{"bill_id": 80, "bill_no": "MSD/2526/033", "total_invoice_value": "17700.00"}	2026-04-01 19:17:34.451106+05:30
338	3	MARK_PAYMENT	PAYMENT	35	Payment received — ₹17700.00 via CHEQUE	{"bill_id": 80, "bill_no": "MSD/2526/033", "payment_id": 35, "amount_paid": 17700, "payment_date": "2026-02-17", "payment_mode": "CHEQUE"}	2026-04-01 19:19:25.5313+05:30
339	3	CREATE_BILL	BILL	81	Created bill #MSD-DRAFT-81 (2025-26)	{"bill_id": 81, "bill_no": "MSD-DRAFT-81", "financial_year": "2025-26"}	2026-04-01 19:22:52.483295+05:30
340	3	ADD_SERVICE	SERVICE	212	Added "Professional Services" — ₹35000.00	{"amount": 35000, "bill_id": 81, "bill_no": "MSD-DRAFT-81", "service_id": 212, "service_name": "Professional Services"}	2026-04-01 19:22:52.487337+05:30
341	3	CREATE_BILL	BILL	82	Created bill #MSD-DRAFT-82 (2025-26)	{"bill_id": 82, "bill_no": "MSD-DRAFT-82", "financial_year": "2025-26"}	2026-04-01 19:26:15.469746+05:30
342	3	ADD_SERVICE	SERVICE	214	Added "Preparation of Partnership Deed, Application at ROF, Pan Card" — ₹7500.00	{"amount": 7500, "bill_id": 82, "bill_no": "MSD-DRAFT-82", "service_id": 214, "service_name": "Preparation of Partnership Deed, Application at ROF, Pan Card"}	2026-04-01 19:26:15.473812+05:30
343	3	ADD_SERVICE	SERVICE	213	Added "Income Tax Audit, Account Finalisation" — ₹25000.00	{"amount": 25000, "bill_id": 82, "bill_no": "MSD-DRAFT-82", "service_id": 213, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-01 19:26:15.473706+05:30
344	3	FINALIZE_BILL	BILL	82	Total ₹38350.00	{"bill_id": 82, "bill_no": "MSD/2526/034", "total_invoice_value": "38350.00"}	2026-04-01 19:26:22.046286+05:30
345	3	MARK_PAYMENT	PAYMENT	36	Payment received — ₹38350.00 via NEFT	{"bill_id": 82, "bill_no": "MSD/2526/034", "payment_id": 36, "amount_paid": 38350, "payment_date": "2026-03-16", "payment_mode": "NEFT"}	2026-04-01 19:27:19.61328+05:30
346	3	CREATE_BILL	BILL	83	Created bill #MSD-DRAFT-83 (2025-26)	{"bill_id": 83, "bill_no": "MSD-DRAFT-83", "financial_year": "2025-26"}	2026-04-01 19:40:18.846083+05:30
347	3	ADD_SERVICE	SERVICE	216	Added "Professional Services" — ₹15000.00	{"amount": 15000, "bill_id": 83, "bill_no": "MSD-DRAFT-83", "service_id": 216, "service_name": "Professional Services"}	2026-04-01 19:40:18.850571+05:30
348	3	ADD_SERVICE	SERVICE	215	Added "Professional Services" — ₹15000.00	{"amount": 15000, "bill_id": 83, "bill_no": "MSD-DRAFT-83", "service_id": 215, "service_name": "Professional Services"}	2026-04-01 19:40:18.850446+05:30
349	3	ADD_SERVICE	SERVICE	217	Added "GST Returns - Quarterly" — ₹6000.00	{"amount": 6000, "bill_id": 83, "bill_no": "MSD-DRAFT-83", "service_id": 217, "service_name": "GST Returns - Quarterly"}	2026-04-01 19:40:19.004152+05:30
350	3	ADD_SERVICE	SERVICE	218	Added "GST Returns - Quarterly" — ₹6000.00	{"amount": 6000, "bill_id": 83, "bill_no": "MSD-DRAFT-83", "service_id": 218, "service_name": "GST Returns - Quarterly"}	2026-04-01 19:40:19.087696+05:30
351	3	CREATE_BILL	BILL	84	Created bill #MSD-DRAFT-84 (2025-26)	{"bill_id": 84, "bill_no": "MSD-DRAFT-84", "financial_year": "2025-26"}	2026-04-01 19:41:45.042708+05:30
352	3	ADD_SERVICE	SERVICE	219	Added "Professional Services" — ₹17000.00	{"amount": 17000, "bill_id": 84, "bill_no": "MSD-DRAFT-84", "service_id": 219, "service_name": "Professional Services"}	2026-04-01 19:41:45.047497+05:30
353	3	CREATE_BILL	BILL	85	Created bill #MSD-DRAFT-85 (2026-27)	{"bill_id": 85, "bill_no": "MSD-DRAFT-85", "financial_year": "2026-27"}	2026-04-01 19:49:24.083926+05:30
354	3	ADD_SERVICE	SERVICE	220	Added "Professional Services" — ₹30500.00	{"amount": 30500, "bill_id": 85, "bill_no": "MSD-DRAFT-85", "service_id": 220, "service_name": "Professional Services"}	2026-04-01 19:49:24.08724+05:30
355	3	ADD_SERVICE	SERVICE	221	Added "Professional Services" — ₹30500.00	{"amount": 30500, "bill_id": 85, "bill_no": "MSD-DRAFT-85", "service_id": 221, "service_name": "Professional Services"}	2026-04-01 19:49:24.325788+05:30
356	3	ADD_SERVICE	SERVICE	222	Added "Professional Services" — ₹30500.00	{"amount": 30500, "bill_id": 85, "bill_no": "MSD-DRAFT-85", "service_id": 222, "service_name": "Professional Services"}	2026-04-01 19:49:24.397834+05:30
357	3	ADD_SERVICE	SERVICE	224	Added "Professional Services" — ₹38000.00	{"amount": 38000, "bill_id": 85, "bill_no": "MSD-DRAFT-85", "service_id": 224, "service_name": "Professional Services"}	2026-04-01 19:49:24.468501+05:30
358	3	ADD_SERVICE	SERVICE	223	Added "Professional Services" — ₹30500.00	{"amount": 30500, "bill_id": 85, "bill_no": "MSD-DRAFT-85", "service_id": 223, "service_name": "Professional Services"}	2026-04-01 19:49:24.486822+05:30
359	3	CREATE_BILL	BILL	86	Created bill #MSD-DRAFT-86 (2025-26)	{"bill_id": 86, "bill_no": "MSD-DRAFT-86", "financial_year": "2025-26"}	2026-04-01 19:52:17.453014+05:30
360	3	ADD_SERVICE	SERVICE	225	Added "Professional Services" — ₹22000.00	{"amount": 22000, "bill_id": 86, "bill_no": "MSD-DRAFT-86", "service_id": 225, "service_name": "Professional Services"}	2026-04-01 19:52:17.457555+05:30
361	3	FINALIZE_BILL	BILL	86	Total ₹25960.00	{"bill_id": 86, "bill_no": "MSD/2526/035", "total_invoice_value": "25960.00"}	2026-04-01 19:52:26.335113+05:30
362	3	CREATE_BILL	BILL	87	Created bill #MSD-DRAFT-87 (2025-26)	{"bill_id": 87, "bill_no": "MSD-DRAFT-87", "financial_year": "2025-26"}	2026-04-01 19:57:31.653741+05:30
363	3	ADD_SERVICE	SERVICE	226	Added "Income Tax Audit, Account Finalisation" — ₹20000.00	{"amount": 20000, "bill_id": 87, "bill_no": "MSD-DRAFT-87", "service_id": 226, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-01 19:57:31.657872+05:30
364	3	FINALIZE_BILL	BILL	87	Total ₹23600.00	{"bill_id": 87, "bill_no": "MSD/2526/036", "total_invoice_value": "23600.00"}	2026-04-01 19:57:45.150264+05:30
365	3	MARK_PAYMENT	PAYMENT	37	Payment received — ₹23600.00 via NEFT	{"bill_id": 87, "bill_no": "MSD/2526/036", "payment_id": 37, "amount_paid": 23600, "payment_date": "2026-01-19", "payment_mode": "NEFT"}	2026-04-01 19:57:54.101921+05:30
366	3	CREATE_BILL	BILL	88	Created bill #MSD-DRAFT-88 (2025-26)	{"bill_id": 88, "bill_no": "MSD-DRAFT-88", "financial_year": "2025-26"}	2026-04-01 20:00:27.818335+05:30
367	3	ADD_SERVICE	SERVICE	227	Added "Professional Services" — ₹33000.00	{"amount": 33000, "bill_id": 88, "bill_no": "MSD-DRAFT-88", "service_id": 227, "service_name": "Professional Services"}	2026-04-01 20:00:27.822914+05:30
368	3	FINALIZE_BILL	BILL	88	Total ₹38940.00	{"bill_id": 88, "bill_no": "MSD/2526/037", "total_invoice_value": "38940.00"}	2026-04-01 20:00:32.89393+05:30
369	3	MARK_PAYMENT	PAYMENT	38	Payment received — ₹38940.00 via CHEQUE	{"bill_id": 88, "bill_no": "MSD/2526/037", "payment_id": 38, "amount_paid": 38940, "payment_date": "2026-02-17", "payment_mode": "CHEQUE"}	2026-04-01 20:01:18.16856+05:30
370	3	MARK_PAYMENT	PAYMENT	39	Payment received — ₹25960.00 via CHEQUE	{"bill_id": 86, "bill_no": "MSD/2526/035", "payment_id": 39, "amount_paid": 25960, "payment_date": "2026-02-17", "payment_mode": "CHEQUE"}	2026-04-01 20:01:38.688363+05:30
371	3	CREATE_BILL	BILL	89	Created bill #URJ-DRAFT-89 (2025-26)	{"bill_id": 89, "bill_no": "URJ-DRAFT-89", "financial_year": "2025-26"}	2026-04-02 12:03:49.602547+05:30
372	3	ADD_SERVICE	SERVICE	228	Added "Income Tax Return, Account Finalisation" — ₹6000.00	{"amount": 6000, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 228, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:03:49.619624+05:30
373	3	ADD_SERVICE	SERVICE	229	Added "Income Tax Return, Account Finalisation" — ₹6000.00	{"amount": 6000, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 229, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:03:49.74487+05:30
374	3	ADD_SERVICE	SERVICE	230	Added "Income Tax Return, Account Finalisation" — ₹6000.00	{"amount": 6000, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 230, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:03:49.921844+05:30
375	3	CREATE_BILL	BILL	90	Created bill #URJ-DRAFT-90 (2025-26)	{"bill_id": 90, "bill_no": "URJ-DRAFT-90", "financial_year": "2025-26"}	2026-04-02 12:07:05.522357+05:30
376	3	ADD_SERVICE	SERVICE	232	Added "Income Tax Return, Account Finalisation" — ₹10000.00	{"amount": 10000, "bill_id": 90, "bill_no": "URJ-DRAFT-90", "service_id": 232, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:07:05.526615+05:30
377	3	ADD_SERVICE	SERVICE	231	Added "Income Tax Return, Account Finalisation" — ₹10000.00	{"amount": 10000, "bill_id": 90, "bill_no": "URJ-DRAFT-90", "service_id": 231, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:07:05.526473+05:30
378	3	ADD_SERVICE	SERVICE	233	Added "Income Tax Return, Account Finalisation" — ₹5000.00	{"amount": 5000, "bill_id": 90, "bill_no": "URJ-DRAFT-90", "service_id": 233, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:07:05.648097+05:30
379	3	CREATE_BILL	BILL	91	Created bill #URJ-DRAFT-91 (2025-26)	{"bill_id": 91, "bill_no": "URJ-DRAFT-91", "financial_year": "2025-26"}	2026-04-02 12:15:26.334414+05:30
380	3	ADD_SERVICE	SERVICE	235	Added "Income Tax Return, Account Finalisation" — ₹7500.00	{"amount": 7500, "bill_id": 91, "bill_no": "URJ-DRAFT-91", "service_id": 235, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:15:26.33864+05:30
381	3	ADD_SERVICE	SERVICE	234	Added "Income Tax Return, Account Finalisation" — ₹7500.00	{"amount": 7500, "bill_id": 91, "bill_no": "URJ-DRAFT-91", "service_id": 234, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:15:26.338502+05:30
382	3	ADD_SERVICE	SERVICE	237	Added "Income Tax Return, Account Finalisation" — ₹7500.00	{"amount": 7500, "bill_id": 91, "bill_no": "URJ-DRAFT-91", "service_id": 237, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:15:26.528836+05:30
383	3	ADD_SERVICE	SERVICE	236	Added "Income Tax Return, Account Finalisation" — ₹7500.00	{"amount": 7500, "bill_id": 91, "bill_no": "URJ-DRAFT-91", "service_id": 236, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:15:26.558019+05:30
384	3	FINALIZE_BILL	BILL	91	Total ₹30000.00	{"bill_id": 91, "bill_no": "URJ/2526/004", "total_invoice_value": "30000.00"}	2026-04-02 12:15:31.408474+05:30
385	3	MARK_PAYMENT	PAYMENT	40	Payment received — ₹25000.00 via UPI	{"bill_id": 91, "bill_no": "URJ/2526/004", "payment_id": 40, "amount_paid": 25000, "payment_date": "2026-03-16", "payment_mode": "UPI"}	2026-04-02 12:16:16.489455+05:30
386	\N	WRITE_OFF_BILL	bill	91	Wrote off ₹5000.00 on bill URJ/2526/004	{"notes": "Discount", "bill_no": "URJ/2526/004", "writeoff_amount": 5000}	2026-04-02 12:16:24.427222+05:30
387	3	UPDATE_BILL	BILL	89	Updated bill #URJ-DRAFT-89	{"bill_id": 89, "bill_no": "URJ-DRAFT-89", "override_edit": false}	2026-04-02 12:21:02.045415+05:30
388	3	ADD_SERVICE	SERVICE	242	Added "Income Tax Return, Account Finalisation" — ₹12500.00	{"amount": 12500, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 242, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:21:02.051275+05:30
389	3	ADD_SERVICE	SERVICE	241	Added "Income Tax Return, Account Finalisation" — ₹12500.00	{"amount": 12500, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 241, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:21:02.051118+05:30
390	3	ADD_SERVICE	SERVICE	243	Added "Income Tax Return, Account Finalisation" — ₹3000.00	{"amount": 3000, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 243, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:21:02.189952+05:30
391	3	ADD_SERVICE	SERVICE	245	Added "GST Returns - Quarterly" — ₹6000.00	{"amount": 6000, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 245, "service_name": "GST Returns - Quarterly"}	2026-04-02 12:21:02.34244+05:30
392	3	ADD_SERVICE	SERVICE	244	Added "Income Tax Return, Account Finalisation" — ₹3000.00	{"amount": 3000, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 244, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:21:02.376587+05:30
393	3	ADD_SERVICE	SERVICE	247	Added "GST Annual Return" — ₹3000.00	{"amount": 3000, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 247, "service_name": "GST Annual Return"}	2026-04-02 12:21:02.487943+05:30
394	3	ADD_SERVICE	SERVICE	246	Added "GST Returns - Quarterly" — ₹6000.00	{"amount": 6000, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 246, "service_name": "GST Returns - Quarterly"}	2026-04-02 12:21:02.523189+05:30
395	3	ADD_SERVICE	SERVICE	248	Added "GST Annual Return" — ₹3000.00	{"amount": 3000, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 248, "service_name": "GST Annual Return"}	2026-04-02 12:21:02.663555+05:30
396	3	ADD_SERVICE	SERVICE	249	Added "Account Writing" — ₹10000.00	{"amount": 10000, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 249, "service_name": "Account Writing"}	2026-04-02 12:21:02.738083+05:30
397	3	ADD_SERVICE	SERVICE	250	Added "Account Writing" — ₹10000.00	{"amount": 10000, "bill_id": 89, "bill_no": "URJ-DRAFT-89", "service_id": 250, "service_name": "Account Writing"}	2026-04-02 12:21:02.80645+05:30
398	3	CREATE_BILL	BILL	92	Created bill #URJ-DRAFT-92 (2025-26)	{"bill_id": 92, "bill_no": "URJ-DRAFT-92", "financial_year": "2025-26"}	2026-04-02 12:24:41.814475+05:30
399	3	ADD_SERVICE	SERVICE	252	Added "Income Tax Return, Account Finalisation" — ₹3000.00	{"amount": 3000, "bill_id": 92, "bill_no": "URJ-DRAFT-92", "service_id": 252, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:24:41.819552+05:30
400	3	ADD_SERVICE	SERVICE	251	Added "Preparation of Partnership Deed, Application at ROF, Pan Card" — ₹7500.00	{"amount": 7500, "bill_id": 92, "bill_no": "URJ-DRAFT-92", "service_id": 251, "service_name": "Preparation of Partnership Deed, Application at ROF, Pan Card"}	2026-04-02 12:24:41.819414+05:30
401	3	FINALIZE_BILL	BILL	92	Total ₹10500.00	{"bill_id": 92, "bill_no": "URJ/2526/005", "total_invoice_value": "10500.00"}	2026-04-02 12:24:57.27569+05:30
402	3	MARK_PAYMENT	PAYMENT	41	Payment received — ₹10500.00 via CHEQUE	{"bill_id": 92, "bill_no": "URJ/2526/005", "payment_id": 41, "amount_paid": 10500, "payment_date": "2026-03-18", "payment_mode": "CHEQUE"}	2026-04-02 12:25:11.456983+05:30
403	3	CREATE_BILL	BILL	93	Created bill #URJ-DRAFT-93 (2025-26)	{"bill_id": 93, "bill_no": "URJ-DRAFT-93", "financial_year": "2025-26"}	2026-04-02 12:38:20.252628+05:30
404	3	ADD_SERVICE	SERVICE	254	Added "Income Tax Return, Account Finalisation" — ₹10000.00	{"amount": 10000, "bill_id": 93, "bill_no": "URJ-DRAFT-93", "service_id": 254, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 12:38:20.256611+05:30
405	3	ADD_SERVICE	SERVICE	253	Added "Income Tax Audit, Account Finalisation" — ₹17000.00	{"amount": 17000, "bill_id": 93, "bill_no": "URJ-DRAFT-93", "service_id": 253, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-02 12:38:20.256465+05:30
406	3	CREATE_BILL	BILL	94	Created bill #URJ-DRAFT-94 (2025-26)	{"bill_id": 94, "bill_no": "URJ-DRAFT-94", "financial_year": "2025-26"}	2026-04-02 12:40:42.560667+05:30
407	3	ADD_SERVICE	SERVICE	255	Added "Income Tax Audit, Account Finalisation" — ₹16500.00	{"amount": 16500, "bill_id": 94, "bill_no": "URJ-DRAFT-94", "service_id": 255, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-02 12:40:42.5645+05:30
408	3	CREATE_BILL	BILL	95	Created bill #URJ-DRAFT-95 (2025-26)	{"bill_id": 95, "bill_no": "URJ-DRAFT-95", "financial_year": "2025-26"}	2026-04-02 12:51:40.59359+05:30
409	3	ADD_SERVICE	SERVICE	256	Added "Income Tax Audit, Account Finalisation" — ₹22000.00	{"amount": 22000, "bill_id": 95, "bill_no": "URJ-DRAFT-95", "service_id": 256, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-02 12:51:40.596824+05:30
410	3	CREATE_BILL	BILL	96	Created bill #URJ-DRAFT-96 (2025-26)	{"bill_id": 96, "bill_no": "URJ-DRAFT-96", "financial_year": "2025-26"}	2026-04-02 13:07:19.6506+05:30
411	3	ADD_SERVICE	SERVICE	257	Added "Income Tax Audit, Account Finalisation" — ₹12000.00	{"amount": 12000, "bill_id": 96, "bill_no": "URJ-DRAFT-96", "service_id": 257, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-02 13:07:19.654713+05:30
412	3	CREATE_BILL	BILL	97	Created bill #URJ-DRAFT-97 (2025-26)	{"bill_id": 97, "bill_no": "URJ-DRAFT-97", "financial_year": "2025-26"}	2026-04-02 13:12:06.147831+05:30
413	3	ADD_SERVICE	SERVICE	258	Added "Professional Services" — ₹33000.00	{"amount": 33000, "bill_id": 97, "bill_no": "URJ-DRAFT-97", "service_id": 258, "service_name": "Professional Services"}	2026-04-02 13:12:06.152157+05:30
414	3	CREATE_BILL	BILL	98	Created bill #URJ-DRAFT-98 (2025-26)	{"bill_id": 98, "bill_no": "URJ-DRAFT-98", "financial_year": "2025-26"}	2026-04-02 15:48:01.399915+05:30
415	3	ADD_SERVICE	SERVICE	259	Added "Income Tax Audit, Account Finalisation" — ₹10000.00	{"amount": 10000, "bill_id": 98, "bill_no": "URJ-DRAFT-98", "service_id": 259, "service_name": "Income Tax Audit, Account Finalisation"}	2026-04-02 15:48:01.403911+05:30
416	3	ADD_SERVICE	SERVICE	260	Added "GST Returns - Quarterly" — ₹6000.00	{"amount": 6000, "bill_id": 98, "bill_no": "URJ-DRAFT-98", "service_id": 260, "service_name": "GST Returns - Quarterly"}	2026-04-02 15:48:01.62486+05:30
417	3	ADD_SERVICE	SERVICE	262	Added "Account Writing" — ₹18000.00	{"amount": 18000, "bill_id": 98, "bill_no": "URJ-DRAFT-98", "service_id": 262, "service_name": "Account Writing"}	2026-04-02 15:48:01.675356+05:30
418	3	ADD_SERVICE	SERVICE	261	Added "GST Annual Return" — ₹2000.00	{"amount": 2000, "bill_id": 98, "bill_no": "URJ-DRAFT-98", "service_id": 261, "service_name": "GST Annual Return"}	2026-04-02 15:48:01.705326+05:30
419	3	CREATE_BILL	BILL	99	Created bill #URJ-DRAFT-99 (2025-26)	{"bill_id": 99, "bill_no": "URJ-DRAFT-99", "financial_year": "2025-26"}	2026-04-02 15:51:19.516572+05:30
420	3	ADD_SERVICE	SERVICE	263	Added "Income Tax Audit , Income Tax Return and\nAccount Finalisation" — ₹20000.00	{"amount": 20000, "bill_id": 99, "bill_no": "URJ-DRAFT-99", "service_id": 263, "service_name": "Income Tax Audit , Income Tax Return and\\nAccount Finalisation"}	2026-04-02 15:51:19.521427+05:30
421	3	CREATE_BILL	BILL	100	Created bill #URJ-DRAFT-100 (2025-26)	{"bill_id": 100, "bill_no": "URJ-DRAFT-100", "financial_year": "2025-26"}	2026-04-02 15:56:57.493684+05:30
422	3	ADD_SERVICE	SERVICE	265	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹20000.00	{"amount": 20000, "bill_id": 100, "bill_no": "URJ-DRAFT-100", "service_id": 265, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 15:56:57.498158+05:30
423	3	ADD_SERVICE	SERVICE	264	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹20000.00	{"amount": 20000, "bill_id": 100, "bill_no": "URJ-DRAFT-100", "service_id": 264, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 15:56:57.498028+05:30
424	3	ADD_SERVICE	SERVICE	266	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹22000.00	{"amount": 22000, "bill_id": 100, "bill_no": "URJ-DRAFT-100", "service_id": 266, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 15:56:57.725941+05:30
425	3	CREATE_BILL	BILL	101	Created bill #URJ-DRAFT-101 (2025-26)	{"bill_id": 101, "bill_no": "URJ-DRAFT-101", "financial_year": "2025-26"}	2026-04-02 15:58:05.829845+05:30
426	3	ADD_SERVICE	SERVICE	268	Added "Income Tax Return, Account Finalisation" — ₹11000.00	{"amount": 11000, "bill_id": 101, "bill_no": "URJ-DRAFT-101", "service_id": 268, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 15:58:05.833551+05:30
483	3	CREATE_BILL	BILL	121	Created bill #URJ-DRAFT-121 (2026-27)	{"bill_id": 121, "bill_no": "URJ-DRAFT-121", "financial_year": "2026-27"}	2026-04-15 17:26:16.843261+05:30
427	3	ADD_SERVICE	SERVICE	267	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹22000.00	{"amount": 22000, "bill_id": 101, "bill_no": "URJ-DRAFT-101", "service_id": 267, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 15:58:05.833453+05:30
428	3	CREATE_BILL	BILL	102	Created bill #URJ-DRAFT-102 (2025-26)	{"bill_id": 102, "bill_no": "URJ-DRAFT-102", "financial_year": "2025-26"}	2026-04-02 16:01:52.492973+05:30
429	3	ADD_SERVICE	SERVICE	270	Added "Income Tax Return, Account Finalisation" — ₹4000.00	{"amount": 4000, "bill_id": 102, "bill_no": "URJ-DRAFT-102", "service_id": 270, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 16:01:52.496499+05:30
430	3	ADD_SERVICE	SERVICE	269	Added "Income Tax Return, Account Finalisation" — ₹4000.00	{"amount": 4000, "bill_id": 102, "bill_no": "URJ-DRAFT-102", "service_id": 269, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 16:01:52.496399+05:30
431	3	ADD_SERVICE	SERVICE	271	Added "GST Returns - Quarterly" — ₹4000.00	{"amount": 4000, "bill_id": 102, "bill_no": "URJ-DRAFT-102", "service_id": 271, "service_name": "GST Returns - Quarterly"}	2026-04-02 16:01:52.627251+05:30
432	3	ADD_SERVICE	SERVICE	273	Added "GST Returns - Quarterly" — ₹4000.00	{"amount": 4000, "bill_id": 102, "bill_no": "URJ-DRAFT-102", "service_id": 273, "service_name": "GST Returns - Quarterly"}	2026-04-02 16:01:52.782644+05:30
433	3	ADD_SERVICE	SERVICE	272	Added "GST Annual Return" — ₹1000.00	{"amount": 1000, "bill_id": 102, "bill_no": "URJ-DRAFT-102", "service_id": 272, "service_name": "GST Annual Return"}	2026-04-02 16:01:52.803064+05:30
434	3	ADD_SERVICE	SERVICE	274	Added "GST Annual Return" — ₹1000.00	{"amount": 1000, "bill_id": 102, "bill_no": "URJ-DRAFT-102", "service_id": 274, "service_name": "GST Annual Return"}	2026-04-02 16:01:52.85402+05:30
435	3	ADD_SERVICE	SERVICE	275	Added "Account Writing" — ₹9000.00	{"amount": 9000, "bill_id": 102, "bill_no": "URJ-DRAFT-102", "service_id": 275, "service_name": "Account Writing"}	2026-04-02 16:01:52.933096+05:30
436	3	ADD_SERVICE	SERVICE	276	Added "Account Writing" — ₹9000.00	{"amount": 9000, "bill_id": 102, "bill_no": "URJ-DRAFT-102", "service_id": 276, "service_name": "Account Writing"}	2026-04-02 16:01:53.105906+05:30
437	3	CREATE_BILL	BILL	103	Created bill #URJ-DRAFT-103 (2025-26)	{"bill_id": 103, "bill_no": "URJ-DRAFT-103", "financial_year": "2025-26"}	2026-04-02 16:19:36.888428+05:30
438	3	ADD_SERVICE	SERVICE	278	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 103, "bill_no": "URJ-DRAFT-103", "service_id": 278, "service_name": "GST Return - Monthly"}	2026-04-02 16:19:36.894159+05:30
439	3	ADD_SERVICE	SERVICE	277	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹12000.00	{"amount": 12000, "bill_id": 103, "bill_no": "URJ-DRAFT-103", "service_id": 277, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 16:19:36.894009+05:30
440	3	ADD_SERVICE	SERVICE	280	Added "Income Tax Return, Account Finalisation" — ₹5000.00	{"amount": 5000, "bill_id": 103, "bill_no": "URJ-DRAFT-103", "service_id": 280, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 16:19:37.105568+05:30
441	3	ADD_SERVICE	SERVICE	279	Added "Income Tax Return, Account Finalisation" — ₹5000.00	{"amount": 5000, "bill_id": 103, "bill_no": "URJ-DRAFT-103", "service_id": 279, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 16:19:37.130665+05:30
442	3	CREATE_BILL	BILL	104	Created bill #URJ-DRAFT-104 (2025-26)	{"bill_id": 104, "bill_no": "URJ-DRAFT-104", "financial_year": "2025-26"}	2026-04-02 16:40:55.375556+05:30
443	3	ADD_SERVICE	SERVICE	281	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹17000.00	{"amount": 17000, "bill_id": 104, "bill_no": "URJ-DRAFT-104", "service_id": 281, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 16:40:55.379831+05:30
444	3	CREATE_BILL	BILL	105	Created bill #URJ-DRAFT-105 (2025-26)	{"bill_id": 105, "bill_no": "URJ-DRAFT-105", "financial_year": "2025-26"}	2026-04-02 16:44:12.445161+05:30
445	3	ADD_SERVICE	SERVICE	283	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹20000.00	{"amount": 20000, "bill_id": 105, "bill_no": "URJ-DRAFT-105", "service_id": 283, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 16:44:12.448877+05:30
446	3	ADD_SERVICE	SERVICE	282	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹20000.00	{"amount": 20000, "bill_id": 105, "bill_no": "URJ-DRAFT-105", "service_id": 282, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 16:44:12.448742+05:30
447	3	ADD_SERVICE	SERVICE	284	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹22000.00	{"amount": 22000, "bill_id": 105, "bill_no": "URJ-DRAFT-105", "service_id": 284, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 16:44:12.683726+05:30
448	3	CREATE_BILL	BILL	106	Created bill #URJ-DRAFT-106 (2025-26)	{"bill_id": 106, "bill_no": "URJ-DRAFT-106", "financial_year": "2025-26"}	2026-04-02 16:46:31.155168+05:30
449	3	ADD_SERVICE	SERVICE	285	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹16500.00	{"amount": 16500, "bill_id": 106, "bill_no": "URJ-DRAFT-106", "service_id": 285, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 16:46:31.159027+05:30
450	3	CREATE_BILL	BILL	107	Created bill #URJ-DRAFT-107 (2025-26)	{"bill_id": 107, "bill_no": "URJ-DRAFT-107", "financial_year": "2025-26"}	2026-04-02 16:50:04.689564+05:30
451	3	ADD_SERVICE	SERVICE	287	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 107, "bill_no": "URJ-DRAFT-107", "service_id": 287, "service_name": "GST Return - Monthly"}	2026-04-02 16:50:04.695216+05:30
452	3	ADD_SERVICE	SERVICE	286	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹19800.00	{"amount": 19800, "bill_id": 107, "bill_no": "URJ-DRAFT-107", "service_id": 286, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 16:50:04.695085+05:30
453	3	ADD_SERVICE	SERVICE	289	Added "Professional Services" — ₹4000.00	{"amount": 4000, "bill_id": 107, "bill_no": "URJ-DRAFT-107", "service_id": 289, "service_name": "Professional Services"}	2026-04-02 16:50:04.907923+05:30
454	3	ADD_SERVICE	SERVICE	288	Added "Income Tax Return, Account Finalisation" — ₹4000.00	{"amount": 4000, "bill_id": 107, "bill_no": "URJ-DRAFT-107", "service_id": 288, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 16:50:04.93515+05:30
455	3	CREATE_BILL	BILL	108	Created bill #URJ-DRAFT-108 (2025-26)	{"bill_id": 108, "bill_no": "URJ-DRAFT-108", "financial_year": "2025-26"}	2026-04-02 16:51:05.773862+05:30
456	3	ADD_SERVICE	SERVICE	290	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹20000.00	{"amount": 20000, "bill_id": 108, "bill_no": "URJ-DRAFT-108", "service_id": 290, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 16:51:05.77942+05:30
457	3	CREATE_BILL	BILL	109	Created bill #URJ-DRAFT-109 (2025-26)	{"bill_id": 109, "bill_no": "URJ-DRAFT-109", "financial_year": "2025-26"}	2026-04-02 16:52:02.266113+05:30
458	3	ADD_SERVICE	SERVICE	291	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹16500.00	{"amount": 16500, "bill_id": 109, "bill_no": "URJ-DRAFT-109", "service_id": 291, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 16:52:02.270618+05:30
459	3	CREATE_BILL	BILL	111	Created bill #URJ-DRAFT-111 (2025-26)	{"bill_id": 111, "bill_no": "URJ-DRAFT-111", "financial_year": "2025-26"}	2026-04-02 16:55:13.322324+05:30
460	3	ADD_SERVICE	SERVICE	292	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹16500.00	{"amount": 16500, "bill_id": 111, "bill_no": "URJ-DRAFT-111", "service_id": 292, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 16:55:13.327956+05:30
461	3	CREATE_BILL	BILL	112	Created bill #URJ-DRAFT-112 (2025-26)	{"bill_id": 112, "bill_no": "URJ-DRAFT-112", "financial_year": "2025-26"}	2026-04-02 16:57:33.758257+05:30
462	3	ADD_SERVICE	SERVICE	294	Added "GST Return - Monthly" — ₹13200.00	{"amount": 13200, "bill_id": 112, "bill_no": "URJ-DRAFT-112", "service_id": 294, "service_name": "GST Return - Monthly"}	2026-04-02 16:57:33.763248+05:30
463	3	ADD_SERVICE	SERVICE	293	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹11000.00	{"amount": 11000, "bill_id": 112, "bill_no": "URJ-DRAFT-112", "service_id": 293, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 16:57:33.763084+05:30
464	3	ADD_SERVICE	SERVICE	295	Added "Income Tax Return, Account Finalisation" — ₹4400.00	{"amount": 4400, "bill_id": 112, "bill_no": "URJ-DRAFT-112", "service_id": 295, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 16:57:33.921678+05:30
465	3	ADD_SERVICE	SERVICE	296	Added "Income Tax Return, Account Finalisation" — ₹4400.00	{"amount": 4400, "bill_id": 112, "bill_no": "URJ-DRAFT-112", "service_id": 296, "service_name": "Income Tax Return, Account Finalisation"}	2026-04-02 16:57:34.021802+05:30
466	3	CREATE_BILL	BILL	113	Created bill #URJ-DRAFT-113 (2025-26)	{"bill_id": 113, "bill_no": "URJ-DRAFT-113", "financial_year": "2025-26"}	2026-04-02 17:06:49.481529+05:30
467	3	ADD_SERVICE	SERVICE	297	Added "Income Tax Audit , Income Tax Return, GST Reconciliation , Account Finalisation and other services" — ₹17000.00	{"amount": 17000, "bill_id": 113, "bill_no": "URJ-DRAFT-113", "service_id": 297, "service_name": "Income Tax Audit , Income Tax Return, GST Reconciliation , Account Finalisation and other services"}	2026-04-02 17:06:49.487021+05:30
468	3	CREATE_BILL	BILL	114	Created bill #URJ-DRAFT-114 (2025-26)	{"bill_id": 114, "bill_no": "URJ-DRAFT-114", "financial_year": "2025-26"}	2026-04-02 17:09:01.05805+05:30
469	3	ADD_SERVICE	SERVICE	299	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹19800.00	{"amount": 19800, "bill_id": 114, "bill_no": "URJ-DRAFT-114", "service_id": 299, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 17:09:01.062496+05:30
470	3	ADD_SERVICE	SERVICE	298	Added "Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services" — ₹18000.00	{"amount": 18000, "bill_id": 114, "bill_no": "URJ-DRAFT-114", "service_id": 298, "service_name": "Income Tax Audit , GST Reconciliation ,\\nAccount Finalisation and other services"}	2026-04-02 17:09:01.062353+05:30
471	3	CREATE_BILL	BILL	115	Created bill #URJ-DRAFT-115 (2026-27)	{"bill_id": 115, "bill_no": "URJ-DRAFT-115", "financial_year": "2026-27"}	2026-04-03 16:52:05.711633+05:30
472	3	ADD_SERVICE	SERVICE	300	Added "Certificate" — ₹2500.00	{"amount": 2500, "bill_id": 115, "bill_no": "URJ-DRAFT-115", "service_id": 300, "service_name": "Certificate"}	2026-04-03 16:52:05.731565+05:30
473	3	FINALIZE_BILL	BILL	115	Total ₹2500.00	{"bill_id": 115, "bill_no": "URJ/2627/001", "total_invoice_value": "2500.00"}	2026-04-03 17:43:13.087819+05:30
474	3	MARK_PAYMENT	PAYMENT	42	Payment received — ₹2500.00 via CASH	{"bill_id": 115, "bill_no": "URJ/2627/001", "payment_id": 42, "amount_paid": 2500, "payment_date": "2026-04-06", "payment_mode": "CASH"}	2026-04-06 17:30:26.203475+05:30
475	3	CREATE_BILL	BILL	117	Created bill #URJ-DRAFT-117 (2026-27)	{"bill_id": 117, "bill_no": "URJ-DRAFT-117", "financial_year": "2026-27"}	2026-04-10 12:30:35.854165+05:30
476	3	ADD_SERVICE	SERVICE	301	Added "Preparation of Partnership Deed, Application at ROF, Pan Card" — ₹7500.00	{"amount": 7500, "bill_id": 117, "bill_no": "URJ-DRAFT-117", "service_id": 301, "service_name": "Preparation of Partnership Deed, Application at ROF, Pan Card"}	2026-04-10 12:30:35.859959+05:30
477	3	CREATE_BILL	BILL	118	Created bill #URJ-DRAFT-118 (2025-26)	{"bill_id": 118, "bill_no": "URJ-DRAFT-118", "financial_year": "2025-26"}	2026-04-13 18:11:26.037452+05:30
478	3	ADD_SERVICE	SERVICE	302	Added "Preparation of Partnership Deed, Application at ROF, Pan Card" — ₹7500.00	{"amount": 7500, "bill_id": 118, "bill_no": "URJ-DRAFT-118", "service_id": 302, "service_name": "Preparation of Partnership Deed, Application at ROF, Pan Card"}	2026-04-13 18:11:26.044537+05:30
479	3	CREATE_BILL	BILL	119	Created bill #URJ-DRAFT-119 (2026-27)	{"bill_id": 119, "bill_no": "URJ-DRAFT-119", "financial_year": "2026-27"}	2026-04-15 17:23:36.554046+05:30
480	3	ADD_SERVICE	SERVICE	303	Added "Professional Services" — ₹20000.00	{"amount": 20000, "bill_id": 119, "bill_no": "URJ-DRAFT-119", "service_id": 303, "service_name": "Professional Services"}	2026-04-15 17:23:36.57433+05:30
481	3	CREATE_BILL	BILL	120	Created bill #URJ-DRAFT-120 (2026-27)	{"bill_id": 120, "bill_no": "URJ-DRAFT-120", "financial_year": "2026-27"}	2026-04-15 17:24:46.665393+05:30
482	3	ADD_SERVICE	SERVICE	304	Added "Professional Services" — ₹5000.00	{"amount": 5000, "bill_id": 120, "bill_no": "URJ-DRAFT-120", "service_id": 304, "service_name": "Professional Services"}	2026-04-15 17:24:46.669517+05:30
484	3	ADD_SERVICE	SERVICE	305	Added "Professional Services" — ₹5000.00	{"amount": 5000, "bill_id": 121, "bill_no": "URJ-DRAFT-121", "service_id": 305, "service_name": "Professional Services"}	2026-04-15 17:26:16.847485+05:30
485	3	CREATE_BILL	BILL	122	Created bill #MSD-DRAFT-122 (2026-27)	{"bill_id": 122, "bill_no": "MSD-DRAFT-122", "financial_year": "2026-27"}	2026-04-17 13:09:41.108792+05:30
486	3	ADD_SERVICE	SERVICE	306	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 122, "bill_no": "MSD-DRAFT-122", "service_id": 306, "service_name": "GST Return - Monthly"}	2026-04-17 13:09:41.113916+05:30
487	3	UPDATE_BILL	BILL	122	Updated bill #MSD-DRAFT-122	{"bill_id": 122, "bill_no": "MSD-DRAFT-122", "override_edit": false}	2026-04-17 13:11:02.883257+05:30
488	3	ADD_SERVICE	SERVICE	307	Added "GST Return - Monthly" — ₹6250.00	{"amount": 6250, "bill_id": 122, "bill_no": "MSD-DRAFT-122", "service_id": 307, "service_name": "GST Return - Monthly"}	2026-04-17 13:11:02.887848+05:30
489	3	UPDATE_BILL	BILL	122	Updated bill #MSD-DRAFT-122	{"bill_id": 122, "bill_no": "MSD-DRAFT-122", "override_edit": false}	2026-04-17 13:11:16.525063+05:30
490	3	CREATE_BILL	BILL	123	Created bill #URJ-DRAFT-123 (2026-27)	{"bill_id": 123, "bill_no": "URJ-DRAFT-123", "financial_year": "2026-27"}	2026-04-17 17:33:06.874812+05:30
491	3	ADD_SERVICE	SERVICE	311	Added "Professional Services" — ₹18000.00	{"amount": 18000, "bill_id": 123, "bill_no": "URJ-DRAFT-123", "service_id": 311, "service_name": "Professional Services"}	2026-04-17 17:33:06.880887+05:30
492	3	CREATE_BILL	BILL	124	Created bill #MSD-DRAFT-124 (2026-27)	{"bill_id": 124, "bill_no": "MSD-DRAFT-124", "financial_year": "2026-27"}	2026-04-17 18:03:55.804673+05:30
493	3	ADD_SERVICE	SERVICE	312	Added "GST Registration " — ₹5000.00	{"amount": 5000, "bill_id": 124, "bill_no": "MSD-DRAFT-124", "service_id": 312, "service_name": "GST Registration "}	2026-04-17 18:03:55.808731+05:30
494	3	ADD_SERVICE	SERVICE	313	Added "Preparation of Partnership Deed, Application at ROF, Pan Card" — ₹7500.00	{"amount": 7500, "bill_id": 124, "bill_no": "MSD-DRAFT-124", "service_id": 313, "service_name": "Preparation of Partnership Deed, Application at ROF, Pan Card"}	2026-04-17 18:03:56.08427+05:30
495	3	ADD_SERVICE	SERVICE	314	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 124, "bill_no": "MSD-DRAFT-124", "service_id": 314, "service_name": "GST Return - Monthly"}	2026-04-17 18:03:56.090411+05:30
496	3	CREATE_BILL	BILL	125	Created bill #MSD-DRAFT-125 (2026-27)	{"bill_id": 125, "bill_no": "MSD-DRAFT-125", "financial_year": "2026-27"}	2026-04-18 18:17:30.314211+05:30
497	3	ADD_SERVICE	SERVICE	315	Added "Professional Services" — ₹50000.00	{"amount": 50000, "bill_id": 125, "bill_no": "MSD-DRAFT-125", "service_id": 315, "service_name": "Professional Services"}	2026-04-18 18:17:30.33416+05:30
498	3	ADD_SERVICE	SERVICE	316	Added "Professional Services" — ₹50000.00	{"amount": 50000, "bill_id": 125, "bill_no": "MSD-DRAFT-125", "service_id": 316, "service_name": "Professional Services"}	2026-04-18 18:17:30.598616+05:30
499	3	ADD_SERVICE	SERVICE	318	Added "Professional Services" — ₹55000.00	{"amount": 55000, "bill_id": 125, "bill_no": "MSD-DRAFT-125", "service_id": 318, "service_name": "Professional Services"}	2026-04-18 18:17:30.789893+05:30
500	3	ADD_SERVICE	SERVICE	317	Added "Professional Services" — ₹50000.00	{"amount": 50000, "bill_id": 125, "bill_no": "MSD-DRAFT-125", "service_id": 317, "service_name": "Professional Services"}	2026-04-18 18:17:30.790446+05:30
501	3	ADD_SERVICE	SERVICE	319	Added "Professional Services" — ₹55000.00	{"amount": 55000, "bill_id": 125, "bill_no": "MSD-DRAFT-125", "service_id": 319, "service_name": "Professional Services"}	2026-04-18 18:17:30.935178+05:30
502	3	CREATE_BILL	BILL	126	Created bill #URJ-DRAFT-126 (2026-27)	{"bill_id": 126, "bill_no": "URJ-DRAFT-126", "financial_year": "2026-27"}	2026-04-18 18:22:42.377722+05:30
503	3	ADD_SERVICE	SERVICE	320	Added "Professional Services" — ₹27500.00	{"amount": 27500, "bill_id": 126, "bill_no": "URJ-DRAFT-126", "service_id": 320, "service_name": "Professional Services"}	2026-04-18 18:22:42.383772+05:30
504	3	CREATE_BILL	BILL	127	Created bill #URJ-DRAFT-127 (2026-27)	{"bill_id": 127, "bill_no": "URJ-DRAFT-127", "financial_year": "2026-27"}	2026-04-18 18:50:25.19526+05:30
505	3	ADD_SERVICE	SERVICE	321	Added "Professional Services" — ₹55000.00	{"amount": 55000, "bill_id": 127, "bill_no": "URJ-DRAFT-127", "service_id": 321, "service_name": "Professional Services"}	2026-04-18 18:50:25.21381+05:30
506	3	CREATE_BILL	BILL	128	Created bill #URJ-DRAFT-128 (2026-27)	{"bill_id": 128, "bill_no": "URJ-DRAFT-128", "financial_year": "2026-27"}	2026-04-18 18:51:44.005523+05:30
507	3	ADD_SERVICE	SERVICE	322	Added "Professional Services" — ₹45000.00	{"amount": 45000, "bill_id": 128, "bill_no": "URJ-DRAFT-128", "service_id": 322, "service_name": "Professional Services"}	2026-04-18 18:51:44.008723+05:30
508	3	UPDATE_BILL	BILL	128	Updated bill #URJ-DRAFT-128	{"bill_id": 128, "bill_no": "URJ-DRAFT-128", "override_edit": false}	2026-04-18 18:51:57.836504+05:30
509	3	ADD_SERVICE	SERVICE	323	Added "Professional Services" — ₹35000.00	{"amount": 35000, "bill_id": 128, "bill_no": "URJ-DRAFT-128", "service_id": 323, "service_name": "Professional Services"}	2026-04-18 18:51:57.841475+05:30
510	3	DELETE_SERVICE	SERVICE	322	Removed "Professional Services" — ₹45000.00	{"amount": 45000, "bill_id": 128, "bill_no": "URJ-DRAFT-128", "service_id": 322, "service_name": "Professional Services"}	2026-04-18 18:51:57.841311+05:30
511	3	CREATE_BILL	BILL	129	Created bill #URJ-DRAFT-129 (2026-27)	{"bill_id": 129, "bill_no": "URJ-DRAFT-129", "financial_year": "2026-27"}	2026-04-18 18:53:09.106144+05:30
512	3	ADD_SERVICE	SERVICE	324	Added "Professional Services" — ₹30000.00	{"amount": 30000, "bill_id": 129, "bill_no": "URJ-DRAFT-129", "service_id": 324, "service_name": "Professional Services"}	2026-04-18 18:53:09.111327+05:30
513	3	UPDATE_BILL	BILL	129	Updated bill #URJ-DRAFT-129	{"bill_id": 129, "bill_no": "URJ-DRAFT-129", "override_edit": false}	2026-04-18 18:53:34.149975+05:30
514	3	ADD_SERVICE	SERVICE	326	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 129, "bill_no": "URJ-DRAFT-129", "service_id": 326, "service_name": "GST Return - Monthly"}	2026-04-18 18:53:34.158222+05:30
515	3	CREATE_BILL	BILL	130	Created bill #URJ-DRAFT-130 (2026-27)	{"bill_id": 130, "bill_no": "URJ-DRAFT-130", "financial_year": "2026-27"}	2026-04-18 19:08:00.069922+05:30
578	3	FINALIZE_BILL	BILL	140	Total ₹30000.00	{"bill_id": 140, "bill_no": "URJ/2627/007", "total_invoice_value": "30000.00"}	2026-05-02 12:39:03.850156+05:30
516	3	ADD_SERVICE	SERVICE	327	Added "Preparation of Partnership Deed, Application at ROF, Pan Card" — ₹7500.00	{"amount": 7500, "bill_id": 130, "bill_no": "URJ-DRAFT-130", "service_id": 327, "service_name": "Preparation of Partnership Deed, Application at ROF, Pan Card"}	2026-04-18 19:08:00.07475+05:30
517	3	CREATE_BILL	BILL	131	Created bill #MSD-DRAFT-131 (2026-27)	{"bill_id": 131, "bill_no": "MSD-DRAFT-131", "financial_year": "2026-27"}	2026-04-18 19:11:20.356955+05:30
518	3	ADD_SERVICE	SERVICE	329	Added "Income Tax Audit , Income Tax Return and\nAccount Finalisation" — ₹20000.00	{"amount": 20000, "bill_id": 131, "bill_no": "MSD-DRAFT-131", "service_id": 329, "service_name": "Income Tax Audit , Income Tax Return and\\nAccount Finalisation"}	2026-04-18 19:11:20.361755+05:30
519	3	ADD_SERVICE	SERVICE	328	Added "Account Writing" — ₹12000.00	{"amount": 12000, "bill_id": 131, "bill_no": "MSD-DRAFT-131", "service_id": 328, "service_name": "Account Writing"}	2026-04-18 19:11:20.361608+05:30
520	3	UPDATE_BILL	BILL	131	Updated bill #MSD-DRAFT-131	{"bill_id": 131, "bill_no": "MSD-DRAFT-131", "override_edit": false}	2026-04-18 19:11:43.422069+05:30
521	3	UPDATE_BILL	BILL	131	Updated bill #MSD-DRAFT-131	{"bill_id": 131, "bill_no": "MSD-DRAFT-131", "override_edit": false}	2026-04-18 19:24:00.078705+05:30
522	3	DELETE_SERVICE	SERVICE	331	Removed "Income Tax Audit , Income Tax Return and\nAccount Finalisation" — ₹20000.00	{"amount": 20000, "bill_id": 131, "bill_no": "MSD-DRAFT-131", "service_id": 331, "service_name": "Income Tax Audit , Income Tax Return and\\nAccount Finalisation"}	2026-04-18 19:24:00.082415+05:30
523	3	DELETE_SERVICE	SERVICE	330	Removed "Account Writing" — ₹12000.00	{"amount": 12000, "bill_id": 131, "bill_no": "MSD-DRAFT-131", "service_id": 330, "service_name": "Account Writing"}	2026-04-18 19:24:00.08231+05:30
524	3	ADD_SERVICE	SERVICE	332	Added "Income Tax Audit " — ₹7500.00	{"amount": 7500, "bill_id": 131, "bill_no": "MSD-DRAFT-131", "service_id": 332, "service_name": "Income Tax Audit "}	2026-04-18 19:24:00.206235+05:30
525	3	CREATE_BILL	BILL	132	Created bill #URJ-DRAFT-132 (2026-27)	{"bill_id": 132, "bill_no": "URJ-DRAFT-132", "financial_year": "2026-27"}	2026-04-18 19:26:04.99721+05:30
526	3	ADD_SERVICE	SERVICE	333	Added "Account Writing and Preparation of Income Tax Return " — ₹28500.00	{"amount": 28500, "bill_id": 132, "bill_no": "URJ-DRAFT-132", "service_id": 333, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:26:05.003082+05:30
527	3	CREATE_BILL	BILL	133	Created bill #URJ-DRAFT-133 (2026-27)	{"bill_id": 133, "bill_no": "URJ-DRAFT-133", "financial_year": "2026-27"}	2026-04-18 19:26:42.785975+05:30
528	3	ADD_SERVICE	SERVICE	334	Added "Account Writing and Preparation of Income Tax Return " — ₹30000.00	{"amount": 30000, "bill_id": 133, "bill_no": "URJ-DRAFT-133", "service_id": 334, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:26:42.790305+05:30
529	3	CREATE_BILL	BILL	134	Created bill #URJ-DRAFT-134 (2026-27)	{"bill_id": 134, "bill_no": "URJ-DRAFT-134", "financial_year": "2026-27"}	2026-04-18 19:29:23.649703+05:30
530	3	ADD_SERVICE	SERVICE	336	Added "Professional Services" — ₹33000.00	{"amount": 33000, "bill_id": 134, "bill_no": "URJ-DRAFT-134", "service_id": 336, "service_name": "Professional Services"}	2026-04-18 19:29:23.653079+05:30
531	3	ADD_SERVICE	SERVICE	335	Added "Professional Services" — ₹30000.00	{"amount": 30000, "bill_id": 134, "bill_no": "URJ-DRAFT-134", "service_id": 335, "service_name": "Professional Services"}	2026-04-18 19:29:23.652956+05:30
532	3	ADD_SERVICE	SERVICE	337	Added "Professional Services" — ₹33000.00	{"amount": 33000, "bill_id": 134, "bill_no": "URJ-DRAFT-134", "service_id": 337, "service_name": "Professional Services"}	2026-04-18 19:29:23.781375+05:30
533	3	CREATE_BILL	BILL	135	Created bill #URJ-DRAFT-135 (2026-27)	{"bill_id": 135, "bill_no": "URJ-DRAFT-135", "financial_year": "2026-27"}	2026-04-18 19:30:31.352435+05:30
534	3	ADD_SERVICE	SERVICE	338	Added "Account Writing and Preparation of Income Tax Return " — ₹30000.00	{"amount": 30000, "bill_id": 135, "bill_no": "URJ-DRAFT-135", "service_id": 338, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:30:31.356445+05:30
535	3	ADD_SERVICE	SERVICE	339	Added "Account Writing and Preparation of Income Tax Return " — ₹33000.00	{"amount": 33000, "bill_id": 135, "bill_no": "URJ-DRAFT-135", "service_id": 339, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:30:31.510002+05:30
536	3	ADD_SERVICE	SERVICE	340	Added "Account Writing and Preparation of Income Tax Return " — ₹33000.00	{"amount": 33000, "bill_id": 135, "bill_no": "URJ-DRAFT-135", "service_id": 340, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:30:31.583845+05:30
537	3	FINALIZE_BILL	BILL	135	Total ₹96000.00	{"bill_id": 135, "bill_no": "URJ/2627/002", "total_invoice_value": "96000.00"}	2026-04-18 19:31:42.959334+05:30
538	3	DELETE_BILL	BILL	135	Deleted bill #URJ/2627/002	{"bill_id": 135, "bill_no": "URJ/2627/002"}	2026-04-18 19:31:52.60921+05:30
539	3	FINALIZE_BILL	BILL	134	Total ₹96000.00	{"bill_id": 134, "bill_no": "URJ/2627/003", "total_invoice_value": "96000.00"}	2026-04-18 19:31:59.682641+05:30
540	3	DELETE_BILL	BILL	134	Deleted bill #URJ/2627/003	{"bill_id": 134, "bill_no": "URJ/2627/003"}	2026-04-18 19:32:10.313071+05:30
541	3	FINALIZE_BILL	BILL	133	Total ₹30000.00	{"bill_id": 133, "bill_no": "URJ/2627/004", "total_invoice_value": "30000.00"}	2026-04-18 19:32:19.613764+05:30
542	3	DELETE_BILL	BILL	133	Deleted bill #URJ/2627/004	{"bill_id": 133, "bill_no": "URJ/2627/004"}	2026-04-18 19:32:28.473456+05:30
543	3	FINALIZE_BILL	BILL	132	Total ₹28500.00	{"bill_id": 132, "bill_no": "URJ/2627/005", "total_invoice_value": "28500.00"}	2026-04-18 19:32:31.303153+05:30
544	3	DELETE_BILL	BILL	132	Deleted bill #URJ/2627/005	{"bill_id": 132, "bill_no": "URJ/2627/005"}	2026-04-18 19:32:38.132455+05:30
545	3	CREATE_BILL	BILL	136	Created bill #URJ-DRAFT-136 (2026-27)	{"bill_id": 136, "bill_no": "URJ-DRAFT-136", "financial_year": "2026-27"}	2026-04-18 19:33:57.306734+05:30
546	3	ADD_SERVICE	SERVICE	341	Added "Account Writing and Preparation of Income Tax Return " — ₹28500.00	{"amount": 28500, "bill_id": 136, "bill_no": "URJ-DRAFT-136", "service_id": 341, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:33:57.310098+05:30
547	3	CREATE_BILL	BILL	137	Created bill #URJ-DRAFT-137 (2026-27)	{"bill_id": 137, "bill_no": "URJ-DRAFT-137", "financial_year": "2026-27"}	2026-04-18 19:44:11.754687+05:30
579	3	FINALIZE_BILL	BILL	139	Total ₹28500.00	{"bill_id": 139, "bill_no": "URJ/2627/008", "total_invoice_value": "28500.00"}	2026-05-02 12:39:06.839254+05:30
548	3	ADD_SERVICE	SERVICE	342	Added "Account Writing and Preparation of Income Tax Return " — ₹28500.00	{"amount": 28500, "bill_id": 137, "bill_no": "URJ-DRAFT-137", "service_id": 342, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:44:11.759058+05:30
549	3	CREATE_BILL	BILL	138	Created bill #URJ-DRAFT-138 (2026-27)	{"bill_id": 138, "bill_no": "URJ-DRAFT-138", "financial_year": "2026-27"}	2026-04-18 19:45:19.935051+05:30
550	3	ADD_SERVICE	SERVICE	343	Added "Account Writing and Preparation of Income Tax Return " — ₹28500.00	{"amount": 28500, "bill_id": 138, "bill_no": "URJ-DRAFT-138", "service_id": 343, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:45:19.938158+05:30
551	3	CREATE_BILL	BILL	139	Created bill #URJ-DRAFT-139 (2026-27)	{"bill_id": 139, "bill_no": "URJ-DRAFT-139", "financial_year": "2026-27"}	2026-04-18 19:47:20.566042+05:30
552	3	ADD_SERVICE	SERVICE	344	Added "Account Writing and Preparation of Income Tax Return " — ₹28500.00	{"amount": 28500, "bill_id": 139, "bill_no": "URJ-DRAFT-139", "service_id": 344, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:47:20.569197+05:30
553	3	CREATE_BILL	BILL	140	Created bill #URJ-DRAFT-140 (2026-27)	{"bill_id": 140, "bill_no": "URJ-DRAFT-140", "financial_year": "2026-27"}	2026-04-18 19:48:05.483562+05:30
554	3	ADD_SERVICE	SERVICE	345	Added "Account Writing and Preparation of Income Tax Return " — ₹30000.00	{"amount": 30000, "bill_id": 140, "bill_no": "URJ-DRAFT-140", "service_id": 345, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:48:05.485132+05:30
555	3	CREATE_BILL	BILL	141	Created bill #URJ-DRAFT-141 (2026-27)	{"bill_id": 141, "bill_no": "URJ-DRAFT-141", "financial_year": "2026-27"}	2026-04-18 19:49:43.291526+05:30
556	3	ADD_SERVICE	SERVICE	347	Added "Account Writing and Preparation of Income Tax Return " — ₹33000.00	{"amount": 33000, "bill_id": 141, "bill_no": "URJ-DRAFT-141", "service_id": 347, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:49:43.296319+05:30
557	3	ADD_SERVICE	SERVICE	346	Added "Account Writing and Preparation of Income Tax Return " — ₹30000.00	{"amount": 30000, "bill_id": 141, "bill_no": "URJ-DRAFT-141", "service_id": 346, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:49:43.296288+05:30
558	3	ADD_SERVICE	SERVICE	348	Added "Account Writing and Preparation of Income Tax Return " — ₹33000.00	{"amount": 33000, "bill_id": 141, "bill_no": "URJ-DRAFT-141", "service_id": 348, "service_name": "Account Writing and Preparation of Income Tax Return "}	2026-04-18 19:49:43.416091+05:30
559	3	CREATE_BILL	BILL	142	Created bill #MSD-DRAFT-142 (2026-27)	{"bill_id": 142, "bill_no": "MSD-DRAFT-142", "financial_year": "2026-27"}	2026-04-18 20:00:56.310471+05:30
560	3	ADD_SERVICE	SERVICE	349	Added "Professional Services" — ₹7500.00	{"amount": 7500, "bill_id": 142, "bill_no": "MSD-DRAFT-142", "service_id": 349, "service_name": "Professional Services"}	2026-04-18 20:00:56.315569+05:30
561	3	CREATE_BILL	BILL	143	Created bill #MSD-DRAFT-143 (2026-27)	{"bill_id": 143, "bill_no": "MSD-DRAFT-143", "financial_year": "2026-27"}	2026-04-22 12:36:38.351808+05:30
562	3	ADD_SERVICE	SERVICE	350	Added "GST Return - Monthly" — ₹10000.00	{"amount": 10000, "bill_id": 143, "bill_no": "MSD-DRAFT-143", "service_id": 350, "service_name": "GST Return - Monthly"}	2026-04-22 12:36:38.368609+05:30
563	3	ADD_SERVICE	SERVICE	351	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 143, "bill_no": "MSD-DRAFT-143", "service_id": 351, "service_name": "GST Return - Monthly"}	2026-04-22 12:36:38.591518+05:30
564	3	FINALIZE_BILL	BILL	124	Total ₹32450.00	{"bill_id": 124, "bill_no": "MSD/2627/003", "total_invoice_value": "32450.00"}	2026-04-22 12:36:51.160919+05:30
565	3	MARK_PAYMENT	PAYMENT	43	Payment received — ₹32450.00 via UPI	{"bill_id": 124, "bill_no": "MSD/2627/003", "payment_id": 43, "amount_paid": 32450, "payment_date": "2026-04-20", "payment_mode": "UPI"}	2026-04-22 12:37:39.090367+05:30
566	3	UPDATE_BILL	BILL	143	Updated bill #MSD-DRAFT-143	{"bill_id": 143, "bill_no": "MSD-DRAFT-143", "override_edit": false}	2026-04-22 12:43:41.128877+05:30
567	3	ADD_SERVICE	SERVICE	354	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 143, "bill_no": "MSD-DRAFT-143", "service_id": 354, "service_name": "GST Return - Monthly"}	2026-04-22 12:43:41.147+05:30
568	3	ADD_SERVICE	SERVICE	355	Added "GST Returns - Quarterly" — ₹1500.00	{"amount": 1500, "bill_id": 143, "bill_no": "MSD-DRAFT-143", "service_id": 355, "service_name": "GST Returns - Quarterly"}	2026-04-22 12:43:41.147229+05:30
569	3	ADD_SERVICE	SERVICE	356	Added "GST Return - Monthly" — ₹11250.00	{"amount": 11250, "bill_id": 143, "bill_no": "MSD-DRAFT-143", "service_id": 356, "service_name": "GST Return - Monthly"}	2026-04-22 12:43:41.320933+05:30
570	3	ADD_SERVICE	SERVICE	357	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 143, "bill_no": "MSD-DRAFT-143", "service_id": 357, "service_name": "GST Return - Monthly"}	2026-04-22 12:43:41.542221+05:30
571	3	ADD_SERVICE	SERVICE	358	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 143, "bill_no": "MSD-DRAFT-143", "service_id": 358, "service_name": "GST Return - Monthly"}	2026-04-22 12:43:41.56094+05:30
572	3	ADD_SERVICE	SERVICE	359	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 143, "bill_no": "MSD-DRAFT-143", "service_id": 359, "service_name": "GST Return - Monthly"}	2026-04-22 12:43:41.775795+05:30
573	3	ADD_SERVICE	SERVICE	361	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 143, "bill_no": "MSD-DRAFT-143", "service_id": 361, "service_name": "GST Return - Monthly"}	2026-04-22 12:43:41.902306+05:30
574	3	ADD_SERVICE	SERVICE	360	Added "GST Return - Monthly" — ₹15000.00	{"amount": 15000, "bill_id": 143, "bill_no": "MSD-DRAFT-143", "service_id": 360, "service_name": "GST Return - Monthly"}	2026-04-22 12:43:41.906462+05:30
575	3	ADD_SERVICE	SERVICE	362	Added "GST Annual Return" — ₹10000.00	{"amount": 10000, "bill_id": 143, "bill_no": "MSD-DRAFT-143", "service_id": 362, "service_name": "GST Annual Return"}	2026-04-22 12:43:42.1173+05:30
576	3	FINALIZE_BILL	BILL	141	Total ₹96000.00	{"bill_id": 141, "bill_no": "URJ/2627/006", "total_invoice_value": "96000.00"}	2026-05-02 12:38:07.808762+05:30
577	3	MARK_PAYMENT	PAYMENT	44	Payment received — ₹96000.00 via NEFT	{"bill_id": 141, "bill_no": "URJ/2627/006", "payment_id": 44, "amount_paid": 96000, "payment_date": "2026-04-30", "payment_mode": "NEFT"}	2026-05-02 12:38:56.734759+05:30
580	\N	CREATE_USER	USER	5	Created user "AMIT" with role CA (self-registered, pending approval)	{"role": "CA", "username": "AMIT", "is_approved": false, "new_user_id": 5}	2026-05-07 18:16:14.632117+05:30
581	3	APPROVE_USER	USER	5	Approved user "AMIT" (CA)	{"username": "AMIT", "target_user_id": 5}	2026-05-07 18:16:55.557401+05:30
582	5	CREATE_BILL	BILL	144	Created bill #MSD-DRAFT-144 (2026-27)	{"bill_id": 144, "bill_no": "MSD-DRAFT-144", "financial_year": "2026-27"}	2026-05-07 18:21:15.958934+05:30
583	5	ADD_SERVICE	SERVICE	363	Added "Certificate" — ₹1000.00	{"amount": 1000, "bill_id": 144, "bill_no": "MSD-DRAFT-144", "service_id": 363, "service_name": "Certificate"}	2026-05-07 18:21:15.963816+05:30
584	5	ADD_SERVICE	SERVICE	364	Added "Certificate" — ₹1000.00	{"amount": 1000, "bill_id": 144, "bill_no": "MSD-DRAFT-144", "service_id": 364, "service_name": "Certificate"}	2026-05-07 18:21:16.110614+05:30
585	5	ADD_SERVICE	SERVICE	365	Added "Other Professional Services" — ₹2000.00	{"amount": 2000, "bill_id": 144, "bill_no": "MSD-DRAFT-144", "service_id": 365, "service_name": "Other Professional Services"}	2026-05-07 18:21:16.177619+05:30
586	5	CREATE_BILL	BILL	145	Created bill #MSD-DRAFT-145 (2025-26)	{"bill_id": 145, "bill_no": "MSD-DRAFT-145", "financial_year": "2025-26"}	2026-05-07 18:27:44.532164+05:30
587	5	ADD_SERVICE	SERVICE	366	Added "Certificate" — ₹3000.00	{"amount": 3000, "bill_id": 145, "bill_no": "MSD-DRAFT-145", "service_id": 366, "service_name": "Certificate"}	2026-05-07 18:27:44.537379+05:30
588	5	CREATE_BILL	BILL	146	Created bill #MSD-DRAFT-146 (2026-27)	{"bill_id": 146, "bill_no": "MSD-DRAFT-146", "financial_year": "2026-27"}	2026-05-07 18:33:13.83935+05:30
589	5	ADD_SERVICE	SERVICE	367	Added "Certificate" — ₹1500.00	{"amount": 1500, "bill_id": 146, "bill_no": "MSD-DRAFT-146", "service_id": 367, "service_name": "Certificate"}	2026-05-07 18:33:13.843663+05:30
590	5	CREATE_BILL	BILL	147	Created bill #URJ-DRAFT-147 (2025-26)	{"bill_id": 147, "bill_no": "URJ-DRAFT-147", "financial_year": "2025-26"}	2026-05-07 18:34:31.147687+05:30
591	5	ADD_SERVICE	SERVICE	368	Added "Professional Services" — ₹500.00	{"amount": 500, "bill_id": 147, "bill_no": "URJ-DRAFT-147", "service_id": 368, "service_name": "Professional Services"}	2026-05-07 18:34:31.152489+05:30
592	5	CREATE_BILL	BILL	148	Created bill #MSD-DRAFT-148 (2025-26)	{"bill_id": 148, "bill_no": "MSD-DRAFT-148", "financial_year": "2025-26"}	2026-05-07 18:41:18.692083+05:30
593	5	ADD_SERVICE	SERVICE	369	Added "Certificate" — ₹1500.00	{"amount": 1500, "bill_id": 148, "bill_no": "MSD-DRAFT-148", "service_id": 369, "service_name": "Certificate"}	2026-05-07 18:41:18.697076+05:30
594	5	CREATE_BILL	BILL	149	Created bill #MSD-DRAFT-149 (2025-26)	{"bill_id": 149, "bill_no": "MSD-DRAFT-149", "financial_year": "2025-26"}	2026-05-07 18:42:40.292401+05:30
595	5	ADD_SERVICE	SERVICE	370	Added "Certificate" — ₹2000.00	{"amount": 2000, "bill_id": 149, "bill_no": "MSD-DRAFT-149", "service_id": 370, "service_name": "Certificate"}	2026-05-07 18:42:40.297611+05:30
596	5	CREATE_BILL	BILL	150	Created bill #URJ-DRAFT-150 (2026-27)	{"bill_id": 150, "bill_no": "URJ-DRAFT-150", "financial_year": "2026-27"}	2026-05-07 18:45:04.076586+05:30
597	5	ADD_SERVICE	SERVICE	371	Added "Preparation of Project Report/CMA" — ₹5000.00	{"amount": 5000, "bill_id": 150, "bill_no": "URJ-DRAFT-150", "service_id": 371, "service_name": "Preparation of Project Report/CMA"}	2026-05-07 18:45:04.080219+05:30
598	5	CREATE_BILL	BILL	151	Created bill #MSD-DRAFT-151 (2026-27)	{"bill_id": 151, "bill_no": "MSD-DRAFT-151", "financial_year": "2026-27"}	2026-05-07 18:46:04.469195+05:30
599	5	ADD_SERVICE	SERVICE	372	Added "Other Professional Services" — ₹1500.00	{"amount": 1500, "bill_id": 151, "bill_no": "MSD-DRAFT-151", "service_id": 372, "service_name": "Other Professional Services"}	2026-05-07 18:46:04.472844+05:30
600	3	RESET_PASSWORD	USER	2	Admin reset password for user id 2	{"target_user_id": 2}	2026-05-08 10:58:14.065695+05:30
601	2	CREATE_BILL	BILL	152	Created bill #MSD-DRAFT-152 (2026-27)	{"bill_id": 152, "bill_no": "MSD-DRAFT-152", "financial_year": "2026-27"}	2026-05-08 10:59:16.619501+05:30
602	2	ADD_SERVICE	SERVICE	373	Added "Professional Services" — ₹1500.00	{"amount": 1500, "bill_id": 152, "bill_no": "MSD-DRAFT-152", "service_id": 373, "service_name": "Professional Services"}	2026-05-08 10:59:16.626038+05:30
603	2	CREATE_BILL	BILL	153	Created bill #MSD-DRAFT-153 (2026-27)	{"bill_id": 153, "bill_no": "MSD-DRAFT-153", "financial_year": "2026-27"}	2026-05-08 11:09:03.544585+05:30
604	2	ADD_SERVICE	SERVICE	374	Added "Other Professional Services" — ₹3000.00	{"amount": 3000, "bill_id": 153, "bill_no": "MSD-DRAFT-153", "service_id": 374, "service_name": "Other Professional Services"}	2026-05-08 11:09:03.548621+05:30
605	2	CREATE_BILL	BILL	154	Created bill #MSD-DRAFT-154 (2026-27)	{"bill_id": 154, "bill_no": "MSD-DRAFT-154", "financial_year": "2026-27"}	2026-05-08 12:36:13.303081+05:30
606	2	ADD_SERVICE	SERVICE	375	Added "Other Professional Services" — ₹3000.00	{"amount": 3000, "bill_id": 154, "bill_no": "MSD-DRAFT-154", "service_id": 375, "service_name": "Other Professional Services"}	2026-05-08 12:36:13.308258+05:30
607	2	CREATE_BILL	BILL	155	Created bill #URJ-DRAFT-155 (2026-27)	{"bill_id": 155, "bill_no": "URJ-DRAFT-155", "financial_year": "2026-27"}	2026-05-08 12:39:29.971764+05:30
608	2	ADD_SERVICE	SERVICE	376	Added "Other Professional Services" — ₹10000.00	{"amount": 10000, "bill_id": 155, "bill_no": "URJ-DRAFT-155", "service_id": 376, "service_name": "Other Professional Services"}	2026-05-08 12:39:29.977347+05:30
609	2	CREATE_BILL	BILL	156	Created bill #URJ-DRAFT-156 (2026-27)	{"bill_id": 156, "bill_no": "URJ-DRAFT-156", "financial_year": "2026-27"}	2026-05-08 12:40:35.254578+05:30
610	2	ADD_SERVICE	SERVICE	377	Added "Other Professional Services" — ₹30000.00	{"amount": 30000, "bill_id": 156, "bill_no": "URJ-DRAFT-156", "service_id": 377, "service_name": "Other Professional Services"}	2026-05-08 12:40:35.258796+05:30
611	2	CREATE_BILL	BILL	157	Created bill #URJ-DRAFT-157 (2026-27)	{"bill_id": 157, "bill_no": "URJ-DRAFT-157", "financial_year": "2026-27"}	2026-05-08 12:41:10.450548+05:30
612	2	ADD_SERVICE	SERVICE	378	Added "Other Professional Services" — ₹15000.00	{"amount": 15000, "bill_id": 157, "bill_no": "URJ-DRAFT-157", "service_id": 378, "service_name": "Other Professional Services"}	2026-05-08 12:41:10.452596+05:30
613	2	CREATE_BILL	BILL	158	Created bill #URJ-DRAFT-158 (2026-27)	{"bill_id": 158, "bill_no": "URJ-DRAFT-158", "financial_year": "2026-27"}	2026-05-08 12:41:36.814028+05:30
614	2	ADD_SERVICE	SERVICE	379	Added "Other Professional Services" — ₹15000.00	{"amount": 15000, "bill_id": 158, "bill_no": "URJ-DRAFT-158", "service_id": 379, "service_name": "Other Professional Services"}	2026-05-08 12:41:36.818702+05:30
615	3	CREATE_BILL	BILL	159	Created bill #MSD-DRAFT-159 (2026-27)	{"bill_id": 159, "bill_no": "MSD-DRAFT-159", "financial_year": "2026-27"}	2026-05-09 11:51:39.513796+05:30
616	3	ADD_SERVICE	SERVICE	380	Added "Income Tax Audit , Income Tax Return, GST Reconciliation , Account Finalisation and other services" — ₹25000.00	{"amount": 25000, "bill_id": 159, "bill_no": "MSD-DRAFT-159", "service_id": 380, "service_name": "Income Tax Audit , Income Tax Return, GST Reconciliation , Account Finalisation and other services"}	2026-05-09 11:51:39.521074+05:30
617	3	ADD_SERVICE	SERVICE	382	Added "Income Tax Return, Account Finalisation" — ₹6000.00	{"amount": 6000, "bill_id": 159, "bill_no": "MSD-DRAFT-159", "service_id": 382, "service_name": "Income Tax Return, Account Finalisation"}	2026-05-09 11:51:39.728124+05:30
618	3	ADD_SERVICE	SERVICE	381	Added "Income Tax Audit , Income Tax Return, GST Reconciliation , Account Finalisation and other services" — ₹25000.00	{"amount": 25000, "bill_id": 159, "bill_no": "MSD-DRAFT-159", "service_id": 381, "service_name": "Income Tax Audit , Income Tax Return, GST Reconciliation , Account Finalisation and other services"}	2026-05-09 11:51:39.750018+05:30
619	3	ADD_SERVICE	SERVICE	383	Added "Income Tax Return, Account Finalisation" — ₹6000.00	{"amount": 6000, "bill_id": 159, "bill_no": "MSD-DRAFT-159", "service_id": 383, "service_name": "Income Tax Return, Account Finalisation"}	2026-05-09 11:51:39.914+05:30
620	3	ADD_SERVICE	SERVICE	385	Added "TDS Returns" — ₹9000.00	{"amount": 9000, "bill_id": 159, "bill_no": "MSD-DRAFT-159", "service_id": 385, "service_name": "TDS Returns"}	2026-05-09 11:51:39.989381+05:30
621	3	ADD_SERVICE	SERVICE	384	Added "TDS Returns" — ₹9000.00	{"amount": 9000, "bill_id": 159, "bill_no": "MSD-DRAFT-159", "service_id": 384, "service_name": "TDS Returns"}	2026-05-09 11:51:40.003158+05:30
622	3	ADD_SERVICE	SERVICE	387	Added "Income Tax Return, Account Finalisation" — ₹3000.00	{"amount": 3000, "bill_id": 159, "bill_no": "MSD-DRAFT-159", "service_id": 387, "service_name": "Income Tax Return, Account Finalisation"}	2026-05-09 11:51:40.075952+05:30
623	3	ADD_SERVICE	SERVICE	388	Added "Income Tax Return, Account Finalisation" — ₹3000.00	{"amount": 3000, "bill_id": 159, "bill_no": "MSD-DRAFT-159", "service_id": 388, "service_name": "Income Tax Return, Account Finalisation"}	2026-05-09 11:51:40.250908+05:30
624	3	ADD_SERVICE	SERVICE	386	Added "Income Tax Return, Account Finalisation" — ₹3000.00	{"amount": 3000, "bill_id": 159, "bill_no": "MSD-DRAFT-159", "service_id": 386, "service_name": "Income Tax Return, Account Finalisation"}	2026-05-09 11:51:40.257764+05:30
625	3	ADD_SERVICE	SERVICE	389	Added "Income Tax Return, Account Finalisation" — ₹7500.00	{"amount": 7500, "bill_id": 159, "bill_no": "MSD-DRAFT-159", "service_id": 389, "service_name": "Income Tax Return, Account Finalisation"}	2026-05-09 11:51:40.336143+05:30
626	3	UPDATE_USER	USER	5	Updated user "AMIT" (CA)	{"username": "AMIT", "target_user_id": 5}	2026-05-23 15:00:29.115742+05:30
\.


--
-- Data for Name: bill_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bill_history (id, bill_id, action_type, action_by, recipient_email, recipient_phone, action_timestamp, status, error_message) FROM stdin;
\.


--
-- Data for Name: bill_merges; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bill_merges (id, merged_bill_id, source_bill_id, merged_at, merged_by) FROM stdin;
\.


--
-- Data for Name: bill_number_counters; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bill_number_counters (id, header_id, financial_year, last_number, prefix, created_at, updated_at) FROM stdin;
35	1	2627	3	MSD	2026-04-01 18:57:56.355788	2026-04-22 12:36:51.146848
65	4	2627	8	URJ	2026-04-03 17:43:13.058551	2026-05-02 12:39:06.836375
28	8	2627	1	CA.	2026-04-01 17:14:33.341192	2026-04-01 17:14:33.341192
1	1	2526	37	MSD	2026-03-16 21:11:17.00157	2026-04-01 20:00:32.884438
10	3	2526	5	URJ	2026-03-28 16:23:08.700143	2026-04-02 12:24:57.265204
\.


--
-- Data for Name: bill_number_sequence; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bill_number_sequence (id, financial_year, last_sequence, updated_at) FROM stdin;
\.


--
-- Data for Name: bill_payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bill_payments (id, bill_id, payment_date, amount_paid, notes, recorded_by, created_at, payment_mode, cheque_no, utr, cash_collected_by, received_in_account_id, updated_at) FROM stdin;
6	34	2026-03-28	50000.00	\N	3	2026-03-28 16:23:40.187624	NEFT	\N	FT602283900137	\N	3	2026-03-28 16:23:40.187624
7	33	2026-02-28	38350.00	\N	3	2026-03-28 16:24:11.412028	NEFT	\N	FT602283902045	\N	3	2026-03-28 16:24:11.412028
9	39	2026-03-09	100300.00	\N	3	2026-03-28 17:53:46.048275	CHEQUE	\N	\N	\N	1	2026-03-28 17:53:46.048275
10	43	2026-03-04	29500.00	\N	3	2026-03-28 18:19:57.527422	CHEQUE	221529	\N	\N	1	2026-03-28 18:19:57.527422
11	44	2026-03-04	20000.00	\N	3	2026-03-28 18:21:00.454307	NEFT	\N	\N	\N	3	2026-03-28 18:21:00.454307
12	45	2026-03-12	90860.00	\N	3	2026-03-28 18:31:52.586376	CHEQUE	\N	\N	\N	1	2026-03-28 18:31:52.586376
13	46	2025-11-14	11800.00	\N	3	2026-03-28 18:45:31.667586	CHEQUE	\N	\N	\N	1	2026-03-28 18:45:31.667586
14	47	2025-11-14	11000.00	\N	3	2026-03-28 18:46:19.673703	NEFT	\N	\N	\N	3	2026-03-28 18:46:19.673703
15	48	2026-03-12	31860.00	\N	3	2026-03-28 18:52:38.174891	NEFT	\N	\N	\N	1	2026-03-28 18:52:38.174891
16	28	2026-03-30	41300.00	\N	3	2026-03-31 10:50:33.876786	NEFT	\N	\N	\N	1	2026-03-31 10:50:33.876786
17	50	2026-03-30	53100.00	\N	3	2026-03-31 10:52:19.851223	NEFT	\N	\N	\N	1	2026-03-31 10:52:19.851223
18	49	2026-03-31	208860.00	\N	3	2026-03-31 10:57:21.670382	NEFT	\N	\N	\N	1	2026-03-31 10:57:21.670382
19	19	2026-03-31	162840.00	\N	3	2026-03-31 10:57:56.574322	NEFT	\N	\N	\N	1	2026-03-31 10:57:56.574322
20	23	2026-03-31	195880.00	\N	3	2026-03-31 10:58:07.806937	NEFT	\N	\N	\N	1	2026-03-31 10:58:07.806937
21	24	2026-03-31	212400.00	\N	3	2026-03-31 10:58:12.256672	NEFT	\N	\N	\N	1	2026-03-31 10:58:12.256672
22	18	2026-03-26	354000.00	12014 bal jv	3	2026-03-31 11:05:00.415738	NEFT	\N	\N	\N	1	2026-03-31 11:05:00.415738
23	57	2026-03-04	70800.00	\N	3	2026-03-31 18:00:12.953623	NEFT	\N	\N	\N	1	2026-03-31 18:00:12.953623
24	59	2026-03-24	59000.00	\N	3	2026-04-01 17:16:27.488116	UPI	\N	608378394964	\N	1	2026-04-01 17:16:27.488116
25	58	2026-03-24	7500.00	\N	3	2026-04-01 17:16:59.236178	UPI	\N	608377378879	\N	8	2026-04-01 17:16:59.236178
26	67	2026-02-16	17700.00	\N	3	2026-04-01 18:27:42.051032	CHEQUE	001484	\N	\N	9	2026-04-01 18:27:42.051032
27	69	2025-11-29	84665.00	\N	3	2026-04-01 18:34:57.731042	NEFT	\N	\N	\N	1	2026-04-01 18:34:57.731042
28	70	2026-02-07	15930.00	\N	3	2026-04-01 18:38:09.228983	NEFT	\N	HCBLH60381203408	\N	1	2026-04-01 18:38:09.228983
8	35	2025-11-05	472000.00	\N	3	2026-03-28 16:28:18.865771	NEFT	\N	\N	\N	1	2026-04-01 18:40:39.031583
29	71	2025-09-09	21240.00	\N	3	2026-04-01 18:42:11.616737	NEFT	\N	\N	\N	1	2026-04-01 18:42:11.616737
30	72	2025-12-10	19800.40	\N	3	2026-04-01 18:54:29.657983	NEFT	\N	\N	\N	1	2026-04-01 18:54:29.657983
31	74	2025-10-26	19470.00	\N	3	2026-04-01 18:58:13.11297	NEFT	\N	\N	\N	1	2026-04-01 18:58:13.11297
32	76	2026-03-28	20060.00	\N	3	2026-04-01 19:02:05.865394	UPI	\N	HDFC1342F2062B4B	\N	1	2026-04-01 19:02:05.865394
33	78	2025-09-10	21240.00	\N	3	2026-04-01 19:08:29.533659	NEFT	\N	\N	\N	1	2026-04-01 19:09:57.338873
34	79	2026-02-04	18290.00	\N	3	2026-04-01 19:14:22.776011	NEFT	\N	\N	\N	1	2026-04-01 19:14:22.776011
35	80	2026-02-17	17700.00	\N	3	2026-04-01 19:19:25.341901	CHEQUE	001215	\N	\N	9	2026-04-01 19:19:25.341901
36	82	2026-03-16	38350.00	\N	3	2026-04-01 19:27:19.454021	NEFT	\N	SBIN226075290809	\N	1	2026-04-01 19:27:19.454021
37	87	2026-01-19	23600.00	\N	3	2026-04-01 19:57:54.09117	NEFT	\N	\N	\N	1	2026-04-01 19:57:54.09117
38	88	2026-02-17	38940.00	\N	3	2026-04-01 20:01:17.890202	CHEQUE	004056	\N	\N	9	2026-04-01 20:01:17.890202
39	86	2026-02-17	25960.00	\N	3	2026-04-01 20:01:38.665331	CHEQUE	221359	\N	\N	9	2026-04-01 20:01:38.665331
40	91	2026-03-16	25000.00	\N	3	2026-04-02 12:16:16.343329	UPI	\N	767189287373	\N	3	2026-04-02 12:16:16.343329
41	92	2026-03-18	10500.00	\N	3	2026-04-02 12:25:11.445263	CHEQUE	\N	\N	\N	3	2026-04-02 12:25:11.445263
42	115	2026-04-06	2500.00	\N	3	2026-04-06 17:30:26.152465	CASH	\N	\N	Urja	\N	2026-04-06 17:30:26.152465
43	124	2026-04-20	32450.00	\N	3	2026-04-22 12:37:38.916032	UPI	\N	611012939832	\N	1	2026-04-22 12:37:38.916032
44	141	2026-04-30	96000.00	\N	3	2026-05-02 12:38:56.468278	NEFT	\N	\N	\N	3	2026-05-02 12:38:56.468278
\.


--
-- Data for Name: bill_services; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bill_services (id, bill_id, sr_no, particulars_id, particulars_other, service_date, service_year, amount, gst_rate_id, gst_amount, created_at, description) FROM stdin;
119	49	1	16	\N	\N	2024-25	50000.00	1	9000.00	2026-03-30 16:06:09.271711	Income Tax Audit , GST Audit , GST Annual Return, Company Audit
120	49	2	16	\N	\N	2024-25	10000.00	1	1800.00	2026-03-30 16:06:09.271711	Income Tax Return
121	49	3	4	\N	\N	2024-25	42000.00	1	7560.00	2026-03-30 16:06:09.271711	Maharashtra - 12 Returns 
122	49	4	4	\N	\N	2024-25	30000.00	1	5400.00	2026-03-30 16:06:09.271711	Raipur - 12 Returns
123	49	5	12	\N	\N	2024-25	4000.00	1	720.00	2026-03-30 16:06:09.271711	Gujarat
124	49	6	10	\N	\N	2024-25	16000.00	1	2880.00	2026-03-30 16:06:09.271711	4 Returns 26Q - Quarterly and 4 Returns 24Q - Quarterly
125	49	7	9	\N	\N	2024-25	25000.00	1	4500.00	2026-03-30 16:06:09.271711	SUBMISSION TO NOTICE OF ADT 1 - 2021-22
126	50	1	4	\N	\N	2022-23	15000.00	1	2700.00	2026-03-31 10:52:01.417835	\N
127	50	2	4	\N	\N	2023-24	15000.00	1	2700.00	2026-03-31 10:52:01.417835	\N
128	50	3	4	\N	\N	2024-25	15000.00	1	2700.00	2026-03-31 10:52:01.417835	\N
145	51	1	1	\N	\N	2023-24	15000.00	1	2700.00	2026-03-31 17:08:55.252173	Turnover - 99.06 Lakhs
146	51	2	2	\N	\N	2023-24	3000.00	1	540.00	2026-03-31 17:08:55.252173	Income Tax Return
147	51	3	1	\N	\N	2024-25	20000.00	1	3600.00	2026-03-31 17:08:55.252173	Turnover - 2.77 Crores
148	51	4	2	\N	\N	2024-25	5000.00	1	900.00	2026-03-31 17:08:55.252173	Income Tax Return
149	51	5	10	\N	\N	2024-25	1500.00	1	270.00	2026-03-31 17:08:55.252173	26Q - Q4
158	55	1	1	\N	\N	2024-25	16500.00	1	2970.00	2026-03-31 17:42:40.979748	\N
159	55	2	6	\N	\N	2024-25	16500.00	1	2970.00	2026-03-31 17:42:40.979748	\N
160	55	3	7	\N	\N	2024-25	16500.00	1	2970.00	2026-03-31 17:42:40.979748	\N
161	55	4	4	\N	\N	2024-25	33000.00	1	5940.00	2026-03-31 17:42:40.979748	12 Returns
162	55	5	2	\N	\N	2024-25	16500.00	1	2970.00	2026-03-31 17:42:40.979748	Sambhaji Natthu Chaudhari, Mahesh Chaudhari , Megha Chaudhari
163	55	6	10	\N	\N	2024-25	13200.00	1	2376.00	2026-03-31 17:42:40.979748	27EQ -4 Returns , 26Q - 4 Returns
167	17	4	2	\N	2026-03-24	2024-25	20000.00	1	3600.00	2026-03-31 17:45:35.104897	Partners Revised Return\n4 Returns
168	57	1	16	\N	\N	2024-25	60000.00	1	10800.00	2026-03-31 17:59:37.11998	\N
170	58	1	1	\N	\N	2024-25	7500.00	5	0.00	2026-04-01 17:15:06.335191	\N
171	59	1	16	\N	\N	2024-25	50000.00	1	9000.00	2026-04-01 17:15:53.662511	\N
172	60	1	1	\N	\N	2024-25	15000.00	1	2700.00	2026-04-01 17:44:17.721179	\N
173	61	1	1	\N	\N	2022-23	45000.00	1	8100.00	2026-04-01 17:48:06.538717	\N
174	61	2	1	\N	\N	2023-24	45000.00	1	8100.00	2026-04-01 17:48:06.538717	\N
175	61	3	1	\N	\N	2024-25	45000.00	1	8100.00	2026-04-01 17:48:06.538717	\N
176	61	4	16	\N	\N	\N	55000.00	1	9900.00	2026-04-01 17:48:06.538717	Old Professional Fees Difference
177	62	1	2	\N	\N	2022-23	7500.00	1	1350.00	2026-04-01 17:53:48.914644	\N
178	62	2	2	\N	\N	2023-24	7500.00	1	1350.00	2026-04-01 17:53:48.914644	\N
179	62	3	2	\N	\N	2024-25	7500.00	1	1350.00	2026-04-01 17:53:48.914644	\N
180	63	1	16	\N	\N	2024-25	30000.00	1	5400.00	2026-04-01 17:57:22.850075	Income Tax Audit Income Tax Return , GST Reconciliation ,\nAccount Finalisation and other services
181	64	1	16	\N	\N	2024-25	60000.00	5	0.00	2026-04-01 18:04:27.824494	Account Writing, Income Tax Audit, Income Tax Return, Account Finalisation
182	65	1	16	\N	\N	2024-25	40000.00	5	0.00	2026-04-01 18:05:34.454442	Account Writing, Income Tax Return, Account Finalisation
183	66	1	16	\N	\N	2024-25	62000.00	1	11160.00	2026-04-01 18:09:08.453416	Income Tax Audit Income Tax Return , GST Reconciliation ,\nAccount Finalisation and other services
184	67	1	16	\N	\N	2024-25	15000.00	1	2700.00	2026-04-01 18:12:57.918994	Income Tax Audit ,Income Tax Returns,  Account Finalisation\nand other services
185	68	1	1	\N	\N	2023-24	25000.00	1	4500.00	2026-04-01 18:32:16.319534	\N
186	68	2	1	\N	\N	2024-25	25000.00	1	4500.00	2026-04-01 18:32:16.319534	\N
187	68	3	2	\N	\N	2023-24	5000.00	1	900.00	2026-04-01 18:32:16.319534	\N
188	68	4	2	\N	\N	2024-25	5000.00	1	900.00	2026-04-01 18:32:16.319534	\N
189	68	5	12	\N	\N	\N	5000.00	1	900.00	2026-04-01 18:32:16.319534	14/01/2024
190	68	6	4	\N	\N	2023-24	4500.00	1	810.00	2026-04-01 18:32:16.319534	3 RETURNS
191	68	7	4	\N	\N	2024-25	18000.00	1	3240.00	2026-04-01 18:32:16.319534	12 RETURNS
192	68	8	12	\N	\N	\N	5000.00	1	900.00	2026-04-01 18:32:16.319534	GST TDS REGISTRATION - 08/09/2023
193	68	9	4	\N	\N	2023-24	10500.00	1	1890.00	2026-04-01 18:32:16.319534	7 GST TDS RETURNS
194	68	10	4	\N	\N	2024-25	18000.00	1	3240.00	2026-04-01 18:32:16.319534	12 GST TDS RETURNS
195	68	11	10	\N	\N	2024-25	3000.00	1	540.00	2026-04-01 18:32:16.319534	INCOME TAX TDS RETURNS - 2 RETURNS
196	69	1	10	\N	\N	2024-25	13750.00	1	2475.00	2026-04-01 18:34:23.964433	24Q - 1 Quarter  \n26Q- 4 Quarters
197	69	2	4	\N	\N	2024-25	36000.00	1	6480.00	2026-04-01 18:34:23.964433	GSTR 1- Monthly -12 Returns  \nGSTR 3B -Monthly -12 Returns
198	69	3	2	\N	\N	2024-25	10000.00	1	1800.00	2026-04-01 18:34:23.964433	\N
199	69	4	6	\N	\N	2024-25	12000.00	1	2160.00	2026-04-01 18:34:23.964433	\N
200	70	1	16	\N	\N	2024-25	13500.00	1	2430.00	2026-04-01 18:37:23.07052	\N
201	71	1	16	\N	\N	2024-25	18000.00	1	3240.00	2026-04-01 18:41:41.279118	Accounting\nIncome Tax Return Preparation\nGST Returns - Monthly
202	72	1	16	\N	\N	2024-25	16780.00	1	3020.40	2026-04-01 18:53:50.798331	\N
204	74	1	1	\N	\N	2024-25	16500.00	1	2970.00	2026-04-01 18:57:04.263719	\N
206	76	1	1	\N	\N	2024-25	17000.00	1	3060.00	2026-04-01 19:02:18.42427	\N
2	2	1	1	\N	2026-03-15	2025-26	10.00	1	1.80	2026-03-16 21:13:44.471612	\N
3	3	1	2	\N	2026-03-16	2024-25	10.00	1	1.80	2026-03-17 16:37:06.37023	\N
15	13	1	14	\N	2026-03-22	2025-26	10.00	1	1.80	2026-03-23 12:41:49.974863	\N
16	13	2	14	\N	2026-03-10	2025-26	15.00	1	2.70	2026-03-23 12:41:49.974863	\N
17	14	1	8	\N	2026-03-09	2025-26	1500.00	1	270.00	2026-03-23 12:42:14.671646	\N
207	77	1	16	\N	\N	2024-25	16000.00	1	2880.00	2026-04-01 19:05:55.194621	Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services
209	78	1	16	\N	\N	2024-25	18000.00	1	3240.00	2026-04-01 19:09:37.322457	Accounting\nIncome Tax Return Preparation\nGST Returns - Monthly
210	79	1	1	\N	\N	2024-25	15500.00	1	2790.00	2026-04-01 19:13:58.65236	\N
211	80	1	16	\N	\N	2024-25	15000.00	1	2700.00	2026-04-01 19:17:27.904743	Income Tax Audit , Income Tax Return, Account Finalisation\nand other services
212	81	1	16	\N	\N	2024-25	35000.00	1	6300.00	2026-04-01 19:22:52.220808	Income Tax Audit ,Income Tax Return,  GST Reconciliation ,\nAccount Finalisation and other services
28	18	1	14	\N	2026-03-25	2024-25	300000.00	1	54000.00	2026-03-26 13:19:05.591817	2024-25
29	19	1	4	\N	\N	2024-25	108000.00	1	19440.00	2026-03-28 12:41:57.05863	MAHARASHTRA - 12 RETURNS
30	19	2	4	\N	\N	2024-25	30000.00	1	5400.00	2026-03-28 12:41:57.05863	RAIPUR - 12 RETURNS
32	23	1	4	\N	\N	2024-25	132000.00	1	23760.00	2026-03-28 12:45:27.927932	MAHARASHTRA - 12 RETURNS
33	23	2	4	\N	\N	2024-25	30000.00	1	5400.00	2026-03-28 12:45:27.927932	RAIPUR - 12 RETURNS
34	23	3	4	\N	\N	2024-25	4000.00	1	720.00	2026-03-28 12:45:27.927932	GUJARAT - 2 RETURNS
37	24	1	4	\N	\N	2024-25	132000.00	1	23760.00	2026-03-28 12:47:18.792648	MAHARASHTRA - 12 RETURNS
38	24	2	4	\N	\N	2024-25	30000.00	1	5400.00	2026-03-28 12:47:18.792648	RAIPUR - 12 RETURNS
39	24	3	4	\N	\N	2024-25	18000.00	1	3240.00	2026-03-28 12:47:18.792648	GUJARAT - 2 RETURNS
40	25	1	1	\N	\N	2024-25	14000.00	1	2520.00	2026-03-28 12:52:59.487433	\N
41	25	2	14	\N	\N	2023-24	2000.00	1	360.00	2026-03-28 12:52:59.487433	PREVIOUS OUTSTANDING
42	26	1	1	\N	\N	2024-25	35000.00	1	6300.00	2026-03-28 12:58:36.076076	\N
51	28	1	1	\N	\N	2024-25	30000.00	1	5400.00	2026-03-28 13:13:13.972006	\N
52	28	2	9	\N	\N	2024-25	5000.00	1	900.00	2026-03-28 13:13:13.972006	2021-22
53	29	1	14	\N	\N	2024-25	55000.00	1	9900.00	2026-03-28 15:44:47.989428	Income Tax Audit \nIncome Tax Return\nGST Returns\nTDS Returns\nGST Annual Return\nGST Audit
54	29	2	14	\N	2025-07-12	2024-25	2500.00	1	450.00	2026-03-28 15:44:47.989428	Turnover Certificate
55	29	3	14	\N	2026-03-13	2024-25	1500.00	1	270.00	2026-03-28 15:44:47.989428	TDS OLD DEMAND RESOLUTION
56	30	1	16	\N	\N	2024-25	55000.00	1	9900.00	2026-03-28 15:52:18.858044	Income Tax Audit \nIncome Tax Return\nAccount Finalisation
58	31	1	16	\N	\N	2024-25	55000.00	1	9900.00	2026-03-28 16:08:03.364083	Income Tax Audit,\nIncome Tax Return,\nGST Returns - Monthly,\nTDS Returns,\nGST Annual Return ( GSTR 9 and 9C )\n
59	32	1	16	\N	\N	2024-25	55000.00	1	9900.00	2026-03-28 16:10:40.86562	Income Tax Audit, Income Tax Return, GST Returns - Monthly, TDS Returns, GST Annual Return (GSTR 9 and GSTR 9C)
60	33	1	1	\N	\N	2024-25	25000.00	1	4500.00	2026-03-28 16:19:07.407879	\N
61	33	2	9	\N	\N	2024-25	7500.00	1	1350.00	2026-03-28 16:19:07.407879	2017-18
62	34	1	10	\N	\N	2024-25	15000.00	5	0.00	2026-03-28 16:23:00.717307	4 RETURNS 26Q AND 1 RETURN 24Q
63	34	2	4	\N	\N	2024-25	15000.00	5	0.00	2026-03-28 16:23:00.717307	\N
64	34	3	2	\N	\N	2024-25	20000.00	5	0.00	2026-03-28 16:23:00.717307	FAMILY - 5 ITR'S
65	35	1	16	\N	\N	2024-25	400000.00	1	72000.00	2026-03-28 16:27:56.170516	Income Tax Audit, GST Returns- GSTR 3B + GSTR 1, GST Annual Return + Audit , Other Consultancy, Certification & Other Attestation
66	36	1	16	\N	\N	2023-24	25000.00	1	4500.00	2026-03-28 17:38:47.24981	Income Tax Audit , Company Compliance
67	36	2	16	\N	\N	2024-25	25000.00	1	4500.00	2026-03-28 17:38:47.24981	Income Tax Audit , Company Compliance
68	36	3	10	\N	\N	2023-24	2500.00	1	450.00	2026-03-28 17:38:47.24981	26Q - 1
69	36	4	10	\N	\N	2024-25	7500.00	1	1350.00	2026-03-28 17:38:47.24981	26Q -1 , 27EQ - 2
70	36	5	5	\N	\N	2023-24	6000.00	1	1080.00	2026-03-28 17:38:47.24981	\N
71	36	6	5	\N	\N	2024-25	6000.00	1	1080.00	2026-03-28 17:38:47.24981	\N
72	36	7	6	\N	\N	2023-24	10000.00	1	1800.00	2026-03-28 17:38:47.24981	GSTR 9 AND GSTR 9C
73	36	8	6	\N	\N	2024-25	10000.00	1	1800.00	2026-03-28 17:38:47.24981	GSTR 9 AND GSTR 9C
76	37	1	2	\N	\N	2023-24	15000.00	5	0.00	2026-03-28 17:48:11.745651	NIMAD KHANDSARI SUGAR MILLS, DIVYAM P AGRAWAL, SEEMA MAYANK AGRAWAL, MAYANK AGRAWAL HUF, EKVIRA COTEX PRIVATE LIMITED
77	37	2	2	\N	\N	2024-25	15000.00	5	0.00	2026-03-28 17:48:11.745651	NIMAD KHANDSARI SUGAR MILLS, DIVYAM P AGRAWAL, SEEMA MAYANK AGRAWAL, MAYANK AGRAWAL HUF, EKVIRA COTEX PRIVATE LIMITED
78	38	1	16	\N	\N	2024-25	10000.00	5	0.00	2026-03-28 17:49:22.39516	Income Tax Audit, Income Tax Return
79	38	2	10	\N	\N	2024-25	2500.00	5	0.00	2026-03-28 17:49:22.39516	26Q- Q4
80	39	1	16	\N	\N	2024-25	85000.00	1	15300.00	2026-03-28 17:53:18.907437	\N
81	43	1	16	\N	\N	2024-25	25000.00	1	4500.00	2026-03-28 18:19:22.108246	\N
82	44	1	16	\N	\N	2024-25	20000.00	5	0.00	2026-03-28 18:20:27.167319	\N
83	27	1	14	\N	\N	2023-24	125000.00	1	22500.00	2026-03-28 18:23:10.044985	Income Tax Audit, Income Tax Return, GST Returns - Monthly, TDS Returns and Payments , GST Annual Return ( GSTR 9 and 9C )
84	27	2	14	\N	\N	2024-25	125000.00	1	22500.00	2026-03-28 18:23:10.044985	Income Tax Audit, Income Tax Return, GST Returns - Monthly, TDS Returns and Payments , GST Annual Return ( GSTR 9 and 9C )
85	27	3	9	\N	\N	2024-25	5000.00	1	900.00	2026-03-28 18:23:10.044985	2019-20
86	27	4	9	\N	\N	2024-25	25000.00	1	4500.00	2026-03-28 18:23:10.044985	2020-21
87	45	1	16	\N	\N	2024-25	77000.00	1	13860.00	2026-03-28 18:31:22.777714	\N
88	46	1	16	\N	\N	2024-25	10000.00	1	1800.00	2026-03-28 18:44:57.322902	\N
89	47	1	14	\N	\N	2024-25	11000.00	5	0.00	2026-03-28 18:46:04.396048	\N
90	48	1	16	\N	\N	2024-25	27000.00	1	4860.00	2026-03-28 18:52:09.934548	\N
139	52	1	1	\N	\N	2023-24	25000.00	1	4500.00	2026-03-31 17:02:45.877051	Turnover - 16.13 Crores
140	52	2	2	\N	\N	2023-24	5000.00	1	900.00	2026-03-31 17:02:45.877051	\N
141	52	3	10	\N	\N	2023-24	6000.00	1	1080.00	2026-03-31 17:02:45.877051	26Q - 4 Quarters
142	52	4	1	\N	\N	2024-25	25000.00	1	4500.00	2026-03-31 17:02:45.877051	Turnover - 14.53 Crores
143	52	5	2	\N	\N	2024-25	5000.00	1	900.00	2026-03-31 17:02:45.877051	\N
144	52	6	10	\N	\N	2024-25	4500.00	1	810.00	2026-03-31 17:02:45.877051	26Q - 3 Quarters
150	53	1	1	\N	\N	2023-24	15000.00	1	2700.00	2026-03-31 17:12:52.259311	Turnover - 1.19 Crores
151	53	2	2	\N	\N	2023-24	5000.00	1	900.00	2026-03-31 17:12:52.259311	\N
152	53	3	2	\N	\N	2024-25	7500.00	1	1350.00	2026-03-31 17:12:52.259311	Turnover - 62.50 Lakhs
153	53	4	10	\N	\N	2024-25	3000.00	1	540.00	2026-03-31 17:12:52.259311	26Q - 2 Quarters
156	54	1	2	\N	\N	2023-24	9000.00	5	0.00	2026-03-31 17:14:59.971171	6 - Family Returns
157	54	2	2	\N	\N	2024-25	9000.00	5	0.00	2026-03-31 17:14:59.971171	6 - Family Returns
164	17	1	1	\N	2026-03-24	2024-25	10000.00	1	1800.00	2026-03-31 17:45:35.104897	Megatech Solution Turnover - 1.68 Cr
165	17	2	2	\N	2026-03-24	2024-25	5000.00	1	900.00	2026-03-31 17:45:35.104897	Megatech Solutions
166	17	3	4	\N	2026-03-24	2024-25	15000.00	1	2700.00	2026-03-31 17:45:35.104897	12 Returns
213	82	1	1	\N	\N	2024-25	25000.00	1	4500.00	2026-04-01 19:26:15.268128	\N
214	82	2	11	Writing of Partnership Deed	\N	2024-25	7500.00	1	1350.00	2026-04-01 19:26:15.268128	\N
215	83	1	16	\N	\N	2023-24	15000.00	1	2700.00	2026-04-01 19:40:18.553663	INCOME TAX RETURN & ACCOUNTING\nRAJESH ASHOK VARMA,\nREENA RAJESH VARMA
216	83	2	16	\N	\N	2024-25	15000.00	1	2700.00	2026-04-01 19:40:18.553663	INCOME TAX RETURN & ACCOUNTING\nRAJESH ASHOK VARMA,\nREENA RAJESH VARMA
217	83	3	5	\N	\N	2023-24	6000.00	1	1080.00	2026-04-01 19:40:18.553663	\N
218	83	4	5	\N	\N	2024-25	6000.00	1	1080.00	2026-04-01 19:40:18.553663	\N
219	84	1	16	\N	\N	2024-25	17000.00	1	3060.00	2026-04-01 19:41:44.827191	Income Tax Audit ,Income Tax Return,\nAccount Finalisation and other services
220	85	1	16	\N	\N	2020-21	30500.00	1	5490.00	2026-04-01 19:49:23.88747	Income Tax Audit ,Income Tax Return , GST Audit ,GST Returns
221	85	2	16	\N	\N	2021-22	30500.00	1	5490.00	2026-04-01 19:49:23.88747	Income Tax Audit ,Income Tax Return , GST Audit ,GST Returns
222	85	3	16	\N	\N	2022-23	30500.00	1	5490.00	2026-04-01 19:49:23.88747	Income Tax Audit ,Income Tax Return , GST Audit ,GST Returns
223	85	4	16	\N	\N	2023-24	30500.00	1	5490.00	2026-04-01 19:49:23.88747	Income Tax Audit ,Income Tax Return , GST Audit ,GST Returns
224	85	5	16	\N	\N	2024-25	38000.00	1	6840.00	2026-04-01 19:49:23.88747	Income Tax Audit ,Income Tax Return , GST Audit ,GST Returns, GST Annual Return
225	86	1	16	\N	\N	2024-25	22000.00	1	3960.00	2026-04-01 19:52:17.193748	Income Tax Audit , Income Tax Return, Account Finalisation\nand other services
226	87	1	1	\N	\N	2024-25	20000.00	1	3600.00	2026-04-01 19:57:31.624674	\N
227	88	1	16	\N	\N	2024-25	33000.00	1	5940.00	2026-04-01 20:00:27.658668	Income Tax Audit ,Income Tax Return,  Account Finalisation\nand other services
231	90	1	2	\N	\N	2024-25	10000.00	5	0.00	2026-04-02 12:07:05.35778	Hemant Chaliyawala
232	90	2	2	\N	\N	2024-25	10000.00	5	0.00	2026-04-02 12:07:05.35778	Ami Hemant Chaliyawala
233	90	3	2	\N	\N	2024-25	5000.00	5	0.00	2026-04-02 12:07:05.35778	Riya Hemant Chaliyawala
234	91	1	2	\N	\N	2024-25	7500.00	5	0.00	2026-04-02 12:15:26.174937	Jitendra Bhavsar
235	91	2	2	\N	\N	2024-25	7500.00	5	0.00	2026-04-02 12:15:26.174937	Priti Jitendra Bhavsar
236	91	3	2	\N	\N	2024-25	7500.00	5	0.00	2026-04-02 12:15:26.174937	Harsh Jitendra Bhavsar
237	91	4	2	\N	\N	2024-25	7500.00	5	0.00	2026-04-02 12:15:26.174937	Shraddha Malwe
238	89	1	2	\N	\N	2022-23	6000.00	5	0.00	2026-04-02 12:21:01.849954	Abhijeet Sisode
239	89	2	2	\N	\N	2023-24	6000.00	5	0.00	2026-04-02 12:21:01.849954	Abhijeet Sisode
240	89	3	2	\N	\N	2024-25	6000.00	5	0.00	2026-04-02 12:21:01.849954	Abhijeet Sisode
241	89	4	2	\N	\N	2023-24	12500.00	5	0.00	2026-04-02 12:21:01.849954	Manjit Sisode
242	89	5	2	\N	\N	2024-25	12500.00	5	0.00	2026-04-02 12:21:01.849954	Manjit Sisode
243	89	6	2	\N	\N	2023-24	3000.00	5	0.00	2026-04-02 12:21:01.849954	Nikita Sisode - Janseva Medical
244	89	7	2	\N	\N	2024-25	3000.00	5	0.00	2026-04-02 12:21:01.849954	Nikita Sisode - Janseva Medical
245	89	8	5	\N	\N	2023-24	6000.00	5	0.00	2026-04-02 12:21:01.849954	\N
246	89	9	5	\N	\N	2024-25	6000.00	5	0.00	2026-04-02 12:21:01.849954	\N
247	89	10	6	\N	\N	2023-24	3000.00	5	0.00	2026-04-02 12:21:01.849954	\N
248	89	11	6	\N	\N	2024-25	3000.00	5	0.00	2026-04-02 12:21:01.849954	\N
249	89	12	3	\N	\N	2023-24	10000.00	5	0.00	2026-04-02 12:21:01.849954	Medical & Personal
250	89	13	3	\N	\N	2024-25	10000.00	5	0.00	2026-04-02 12:21:01.849954	Medical & Personal
251	92	1	11	\N	\N	2024-25	7500.00	5	0.00	2026-04-02 12:24:41.515921	\N
252	92	2	2	\N	\N	2024-25	3000.00	5	0.00	2026-04-02 12:24:41.515921	\N
253	93	1	1	\N	\N	2024-25	17000.00	5	0.00	2026-04-02 12:38:20.088703	\N
254	93	2	2	\N	\N	2024-25	10000.00	5	0.00	2026-04-02 12:38:20.088703	Partners
255	94	1	1	\N	\N	2024-25	16500.00	5	0.00	2026-04-02 12:40:42.304709	\N
256	95	1	1	\N	\N	2024-25	22000.00	5	0.00	2026-04-02 12:51:40.394909	\N
257	96	1	1	\N	\N	2024-25	12000.00	5	0.00	2026-04-02 13:07:19.460755	\N
258	97	1	16	\N	\N	2024-25	33000.00	5	0.00	2026-04-02 13:12:05.968562	Income Tax Audit , Income Tax Return, GST Reconciliation ,\nAccount Finalisation and other services
259	98	1	1	\N	\N	2024-25	10000.00	5	0.00	2026-04-02 15:48:01.13625	\N
260	98	2	5	\N	\N	2024-25	6000.00	5	0.00	2026-04-02 15:48:01.13625	\N
261	98	3	6	\N	\N	2024-25	2000.00	5	0.00	2026-04-02 15:48:01.13625	\N
262	98	4	3	\N	\N	2024-25	18000.00	5	0.00	2026-04-02 15:48:01.13625	\N
263	99	1	18	\N	\N	2024-25	20000.00	5	0.00	2026-04-02 15:51:19.484756	\N
264	100	1	19	\N	\N	2022-23	20000.00	5	0.00	2026-04-02 15:56:57.209926	\N
265	100	2	19	\N	\N	2023-24	20000.00	5	0.00	2026-04-02 15:56:57.209926	\N
266	100	3	19	\N	\N	2024-25	22000.00	5	0.00	2026-04-02 15:56:57.209926	\N
267	101	1	19	\N	\N	2024-25	22000.00	5	0.00	2026-04-02 15:58:05.673596	\N
268	101	2	2	\N	\N	2024-25	11000.00	5	0.00	2026-04-02 15:58:05.673596	\N
269	102	1	2	\N	\N	2023-24	4000.00	5	0.00	2026-04-02 16:01:52.223359	\N
270	102	2	2	\N	\N	2024-25	4000.00	5	0.00	2026-04-02 16:01:52.223359	\N
271	102	3	5	\N	\N	2023-24	4000.00	5	0.00	2026-04-02 16:01:52.223359	\N
272	102	4	6	\N	\N	2023-24	1000.00	5	0.00	2026-04-02 16:01:52.223359	\N
273	102	5	5	\N	\N	2024-25	4000.00	5	0.00	2026-04-02 16:01:52.223359	\N
274	102	6	6	\N	\N	2024-25	1000.00	5	0.00	2026-04-02 16:01:52.223359	\N
275	102	7	3	\N	\N	2023-24	9000.00	5	0.00	2026-04-02 16:01:52.223359	\N
276	102	8	3	\N	\N	2024-25	9000.00	5	0.00	2026-04-02 16:01:52.223359	\N
277	103	1	19	\N	\N	2024-25	12000.00	5	0.00	2026-04-02 16:19:36.620895	\N
278	103	2	4	\N	\N	2024-25	15000.00	5	0.00	2026-04-02 16:19:36.620895	\N
279	103	3	2	\N	\N	2024-25	5000.00	5	0.00	2026-04-02 16:19:36.620895	Vijaysingh
280	103	4	2	\N	\N	2024-25	5000.00	5	0.00	2026-04-02 16:19:36.620895	Sangeeta
281	104	1	19	\N	\N	2024-25	17000.00	5	0.00	2026-04-02 16:40:55.207372	\N
282	105	1	19	\N	\N	2022-23	20000.00	5	0.00	2026-04-02 16:44:12.276787	\N
283	105	2	19	\N	\N	2023-24	20000.00	5	0.00	2026-04-02 16:44:12.276787	\N
284	105	3	19	\N	\N	2024-25	22000.00	5	0.00	2026-04-02 16:44:12.276787	\N
285	106	1	20	\N	\N	2024-25	16500.00	5	0.00	2026-04-02 16:46:30.990142	\N
286	107	1	20	\N	\N	2024-25	19800.00	5	0.00	2026-04-02 16:50:04.408371	\N
287	107	2	4	\N	\N	2024-25	15000.00	5	0.00	2026-04-02 16:50:04.408371	\N
288	107	3	2	\N	\N	2024-25	4000.00	5	0.00	2026-04-02 16:50:04.408371	Mihir Lalwani
289	107	4	16	\N	\N	2024-25	4000.00	5	0.00	2026-04-02 16:50:04.408371	Projected Balance Sheet for Loan Purpose
290	108	1	20	\N	\N	2024-25	20000.00	5	0.00	2026-04-02 16:51:05.576644	\N
291	109	1	20	\N	\N	2024-25	16500.00	5	0.00	2026-04-02 16:52:01.983647	\N
292	111	1	20	\N	\N	2024-25	16500.00	5	0.00	2026-04-02 16:55:13.14609	\N
293	112	1	20	\N	\N	2024-25	11000.00	5	0.00	2026-04-02 16:57:33.55243	\N
294	112	2	4	\N	\N	2024-25	13200.00	5	0.00	2026-04-02 16:57:33.55243	\N
295	112	3	2	\N	\N	2024-25	4400.00	5	0.00	2026-04-02 16:57:33.55243	Jacky Lalwani
296	112	4	2	\N	\N	2024-25	4400.00	5	0.00	2026-04-02 16:57:33.55243	Dimpu Lalwani
297	113	1	19	\N	\N	2024-25	17000.00	5	0.00	2026-04-02 17:06:49.186539	\N
298	114	1	20	\N	\N	2023-24	18000.00	5	0.00	2026-04-02 17:09:00.799893	\N
299	114	2	20	\N	\N	2024-25	19800.00	5	0.00	2026-04-02 17:09:00.799893	\N
300	115	1	21	\N	\N	2025-26	2500.00	5	0.00	2026-04-03 16:52:05.501396	Certificate stating Turnover, Net worth (Book Value), Working Capital and Profit After Tax for the 3 years
301	117	1	11	\N	2026-04-10	2026-27	7500.00	5	0.00	2026-04-10 12:30:35.694362	\N
302	118	1	11	\N	2025-06-12	2025-26	7500.00	5	0.00	2026-04-13 18:11:25.715753	\N
303	119	1	16	\N	\N	2023-24	20000.00	5	0.00	2026-04-15 17:23:36.320827	\N
304	120	1	16	\N	\N	2023-24	5000.00	5	0.00	2026-04-15 17:24:46.404262	\N
305	121	1	16	\N	\N	2023-24	5000.00	5	0.00	2026-04-15 17:26:16.806018	\N
309	122	1	4	\N	\N	2024-25	6250.00	1	1125.00	2026-04-17 13:11:16.481356	\N
310	122	2	4	\N	\N	2025-26	15000.00	1	2700.00	2026-04-17 13:11:16.481356	\N
311	123	1	16	\N	\N	2025-26	18000.00	5	0.00	2026-04-17 17:33:06.578828	\N
312	124	1	12	\N	2025-04-08	2026	5000.00	1	900.00	2026-04-17 18:03:55.56548	\N
313	124	2	11	\N	2025-02-24	\N	7500.00	1	1350.00	2026-04-17 18:03:55.56548	\N
314	124	3	4	\N	\N	2025-26	15000.00	1	2700.00	2026-04-17 18:03:55.56548	\N
315	125	1	16	\N	\N	2020-21	50000.00	1	9000.00	2026-04-18 18:17:29.936921	\N
316	125	2	16	\N	\N	2021-22	50000.00	1	9000.00	2026-04-18 18:17:29.936921	\N
317	125	3	16	\N	\N	2022-23	50000.00	1	9000.00	2026-04-18 18:17:29.936921	\N
318	125	4	16	\N	\N	2023-24	55000.00	1	9900.00	2026-04-18 18:17:29.936921	\N
319	125	5	16	\N	\N	2025-26	55000.00	1	9900.00	2026-04-18 18:17:29.936921	\N
320	126	1	16	\N	\N	2024-25	27500.00	5	0.00	2026-04-18 18:22:42.177576	\N
321	127	1	16	\N	\N	2024-25	55000.00	5	0.00	2026-04-18 18:50:24.966848	Accounting, Income Tax Audit, Income Tax Return .
323	128	1	16	\N	\N	2024-25	35000.00	5	0.00	2026-04-18 18:51:57.794411	Accounting, Income Tax Return
325	129	1	16	\N	\N	2024-25	30000.00	5	0.00	2026-04-18 18:53:34.091159	Accounting , Income Tax Return
326	129	2	4	\N	\N	2024-25	15000.00	5	0.00	2026-04-18 18:53:34.091159	S M Medical
327	130	1	11	\N	2025-10-18	\N	7500.00	5	0.00	2026-04-18 19:07:59.79845	\N
332	131	1	22	\N	\N	2024-25	7500.00	1	1350.00	2026-04-18 19:23:59.819718	\N
341	136	1	23	\N	\N	2024-25	28500.00	5	0.00	2026-04-18 19:33:57.273411	\N
342	137	1	23	\N	\N	2024-25	28500.00	5	0.00	2026-04-18 19:44:11.73759	\N
343	138	1	23	\N	\N	2024-25	28500.00	5	0.00	2026-04-18 19:45:19.9	\N
344	139	1	23	\N	\N	2024-25	28500.00	5	0.00	2026-04-18 19:47:20.539848	\N
345	140	1	23	\N	\N	2024-25	30000.00	5	0.00	2026-04-18 19:48:05.465143	\N
346	141	1	23	\N	\N	2022-23	30000.00	5	0.00	2026-04-18 19:49:43.037302	\N
347	141	2	23	\N	\N	2023-24	33000.00	5	0.00	2026-04-18 19:49:43.037302	\N
348	141	3	23	\N	\N	2024-25	33000.00	5	0.00	2026-04-18 19:49:43.037302	\N
349	142	1	16	\N	\N	2024-25	7500.00	1	1350.00	2026-04-18 20:00:56.27851	\N
352	143	1	4	\N	\N	2025-26	10000.00	1	1800.00	2026-04-22 12:43:40.774595	2017-18, August 2017
353	143	2	4	\N	\N	2018-19	15000.00	1	2700.00	2026-04-22 12:43:40.774595	\N
354	143	3	4	\N	\N	2019-20	15000.00	1	2700.00	2026-04-22 12:43:40.774595	\N
355	143	4	5	\N	\N	2020-21	1500.00	1	270.00	2026-04-22 12:43:40.774595	Q1
356	143	5	4	\N	\N	2020-21	11250.00	1	2025.00	2026-04-22 12:43:40.774595	July 20 to March 2021
357	143	6	4	\N	\N	2021-22	15000.00	1	2700.00	2026-04-22 12:43:40.774595	\N
358	143	7	4	\N	\N	2022-23	15000.00	1	2700.00	2026-04-22 12:43:40.774595	\N
359	143	8	4	\N	\N	2023-24	15000.00	1	2700.00	2026-04-22 12:43:40.774595	\N
360	143	9	4	\N	\N	2024-25	15000.00	1	2700.00	2026-04-22 12:43:40.774595	\N
361	143	10	4	\N	\N	2025-26	15000.00	1	2700.00	2026-04-22 12:43:40.774595	\N
362	143	11	6	\N	\N	2023-24	10000.00	1	1800.00	2026-04-22 12:43:40.774595	GSTR 9 
363	144	1	21	\N	2026-05-07	2026-27	1000.00	1	180.00	2026-05-07 18:21:15.762016	GST CERTIFICATE
364	144	2	21	\N	2026-05-07	2026-27	1000.00	1	180.00	2026-05-07 18:21:15.762016	Cost of Acquisition
365	144	3	14	\N	2026-05-07	2026-27	2000.00	1	360.00	2026-05-07 18:21:15.762016	NETWORTH CERTIFICATE
366	145	1	21	\N	2026-05-07	2026-27	3000.00	1	540.00	2026-05-07 18:27:44.359803	TURNOVER AND BID CAPACITY 
367	146	1	21	\N	2026-01-16	2025-26	1500.00	1	270.00	2026-05-07 18:33:13.658617	TURNOVER AND NETWORTH
368	147	1	16	\N	2026-02-23	2026-27	500.00	5	0.00	2026-05-07 18:34:30.880158	LEI NUMBER
369	148	1	21	\N	2026-03-05	2026-27	1500.00	1	270.00	2026-05-07 18:41:18.532239	BID CAPACITY CERTIFICATE
370	149	1	21	\N	2026-03-07	2026-27	2000.00	1	360.00	2026-05-07 18:42:40.118503	TDS CERTIFICATE FOR PRIVATE SECTOR PROJECTS
371	150	1	13	\N	2026-05-07	2026	5000.00	5	0.00	2026-05-07 18:45:03.926416	\N
372	151	1	14	\N	2026-05-07	2026-27	1500.00	1	270.00	2026-05-07 18:46:04.302887	NETWORTH CERTICTAE
373	152	1	16	\N	2026-05-08	2024-25	1500.00	1	270.00	2026-05-08 10:59:16.38562	NO DUES CERTIFICATE 
374	153	1	14	\N	2026-05-08	2025-26	3000.00	1	540.00	2026-05-08 11:09:03.241972	CETIFICATE OF COST OF INVESTMENTS IN FIXED ASSETS 
375	154	1	14	\N	2026-05-08	2025-26	3000.00	1	540.00	2026-05-08 12:36:13.111007	CERTIFICATE  - 2 
376	155	1	14	\N	2026-05-08	2025-26	10000.00	5	0.00	2026-05-08 12:39:29.810057	PROFESSIONAL TAX ASSESSMENT - 6  YEARS 
377	156	1	14	\N	2026-05-08	2025-26	30000.00	5	0.00	2026-05-08 12:40:35.088706	PROFESSIONAL TAX ASSESSMENT - 2 YEARS - CASH
378	157	1	14	\N	2026-05-08	2026	15000.00	5	0.00	2026-05-08 12:41:10.425471	PROFESSIONAL TAX ASSESSMENT - 2 YEARS - CASH
379	158	1	14	\N	2026-05-08	2026	15000.00	5	0.00	2026-05-08 12:41:36.773898	PROFESSIONAL TAX ASSESSMENT - 2 YEARS - CASH
380	159	1	19	\N	\N	2023-24	25000.00	1	4500.00	2026-05-09 11:51:39.295101	Manik Gas Agency
381	159	2	19	\N	\N	2024-25	25000.00	1	4500.00	2026-05-09 11:51:39.295101	Manik Gas Agency
382	159	3	2	\N	\N	2023-24	6000.00	1	1080.00	2026-05-09 11:51:39.295101	Partners - Rajendra Kachave and Surekha Kachave
383	159	4	2	\N	\N	2024-25	6000.00	1	1080.00	2026-05-09 11:51:39.295101	Partners - Rajendra Kachave and Surekha Kachave
384	159	5	10	\N	\N	2023-24	9000.00	1	1620.00	2026-05-09 11:51:39.295101	TDS Returns - Manik Gas
385	159	6	10	\N	\N	2024-25	9000.00	1	1620.00	2026-05-09 11:51:39.295101	TDS Returns - Manik Gas
386	159	7	2	\N	\N	2021-22	3000.00	1	540.00	2026-05-09 11:51:39.295101	Rushikesh Kachave - ITR
387	159	8	2	\N	\N	2022-23	3000.00	1	540.00	2026-05-09 11:51:39.295101	Rushikesh Kachave - ITR
388	159	9	2	\N	\N	2023-24	3000.00	1	540.00	2026-05-09 11:51:39.295101	Rushikesh Kachave - ITR
389	159	10	2	\N	\N	2023-24	7500.00	1	1350.00	2026-05-09 11:51:39.295101	Accounting - Manik Construction- 2023-24
\.


--
-- Data for Name: bill_writeoffs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bill_writeoffs (id, bill_id, writeoff_amount, written_off_by, writeoff_date, notes, created_at) FROM stdin;
1	91	5000.00	3	2026-04-02	Discount	2026-05-09 15:33:35.421573
\.


--
-- Data for Name: bills; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bills (id, bill_no, header_id, created_by, bill_date, financial_year, payment_term_id, due_date, subtotal, gst_total, total_invoice_value, status, notes, created_at, updated_at, client_id, total_paid, payment_status, last_payment_date, override_header_id) FROM stdin;
50	MSD/2526/019	1	3	2026-03-30	2025-26	1	2026-03-31	45000.00	8100.00	53100.00	FINALIZED	\N	2026-03-31 10:52:01.417835	2026-03-31 10:52:19.851223	37	53100.00	PAID	2026-03-30	\N
49	MSD/2526/020	1	3	2026-03-26	2025-26	1	2026-03-27	177000.00	31860.00	208860.00	FINALIZED		2026-03-30 13:21:48.405221	2026-03-31 10:57:21.670382	72	208860.00	PAID	2026-03-31	\N
65	\N	4	3	2026-04-01	2026-27	1	2026-04-02	40000.00	0.00	40000.00	DRAFT	\N	2026-04-01 18:05:34.454442	2026-04-01 18:05:34.454442	222	0.00	UNPAID	\N	\N
95	\N	4	3	2025-10-14	2025-26	1	2025-10-15	22000.00	0.00	22000.00	DRAFT	\N	2026-04-02 12:51:40.394909	2026-04-02 12:51:40.394909	243	0.00	UNPAID	\N	\N
77	\N	1	3	2025-10-14	2025-26	1	2025-10-15	16000.00	2880.00	18880.00	DRAFT	\N	2026-04-01 19:05:55.194621	2026-04-01 19:05:55.194621	228	0.00	UNPAID	\N	\N
147	\N	3	5	2026-02-23	2025-26	1	2026-02-24	500.00	0.00	500.00	DRAFT	\N	2026-05-07 18:34:30.880158	2026-05-07 18:34:30.880158	11	0.00	UNPAID	\N	\N
54	\N	3	3	2026-03-30	2025-26	1	2026-03-31	18000.00	0.00	18000.00	DRAFT		2026-03-31 17:14:46.773312	2026-03-31 17:14:59.971171	214	0.00	UNPAID	\N	\N
19	MSD/2526/023	1	3	2026-03-28	2025-26	1	2026-03-29	138000.00	24840.00	162840.00	FINALIZED	\N	2026-03-28 12:41:57.05863	2026-03-31 10:57:56.574322	75	162840.00	PAID	2026-03-31	\N
23	MSD/2526/021	1	3	2026-03-27	2025-26	1	2026-03-28	166000.00	29880.00	195880.00	FINALIZED		2026-03-28 12:44:56.63141	2026-03-31 10:58:07.806937	45	195880.00	PAID	2026-03-31	\N
24	MSD/2526/022	1	3	2026-03-27	2025-26	1	2026-03-28	180000.00	32400.00	212400.00	FINALIZED		2026-03-28 12:46:45.013089	2026-03-31 10:58:12.256672	80	212400.00	PAID	2026-03-31	\N
18	MSD/2526/008	1	3	2026-03-26	2025-26	1	2026-03-27	300000.00	54000.00	354000.00	FINALIZED	\N	2026-03-26 13:19:05.591817	2026-03-31 11:05:00.415738	11	354000.00	PAID	2026-03-26	\N
67	MSD/2526/026	1	3	2025-10-15	2025-26	1	2025-10-16	15000.00	2700.00	17700.00	FINALIZED	\N	2026-04-01 18:12:57.918994	2026-04-01 18:27:42.051032	223	17700.00	PAID	2026-02-16	\N
87	MSD/2526/036	1	3	2026-01-16	2025-26	1	2026-01-17	20000.00	3600.00	23600.00	FINALIZED	\N	2026-04-01 19:57:31.624674	2026-04-01 19:57:54.09117	208	23600.00	PAID	2026-01-19	\N
97	\N	4	3	2025-10-15	2025-26	1	2025-10-16	33000.00	0.00	33000.00	DRAFT	\N	2026-04-02 13:12:05.968562	2026-04-02 13:12:05.968562	247	0.00	UNPAID	\N	\N
17	MSD/2526/009	1	3	2026-03-25	2025-26	1	2026-03-26	50000.00	9000.00	59000.00	FINALIZED		2026-03-26 13:07:22.140549	2026-03-31 17:45:35.104897	134	0.00	UNPAID	\N	\N
52	\N	1	3	2026-03-31	2025-26	1	2026-04-01	70500.00	12690.00	83190.00	DRAFT	\N	2026-03-31 17:02:45.877051	2026-03-31 17:02:45.877051	214	0.00	UNPAID	\N	\N
150	\N	3	5	2026-05-07	2026-27	1	2026-05-08	5000.00	0.00	5000.00	DRAFT	\N	2026-05-07 18:45:03.926416	2026-05-07 18:45:03.926416	161	0.00	UNPAID	\N	\N
57	MSD/2526/024	1	3	2026-03-01	2025-26	1	2026-03-02	60000.00	10800.00	70800.00	FINALIZED	\N	2026-03-31 17:59:37.11998	2026-03-31 18:00:12.953623	216	70800.00	PAID	2026-03-04	\N
99	\N	4	3	2025-10-08	2025-26	1	2025-10-09	20000.00	0.00	20000.00	DRAFT	\N	2026-04-02 15:51:19.484756	2026-04-02 15:51:19.484756	248	0.00	UNPAID	\N	\N
28	MSD/2526/018	1	3	2026-03-28	2025-26	1	2026-03-29	35000.00	6300.00	41300.00	FINALIZED	\N	2026-03-28 13:13:13.972006	2026-03-31 10:50:33.876786	94	41300.00	PAID	2026-03-30	\N
59	MSD/2526/025	1	3	2026-03-09	2025-26	1	2026-03-10	50000.00	9000.00	59000.00	FINALIZED	\N	2026-04-01 17:15:53.662511	2026-04-01 17:16:27.488116	123	59000.00	PAID	2026-03-24	\N
69	MSD/2526/027	1	3	2025-10-01	2025-26	1	2025-10-02	71750.00	12915.00	84665.00	FINALIZED	\N	2026-04-01 18:34:23.964433	2026-04-01 18:34:57.731042	22	84665.00	PAID	2025-11-29	\N
79	MSD/2526/032	1	3	2025-10-14	2025-26	1	2025-10-15	15500.00	2790.00	18290.00	FINALIZED	\N	2026-04-01 19:13:58.65236	2026-04-01 19:14:22.776011	230	18290.00	PAID	2026-02-04	\N
61	\N	1	3	2026-02-05	2025-26	1	2026-02-06	190000.00	34200.00	224200.00	DRAFT	\N	2026-04-01 17:48:06.538717	2026-04-01 17:48:06.538717	218	0.00	UNPAID	\N	\N
63	\N	1	3	2026-01-13	2025-26	1	2026-01-14	30000.00	5400.00	35400.00	DRAFT	\N	2026-04-01 17:57:22.850075	2026-04-01 17:57:22.850075	220	0.00	UNPAID	\N	\N
101	\N	4	3	2025-10-15	2025-26	1	2025-10-16	33000.00	0.00	33000.00	DRAFT	\N	2026-04-02 15:58:05.673596	2026-04-02 15:58:05.673596	158	0.00	UNPAID	\N	\N
71	MSD/2526/029	1	3	2025-09-06	2025-26	1	2025-09-07	18000.00	3240.00	21240.00	FINALIZED	\N	2026-04-01 18:41:41.279118	2026-04-01 18:42:11.616737	138	21240.00	PAID	2025-09-09	\N
152	\N	1	2	2026-05-08	2026-27	1	2026-05-09	1500.00	270.00	1770.00	DRAFT	NO DUES CERTIFICATE 	2026-05-08 10:59:16.38562	2026-05-08 10:59:16.38562	282	0.00	UNPAID	\N	\N
81	\N	1	3	2026-01-13	2025-26	1	2026-01-14	35000.00	6300.00	41300.00	DRAFT	\N	2026-04-01 19:22:52.220808	2026-04-01 19:22:52.220808	232	0.00	UNPAID	\N	\N
107	\N	4	3	2026-01-08	2025-26	1	2026-01-09	42800.00	0.00	42800.00	DRAFT	\N	2026-04-02 16:50:04.408371	2026-04-02 16:50:04.408371	167	0.00	UNPAID	\N	\N
74	MSD/2627/001	1	3	2025-10-14	2026-27	1	2025-10-15	16500.00	2970.00	19470.00	FINALIZED		2026-04-01 18:56:44.606706	2026-04-01 18:58:13.11297	226	19470.00	PAID	2025-10-26	\N
103	\N	4	3	2026-01-08	2025-26	1	2026-01-09	37000.00	0.00	37000.00	DRAFT	\N	2026-04-02 16:19:36.620895	2026-04-02 16:19:36.620895	58	0.00	UNPAID	\N	\N
83	\N	1	3	2025-09-04	2025-26	1	2025-09-05	42000.00	7560.00	49560.00	DRAFT	\N	2026-04-01 19:40:18.553663	2026-04-01 19:40:18.553663	70	0.00	UNPAID	\N	\N
90	\N	3	3	2026-03-10	2025-26	1	2026-03-11	25000.00	0.00	25000.00	DRAFT	\N	2026-04-02 12:07:05.35778	2026-04-02 12:07:05.35778	238	0.00	UNPAID	\N	\N
109	\N	4	3	2026-01-09	2025-26	1	2026-01-10	16500.00	0.00	16500.00	DRAFT	\N	2026-04-02 16:52:01.983647	2026-04-02 16:52:01.983647	253	0.00	UNPAID	\N	\N
85	\N	1	3	2026-04-01	2026-27	1	2026-04-02	160000.00	28800.00	188800.00	DRAFT	\N	2026-04-01 19:49:23.88747	2026-04-01 19:49:23.88747	89	0.00	UNPAID	\N	\N
105	\N	4	3	2025-10-21	2025-26	1	2025-10-22	62000.00	0.00	62000.00	DRAFT	\N	2026-04-02 16:44:12.276787	2026-04-02 16:44:12.276787	251	0.00	UNPAID	\N	\N
112	\N	4	3	2026-01-07	2025-26	1	2026-01-08	33000.00	0.00	33000.00	DRAFT	\N	2026-04-02 16:57:33.55243	2026-04-02 16:57:33.55243	170	0.00	UNPAID	\N	\N
92	URJ/2526/005	3	3	2026-03-14	2025-26	1	2026-03-15	10500.00	0.00	10500.00	FINALIZED	\N	2026-04-02 12:24:41.515921	2026-04-02 12:25:11.445263	240	10500.00	PAID	2026-03-18	\N
2	\N	1	2	2026-03-16	2025-26	1	2026-03-17	10.00	1.80	11.80	ABSORBED	A	2026-03-16 21:13:44.471612	2026-03-30 11:23:13.925205	1	0.00	UNPAID	\N	\N
3	\N	1	3	2026-03-17	2025-26	1	2026-03-18	10.00	1.80	11.80	ABSORBED	Have a nice day	2026-03-17 16:37:06.37023	2026-03-30 11:23:13.925205	1	0.00	UNPAID	\N	\N
94	\N	4	3	2025-10-23	2025-26	1	2025-10-24	16500.00	0.00	16500.00	DRAFT	\N	2026-04-02 12:40:42.304709	2026-04-02 12:40:42.304709	242	0.00	UNPAID	\N	\N
13	\N	1	3	2026-03-23	2025-26	1	2026-03-24	25.00	4.50	29.50	ABSORBED	\N	2026-03-23 12:41:49.974863	2026-03-30 11:23:13.925205	1	0.00	UNPAID	\N	\N
14	\N	1	3	2026-03-23	2025-26	1	2026-03-24	1500.00	270.00	1770.00	ABSORBED	\N	2026-03-23 12:42:14.671646	2026-03-30 11:23:13.925205	1	0.00	UNPAID	\N	\N
114	\N	4	3	2025-10-15	2025-26	1	2025-10-16	37800.00	0.00	37800.00	DRAFT	\N	2026-04-02 17:09:00.799893	2026-04-02 17:09:00.799893	256	0.00	UNPAID	\N	\N
115	URJ/2627/001	4	3	2026-04-03	2026-27	1	2026-04-04	2500.00	0.00	2500.00	FINALIZED	\N	2026-04-03 16:52:05.501396	2026-04-06 17:30:26.152465	39	2500.00	PAID	2026-04-06	\N
25	\N	1	3	2026-03-28	2025-26	1	2026-03-29	16000.00	2880.00	18880.00	DRAFT	\N	2026-03-28 12:52:59.487433	2026-03-30 11:23:13.925205	203	0.00	UNPAID	\N	\N
26	\N	1	3	2026-03-28	2025-26	1	2026-03-29	35000.00	6300.00	41300.00	DRAFT	\N	2026-03-28 12:58:36.076076	2026-03-30 11:23:13.925205	204	0.00	UNPAID	\N	\N
117	\N	4	3	2026-04-10	2026-27	1	2026-04-11	7500.00	0.00	7500.00	DRAFT	\N	2026-04-10 12:30:35.694362	2026-04-10 12:30:35.694362	357	0.00	UNPAID	\N	\N
118	\N	4	3	2025-06-12	2025-26	1	2025-06-13	7500.00	0.00	7500.00	DRAFT	\N	2026-04-13 18:11:25.715753	2026-04-13 18:11:25.715753	358	0.00	UNPAID	\N	\N
29	\N	1	3	2026-03-28	2025-26	1	2026-03-29	59000.00	10620.00	69620.00	DRAFT	\N	2026-03-28 15:44:47.989428	2026-03-30 11:23:13.925205	26	0.00	UNPAID	\N	\N
119	\N	4	3	2026-04-15	2026-27	1	2026-04-16	20000.00	0.00	20000.00	DRAFT	\N	2026-04-15 17:23:36.320827	2026-04-15 17:23:36.320827	53	0.00	UNPAID	\N	\N
121	\N	3	3	2026-04-15	2026-27	1	2026-04-16	5000.00	0.00	5000.00	DRAFT	\N	2026-04-15 17:26:16.806018	2026-04-15 17:26:16.806018	86	0.00	UNPAID	\N	\N
123	\N	3	3	2026-04-17	2026-27	1	2026-04-18	18000.00	0.00	18000.00	DRAFT	\N	2026-04-17 17:33:06.578828	2026-04-17 17:33:06.578828	314	0.00	UNPAID	\N	\N
30	\N	1	3	2026-03-28	2025-26	1	2026-03-29	55000.00	9900.00	64900.00	DRAFT	\N	2026-03-28 15:52:18.858044	2026-03-30 11:23:13.925205	205	0.00	UNPAID	\N	\N
31	\N	1	3	2026-03-27	2025-26	1	2026-03-28	55000.00	9900.00	64900.00	DRAFT		2026-03-28 16:07:41.119803	2026-03-30 11:23:13.925205	98	0.00	UNPAID	\N	\N
32	\N	1	3	2026-03-28	2025-26	1	2026-03-29	55000.00	9900.00	64900.00	DRAFT	\N	2026-03-28 16:10:40.86562	2026-03-30 11:23:13.925205	25	0.00	UNPAID	\N	\N
33	MSD/2526/010	1	3	2026-02-28	2025-26	1	2026-03-01	32500.00	5850.00	38350.00	FINALIZED	\N	2026-03-28 16:19:07.407879	2026-03-30 11:23:13.925205	162	38350.00	PAID	2026-02-28	\N
34	URJ/2526/001	3	3	2026-03-28	2025-26	1	2026-03-29	50000.00	0.00	50000.00	FINALIZED	\N	2026-03-28 16:23:00.717307	2026-03-30 11:23:13.925205	162	50000.00	PAID	2026-03-28	\N
68	\N	1	3	2026-04-01	2026-27	1	2026-04-02	124000.00	22320.00	146320.00	DRAFT	\N	2026-04-01 18:32:16.319534	2026-04-01 18:32:16.319534	178	0.00	UNPAID	\N	\N
96	\N	4	3	2025-10-15	2025-26	1	2025-10-16	12000.00	0.00	12000.00	DRAFT	\N	2026-04-02 13:07:19.460755	2026-04-02 13:07:19.460755	246	0.00	UNPAID	\N	\N
55	\N	1	3	2026-03-31	2025-26	1	2026-04-01	112200.00	20196.00	132396.00	DRAFT	\N	2026-03-31 17:42:40.979748	2026-03-31 17:42:40.979748	47	0.00	UNPAID	\N	\N
36	MSD/2526/017	1	3	2026-03-19	2025-26	1	2026-03-20	92000.00	16560.00	108560.00	FINALIZED	\N	2026-03-28 17:38:47.24981	2026-03-30 11:23:13.925205	24	0.00	UNPAID	\N	\N
37	\N	3	3	2026-03-18	2025-26	1	2026-03-19	30000.00	0.00	30000.00	DRAFT		2026-03-28 17:43:38.289796	2026-03-30 11:23:13.925205	24	0.00	UNPAID	\N	\N
38	\N	4	3	2026-03-28	2025-26	1	2026-03-29	12500.00	0.00	12500.00	DRAFT	\N	2026-03-28 17:49:22.39516	2026-03-30 11:23:13.925205	206	0.00	UNPAID	\N	\N
39	MSD/2526/012	1	3	2026-03-15	2025-26	1	2026-03-16	85000.00	15300.00	100300.00	FINALIZED	\N	2026-03-28 17:53:18.907437	2026-03-30 11:23:13.925205	207	100300.00	PAID	2026-03-09	\N
43	MSD/2526/013	1	3	2026-03-28	2025-26	1	2026-03-29	25000.00	4500.00	29500.00	FINALIZED	\N	2026-03-28 18:19:22.108246	2026-03-30 11:23:13.925205	111	29500.00	PAID	2026-03-04	\N
44	URJ/2526/002	3	3	2026-03-28	2025-26	1	2026-03-29	20000.00	0.00	20000.00	FINALIZED	\N	2026-03-28 18:20:27.167319	2026-03-30 11:23:13.925205	111	20000.00	PAID	2026-03-04	\N
27	\N	1	3	2026-03-26	2025-26	1	2026-03-27	280000.00	50400.00	330400.00	DRAFT		2026-03-28 13:02:14.738758	2026-03-30 11:23:13.925205	91	0.00	UNPAID	\N	\N
45	MSD/2526/014	1	3	2026-03-15	2025-26	1	2026-03-16	77000.00	13860.00	90860.00	FINALIZED	\N	2026-03-28 18:31:22.777714	2026-03-30 11:23:13.925205	209	90860.00	PAID	2026-03-12	\N
46	MSD/2526/015	1	3	2026-03-28	2025-26	1	2026-03-29	10000.00	1800.00	11800.00	FINALIZED	\N	2026-03-28 18:44:57.322902	2026-03-30 11:23:13.925205	210	11800.00	PAID	2025-11-14	\N
47	URJ/2526/003	3	3	2025-11-14	2025-26	1	2025-11-15	11000.00	0.00	11000.00	FINALIZED	\N	2026-03-28 18:46:04.396048	2026-03-30 11:23:13.925205	210	11000.00	PAID	2025-11-14	\N
48	MSD/2526/016	1	3	2026-03-16	2025-26	1	2026-03-17	27000.00	4860.00	31860.00	FINALIZED	\N	2026-03-28 18:52:09.934548	2026-03-30 11:23:13.925205	211	31860.00	PAID	2026-03-12	\N
100	\N	4	3	2025-10-19	2025-26	1	2025-10-20	62000.00	0.00	62000.00	DRAFT	\N	2026-04-02 15:56:57.209926	2026-04-02 15:56:57.209926	249	0.00	UNPAID	\N	\N
148	\N	1	5	2026-03-05	2025-26	1	2026-03-06	1500.00	270.00	1770.00	DRAFT	\N	2026-05-07 18:41:18.532239	2026-05-07 18:41:18.532239	11	0.00	UNPAID	\N	\N
58	CA./2627/001	8	3	2026-03-08	2026-27	1	2026-03-09	7500.00	0.00	7500.00	FINALIZED		2026-04-01 17:13:54.938869	2026-04-01 17:16:59.236178	123	7500.00	PAID	2026-03-24	\N
60	\N	1	3	2025-10-31	2025-26	1	2025-11-01	15000.00	2700.00	17700.00	DRAFT	\N	2026-04-01 17:44:17.721179	2026-04-01 17:44:17.721179	217	0.00	UNPAID	\N	\N
70	MSD/2526/028	1	3	2025-10-14	2025-26	1	2025-10-15	13500.00	2430.00	15930.00	FINALIZED	\N	2026-04-01 18:37:23.07052	2026-04-01 18:38:09.228983	224	15930.00	PAID	2026-02-07	\N
35	MSD/2526/011	1	3	2025-11-04	2025-26	1	2025-11-05	400000.00	72000.00	472000.00	FINALIZED	\N	2026-03-28 16:27:56.170516	2026-04-01 18:40:39.031583	23	472000.00	PAID	2025-11-05	\N
62	\N	1	3	2026-03-12	2025-26	1	2026-03-13	22500.00	4050.00	26550.00	DRAFT	\N	2026-04-01 17:53:48.914644	2026-04-01 17:53:48.914644	219	0.00	UNPAID	\N	\N
64	\N	4	3	2026-04-01	2026-27	1	2026-04-02	60000.00	0.00	60000.00	DRAFT	\N	2026-04-01 18:04:27.824494	2026-04-01 18:04:27.824494	221	0.00	UNPAID	\N	\N
66	\N	1	3	2026-01-13	2025-26	1	2026-01-14	62000.00	11160.00	73160.00	DRAFT	\N	2026-04-01 18:09:08.453416	2026-04-01 18:09:08.453416	19	0.00	UNPAID	\N	\N
51	\N	1	3	2026-03-29	2025-26	1	2026-03-30	44500.00	8010.00	52510.00	DRAFT		2026-03-31 16:31:26.690148	2026-03-31 17:08:55.252173	213	0.00	UNPAID	\N	\N
76	MSD/2627/002	1	3	2026-01-12	2026-27	1	2026-01-13	17000.00	3060.00	20060.00	FINALIZED		2026-04-01 19:00:55.558658	2026-04-01 19:02:18.42427	227	20060.00	PAID	2026-03-28	\N
98	\N	4	3	2026-01-08	2025-26	1	2026-01-09	36000.00	0.00	36000.00	DRAFT	\N	2026-04-02 15:48:01.13625	2026-04-02 15:48:01.13625	194	0.00	UNPAID	\N	\N
53	\N	1	3	2026-03-31	2025-26	1	2026-04-01	30500.00	5490.00	35990.00	DRAFT	\N	2026-03-31 17:12:52.259311	2026-03-31 17:12:52.259311	215	0.00	UNPAID	\N	\N
82	MSD/2526/034	1	3	2026-01-13	2025-26	1	2026-01-14	32500.00	5850.00	38350.00	FINALIZED	\N	2026-04-01 19:26:15.268128	2026-04-01 19:27:19.454021	233	38350.00	PAID	2026-03-16	\N
104	\N	4	3	2025-10-15	2025-26	1	2025-10-16	17000.00	0.00	17000.00	DRAFT	\N	2026-04-02 16:40:55.207372	2026-04-02 16:40:55.207372	250	0.00	UNPAID	\N	\N
72	MSD/2526/030	1	3	2025-11-21	2025-26	1	2025-11-22	16780.00	3020.40	19800.40	FINALIZED	\N	2026-04-01 18:53:50.798331	2026-04-01 18:54:29.657983	225	19800.40	PAID	2025-12-10	\N
106	\N	4	3	2025-10-18	2025-26	1	2025-10-19	16500.00	0.00	16500.00	DRAFT	\N	2026-04-02 16:46:30.990142	2026-04-02 16:46:30.990142	252	0.00	UNPAID	\N	\N
78	MSD/2526/031	1	3	2025-09-05	2025-26	1	2025-09-06	18000.00	3240.00	21240.00	FINALIZED		2026-04-01 19:07:58.936967	2026-04-01 19:09:57.338873	229	21240.00	PAID	2025-09-10	\N
84	\N	1	3	2026-02-04	2025-26	1	2026-02-05	17000.00	3060.00	20060.00	DRAFT	\N	2026-04-01 19:41:44.827191	2026-04-01 19:41:44.827191	234	0.00	UNPAID	\N	\N
102	\N	4	3	2026-01-09	2025-26	1	2026-01-10	36000.00	0.00	36000.00	DRAFT	\N	2026-04-02 16:01:52.223359	2026-04-02 16:01:52.223359	202	0.00	UNPAID	\N	\N
80	MSD/2526/033	1	3	2025-10-14	2025-26	1	2025-10-15	15000.00	2700.00	17700.00	FINALIZED	\N	2026-04-01 19:17:27.904743	2026-04-01 19:19:25.341901	231	17700.00	PAID	2026-02-17	\N
108	\N	4	3	2025-10-18	2025-26	1	2025-10-19	20000.00	0.00	20000.00	DRAFT	\N	2026-04-02 16:51:05.576644	2026-04-02 16:51:05.576644	90	0.00	UNPAID	\N	\N
93	\N	4	3	2026-01-13	2025-26	1	2026-01-14	27000.00	0.00	27000.00	DRAFT	\N	2026-04-02 12:38:20.088703	2026-04-02 12:38:20.088703	241	0.00	UNPAID	\N	\N
111	\N	4	3	2025-10-15	2025-26	1	2025-10-16	16500.00	0.00	16500.00	DRAFT	\N	2026-04-02 16:55:13.14609	2026-04-02 16:55:13.14609	254	0.00	UNPAID	\N	\N
113	\N	4	3	2025-10-15	2025-26	1	2025-10-16	17000.00	0.00	17000.00	DRAFT	\N	2026-04-02 17:06:49.186539	2026-04-02 17:06:49.186539	255	0.00	UNPAID	\N	\N
88	MSD/2526/037	1	3	2025-10-14	2025-26	1	2025-10-15	33000.00	5940.00	38940.00	FINALIZED	\N	2026-04-01 20:00:27.658668	2026-04-01 20:01:17.890202	236	38940.00	PAID	2026-02-17	\N
86	MSD/2526/035	1	3	2025-10-14	2025-26	1	2025-10-15	22000.00	3960.00	25960.00	FINALIZED	\N	2026-04-01 19:52:17.193748	2026-04-01 20:01:38.665331	235	25960.00	PAID	2026-02-17	\N
120	\N	3	3	2026-04-15	2026-27	1	2026-04-16	5000.00	0.00	5000.00	DRAFT	\N	2026-04-15 17:24:46.404262	2026-04-15 17:24:46.404262	324	0.00	UNPAID	\N	\N
122	\N	1	3	2026-04-15	2026-27	1	2026-04-16	21250.00	3825.00	25075.00	DRAFT		2026-04-17 13:09:41.030867	2026-04-17 13:11:16.481356	142	0.00	UNPAID	\N	\N
125	\N	1	3	2026-04-18	2026-27	1	2026-04-19	260000.00	46800.00	306800.00	DRAFT	\N	2026-04-18 18:17:29.936921	2026-04-18 18:17:29.936921	321	0.00	UNPAID	\N	\N
126	\N	3	3	2026-04-18	2026-27	1	2026-04-19	27500.00	0.00	27500.00	DRAFT	\N	2026-04-18 18:22:42.177576	2026-04-18 18:22:42.177576	314	0.00	UNPAID	\N	\N
91	URJ/2526/004	3	3	2026-03-09	2025-26	1	2026-03-10	30000.00	0.00	30000.00	FINALIZED	\N	2026-04-02 12:15:26.174937	2026-04-02 12:16:24.420108	239	25000.00	PAID	2026-03-16	\N
127	\N	4	3	2026-04-18	2026-27	1	2026-04-19	55000.00	0.00	55000.00	DRAFT	\N	2026-04-18 18:50:24.966848	2026-04-18 18:50:24.966848	359	0.00	UNPAID	\N	\N
124	MSD/2627/003	1	3	2026-04-17	2026-27	1	2026-04-18	27500.00	4950.00	32450.00	FINALIZED	\N	2026-04-17 18:03:55.56548	2026-04-22 12:37:38.916032	155	32450.00	PAID	2026-04-20	\N
89	\N	3	3	2025-09-17	2025-26	1	2025-09-18	87000.00	0.00	87000.00	DRAFT		2026-04-02 12:03:49.289687	2026-04-02 12:21:01.849954	237	0.00	UNPAID	\N	\N
128	\N	4	3	2026-04-17	2026-27	1	2026-04-18	35000.00	0.00	35000.00	DRAFT		2026-04-18 18:51:43.741591	2026-04-18 18:51:57.794411	360	0.00	UNPAID	\N	\N
149	\N	1	5	2026-03-07	2025-26	1	2026-03-08	2000.00	360.00	2360.00	DRAFT	\N	2026-05-07 18:42:40.118503	2026-05-07 18:42:40.118503	11	0.00	UNPAID	\N	\N
151	\N	1	5	2026-05-07	2026-27	1	2026-05-08	1500.00	270.00	1770.00	DRAFT	\N	2026-05-07 18:46:04.302887	2026-05-07 18:46:04.302887	161	0.00	UNPAID	\N	\N
129	\N	4	3	2026-04-17	2026-27	1	2026-04-18	45000.00	0.00	45000.00	DRAFT		2026-04-18 18:53:08.892824	2026-04-18 18:53:34.091159	195	0.00	UNPAID	\N	\N
130	\N	4	3	2026-04-18	2026-27	1	2026-04-19	7500.00	0.00	7500.00	DRAFT	\N	2026-04-18 19:07:59.79845	2026-04-18 19:07:59.79845	361	0.00	UNPAID	\N	\N
153	\N	1	2	2026-05-07	2026-27	1	2026-05-08	3000.00	540.00	3540.00	DRAFT	CETIFICATE OF COST OF INVESTMENTS IN FIXED ASSETS 	2026-05-08 11:09:03.241972	2026-05-08 11:09:03.241972	205	0.00	UNPAID	\N	\N
154	\N	1	2	2026-05-08	2026-27	1	2026-05-09	3000.00	540.00	3540.00	DRAFT	NET WORTH CERTIFICATE AND ASSET CERTIFICATE	2026-05-08 12:36:13.111007	2026-05-08 12:36:13.111007	228	0.00	UNPAID	\N	\N
155	\N	3	2	2026-05-08	2026-27	1	2026-05-09	10000.00	0.00	10000.00	DRAFT	PROFESSIONAL TAX ASSESSMENT - 6  YEARS 	2026-05-08 12:39:29.810057	2026-05-08 12:39:29.810057	321	0.00	UNPAID	\N	\N
142	\N	1	3	2026-04-18	2026-27	1	2026-04-19	7500.00	1350.00	8850.00	DRAFT	\N	2026-04-18 20:00:56.27851	2026-04-18 20:00:56.27851	346	0.00	UNPAID	\N	\N
156	\N	3	2	2026-05-08	2026-27	1	2026-05-09	30000.00	0.00	30000.00	DRAFT	PROFESSIONAL TAX ASSESSMENT - 2 YEARS - CASH	2026-05-08 12:40:35.088706	2026-05-08 12:40:35.088706	46	0.00	UNPAID	\N	\N
131	\N	1	3	2026-04-16	2026-27	1	2026-04-17	7500.00	1350.00	8850.00	DRAFT		2026-04-18 19:11:20.205628	2026-04-18 19:23:59.819718	313	0.00	UNPAID	\N	\N
157	\N	3	2	2026-05-08	2026-27	1	2026-05-09	15000.00	0.00	15000.00	DRAFT	PROFESSIONAL TAX ASSESSMENT - 2 YEARS - CASH	2026-05-08 12:41:10.425471	2026-05-08 12:41:10.425471	95	0.00	UNPAID	\N	\N
158	\N	3	2	2026-05-08	2026-27	1	2026-05-09	15000.00	0.00	15000.00	DRAFT	PROFESSIONAL TAX ASSESSMENT - 2 YEARS - CASH	2026-05-08 12:41:36.773898	2026-05-08 12:41:36.773898	104	0.00	UNPAID	\N	\N
159	\N	1	3	2026-05-09	2026-27	1	2026-05-10	96500.00	17370.00	113870.00	DRAFT	\N	2026-05-09 11:51:39.295101	2026-05-09 11:51:39.295101	332	0.00	UNPAID	\N	\N
143	\N	1	3	2026-04-21	2026-27	1	2026-04-22	137750.00	24795.00	162545.00	DRAFT		2026-04-22 12:36:38.036225	2026-04-22 12:43:40.774595	64	0.00	UNPAID	\N	\N
136	\N	3	3	2026-04-18	2026-27	1	2026-04-19	28500.00	0.00	28500.00	DRAFT	\N	2026-04-18 19:33:57.273411	2026-04-18 19:33:57.273411	313	0.00	UNPAID	\N	\N
137	\N	3	3	2026-04-18	2026-27	1	2026-04-19	28500.00	0.00	28500.00	DRAFT	\N	2026-04-18 19:44:11.73759	2026-04-18 19:44:11.73759	313	0.00	UNPAID	\N	\N
138	\N	3	3	2026-04-18	2026-27	1	2026-04-19	28500.00	0.00	28500.00	DRAFT	\N	2026-04-18 19:45:19.9	2026-04-18 19:45:19.9	313	0.00	UNPAID	\N	\N
141	URJ/2627/006	4	3	2026-04-18	2026-27	1	2026-04-19	96000.00	0.00	96000.00	FINALIZED	\N	2026-04-18 19:49:43.037302	2026-05-02 12:38:56.468278	294	96000.00	PAID	2026-04-30	\N
140	URJ/2627/007	4	3	2026-04-18	2026-27	1	2026-04-19	30000.00	0.00	30000.00	FINALIZED	\N	2026-04-18 19:48:05.465143	2026-05-02 12:39:03.845832	270	0.00	UNPAID	\N	\N
139	URJ/2627/008	4	3	2026-04-18	2026-27	1	2026-04-19	28500.00	0.00	28500.00	FINALIZED	\N	2026-04-18 19:47:20.539848	2026-05-02 12:39:06.836375	313	0.00	UNPAID	\N	\N
144	\N	1	5	2026-05-07	2026-27	1	2026-05-08	4000.00	720.00	4720.00	DRAFT	\N	2026-05-07 18:21:15.762016	2026-05-07 18:21:15.762016	40	0.00	UNPAID	\N	\N
145	\N	1	5	2026-03-11	2025-26	1	2026-03-12	3000.00	540.00	3540.00	DRAFT	\N	2026-05-07 18:27:44.359803	2026-05-07 18:27:44.359803	136	0.00	UNPAID	\N	\N
146	\N	1	5	2026-05-16	2026-27	1	2026-05-17	1500.00	270.00	1770.00	DRAFT	\N	2026-05-07 18:33:13.658617	2026-05-07 18:33:13.658617	11	0.00	UNPAID	\N	\N
\.


--
-- Data for Name: clients_master; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.clients_master (id, client_name, contact_person, phone, email, is_active, created_at, updated_at, gstin, address_line1, address_line2, city, state, pincode, pan) FROM stdin;
332	Manik Gas Agency			\N	t	2026-04-07 18:48:17.167147	2026-04-07 18:48:17.167147	27AAYFM3227B1Z7	\N	\N	\N	\N	\N	AAYFM3227B
285	Bhushankumar Hukumchand Sanklecha			\N	t	2026-04-06 19:11:16.653145	2026-04-06 19:11:16.653145	\N	\N	\N	\N	\N	\N	CMXPS8533F
42	Laksmi Leela Enterprises	Chetan Biraris	8866165566	lakshmileelaenterprises@gmail.com	t	2026-03-23 17:58:03.032048	2026-04-06 19:15:57.691926	27AAJFL7139A1ZE	\N	\N	Dhule	Maharashtra	424001	AAJFL7139A
288	Ramesh Transport Prop. Chetan Dilip Biraris			\N	t	2026-04-06 19:17:04.015253	2026-04-06 19:17:04.015253	\N	\N	\N	\N	\N	\N	ALKPD3011D
18	Chhatrapati Infra	Kunal Patil	8149924444	kunaldigambarpatil@gmail.com	t	2026-03-23 17:58:02.98118	2026-04-06 19:18:02.761478	27AAPFC9904L1ZT	\N	\N	Dhule	Maharashtra	424001	AAPFC9904L
9	Ankush Agencies Prop. Chhaya Kiran Rayate	Kiran Rayate	9423978968	rayatekiran49@gmail.com	t	2026-03-23 17:58:02.961587	2026-04-07 17:00:27.469971	27AIFPR9718R1Z6	\N	\N	Dhule	Maharashtra	424001	AIFPR9718R
19	Decent Cold Storage	Janak Agrawal	9404822227	decentcold@yahoo.com	t	2026-03-23 17:58:02.984105	2026-04-07 17:04:12.359498	27AAECD0798F1ZK	\N	\N	Dhule	Maharashtra	424001	AAECD0798F
8	Wadile Family	Amit Wadile	7588866666	wadile.amit@gmail.com	t	2026-03-23 17:58:02.959474	2026-03-23 17:58:02.959474	27AAXPW4480D1Z0	\N	\N	Dhule	Maharashtra	424001	\N
20	Deepak Gold	Shubham Soni	9422788333	deepakgold2016@gmail.com	t	2026-03-23 17:58:02.986036	2026-04-07 17:06:06.333377	27AAFFD0104R1ZG	\N	\N	Dhule	Maharashtra	424001	AAFFD0104R
333	Manoj Pustakalay Prop. Sanjay Kashinath Wani			\N	t	2026-04-07 18:49:02.246263	2026-04-07 18:49:02.246263	27AAIPW6893P1ZD	\N	\N	\N	\N	\N	AAIPW6893P
39	Sanika Contruction - Kedar Sadashiv Joshi	Kedas Joshi	9422788148	kedarsjoshi2016@gmail.com	t	2026-03-23 17:58:03.025537	2026-04-08 11:17:09.982975	27AASPJ6595K1ZR	\N	\N	Dhule	Maharashtra	424001	AASPJ6595K
44	Raj Plastic - Madhukar Bagale	Madhukar Bagale	9420292222	rajplastics18@rediffmail.com	t	2026-03-23 17:58:03.03717	2026-04-08 11:26:18.395297	27AHVPB5752E1Z6	\N	\N	Dhule	Maharashtra	424001	AHVPB5752E
22	Dhule Vikas Sahakari Bank	Atul Upasani	9850899104	shrikantsharmaca@gmail.com	t	2026-03-23 17:58:02.989938	2026-04-07 17:16:15.287761	27AAAAD2632C1ZD	\N	\N	Dhule	Maharashtra	424001	AAAAD2632C
24	Ekvira Cotex Pvt Ltd	Mayank Agrawal	9422288664	ekviracotex2016@gmail.com	t	2026-03-23 17:58:02.993833	2026-04-07 17:22:14.49029	27AABCE4687K1Z7	\N	\N	Dhule	Maharashtra	424001	AABCE4687K
16	Bhikan Sandu Patil	Bhikan Sandu Patil	9422787632	bhikanpatil2016@yahoo.com	t	2026-03-23 17:58:02.977139	2026-03-23 17:58:02.977139	27AGXPP0685M1ZD	\N	\N	Dhule	Maharashtra	424001	\N
47	Mahesh Auto Engg Works Prop. Sambhaji Natthu Chaudhari	Mahesh Chaudhari	9823060137	maheshautoeng@yahoo.com	t	2026-03-23 17:58:03.044567	2026-04-07 17:39:54.797849	27AAHPC6689E1ZJ	\N	\N	Dhule	Maharashtra	424001	AAHPC6689E
43	M/S A B Wagh	Ajay Wagh	9823151779	abwagh2016@yahoo.com	t	2026-03-23 17:58:03.034029	2026-04-07 17:43:40.773383	27AAPFA7334Q1ZP	\N	\N	Dhule	Maharashtra	424001	AAPFA7334Q
34	Shree Jinmata Marble & Granite	Mohan Bajiya	9823099538	jinmatagst@rediffmail.com	t	2026-03-23 17:58:03.015676	2026-04-07 17:46:32.122628	27ADGFS3008P1ZP	\N	\N	Dhule	Maharashtra	424001	ADGFS3008P
36	Jogeshwari Traders Prop. Kishor Shelar	Pramod Shelar	9422705654	kishoreknathshelar@gmail.com	t	2026-03-23 17:58:03.019601	2026-04-07 17:49:50.775062	27AFFPS8475K1ZM	\N	\N	Dhule	Maharashtra	424001	AFFPS8475K
38	Kalyani Chemist	Aniket Agrawal	9765536708	kalyanichemist2016@gmail.com	t	2026-03-23 17:58:03.023545	2026-03-23 17:58:03.023545	27AAKHA3837R1ZO	\N	\N	Dhule	Maharashtra	424001	\N
21	Deepak Jewellers Prop. Suresh Soni	Hitesh Soni	9823036103	sbsonimvat2016@gmail.com	t	2026-03-23 17:58:02.987946	2026-04-07 17:51:54.463403	27ABLPS6763N1ZN	\N	\N	Dhule	Maharashtra	424001	ABLPS6763N
35	Jitendra & Co	Jitendra Shah	9823155638	jitendraandco@gmail.com	t	2026-03-23 17:58:03.017666	2026-04-07 17:53:08.813186	27ADFPS5900B1ZT	\N	\N	Dhule	Maharashtra	424001	ADFPS5900B
25	Ganesh Enterprises	Kaushik Agrawal	9833308887	ganeshentreprises2016@gmail.com	t	2026-03-23 17:58:02.996206	2026-04-07 18:11:17.573481	27AADFG1586E1ZI	\N	\N	Dhule	Maharashtra	424001	AADFG1586E
29	Hitesh Silver Prop. Amit Soni	Amit Soni	9823038103	hiteshsilver123@gmail.com	t	2026-03-23 17:58:03.004487	2026-04-07 18:17:28.788776	27ANYPS2515F1ZK	\N	\N	Dhule	Maharashtra	424001	ANYPS2515F
30	Hotel Krishna	Umesh Popali	9823148318	hotelkrishna29118@gmail.com	t	2026-03-23 17:58:03.00642	2026-04-07 18:17:58.32687	27AAEFH5669J1ZX	\N	\N	Dhule	Maharashtra	424001	AAEFH5669J
4	A B Wagh & Sundermadhav Constuction JV	Ajay Wagh	9823151779	abwagh25@gmail.com	t	2026-03-23 17:58:02.943232	2026-04-06 17:39:29.302187	27ABLFA4635P1ZV	\N	\N	Dhule	Maharashtra	424001	ABLFA4635P
5	Aashapuri Cotex	Vijaysingh Girase	9404191069	akshaydesale12@gmail.com	t	2026-03-23 17:58:02.952447	2026-04-06 17:39:37.906684	27ABSFA5013E1ZL	\N	\N	Dhule	Maharashtra	424001	ABSFA5013E
7	Alpa Anup Agrawal	Chirayu Agrawal	7517721815	shrikantsharma_ca@rediffmail.com	t	2026-03-23 17:58:02.957348	2026-04-06 17:41:47.799378	27AEBPA8988G1Z9	\N	\N	Dhule	Maharashtra	424001	AEBPA8988G
10	Anup Omprakash Agrawal	Chirayu Agrawal	9823144927	anupagrawalmvat@gmail.com	t	2026-03-23 17:58:02.963652	2026-04-06 17:42:31.883569	27AAKPA2461R1ZD	\N	\N	Dhule	Maharashtra	424001	AAKPA2461R
11	Atharav Enterprises Prop. Shashikant Shripat Patil	Shashikant Patil	7350454531	shrikantsharmaca@gmail.com	t	2026-03-23 17:58:02.96582	2026-04-06 17:42:54.84092	27AMIPP2468B1Z1	\N	\N	Dhule	Maharashtra	424001	AMIPP2468B
13	Bankatlal Bang	Anand Bang	8485826654	bankatlalbang@gmail.com	t	2026-03-23 17:58:02.970166	2026-04-06 17:44:03.544294	27ABRPB9287G1Z4	\N	\N	Dhule	Maharashtra	424001	ABRPB9287G
14	Bhagwati Construction	Deepak Bhamare	9422296330	sundermadhav2016@gmail.com	t	2026-03-23 17:58:02.972312	2026-04-06 17:44:10.786904	27AAYFB3980E1Z0	\N	\N	Dhule	Maharashtra	424001	AAYFB3980E
15	Bhausaheb U Sonawane	Bhausaheb U Sonawane	7588520465	bhausahebgst@gmail.com	t	2026-03-23 17:58:02.974397	2026-04-06 17:44:35.862523	27AFFPS8453M1ZO	\N	\N	Dhule	Maharashtra	424001	AFFPS8453M
45	Maharashtra Solvent Extraction Private Limited	Sanjay Agrawal	9823044217	shrikantsharma_ca@rediffmail.com	t	2026-03-23 17:58:03.039407	2026-04-06 18:04:27.618873	27AADCM8466G1Z5	\N	\N	Dhule	Maharashtra	424001	AADCM8466G
46	Maharashtra Mahila Sahakari Gruh Udyog	Ashadevi Agrawal	9422289142	mahamahila2016@gmail.com	t	2026-03-23 17:58:03.041976	2026-04-06 18:35:44.69313	27AADFM8202H1ZF	\N	\N	Dhule	Maharashtra	424001	AADFM8202H
26	Tusova Agro Private Limited	Prashant Kanugo	9422778315	\N	t	2026-03-23 17:58:02.998214	2026-04-06 18:35:50.629026	27AADCG3105C1Z9	\N	\N	Dhule	Maharashtra	424001	AADCG3105C
28	Heet Auto Nandurbar - Bhagwan Hari Patil	Devendra Patil	7588318225	heetsuzuki@gmail.com	t	2026-03-23 17:58:03.002328	2026-04-06 18:48:33.757693	27ABHPP1239Q2Z2	\N	\N	Dhule	Maharashtra	424001	ABHPP1239Q
27	Heet Automotive Private Limited	Devendra Patil	7588318224	heetsuzuki@gmail.com	t	2026-03-23 17:58:03.000325	2026-04-06 18:48:40.54798	27AADCH5988A1ZH	\N	\N	Dhule	Maharashtra	424001	AADCH5988A
32	Jai Ambe Agro Sales Prop. Priti Devendra Patil	Devendra Patil	9856010894	jayambesrt@gmail.com	t	2026-03-23 17:58:03.010507	2026-04-07 18:18:23.194444	27ARTPP9938L1ZI	\N	\N	Dhule	Maharashtra	424001	ARTPP9938L
33	Jay Motors Prop. Devendra B Patil	Devendra Patil	9326010894	jaymotorscnh@gmail.com	t	2026-03-23 17:58:03.01363	2026-04-07 18:18:39.939844	27ABHPP1240K1ZM	\N	\N	Dhule	Maharashtra	424001	ABHPP1240K
40	Kulswamini Stone Crusher Prop. Pramod Shelar	Pramod Shelar	9823625500	kulswaminigst@rediffmail.com	t	2026-03-23 17:58:03.027698	2026-04-07 18:32:08.173977	27BHCPS2298N1ZL	\N	\N	Dhule	Maharashtra	424001	BHCPS2298N
1	Maa Shakambari Impex	NARENDRA JOSHI	9422382352	\N	t	2026-03-16 20:55:46.646017	2026-04-07 18:37:43.640347	27ABRFM1014E1ZH	\N	\N	\N	\N	\N	ABRFM1014E
31	Intel Electronic Prop. Chhajendra Ramesh Sonawane	Chhajendra Sonawane	9422286573	\N	t	2026-03-23 17:58:03.008434	2026-04-06 19:17:37.48942	27ADQPS8176E1ZU	\N	\N	Dhule	Maharashtra	424001	ADQPS8176E
334	Mishribai Agrotech Private Limited			\N	t	2026-04-07 18:50:29.912961	2026-04-07 18:50:29.912961	27AAICM4904A1ZT	\N	\N	\N	\N	\N	AAICM4904A
59	Om Industries	Mahendra Agrawal	9049277677	madhuroil@rediffmail.com	t	2026-03-23 17:58:03.074891	2026-04-07 18:56:23.245627	27AACFO4056E1ZG	\N	\N	Dhule	Maharashtra	424001	AACFO4056E
61	Om Shiv Construction	Kailas Hajare	9422285435	\N	t	2026-03-23 17:58:03.078867	2026-04-08 11:05:12.016965	27AADFO0557F1ZF	\N	\N	Dhule	Maharashtra	424001	AADFO0557F
63	Pankaj Deepak Agrawal	Pankaj Deepak Agrawal	9422286459	pankajagrawal459@gmail.com	t	2026-03-23 17:58:03.082925	2026-04-07 17:06:33.93765	27AFXPA8013P1ZU	\N	\N	Dhule	Maharashtra	424001	AFXPA8013P
67	R S Infra	Rohan Biraris	8600069169	rsinfragst@gmail.com	t	2026-03-23 17:58:03.091092	2026-04-08 11:09:38.587046	27AAYFR1784L1Z7	\N	\N	Dhule	Maharashtra	424001	AAYFR1784L
69	Raj Trading Co	Bhupendra Vora	9422788299	rajtradingmvat@gmail.com	t	2026-03-23 17:58:03.095201	2026-04-08 11:10:11.014484	27AABPV2221K1ZP	\N	\N	Dhule	Maharashtra	424001	AABPV2221K
54	New Tulsi Super Shop Prop. Vipul Badhan	Vipul Badhan	8275591100	premd60@gmail.com	t	2026-03-23 17:58:03.061949	2026-04-07 17:11:43.709405	27ANMPB9993L1Z4	\N	\N	Dhule	Maharashtra	424001	ANMPB9993L
78	Sai Mathamba Traders Prop. Yogesh Badhan	Yogesh Badhan	9404445555	badhan.yogesh@gmail.com	t	2026-03-23 17:58:03.114395	2026-04-07 17:11:59.033079	27AHYPB8956B1ZX	\N	\N	Dhule	Maharashtra	424001	AHYPB8956B
52	Mule Construction	Sagar Mule	9421525888	muleconstructions@gmail.com	t	2026-03-23 17:58:03.057081	2026-04-08 11:14:31.393915	27ABIFM9486D1ZS	\N	\N	Dhule	Maharashtra	424001	ABIFM9486D
86	Shraddha Agencies Prop. Ramakant B Wani	Sagar Alai	9422296474	sagar.pa574@gmail.com	t	2026-03-23 17:58:03.132972	2026-04-08 11:14:54.054869	27AABPW6920E1ZN	\N	\N	Dhule	Maharashtra	424001	AABPW6920E
62	Pancham Dalpat More	Pancham Dalpat More	7498610298	rahul.more1111@gmail.com	t	2026-03-23 17:58:03.080878	2026-03-23 17:58:03.080878	27AAXPM8908N1ZK	\N	\N	Dhule	Maharashtra	424001	\N
82	Satpuda Constructions	Madhukar Bagale	9422286693	satpudaconstructions@yahoo.com	t	2026-03-23 17:58:03.123183	2026-04-08 11:20:47.122113	27AAYFS0060Q1ZD	\N	\N	Dhule	Maharashtra	424001	AAYFS0060Q
87	Shree Madhur Foods	Mahendra Agrawal	9049277677	madhuroil@rediffmail.com	t	2026-03-23 17:58:03.135578	2026-04-08 11:23:00.793038	27AABCM5763A1ZP	\N	\N	Dhule	Maharashtra	424001	AABCM5763A
77	Sai Anand Devlopers	Hemant Patil	9823054065	saianand568@gmail.com	t	2026-03-23 17:58:03.112323	2026-04-08 11:47:30.487713	27ACPFS1577F1ZP	\N	\N	Dhule	Maharashtra	424001	ACPFS1577F
74	Rupal Dinesh Patil	Rupal Patil	9422790004	yash.shahada@gmail.com	t	2026-03-23 17:58:03.106313	2026-04-07 17:20:00.528862	27ARTPP9937F1ZW	\N	\N	Dhule	Maharashtra	424001	ARTPP9937F
60	Omkar Medicose	Mahesh Patil	9823497728	omkarmedicose@rediffmail.com	t	2026-03-23 17:58:03.076901	2026-04-07 17:40:00.208758	27AAFFO1305B1ZX	\N	\N	Dhule	Maharashtra	424001	AAFFO1305B
81	Sankalp Foods	Varsha Borse	9421500569	varshaborse1967@gmail.com	t	2026-03-23 17:58:03.121011	2026-04-08 11:56:01.4014	27AEFFS5008B1ZD	\N	\N	Dhule	Maharashtra	424001	AEFFS5008B
71	Rajpal Samdas Vora	Bhupendra Vora	9422788299	rajpalvora@yahoo.com	t	2026-03-23 17:58:03.099174	2026-03-23 17:58:03.099174	27AADFR4584M1ZM	\N	\N	Dhule	Maharashtra	424001	\N
89	Shri Samarth Krupa Agro Agency Prop. Malti Sambhaji Chaudhari	Mahesh Chaudhari	9823060137	chaudhari1956chaudhari@gmail.com	t	2026-03-23 17:58:03.139645	2026-04-07 17:40:31.081743	27AWUPC9950H1ZX	\N	\N	Dhule	Maharashtra	424001	AWUPC9950H
355	Ganesh Sanjay Naik			\N	t	2026-04-08 16:18:16.795478	2026-04-08 16:18:16.795478	\N	\N	\N	\N	\N	\N	BMEPN0206L
90	Shriram Industries Prop. Mahesh Malpani	Mahesh Malpani	9422756857	maheshkrish7301@yahoo.com	t	2026-03-23 17:58:03.141704	2026-04-07 17:40:48.854606	27AAZPM7778A1ZZ	\N	\N	Dhule	Maharashtra	424001	AAZPM7778A
49	Manoharlal Mohanlal Prop. Meshodevi Manoharlal Mandan	Deepak Mandan	9422286462	manoharlalmvat@gmail.com	t	2026-03-23 17:58:03.050156	2026-04-07 17:41:17.885231	27ANFPM4781N1ZC	\N	\N	Dhule	Maharashtra	424001	ANFPM4781N
84	Sharp Line Travel	Kamlesh Kakariya	9422787207	shrikantsharmaca@gmail.com	t	2026-03-23 17:58:03.127667	2026-03-23 17:58:03.127667	27AAZFS7983F1Z5	\N	\N	Dhule	Maharashtra	424001	\N
83	Shanti Trading Prop. Ajit Rathod HUF	Ajit Rathod	7588629886	shantitradinggst@rediffmail.com	t	2026-03-23 17:58:03.125335	2026-04-07 17:46:24.225543	27AAHHR9009P1ZE	\N	\N	Dhule	Maharashtra	424001	AAHHR9009P
91	Soma Nutrition Labs Private Limited	Hemant Pathak	9167883236	teamgst@yahoo.com	t	2026-03-23 17:58:03.143812	2026-03-23 17:58:03.143812	27AATCS0217R3ZL	\N	\N	Dhule	Maharashtra	424001	\N
56	Nilima M Bagale	Nilima M Bagale	8888180881	nilimabagale@yahoo.com	t	2026-03-23 17:58:03.067316	2026-04-06 17:35:59.259444	27AZKPB9696C1Z1	\N	\N	Dhule	Maharashtra	424001	AZKPB9696C
68	Rahul More	Rahul More	8888554500	rahulmoregst@gmail.com	t	2026-03-23 17:58:03.093111	2026-04-06 17:37:06.324626	27BUEPM9363B1ZJ	\N	\N	Dhule	Maharashtra	424001	BUEPM9363B
85	Sharvari Associates	Rahul Borse	9004523241	sharvari_ac@yahoo.com	t	2026-03-23 17:58:03.130146	2026-04-06 17:37:13.156674	27DYDPB5890P1ZS	\N	\N	Dhule	Maharashtra	424001	DYDPB5890P
53	Navjeevan Book Stall Prop. Pradeep Balkrishna Wani	Sagar Alai	9422504645	sagar.pa574@gmail.com	t	2026-03-23 17:58:03.059311	2026-04-06 17:38:30.146759	27AABPW6919M1ZZ	\N	\N	Dhule	Maharashtra	424001	AABPW6919M
72	Raviraj Internationals	Sanjay Agrawal	9920120501	ravirajmvat@gmail.com	t	2026-03-23 17:58:03.101752	2026-04-06 17:46:24.104498	27AAGCR0689B1ZE	\N	\N	Dhule	Maharashtra	424001	AAGCR0689B
75	S K Agrotech	Sanjay Agrawal	9823172175	skoiljalgaon@rediffmail.com	t	2026-03-23 17:58:03.108287	2026-04-06 18:04:41.214012	27AAKFM2762P1ZM	\N	\N	Dhule	Maharashtra	424001	AAKFM2762P
80	Sanjay Soya Private Limited	Sanjay Agrawal	9922711852	shrikantsharma_ca@rediffmail.com	t	2026-03-23 17:58:03.118458	2026-04-06 18:04:47.269788	27AAHCS9916M1ZL	\N	\N	Dhule	Maharashtra	424001	AAHCS9916M
66	R K Agro Products	Shashikant Agrawal	9420373230	rkproducts123@gmail.com	t	2026-03-23 17:58:03.088996	2026-04-06 18:05:49.466955	27AAKFR3283Q1ZD	\N	\N	Dhule	Maharashtra	424001	AAKFR3283Q
57	Nilkantha Enterprises Prop. Sunita Girish Bahalkar	Sunita Bahalkar	9082326126	nilkanth.ent6363@gmail.com	t	2026-03-23 17:58:03.069596	2026-04-06 18:06:57.233424	27ALDPB2220M1ZH	\N	\N	Dhule	Maharashtra	424001	ALDPB2220M
137	Omshiv Infra	Anup Agrawal	9923470019	rush2db@gmail.com	t	2026-03-23 17:58:03.257594	2026-04-07 17:46:55.3393	27AAHFO5723H1Z5	\N	\N	Dhule	Maharashtra	424001	AAHFO5723H
64	Parshwa Enterprises	Chirag Vora	9423981855	\N	t	2026-03-23 17:58:03.084922	2026-04-07 17:51:32.884911	27AASFP7932J1ZH	\N	\N	Dhule	Maharashtra	424001	AASFP7932J
65	Pedkai Petrolium	Jitendra Thakur	9422285330	pedkai_petroleum@yahoo.com	t	2026-03-23 17:58:03.08687	2026-04-07 17:53:18.696835	27ADQPT7732D1Z3	\N	\N	Dhule	Maharashtra	424001	ADQPT7732D
55	Nilesh Prakash Jadhav	Nilesh Prakash Jadhav	9922843999	\N	t	2026-03-23 17:58:03.064387	2026-04-07 17:54:27.735771	27ADJPJ6806D1ZN	\N	\N	Dhule	Maharashtra	424001	ADJPJ6806D
88	Shri Chintamani Agencies Prop. Pankaj Jain	Pankaj Jain	9423403406	pcj1983@rediffmail.com	t	2026-03-23 17:58:03.137647	2026-04-07 17:56:14.801752	27ARTPJ6480D1ZE	\N	\N	Dhule	Maharashtra	424001	ARTPJ6480D
70	Rajesh Jewellers Prop. Rajesh Verma	Rajesh Verma	9421532541	rajeshjewellers2016@gmail.com	t	2026-03-23 17:58:03.097199	2026-04-07 17:57:31.435619	27ADHPV8213A1ZM	\N	\N	Dhule	Maharashtra	424001	ADHPV8213A
58	Om Agro	Vijaysing Girase	8007676453	Vijaysing39@gmail.com	t	2026-03-23 17:58:03.072293	2026-04-07 18:00:28.763763	27AAHFO3234H1ZB	\N	\N	Dhule	Maharashtra	424001	AAHFO3234H
76	Saaras Packaging	Kamalkishor Bhattad	9822324649	bhattadkr@gmail.com	t	2026-03-23 17:58:03.110351	2026-04-07 18:19:48.907387	27AEDFS6601L1ZT	\N	\N	Dhule	Maharashtra	424001	AEDFS6601L
108	Nikunj Bang - Manokamana Petroleum	Nikunj Bang	9823007107	nikunjbang@gmail.com	t	2026-03-23 17:58:03.186957	2026-04-07 18:49:18.96796	27BMCPB3243B1ZT	\N	\N	Dhule	Maharashtra	424001	BMCPB3243B
129	Shri Ramesh Transport & Co.	Chetan Dayma	9420010000	Shrirameshtrans@gmail.com	t	2026-03-23 17:58:03.238759	2026-04-06 19:16:01.980529	27AFDFS1966B1Z2	\N	\N	Dhule	Maharashtra	424001	AFDFS1966B
92	Soni Silver Prop. Prakash Soni HUF	Mukesh Soni	9422788333	sonisilver103@gmail.com	t	2026-03-23 17:58:03.146024	2026-04-07 18:52:13.769355	27AAHHS1861A1ZC	\N	\N	Dhule	Maharashtra	424001	AAHHS1861A
113	Shreedhara Agro Services Prop. Swapnil Lakhote	Swapnil Lakhote	9420017474	swapnillakhote@gmail.com	t	2026-03-23 17:58:03.199842	2026-04-08 11:23:21.834272	27AFKPL5215K1Z8	\N	\N	Dhule	Maharashtra	424001	AFKPL5215K
121	Shri Kanushree Enterprises Prop. Meena S Khairnar	Sham Khairnar	9657718208	cavishnu20@gmail.com	t	2026-03-23 17:58:03.218607	2026-04-08 11:24:10.140069	27BMSPK0450M1ZM	\N	\N	Dhule	Maharashtra	424001	BMSPK0450M
128	Shri Krishna Steel Prop. Manjulaben Patel	Himanshu Patel	9422200834	\N	t	2026-03-23 17:58:03.236626	2026-04-08 11:27:15.495988	27AAMPP8733B1ZI	\N	\N	Dhule	Maharashtra	424001	AAMPP8733B
94	Sudam Bhuta Jaware	Sudam Bhuta Jaware	9422792569	sbjaware2016@gmail.com	t	2026-03-23 17:58:03.151534	2026-04-08 11:48:06.582138	27AAQPJ4985R1ZH	\N	\N	Dhule	Maharashtra	424001	AAQPJ4985R
107	Chhatrapati Import & Export	Kunal Patil	8793544849	apgreatsunna9@gmail.com	t	2026-03-23 17:58:03.184525	2026-04-06 19:17:55.957647	27AARFC8478M1ZE	\N	\N	Dhule	Maharashtra	424001	AARFC8478M
131	Kushal Constructions	Rajendra Chhajed	9595261893	kushalconstgst@gmail.com	t	2026-03-23 17:58:03.243157	2026-04-06 19:18:09.85802	27ABBFK5108M1Z7	\N	\N	Dhule	Maharashtra	424001	ABBFK5108M
293	Creative Foundation			\N	t	2026-04-07 17:03:41.397928	2026-04-07 17:03:41.397928	\N	\N	\N	\N	\N	\N	AABTC9231C
105	Kunal Digambar Patil	Kunal Patil	9763494444	digambardpatil4@gmail.com	t	2026-03-23 17:58:03.179572	2026-03-23 17:58:03.179572	27CDUPP2060G2Z7	\N	\N	Dhule	Maharashtra	424001	\N
258	Kirti Sandeep Saraf			\N	t	2026-04-02 17:25:24.222951	2026-04-07 17:04:29.836284	\N	\N	\N	\N	\N	\N	CHTPS4031F
135	Tulip Industries	Sudhir Joshi	9422786286	sudhirmore4444@gmail.com	t	2026-03-23 17:58:03.252502	2026-04-08 11:50:19.654905	27CPZPM8817F1Z2	\N	\N	Dhule	Maharashtra	424001	CPZPM8817F
123	M/S Shyam Enterprises	Shailesh Agrawal	7066002508	Dev_agrawal108@icloud.com	t	2026-03-23 17:58:03.224532	2026-04-08 11:50:41.616093	27AFBFS6702D1Z8	\N	\N	Dhule	Maharashtra	424001	AFBFS6702D
112	Shyam Enterprises	Shailesh Agrawal	7066002508	shyamsteel08@gmail.com	t	2026-03-23 17:58:03.197441	2026-04-08 11:50:47.528528	27AAKPA2449P1ZD	\N	\N	Dhule	Maharashtra	424001	AAKPA2449P
98	Topline Foods	Kaushik Agrawal	9011068466	toplinefoods2016@gmail.com	t	2026-03-23 17:58:03.161448	2026-04-08 11:54:30.06177	27AACFT2497E1Z2	\N	\N	Dhule	Maharashtra	424001	AACFT2497E
126	Varun Refreshments Prop. Varun G Bahalakar	Varun Bahalkar	8668759320	varun.refreshment2019@gmail.com	t	2026-03-23 17:58:03.232098	2026-04-08 11:56:13.856486	27DGPPB6492B1ZA	\N	\N	Dhule	Maharashtra	424001	DGPPB6492B
101	Yash Automotives Dhule	Dinesh Patil	9326010896	yashhero.dhule@gmail.com	t	2026-03-23 17:58:03.168782	2026-04-07 17:19:04.380117	27AABFY9246M1ZG	\N	\N	Dhule	Maharashtra	424001	AABFY9246M
130	Yashmeet Scooters P. Ltd.	Dinesh Patil	9673288220	yashmeetather.dhule@gmail.com	t	2026-03-23 17:58:03.240957	2026-04-07 17:19:09.16229	27AABCY7722K1ZX	\N	\N	Dhule	Maharashtra	424001	AABCY7722K
99	Tulsi Electric And Tv Prop. Mahendra Bedmutha	Mahendra Bedmuttha	7385720642	tulsimvat@gmail.com	t	2026-03-23 17:58:03.164274	2026-04-07 17:42:51.420676	27AAXPB8714F1ZG	\N	\N	Dhule	Maharashtra	424001	AAXPB8714F
120	Hemant Patil	Hemant Patil	9823054065	hemantppatil101@gmail.com	t	2026-03-23 17:58:03.216378	2026-03-23 17:58:03.216378	27AKNPP0548B2Z6	\N	\N	Dhule	Maharashtra	424001	\N
122	MIDC Nardana T Block JV	Kedar Joshi	9423982118	manojdisa5468@yahoo.com	t	2026-03-23 17:58:03.220926	2026-03-23 17:58:03.220926	27ABXFM4284C1ZT	\N	\N	Dhule	Maharashtra	424001	\N
97	Swami Telenet & Constructions	Anil Shirsath	7028604444	swamitelenetst2016@gmail.com	t	2026-03-23 17:58:03.158648	2026-04-07 17:43:52.956099	27ABDFS6161Q1ZI	\N	\N	Dhule	Maharashtra	424001	ABDFS6161Q
96	Super Marbles Prop. Ravjibhai Patel	Ravjibhai Patel	9823143739	mayu1939@gmail.com	t	2026-03-23 17:58:03.156307	2026-04-07 17:44:30.657609	27AAMPP7559D1Z8	\N	\N	Dhule	Maharashtra	424001	AAMPP7559D
119	Dilip Motiram Biraris	Rohan Biraris	9689888909	birarisdilip@gmail.com	t	2026-03-23 17:58:03.214039	2026-04-07 17:52:20.579444	27ABEPB6913C1Z6	\N	\N	Dhule	Maharashtra	424001	ABEPB6913C
136	K R Patil - Jay Siyaram Construction	K R Patil	9765000595	krpdhl95@gmail.com	t	2026-03-23 17:58:03.255447	2026-03-23 17:58:03.255447	27AGAPP7989F1ZU	\N	\N	Dhule	Maharashtra	424001	\N
239	Jitendra Bhavsar	Harsh Bhavsar	9545878255		t	2026-04-02 12:12:44.262598	2026-04-02 12:12:44.262598	\N	\N	\N	\N	\N	\N	\N
106	Rahul Enterprises	Rahul Agrawal	9823716921	dhulerahulenterprises@gmail.com	t	2026-03-23 17:58:03.182153	2026-04-06 17:36:59.610016	27AHZPG6869R1ZU	\N	\N	Dhule	Maharashtra	424001	AHZPG6869R
133	Shrinivas Sanjay Kute	Shrinivas Sanjay Kute	9673816681	swamikute69@gmail.com	t	2026-03-23 17:58:03.247657	2026-04-06 18:05:10.57145	27ESQPK3671D1ZF	\N	\N	Dhule	Maharashtra	424001	ESQPK3671D
104	M/S Sundarmadhav Construction	Deepak Bhamare	9422296330	sundermadhav2016@gmail.com	t	2026-03-23 17:58:03.176686	2026-04-06 18:32:02.392559	27AESFS0092L1ZD	\N	\N	Dhule	Maharashtra	424001	AESFS0092L
95	Sundermadhav Constructions  - Deepak Bhamare	Deepak Bhamare	9422296330	sundermadhav2016@gmail.com	t	2026-03-23 17:58:03.154091	2026-04-06 18:32:21.139903	27AAMPB2271J1ZQ	\N	\N	Dhule	Maharashtra	424001	AAMPB2271J
102	Krishna Handloom	Amol Pingale	9422786100	pranjalipingale05@gmail.com	t	2026-03-23 17:58:03.170982	2026-04-06 18:59:10.932269	27AAYFK7113Q1ZD	\N	\N	Dhule	Maharashtra	424001	AAYFK7113Q
103	Krishna Plywood Prop. Ramesh Purshottam Patel	Himanshu Patel	9422774434	krishnagroupdhule@gmail.com	t	2026-03-23 17:58:03.173408	2026-04-06 18:59:48.004813	27AAMPP8743R1ZJ	\N	\N	Dhule	Maharashtra	424001	AAMPP8743R
118	Shri Krishna Sale Corporation Prop. Hiralal P. Patel	Himanshu Patel	9422774434	krishnagroupdhule@gmail.com	t	2026-03-23 17:58:03.211738	2026-04-06 19:00:22.019114	27AANPP4545L1Z2	\N	\N	Dhule	Maharashtra	424001	AANPP4545L
117	Shri Krishna Sales Prop. Vinod P. Patel	Himanshu Patel	9422774434	krishnagroupdhule@gmail.com	t	2026-03-23 17:58:03.209398	2026-04-06 19:00:41.703858	27AAMPP8741P1ZP	\N	\N	Dhule	Maharashtra	424001	AAMPP8741P
116	Shri Krishna Saw Mill	Himanshu Patel	9422774434	krishnagroupdhule@gmail.com	t	2026-03-23 17:58:03.206786	2026-04-06 19:04:08.182197	27AAGFK7340F1ZD	\N	\N	Dhule	Maharashtra	424001	AAGFK7340F
111	M/s Jitendra & Co	Jitendra Shah	9422778091	keyurvshah@yahoo.co.in	t	2026-03-23 17:58:03.195074	2026-04-07 17:53:14.07841	27AASFJ5860D1Z1	\N	\N	Dhule	Maharashtra	424001	AASFJ5860D
294	Dr Deepa Sachin Chaudhary			\N	t	2026-04-07 17:05:36.363107	2026-04-07 17:59:38.25765	\N	\N	\N	\N	\N	\N	AKWPC0803F
134	Megatech Solutions	Uday Joshi	9423191706	uday_kipl@rediffmail.com	t	2026-03-23 17:58:03.249915	2026-04-07 18:17:09.963862	27ACAFM1933A1ZS	\N	\N	Dhule	Maharashtra	424001	ACAFM1933A
124	Mahalaxmi Electronics Prop. Sunny Khairnar	Shobha Khairnar	9373235765	akshaydesalg1z4181@gmail.com	t	2026-03-23 17:58:03.227377	2026-04-07 18:34:16.830433	27AICPK6276G1Z4	\N	\N	Dhule	Maharashtra	424001	AICPK6276G
115	Manik Constructions Prop. Rushikesh Kachave	Rushikesh Kachave	9011931152	rushikeshkachave09@gmail.com	t	2026-03-23 17:58:03.204576	2026-04-07 18:47:41.267042	27EJTPK4053D1Z0	\N	\N	Dhule	Maharashtra	424001	EJTPK4053D
114	Manik Transport	Rushikesh Kachave	9011931152	rushikeshkachave09@gmail.com	t	2026-03-23 17:58:03.20213	2026-04-07 18:47:47.354795	27ABWFM7674D1ZK	\N	\N	Dhule	Maharashtra	424001	ABWFM7674D
168	Mukesh Bamb	Mukesh Bamb	9421533070	mukeshbamb2016@yahoo.com	t	2026-03-23 17:58:03.344591	2026-04-07 18:51:00.130547	27ABEPB6757C1ZW	\N	\N	Dhule	Maharashtra	424001	ABEPB6757C
138	Dr Bhushan Chaudhari	Dr Bhushan Chaudhari	9822495135	drchaudharybhushan@gmail.com	t	2026-03-23 17:58:03.259708	2026-04-06 19:10:49.407371	27AAHPC7501M1ZP	\N	\N	Dhule	Maharashtra	424001	AAHPC7501M
93	Subhashchandra & Sons - Sushil Popli	Sushil Popli	9823148318	hotelkrishna29118@gmail.com	t	2026-03-23 17:58:03.148192	2026-04-06 19:13:30.083707	27AAVPP2582R1ZH	\N	\N	Dhule	Maharashtra	424001	AAVPP2582R
153	Shri Soni Silver - Mukesh Soni	Mukesh Soni	9209293151	shrisonisilver25@gmail.com	t	2026-03-23 17:58:03.304014	2026-04-07 18:51:20.859695	27ANYPS4761M1ZT	\N	\N	Dhule	Maharashtra	424001	ANYPS4761M
335	Dr Nainesh Bhalchandra Desale			\N	t	2026-04-07 18:52:55.448442	2026-04-07 18:52:55.448442	\N	\N	\N	\N	\N	\N	AEMPD8980L
340	Om Shree Agro Industries Private Limited			\N	t	2026-04-08 11:06:00.080835	2026-04-08 11:06:00.080835	27AAACO4104A1Z7	\N	\N	\N	\N	\N	AAACO4104A
286	Chandrashekhar Kisanrao Mugul			\N	t	2026-04-06 19:14:02.911824	2026-04-06 19:14:02.911824	\N	\N	\N	\N	\N	\N	AGRPM1635N
152	Saanvi Infra	Vinod Hire	9922143399	saanviinfra.0506@gmail.com	t	2026-03-23 17:58:03.301481	2026-04-08 11:09:44.904665	27AFNFS1398M1Z3	\N	\N	Dhule	Maharashtra	424001	AFNFS1398M
141	Dhananjay Kishor Shelar	Dhananjay Shelar	9168661225	\N	t	2026-03-23 17:58:03.266682	2026-04-07 17:11:26.575325	27MGGPS1732R1ZF	\N	\N	Dhule	Maharashtra	424001	MGGPS1732R
143	M/S Dilip Biraris	Rohan Biraris	8600069169	dmbirarisms@gmail.com	t	2026-03-23 17:58:03.270994	2026-04-07 17:16:59.564673	27AAWFD9364N1ZB	\N	\N	Dhule	Maharashtra	424001	AAWFD9364N
172	D P Engineers Prop. Dinesh Rasiklal Agrawal	Dinesh Agrawal	9422289693	shrikantsharmaca@gmail.com	t	2026-03-23 17:58:03.353893	2026-04-07 17:19:54.267401	27AAKPA2554R1ZB	\N	\N	Dhule	Maharashtra	424001	AAKPA2554R
146	Relan Cloth	Suresh Relan	9226487654	relan.group@gmail.com	t	2026-03-23 17:58:03.279786	2026-04-08 11:11:33.526453	27AACFR9041G1Z6	\N	\N	Dhule	Maharashtra	424001	AACFR9041G
145	Relan Nx	Suresh Relan	9421536885	relan.group@gmail.com	t	2026-03-23 17:58:03.276643	2026-04-08 11:12:02.944797	27AAIFR2715D1ZF	\N	\N	Dhule	Maharashtra	424001	AAIFR2715D
149	Relans The Raymond Shop	Suresh Relan	9226487654	relan.group@gmail.com	t	2026-03-23 17:58:03.292489	2026-04-07 17:41:37.159882	27AAHFR4792B1Z3	\N	\N	Dhule	Maharashtra	424001	AAHFR4792B
181	Relan Studio Prop. Kajal P Relan	Suresh Relan	9168808208	\N	t	2026-03-23 17:58:03.376166	2026-04-08 11:12:17.228543	27BFTPK1083E1ZA	\N	\N	Dhule	Maharashtra	424001	BFTPK1083E
177	Ajinkya Handloom Prop. Amol Pingale	Amol Pingale	9422786100	jpgaud@gmail.com	t	2026-03-23 17:58:03.365719	2026-04-07 17:46:08.888841	27AMPPP0689R1ZU	\N	\N	Dhule	Maharashtra	424001	AMPPP0689R
156	Surabhi Traders Prop. Nitin Rajesh Chavda	Nitin Chawda	9284219807	surabhitraders.dhl@gmail.com	t	2026-03-23 17:58:03.312451	2026-04-07 17:50:30.263646	27CKSPC4959A1Z0	\N	\N	Dhule	Maharashtra	424001	CKSPC4959A
147	Relan Style Prop. Punit S Relan	Suresh Relan	9226487654	relan.group@gmail.com	t	2026-03-23 17:58:03.284607	2026-04-08 11:12:46.897244	27AFAPR7439H1Z5	\N	\N	Dhule	Maharashtra	424001	AFAPR7439H
176	Relans Linen Prop. Rohit S Relan	Suresh Relan	9373651832	relan.group@gmail.com	t	2026-03-23 17:58:03.363187	2026-04-08 11:13:13.09953	27AVKPR6623F1ZA	\N	\N	Dhule	Maharashtra	424001	AVKPR6623F
164	Furniture First	Virendra Agrawal	9420257475	furniturefirst568@yahoo.com	t	2026-03-23 17:58:03.334733	2026-03-23 17:58:03.334733	27AFYPA7256B1ZB	\N	\N	Dhule	Maharashtra	424001	\N
163	Utkarsh Traders Prop. Swati Mukesh Bamb	Mukesh Bamb	9423427088	utkarshatraders2016@gmail.com	t	2026-03-23 17:58:03.332495	2026-04-07 17:50:47.843389	27AOCPB2178J1Z1	\N	\N	Dhule	Maharashtra	424001	AOCPB2178J
155	Parshwaveer Luxecraft	Chirag Vora	9764435099	rsvora16@gmail.com	t	2026-03-23 17:58:03.30944	2026-04-07 17:51:38.114506	27ABGFP9074N1ZE	\N	\N	Dhule	Maharashtra	424001	ABGFP9074N
171	Rishabh Agency Prop. Ritu V Malara	Vishal Malara	9822502552	rushabagency2016@gmail.com	t	2026-03-23 17:58:03.351529	2026-04-08 11:13:46.408207	27AFXPM4728H1ZT	\N	\N	Dhule	Maharashtra	424001	AFXPM4728H
165	S G Gupta	Bhupesh Gupta	9823079704	sggupta568@yahoo.com	t	2026-03-23 17:58:03.336956	2026-04-08 11:14:07.227176	27AAMFS8647P1Z2	\N	\N	Dhule	Maharashtra	424001	AAMFS8647P
142	Sumit Dilip Gaikwad	Sumit Dilip Gaikwad	9892110887	Sumit.gaikwad@gmail.com	t	2026-03-23 17:58:03.268786	2026-04-07 17:52:37.702805	27AKAPG2149L1Z7	\N	\N	Dhule	Maharashtra	424001	AKAPG2149L
183	Mahasagar Orchid Ventures LLP	Ved Gindodiya	9167029955	mahasagarorchid@gmail.com	t	2026-03-23 17:58:03.381234	2026-04-08 11:14:25.855893	27ACEFM0127C1ZS	\N	\N	Dhule	Maharashtra	424001	ACEFM0127C
348	Shri Laxmi Nagari Sahakari Patsanstha Limited			\N	t	2026-04-08 11:47:06.186095	2026-04-08 11:47:06.186095	\N	\N	\N	\N	\N	\N	AAAJS2822C
158	Laxmi Fertilizers Prop. Rajesh Lakhote	Rajesh Lakhote	9423980422	laxmifertilizersgst@gmail.com	t	2026-03-23 17:58:03.317751	2026-04-07 17:57:18.879559	27AACPL9279Q1ZQ	\N	\N	Dhule	Maharashtra	424001	AACPL9279Q
356	Dr Gaurav Kiranchandra Koranne			\N	t	2026-04-08 16:19:37.157317	2026-04-08 16:19:37.157317	\N	\N	\N	\N	\N	\N	FUHPK1761G
361	Aditya Hospital - Firm				t	2026-04-18 19:07:39.868034	2026-04-18 19:07:39.868034	\N	\N	\N	\N	\N	\N	ACMFA2667H
179	Satyam Medical And Gen Stores	Rajesh Agrawal	9423979544	\N	t	2026-03-23 17:58:03.370627	2026-04-07 17:57:57.141101	27AEGFS8955J1Z9	\N	\N	Dhule	Maharashtra	424001	AEGFS8955J
150	Rahul Desale - New	Rahul Desale	9503145118	\N	t	2026-03-23 17:58:03.295973	2026-04-06 17:36:53.54513	27DVUPD2389M1ZP	\N	\N	Dhule	Maharashtra	424001	DVUPD2389M
182	Anand Khairnar Architects	Anand Khairnar	9022189298	anandkhairnar2011@gmail.com	t	2026-03-23 17:58:03.378843	2026-04-06 17:41:56.10098	27ACJFA5885C1Z8	\N	\N	Dhule	Maharashtra	424001	ACJFA5885C
144	Atul Bang HUF	Anand Bang	8600118600	\N	t	2026-03-23 17:58:03.273481	2026-04-06 17:43:02.692826	27AAZHA1685G1ZU	\N	\N	Dhule	Maharashtra	424001	AAZHA1685G
151	Bang Enterprises	Anand Bang	9823007107	nikunjbang@gmail.com	t	2026-03-23 17:58:03.298972	2026-04-06 17:43:51.577611	27AAXFB8650L1ZL	\N	\N	Dhule	Maharashtra	424001	AAXFB8650L
166	Khandesh Vikas Farmer	Sachin Bhadane	7020130825	sbhadane50@gmail.com	t	2026-03-23 17:58:03.339111	2026-04-06 18:03:24.98106	27AAFCK9305E1ZL	\N	\N	Dhule	Maharashtra	424001	AAFCK9305E
159	Kwality Drugs	Sachin Sharma	9822324649	kwalitydrugs2016@gmail.com	t	2026-03-23 17:58:03.322603	2026-04-06 18:03:37.355084	27AAGFK2845P1ZS	\N	\N	Dhule	Maharashtra	424001	AAGFK2845P
160	Suyash Enterprises	Sachin Sharma	7020498123	shrikantsharma_ca@rediffmail.com	t	2026-03-23 17:58:03.325509	2026-04-06 18:03:43.32158	27AAXFS4897G1Z6	\N	\N	Dhule	Maharashtra	424001	AAXFS4897G
157	Maharashtra Vegetable Products Private Limited	Sanjay Agrawal	9960437555	satyamcotex@gmail.com	t	2026-03-23 17:58:03.315195	2026-04-06 18:04:34.237695	27AABCM9041R1ZV	\N	\N	Dhule	Maharashtra	424001	AABCM9041R
154	Vasudha Amol Khairnar	Vasudha Khairnar	9922220818	mail4vasudha@gmail.com	t	2026-03-23 17:58:03.306722	2026-04-06 18:07:21.48493	27AUFPK9363D1ZH	\N	\N	Dhule	Maharashtra	424001	AUFPK9363D
169	Krishna Hardware	Vishal Agrawal	9765020555	girishmittal64@gmail.com	t	2026-03-23 17:58:03.346911	2026-04-06 18:59:16.57419	27AAUFK7204N1ZN	\N	\N	Dhule	Maharashtra	424001	AAUFK7204N
140	Shree Krishna Bio Agro Product	Divyam Agrawal	9423192233	shreekrishna.bap@gmail.com	t	2026-03-23 17:58:03.26459	2026-04-06 19:00:00.870591	23AFJFS0806A1ZL	\N	\N	Dhule	Maharashtra	424001	AFJFS0806A
174	Gvt Global Industries Dhule	Tushar Agrawal	9765020555	girishmittal64@gmail.com	t	2026-03-23 17:58:03.358601	2026-04-07 18:16:38.238744	27AATFG5631Q1ZJ	\N	\N	Dhule	Maharashtra	424001	AATFG5631Q
175	Surbhi Motors Prop. Amol Chaudhari	Surbhi Motors	9823757571	surbhienterprises2016@yahoo.com	t	2026-03-23 17:58:03.360909	2026-04-07 18:18:53.466555	27AHJPC5585G1Z6	\N	\N	Dhule	Maharashtra	424001	AHJPC5585G
170	Vaibhav Laxmi Textile Prop. Seema Lalwani	Dimpu Lalwani	8830251219	seemalalwani1968@gmail.com	t	2026-03-23 17:58:03.349259	2026-04-07 18:34:31.546081	27ABXPL7632F1Z5	\N	\N	Dhule	Maharashtra	424001	ABXPL7632F
185	Furniture House	Virendra Agrawal	9420257475	furniturefirst@rediffmail.com	t	2026-03-23 17:58:03.386022	2026-03-23 17:58:03.386022	27BQKPM8712N1Z5	\N	\N	Dhule	Maharashtra	424001	\N
162	Nandurbar Gas Company	Hiren Chaliyawala	9923077275	nandurbargasmvat@gmail.com	t	2026-03-23 17:58:03.330256	2026-04-07 18:53:21.934982	27AABFN9500H1ZD	\N	\N	Dhule	Maharashtra	424001	AABFN9500H
233	Parth Industries	PARTH INDUSTRIES	9822391120		t	2026-04-01 19:25:28.05306	2026-04-08 11:06:22.317744	27ABFFM4605F1ZG	\N	\N	\N	\N	\N	ABFFM4605F
187	Shivam Pharma Prop. Charuhas S Jagtap HUF	Charuhas Jagtap	9923088822	\N	t	2026-03-23 17:58:03.390798	2026-04-06 19:15:00.933666	27AADHC2028M1ZE	\N	\N	Dhule	Maharashtra	424001	AADHC2028M
189	Vighnaharta Medical Store	Surendra Zende	9890770459	\N	t	2026-03-23 17:58:03.395693	2026-03-23 17:58:03.395693	27AAUHS8890Q1ZJ	\N	\N	Dhule	Maharashtra	424001	\N
214	R R Agro Industries Prop. Shrikisan B Agrawal	YOGESH AGRAWAL	9422285347		t	2026-03-31 16:33:27.688512	2026-04-08 11:07:21.857456	27AGFPA4154J1ZK	\N	\N	\N	\N	\N	AGFPA4154J
210	Dhule And Nandurbar Jilha Prathamik Shikshakanchi Sahakari Pat Ltd	MAHENDRA SHINDE	7588733629	\N	t	2026-03-28 18:44:00.229571	2026-04-07 17:01:27.022269	\N	\N	\N	\N	\N	\N	\N
207	Chirantan Hospital	SUNIL PAGARE	9422769870	\N	t	2026-03-28 17:52:20.561545	2026-04-07 17:02:07.797281	\N	\N	\N	\N	\N	\N	AAMFC1251B
295	Dr. Jaywant Rajaram Deore			\N	t	2026-04-07 17:07:38.569707	2026-04-07 17:07:38.569707	\N	\N	\N	\N	\N	\N	AELPD3508H
213	R R Industries Prop. Kishor Shrikisan Agrawal	YOGESH AGRAWAL	9422285347		t	2026-03-31 16:24:55.616809	2026-04-08 11:07:46.077562	27AEVPA1925R1ZV	\N	\N	\N	\N	\N	AEVPA1925R
215	R R Udyog Prop. Yogesh S Agrawal	Yogesh Agrawal	9422285347		t	2026-03-31 17:04:54.134118	2026-04-08 11:08:03.571414	27ADEPA8117F1ZX	\N	\N	\N	\N	\N	ADEPA8117F
203	Shah Enterprises	SHAH ENTERPRISES	9422286722		t	2026-03-28 12:52:10.11061	2026-04-08 11:22:10.485947	27AAZFS4461J1ZD	\N	\N	\N	\N	\N	AAZFS4461J
199	Shreeji Medical Stores Prop. Sandesh R. Jain	Sandesh Jain	9423981890	\N	t	2026-03-23 17:58:03.420206	2026-04-08 11:23:50.003045	27AMCPJ4282H1Z1	\N	\N	Dhule	Maharashtra	424001	AMCPJ4282H
200	City Medical (Huf)	Sandesh Jain	8669031616	\N	t	2026-03-23 17:58:03.422436	2026-03-23 17:58:03.422436	27AAZHS5890P1ZM	\N	\N	Dhule	Maharashtra	424001	\N
223	Devendra Traders Prop. Devendra Vinod Chaudhari	DEVENDRA VINOD CHAUDHARI	9422505352		t	2026-04-01 18:12:16.370066	2026-04-07 17:08:30.056392	\N	\N	\N	\N	\N	\N	CGGPC6668C
297	Devendra Onkar Khairnar			\N	t	2026-04-07 17:09:17.689698	2026-04-07 17:09:17.689698	\N	\N	\N	\N	\N	\N	AGNPK7133K
236	Vinod Somnath Chaudhari	VINOD SOMNATH CHAUDHARY	9422590000		t	2026-04-01 19:59:50.763045	2026-04-08 11:52:33.676818	\N	\N	\N	\N	\N	\N	ADLPC5209R
184	Sales Corporation	Vaibhav Bhadlikar	8275563852	sachinkwality2182@gmail.com	t	2026-03-23 17:58:03.383569	2026-04-08 11:54:49.71116	27AFRFS4855H1ZA	\N	\N	Dhule	Maharashtra	424001	AFRFS4855H
208	Vilas Tyres Prop. Narottam Vedu Patil	VILAS TYRES	9423023537		t	2026-03-28 18:01:57.802836	2026-04-08 11:57:06.101993	27AAMPP0448F1ZM	\N	\N	\N	\N	\N	AAMPP0448F
192	Vishal Auto Agency Prop. Vishal Malara	Vishal Malara	9422263400	\N	t	2026-03-23 17:58:03.404292	2026-04-08 11:57:48.208761	27ABLPM0625M1ZE	\N	\N	Dhule	Maharashtra	424001	ABLPM0625M
220	Bhangdia Agro Products Prop. Kishor Bhangdia HUF	KISHOR ONKARMAL BHANGDIA HUF	9763712667	\N	t	2026-04-01 17:55:28.841274	2026-04-07 17:38:25.736337	27AADHB6870L1ZZ	\N	\N	\N	\N	\N	AADHB6870L
197	Janseva Medical	Abhijit Sisode	9372727373	\N	t	2026-03-23 17:58:03.415725	2026-04-07 17:44:07.399353	27FGYPS5104L1ZI	\N	\N	Dhule	Maharashtra	424001	FGYPS5104L
226	Hari Om Traders Proprietor Rajendra Himmatsing Rajput	RAJENDRA HIMMATSING RAJPUT	9423943490		t	2026-04-01 18:56:15.86424	2026-04-07 17:48:41.707882	27AFAPR5785A1ZE	\N	\N	\N	\N	\N	AFAPR5785A
231	Nikhil Traders Proprietor Suvarna Vinod Chaudhary	SUVARNA VINOD CHAUDHARY	9422352714		t	2026-04-01 19:16:45.799174	2026-04-07 17:51:13.149922	\N	\N	\N	\N	\N	\N	AQNPC3859L
186	SatiMata Medical Prop. Rajesh Rasiklal Agrawal HUF	Rajesh Agrawal	9404193202	\N	t	2026-03-23 17:58:03.388403	2026-04-07 17:57:49.914192	27AANHR4274E1ZU	\N	\N	Dhule	Maharashtra	424001	AANHR4274E
209	Seva Super Speciality And Critical Care Center Private Limited	RAJESH RASIKLAL AGRAWAL	9823020167	\N	t	2026-03-28 18:30:49.005049	2026-04-07 17:58:43.144484	\N	\N	\N	\N	\N	\N	AAOCS4445A
198	Shree Medical & General Stores	Rajesh Agrawal	9423979544	\N	t	2026-03-23 17:58:03.417945	2026-04-07 17:58:48.603736	27AEDFS8131B1Z9	\N	\N	Dhule	Maharashtra	424001	AEDFS8131B
195	S M Medical And General Prop. Vijay M Hire HUF	Vijay Hire	9422749644	\N	t	2026-03-23 17:58:03.411248	2026-04-07 18:00:43.368645	27AAJHV3848N1Z9	\N	\N	Dhule	Maharashtra	424001	AAJHV3848N
227	Hotel Ganpati Palace	VEERAM SHAH	9890697920		t	2026-04-01 19:00:39.429749	2026-04-07 18:17:44.958143	27AAFFG5361B1ZP	\N	\N	\N	\N	\N	AAFFG5361B
221	Dr Ashish Radheshyam Agrawal	Dr Ashish Radheshyam Agrawal	9422706414	\N	t	2026-04-01 18:01:31.13816	2026-04-01 18:01:31.13816	\N	\N	\N	\N	\N	\N	AESPA1592D
222	Dr Shital Ashish Agrawal	Ashish Agrawal	9422706414	\N	t	2026-04-01 18:02:34.804436	2026-04-01 18:02:34.804436	\N	\N	\N	\N	\N	\N	AGHPA0536E
217	M K Packaging Prop. Kishore Kaluram Agrawal	M K Packaging	9422788117	\N	t	2026-04-01 17:41:30.303608	2026-04-07 18:37:00.893226	27ADQPA2168Q1ZZ	\N	\N	\N	\N	\N	ADQPA2168Q
229	Kanchan Bhushan Chaudhari	BHUSHAN CHAUDHARI	9822495135		t	2026-04-01 19:07:39.231067	2026-04-01 19:07:39.231067	27ALYPC6899G1Z7	\N	\N	\N	\N	\N	ALYPC6899G
234	REAL WINES	VICKY SONAR	9860373909		t	2026-04-01 19:41:25.114301	2026-04-01 19:41:25.114301	27AAJFR1430Q1ZT	\N	\N	\N	\N	\N	AAJFR1430Q
237	Abhijeet Sisode	Abhijeet Sisode	9372727373		t	2026-04-02 12:02:57.125667	2026-04-02 12:02:57.125667	\N	\N	\N	\N	\N	\N	CQMPS9917G
238	Ghelabhai Deochand Group	Hemant Chaliyawala	7767036888		t	2026-04-02 12:06:11.564373	2026-04-02 12:06:11.564373	\N	\N	\N	\N	\N	\N	\N
216	Ashok Textiles	Kush Agrawal	9673160401	\N	t	2026-03-31 17:58:22.135448	2026-04-06 17:42:46.056645	27AAFFA9068B1ZJ	\N	\N	\N	\N	\N	AAFFA9068B
190	Raj Medical Prop. Rajmal Khemchand Jain	Ravi Sharma	9421532509	\N	t	2026-03-23 17:58:03.398769	2026-04-06 17:45:59.980179	27ABKPJ3444L1ZD	\N	\N	Dhule	Maharashtra	424001	ABKPJ3444L
193	Renuka Medical Prop. Ravi Chunilal Sharma HUF	Ravi Sharma	9422786121	\N	t	2026-03-23 17:58:03.406484	2026-04-06 18:01:36.295011	27AAOHR2744A1Z6	\N	\N	Dhule	Maharashtra	424001	AAOHR2744A
230	Kisan Agro Agency Prop. Pratiksha Sanjay Chaudhary	PRATIKSHA SANJAY CHAUDHARY	9420604260		t	2026-04-01 19:13:34.513068	2026-04-06 18:04:09.102537	27AZGPC8151K1Z7	\N	\N	\N	\N	\N	AZGPC8151K
224	Dilip Vasudev Gupta	DILIP VASUDEV GUPTA	9822335174	\N	t	2026-04-01 18:36:21.592746	2026-04-06 18:07:33.05124	\N	\N	\N	\N	\N	\N	ADSPG7643L
228	Kalyani Electronics And Electricals Prop. Vidya Vijay Dhobale	VIDYA VIJAY DHOBALE	9823717123	\N	t	2026-04-01 19:05:00.195793	2026-04-06 18:07:59.372653	27AHIPD1233D1ZZ	\N	\N	\N	\N	\N	AHIPD1233D
211	Hi Tech Diagnostic And Research Center	SUNIL PAGARE	9422769870	\N	t	2026-03-28 18:51:27.814758	2026-04-06 18:26:50.373762	\N	\N	\N	\N	\N	\N	AAIFH8022K
204	Khopade Automobiles Prop. Ashok Manikrao Khopade	ASHOK KHOPADE	9823023099		t	2026-03-28 12:57:04.256261	2026-04-06 18:38:15.751241	27AATPK0933F1ZM	\N	\N	\N	\N	\N	AATPK0933F
202	New Haji Trading Company Prop. Ansari Saud Ahmad Iqbal Ahmad	New Haji Trading Company	9921446914	\N	t	2026-03-23 17:58:03.426852	2026-04-06 18:40:34.921939	27ELMPA0077E1ZB	\N	\N	Dhule	Maharashtra	424001	ELMPA0077E
188	Krishna Chemist Prop. Deepak R. Khandelwal	Deepak Khandelwal	9423193032	\N	t	2026-03-23 17:58:03.393179	2026-04-06 18:59:04.488479	27AATPK1083G1ZH	\N	\N	Dhule	Maharashtra	424001	AATPK1083G
212	Shri Narayani Manufacturing Company	KRISHNA PASARI	7276165682	\N	t	2026-03-28 18:55:43.23218	2026-04-06 19:04:25.95226	27ADVFS7205B1ZW	\N	\N	\N	\N	\N	ADVFS7205B
205	Shrikrishna Khandsari Sugar Mills	Vinod Agrawal	9404191191		t	2026-03-28 15:51:03.224998	2026-04-06 19:05:35.379719	27AAGFS1508P1ZU	\N	\N	\N	\N	\N	AAGFS1508P
225	Gajanan Petroleum Proprietor Bhupendra Govindrao Jadhav	BHUPENDRA GOVINDRAO JADHAV	9403868686		t	2026-04-01 18:53:00.275531	2026-04-06 19:09:42.048724	27AEIPJ6758E1Z9	\N	\N	\N	\N	\N	AEIPJ6758E
240	Shree Moreshwar Developers	Rahul Bhattad	9881007018		t	2026-04-02 12:24:17.619939	2026-04-02 12:24:17.619939	\N	\N	\N	\N	\N	\N	AFLFS4279K
255	Veer Sai Ceramics Prop. Mahendrakumar Harichand Gadwal				t	2026-04-02 17:06:34.200268	2026-04-06 19:13:41.066755	27AUUPG2680G1ZA	\N	\N	\N	\N	\N	AUUPG2680G
196	Shivam Medical And General Stores	Rajesh Agrawal	9423979544	\N	t	2026-03-23 17:58:03.413504	2026-04-06 19:15:07.157626	27AEGFS8737L1Z9	\N	\N	Dhule	Maharashtra	424001	AEGFS8737L
287	Chetan Dilip Birairs			\N	t	2026-04-06 19:16:25.0039	2026-04-06 19:16:25.0039	27AOEPB8728C1Z6	\N	\N	\N	\N	\N	AOEPB8728C
249	Kuldaivat Petroleum	Hemant Wani	9423943514		t	2026-04-02 15:54:41.746472	2026-04-07 18:31:35.999683	27AAVFK8950E1ZQ	\N	\N	\N	\N	\N	AAVFK8950E
173	Essential Equipment Prop. Rahul Kulkarni	Rahul Kulkarni	9822187693	essential_equipments@yahoo.co.in	t	2026-03-23 17:58:03.35625	2026-04-07 18:31:49.909638	27ALUPK2320C1ZB	\N	\N	Dhule	Maharashtra	424001	ALUPK2320C
261	Manish Subhash Neve			\N	t	2026-04-02 17:27:00.076716	2026-04-07 18:47:24.921818	\N	\N	\N	\N	\N	\N	AFHPN1430P
250	Om Sai Granite Prop. Pooja Mukesh Gadwal	POOJA MUKESH GADWAL	9423495696		t	2026-04-02 16:40:30.533171	2026-04-07 18:51:11.827722	27AZLPG8868N1ZC	\N	\N	\N	\N	\N	AZLPG8868N
336	Nareshkumar and Co			\N	t	2026-04-07 18:54:08.138235	2026-04-07 18:54:08.138235	\N	\N	\N	\N	\N	\N	AADFN1563G
337	Navnath Agro Agencies Prop. Sunil Bhalchandra Salunkhe			\N	t	2026-04-07 18:55:18.461037	2026-04-07 18:55:18.461037	27BCBPS3928P1ZX	\N	\N	\N	\N	\N	BCBPS3928P
252	Shri Sai Samartha Krushi Vikas Kendra Prop. Anita Jagadish Shirsath				t	2026-04-02 16:46:12.588417	2026-04-08 11:21:17.281305	27BIJPS5826A1Z6	\N	\N	\N	\N	\N	BIJPS5826A
277	Abhishek Enterprises Prop. Ashadevi Shashikant Agrawal			\N	t	2026-04-06 18:36:43.218871	2026-04-08 11:25:01.366739	\N	\N	\N	\N	\N	\N	AAOPA3370P
260	Dr. Mahesh Krishnarao Ghugari			\N	t	2026-04-02 17:26:46.580406	2026-04-08 11:26:40.90804	\N	\N	\N	\N	\N	\N	AAOPG8564F
248	Dr Jitesh Jagdish Chaure - Suhari Hospital	Dr Jitesh Jagdish Chaure	9552610999		t	2026-04-02 15:50:28.899223	2026-04-08 11:54:03.085738	\N	\N	\N	\N	\N	\N	AMBPC0485A
256	Yogesh Shantilal Jain				t	2026-04-02 17:08:07.96509	2026-04-08 11:58:25.726418	27AHHPJ2538C1ZM	\N	\N	\N	\N	\N	AHHPJ2538C
263	RAHUL DINBANDHU KHANDELWAL			\N	t	2026-04-02 17:30:31.66597	2026-04-02 17:30:31.66597	\N	\N	\N	\N	\N	\N	ASQPK6517Q
48	Manish Bhikan Patil	Manish Bhikan Patil	7775902002	manishpatil02002@gmail.com	t	2026-03-23 17:58:03.04657	2026-04-06 17:34:26.835761	27DDOPP4965H1ZT	\N	\N	Dhule	Maharashtra	424001	DDOPP4965H
109	MAYUR RAMAKANT PATIL	Mayur Patil	9421451557	mayur77patil@gmail.com	t	2026-03-23 17:58:03.18938	2026-04-06 17:35:00.590821	27CINPP2883F1ZR	\N	\N	Dhule	Maharashtra	424001	CINPP2883F
262	Manoj Nago Sonavane			\N	t	2026-04-02 17:27:29.123468	2026-04-06 17:38:44.382067	\N	\N	\N	\N	\N	\N	BSPPS1010L
132	Navjeevan Stationers Prop. Yogesh Ramakant Alai	Sagar Alai	7588148297	sagar.pa574@gmail.com	t	2026-03-23 17:58:03.245378	2026-04-06 17:39:06.810869	27AUMPA7740B1ZV	\N	\N	Dhule	Maharashtra	424001	AUMPA7740B
218	Abdulla Esufjee & Sons	Abdulla Esufjee & Sons	9422786152	\N	t	2026-04-01 17:46:53.335462	2026-04-06 17:40:34.518177	27AACFA4482A1ZW	\N	\N	\N	\N	\N	AACFA4482A
241	Abhijeet Pharma	Abhijeet	8007761099		t	2026-04-02 12:37:38.96157	2026-04-06 17:40:50.808503	27AAWFA6785G1ZQ	\N	\N	\N	\N	\N	AAWFA6785G
242	Ahuja Medicos Prop. Anil J. Ahuja	ANIL J. AHUJA	9923158815		t	2026-04-02 12:40:26.90667	2026-04-06 17:41:11.366866	27AAVPA1802D1Z4	\N	\N	\N	\N	\N	AAVPA1802D
6	Ajinkya Enterprises	Anil Pawar	9404184959	ajinkyaenter2018@gmail.com	t	2026-03-23 17:58:02.955289	2026-04-06 17:41:31.561428	27ABLFA1837B1ZQ	\N	\N	Dhule	Maharashtra	424001	ABLFA1837B
257	Anand Suresh Khairnar	ANAND SURESH KHAIRNAR		\N	t	2026-04-02 17:24:34.190892	2026-04-06 17:42:08.647356	\N	\N	\N	\N	\N	\N	ABDPK1291K
243	Avish Agro Seeds And Fertilizers Prop Amit Pradip Thakkar	AMIT PRADIP THAKKAR	9860595666		t	2026-04-02 12:51:20.332011	2026-04-06 17:43:21.038881	27AEIPT6642R1ZH	\N	\N	\N	\N	\N	AEIPT6642R
246	Avish Traders Proprietor Vinay Pradip Thakkar	VINAY PRADIP THAKKAR	9158177007		t	2026-04-02 13:07:02.954737	2026-04-06 17:43:33.482535	27AKBPT2642L2ZU	\N	\N	\N	\N	\N	AKBPT2642L
264	Ravindra Laxman Shelkar	RAVINDRA LAXMAN SHELKAR		\N	t	2026-04-02 17:34:06.222542	2026-04-06 17:46:15.660905	\N	\N	\N	\N	\N	\N	ARHPS1688L
191	Shivpushp Medical Prop. Ravi Chunilal Sharma	Ravi Sharma	9422786121	\N	t	2026-03-23 17:58:03.401517	2026-04-06 18:01:30.435742	27AXDPS3856Q1ZK	\N	\N	Dhule	Maharashtra	424001	AXDPS3856Q
219	Adarsh Automobile Prop. Ravindra P. Mali	Ravindra Popatrao Mali	9850100041		t	2026-04-01 17:51:27.687705	2026-04-06 18:01:52.597623	27AHQPM0465Q1ZJ	\N	\N	\N	\N	\N	AHQPM0465Q
265	Rekha Narendra Joshi			\N	t	2026-04-02 17:34:29.716339	2026-04-06 18:02:16.000851	\N	\N	\N	\N	\N	\N	AFSPJ6210J
139	Maharashtra BioFuels Private Limited	Sanjay Agrawal	8390070501	msbiofuels51@gmail.com	t	2026-03-23 17:58:03.261896	2026-04-06 18:04:21.966899	27AASCM0332J1ZA	\N	\N	Dhule	Maharashtra	424001	AASCM0332J
267	Shanmukh Sanjay Shardul			\N	t	2026-04-02 17:35:37.232897	2026-04-06 18:04:58.86683	\N	\N	\N	\N	\N	\N	CFJPS3527J
51	Mittal Traders Prop. Shashikant Badriprasad Agrawal	Shashikant Agrawal	9823132788	mittaltradersst2016@gmail.com	t	2026-03-23 17:58:03.054708	2026-04-06 18:05:43.937077	27ABHPA8100F1Z7	\N	\N	Dhule	Maharashtra	424001	ABHPA8100F
268	Shilpa Girish Mistry			\N	t	2026-04-02 17:36:37.253948	2026-04-06 18:06:09.851485	\N	\N	\N	\N	\N	\N	AILPM0458R
269	Vidyavahini Petroleum Prop. Vidyadevi A. Tamboli			\N	t	2026-04-06 18:08:45.163543	2026-04-06 18:08:45.163543	27ACSPT4585H1ZQ	\N	\N	\N	\N	\N	ACSPT4585H
270	Dr. Vivek Haribhai Patel			\N	t	2026-04-06 18:09:40.428817	2026-04-06 18:09:40.428817	\N	\N	\N	\N	\N	\N	AJJPP3137H
266	Dr. Sachin P. Chaudhary			\N	t	2026-04-02 17:35:01.528627	2026-04-06 18:09:48.955437	\N	\N	\N	\N	\N	\N	AHHPC1209K
271	Hariom Marble Prop. Archana Narendra Chaudhary			\N	t	2026-04-06 18:28:03.901701	2026-04-06 18:28:03.901701	27AXPPC6629M1ZV	\N	\N	\N	\N	\N	AXPPC6629M
272	Shri Ashirwad Traders Prop. Archana Yogesh Alai			\N	t	2026-04-06 18:31:33.136595	2026-04-06 18:31:33.136595	\N	\N	\N	\N	\N	\N	DAAPA4745M
254	Shri Sundha Steel Prop. Arjun Ram Kalaji				t	2026-04-02 16:54:55.459175	2026-04-06 18:32:14.876713	27DOTPK7156B1ZL	\N	\N	\N	\N	\N	DOTPK7156B
273	Arun Dattatray Mahale			\N	t	2026-04-06 18:33:01.185966	2026-04-06 18:33:01.185966	\N	\N	\N	\N	\N	\N	AAQPM9240G
274	Nikita Enterprises Prop. Aruna Ramesh Kaloya			\N	t	2026-04-06 18:33:36.989785	2026-04-06 18:33:36.989785	\N	\N	\N	\N	\N	\N	BOCPK8091J
275	Bhabha Vidyut Bhandar Prop. Arvind Shamrao Chaudhari			\N	t	2026-04-06 18:35:06.323254	2026-04-06 18:35:06.323254	\N	\N	\N	\N	\N	\N	AAHPC8641E
276	Asha Sarang Gosavi			\N	t	2026-04-06 18:36:17.416294	2026-04-06 18:36:17.416294	\N	\N	\N	\N	\N	\N	ANJPJ3731B
278	Mahalaxmi Sarees Prop. Ashok Premchand Lalwani			\N	t	2026-04-06 18:38:48.161546	2026-04-06 18:38:48.161546	\N	\N	\N	\N	\N	\N	AADPL1373L
194	Haji Plastics General Stores Prop. Asif Ahmad Abdul Ajij	Haji Plastic	9011329175	\N	t	2026-03-23 17:58:03.409028	2026-04-06 18:40:00.315515	27CFAPA6483G1ZK	\N	\N	Dhule	Maharashtra	424001	CFAPA6483G
279	Athena Agent Private Limited			\N	t	2026-04-06 18:41:14.314377	2026-04-06 18:41:14.314377	27ABCCA5725C1Z0	\N	\N	\N	\N	\N	ABCCA5725C
41	Kushal Book Shop Prop. Ramkrushna K. Baviskar	Ramkrushna Baviskar	9423916592	kushalbookshop@gmail.com	t	2026-03-23 17:58:03.030023	2026-04-06 18:42:16.259649	27AGXPB5306M1ZZ	\N	\N	Dhule	Maharashtra	424001	AGXPB5306M
280	Bafna Brothers			\N	t	2026-04-06 18:43:17.541628	2026-04-06 18:43:17.541628	27AAFFB9187L1ZT	\N	\N	\N	\N	\N	AAFFB9187L
281	Balkrushna Vaman Lokhande			\N	t	2026-04-06 18:45:14.589009	2026-04-06 18:45:14.589009	\N	\N	\N	\N	\N	\N	AXKPL7334D
282	Sonai Krushi Seva Kendra Prop. Balu Laxman Salunkhe			\N	t	2026-04-06 18:46:19.303251	2026-04-06 18:46:19.303251	27APIPS8461C1ZL	\N	\N	\N	\N	\N	APIPS8461C
253	Sona Gas Agency Proprietor Swapnil Subhash Bagul				t	2026-04-02 16:51:48.985236	2026-04-06 18:50:42.310459	27BBJPB9187Q1ZR	\N	\N	\N	\N	\N	BBJPB9187Q
283	Kiran Gas Service Prop. Bharati Uttam Pawar			\N	t	2026-04-06 18:51:10.879123	2026-04-06 18:51:10.879123	27APGPP4651K1ZH	\N	\N	\N	\N	\N	APGPP4651K
284	Asia Logistics Prop. Bhumika Chetan Dayma			\N	t	2026-04-06 19:07:13.301218	2026-04-06 19:07:13.301218	\N	\N	\N	\N	\N	\N	BLCPD5460M
178	Dhule District Krida Sankul	Yogesh Patil	9421531727	\N	t	2026-03-23 17:58:03.368279	2026-04-07 17:00:38.285851	27AABTD1018N1ZS	\N	\N	Dhule	Maharashtra	424001	AABTD1018N
289	Chirantan Health Care			\N	t	2026-04-07 17:01:59.191675	2026-04-07 17:01:59.191675	\N	\N	\N	\N	\N	\N	AAMFC1032C
290	Chirayu Traders			\N	t	2026-04-07 17:02:33.314888	2026-04-07 17:02:33.314888	\N	\N	\N	\N	\N	\N	AAPFC7312Q
291	Creative Academy			\N	t	2026-04-07 17:03:09.507663	2026-04-07 17:03:09.507663	\N	\N	\N	\N	\N	\N	AAPFC1099L
232	Nirmal Oil Products	NIRMAL OIL PRODUCTS	9763712667		t	2026-04-01 19:22:18.679383	2026-04-07 18:55:55.269541	27AAFFN1004J1ZL	\N	\N	\N	\N	\N	AAFFN1004J
201	Shyama Sham Pharma (Nirmalkumar Rawandale Huf)	Nirmal Rawandale	8087733033	\N	t	2026-03-23 17:58:03.424649	2026-04-07 18:56:00.369058	27AAJHN3598M1ZC	\N	\N	Dhule	Maharashtra	424001	AAJHN3598M
341	Radhakrishna Suppliers			\N	t	2026-04-08 11:09:22.539332	2026-04-08 11:09:22.539332	\N	\N	\N	\N	\N	\N	ABEFR0107Q
37	Kalpesh Ramesh Bhoi	Kalpesh Ramesh Bhoi	9890944539	kalpeshrbhoi2502@gmail.com	t	2026-03-23 17:58:03.021504	2026-04-08 11:10:25.781084	27BOXPB1245N1ZH	\N	\N	Dhule	Maharashtra	424001	BOXPB1245N
342	Rathod Ply Prop. Yogesh H Rathod			\N	t	2026-04-08 11:11:03.357667	2026-04-08 11:11:03.357667	27ABIPR9132P1ZU	\N	\N	\N	\N	\N	ABIPR9132P
148	Relan Collection Prop. Suresh M Relan HUF	Suresh Relan	9226487654	relan.group@gmail.com	t	2026-03-23 17:58:03.289094	2026-04-08 11:11:57.422543	27AACHR3093Q1ZH	\N	\N	Dhule	Maharashtra	424001	AACHR3093Q
343	Sai Health Services			\N	t	2026-04-08 11:15:32.700312	2026-04-08 11:15:32.700312	\N	\N	\N	\N	\N	\N	AESFS5093M
344	Sai Heart Care			\N	t	2026-04-08 11:16:34.440126	2026-04-08 11:16:34.440126	\N	\N	\N	\N	\N	\N	AECFS8048G
251	Sai Kuber Petroleum	Hemant Wani	9423943514		t	2026-04-02 16:43:30.07984	2026-04-08 11:16:53.011846	27AEIFS1981E1ZU	\N	\N	\N	\N	\N	AEIFS1981E
349	Shri Vitthal Rukhamai Nagari Sahakari Patpedhi Limited			\N	t	2026-04-08 11:48:43.175137	2026-04-08 11:48:43.175137	\N	\N	\N	\N	\N	\N	AAAJS2481F
350	Shrikrupa Gramin Sahakari Patsanstha Maryadit			\N	t	2026-04-08 11:49:27.855458	2026-04-08 11:49:27.855458	\N	\N	\N	\N	\N	\N	AAAJS3034J
50	M/s Manoharlal Mohanlal	Deepak Mandan	9422286462	manoharlalmohanlal@gmail.com	t	2026-03-23 17:58:03.052194	2026-04-07 17:06:22.107344	27ABPFM1167N1ZM	\N	\N	Dhule	Maharashtra	424001	ABPFM1167N
79	Sandip Dattatray Mahale (Raj Infra)	Sandeep Mahale	9422787999	sandeepmahalemvat@gmail.com	t	2026-03-23 17:58:03.116397	2026-04-07 17:06:39.348829	27ABLPM5396F1Z7	\N	\N	Dhule	Maharashtra	424001	ABLPM5396F
345	Sarweshwari Petroleum\\Radhakrishna Enterprises Prop. Sonu Atul Bang			\N	t	2026-04-08 11:20:21.221554	2026-04-08 11:20:21.221554	\N	\N	\N	\N	\N	\N	ABRPB9389H
127	M/s Satyamev Plaza	Umesh Agrawal	9511800363	\N	t	2026-03-23 17:58:03.234389	2026-04-08 11:20:41.171099	27AEYFS0265B1ZT	\N	\N	Dhule	Maharashtra	424001	AEYFS0265B
351	Siddhi Industries Prop. Mamata Sangram Limaye			\N	t	2026-04-08 11:51:31.533882	2026-04-08 11:51:31.533882	27ADAPL6845M1Z4	\N	\N	\N	\N	\N	ADAPL6845M
352	Siddhivinayak Fuel Prop. Krishnadas Ramesh Chaudhari			\N	t	2026-04-08 11:52:17.217966	2026-04-08 11:52:17.217966	27AXTPC4067D1ZE	\N	\N	\N	\N	\N	AXTPC4067D
353	Star Stone Crusher Proprietor Somnath Ramkisan Maheshwari			\N	t	2026-04-08 11:53:06.456813	2026-04-08 11:53:06.456813	27AZVPM2209D1ZA	\N	\N	\N	\N	\N	AZVPM2209D
235	Somnath Onion Suppliers Prop. Rajesh Somnath Chaudhary	RAJESH SOMNATH CHAUDHARY	9422267371		t	2026-04-01 19:51:33.745881	2026-04-08 11:53:33.27108	\N	\N	\N	\N	\N	\N	ADLPC5208Q
167	Shri Vaibhav Hoziery Prop, Kailashkumar Lalwani	Mihir Lalwani	8788426070	\N	t	2026-03-23 17:58:03.341243	2026-04-08 11:55:48.124398	27AADPL1372M1ZJ	\N	\N	Dhule	Maharashtra	424001	AADPL1372M
357	Shree Siddhivinayak Foods				t	2026-04-10 12:30:12.564072	2026-04-10 12:30:12.564072	\N	\N	\N	\N	\N	\N	AFXFS3334R
358	Apex Energy				t	2026-04-13 18:10:53.962576	2026-04-13 18:10:53.962576	27ACKFA3050G1ZM	\N	\N	\N	\N	\N	ACKFA3050G
359	Dr Vijay Madhukar Hire				t	2026-04-18 18:49:41.231315	2026-04-18 18:49:41.231315	\N	\N	\N	\N	\N	\N	ABKPH0398H
12	Balaji Distributors Prop. Dhananjay D Desale	Dhananjay Desale	7020330407	dhananjaydesale625@gmail.com	t	2026-03-23 17:58:02.96794	2026-04-07 17:09:51.557626	27ANYPD5679H1Z8	\N	\N	Dhule	Maharashtra	424001	ANYPD5679H
206	Shree Balaji Industries	MAYANK AGRAWAL	9422288664	\N	t	2026-03-28 17:47:47.283381	2026-04-07 17:10:58.681687	\N	\N	\N	\N	\N	\N	ABAFS2644D
180	Shree Balaji Cotex	Vijaysingh Girase	8888636060	swetdhagacotex@gmail.com	t	2026-03-23 17:58:03.373973	2026-04-07 17:11:04.992017	27AFQFS6519D1ZM	\N	\N	Dhule	Maharashtra	424001	AFQFS6519D
298	Dr. Dhananjay Kusumakar Jagtap			\N	t	2026-04-07 17:12:21.764786	2026-04-07 17:12:21.764786	\N	\N	\N	\N	\N	\N	ADGPJ9720P
299	Dhananjay Padmakar Tarage			\N	t	2026-04-07 17:12:43.437021	2026-04-07 17:12:43.437021	\N	\N	\N	\N	\N	\N	AFEPT8403P
300	Shriram Traders Prop. Dhananjay Shankar Kulkarni			\N	t	2026-04-07 17:13:25.655151	2026-04-07 17:13:25.655151	27AIGPK6241B1ZL	\N	\N	\N	\N	\N	AIGPK6241B
301	Dhanwantari Associates			\N	t	2026-04-07 17:14:00.209973	2026-04-07 17:14:00.209973	\N	\N	\N	\N	\N	\N	AAHFD0872C
23	Dhule And Nandurbar District Central Co Operative Bank Limited	C R Patil	9403258163	ddccbankho@yahoo.com	t	2026-03-23 17:58:02.991834	2026-04-07 17:14:38.237719	27AAAJD0856H1ZE	\N	\N	Dhule	Maharashtra	424001	AAAJD0856H
302	Dhule Jilha Prathamik Shikshakanchi Sahakari Patpedhi Limited Dhule			\N	t	2026-04-07 17:15:56.332966	2026-04-07 17:15:56.332966	\N	\N	\N	\N	\N	\N	AABTD7183N
303	Digambar Dhudku Patil			\N	t	2026-04-07 17:16:37.18624	2026-04-07 17:16:37.18624	\N	\N	\N	\N	\N	\N	AHOPP1332K
304	Dilipsinh Narayansinh Rajput			\N	t	2026-04-07 17:17:36.455924	2026-04-07 17:17:36.455924	\N	\N	\N	\N	\N	\N	AAJPR7278N
305	Dinbandhu Giradharilal Khandelwal			\N	t	2026-04-07 17:18:13.773289	2026-04-07 17:18:13.773289	\N	\N	\N	\N	\N	\N	ASBPK9689G
306	Dinesh Anandrao Patil			\N	t	2026-04-07 17:18:34.363719	2026-04-07 17:18:34.363719	\N	\N	\N	\N	\N	\N	ABDPP7639L
100	Yash Automobiles Prop. Dinesh Bhagwan Patil	Dinesh Patil	9326010896	yashautomobiles2016@gmail.com	t	2026-03-23 17:58:03.166573	2026-04-07 17:18:59.026431	27ABHPP1245N1ZB	\N	\N	Dhule	Maharashtra	424001	ABHPP1245N
307	Dinesh Manohar Sharma			\N	t	2026-04-07 17:19:27.98598	2026-04-07 17:19:27.98598	\N	\N	\N	\N	\N	\N	AXMPS5899J
308	Dipak Jagdish Sharma			\N	t	2026-04-07 17:20:20.345951	2026-04-07 17:20:20.345951	\N	\N	\N	\N	\N	\N	DNEPS0049R
309	Divyanjali Manish Patil			\N	t	2026-04-07 17:21:32.844084	2026-04-07 17:21:32.844084	27INSPB5500D1Z4	\N	\N	\N	\N	\N	INSPB5500D
310	Kamalbai Kisanrao Khopade			\N	t	2026-04-07 17:39:06.694144	2026-04-07 17:39:06.694144	\N	\N	\N	\N	\N	\N	AATPK0931H
312	Tejawat Organic Foods			\N	t	2026-04-07 17:43:27.343488	2026-04-07 17:43:27.343488	27AAPFT2096L1ZF	\N	\N	\N	\N	\N	AAPFT2096L
314	Advanced Immuno Lab			\N	t	2026-04-07 17:45:34.472355	2026-04-07 17:45:34.472355	\N	\N	\N	\N	\N	\N	AAGFA5873R
315	Bhawani Roadlines Prop. Anup O Agrawal HUF			\N	t	2026-04-07 17:47:23.147866	2026-04-07 17:47:23.147866	\N	\N	\N	\N	\N	\N	AAGHA4334R
316	Balaji Auto Parts Prop. Hariom Vasudev Gupta			\N	t	2026-04-07 17:49:16.317398	2026-04-07 17:49:16.317398	27AAOPG8589N1ZM	\N	\N	\N	\N	\N	AAOPG8589N
110	Ruchi Traders Prop. Sonali Sharma	Sonali Sharma	8668742858	shrma62@gmail.com	t	2026-03-23 17:58:03.192233	2026-04-07 17:50:03.558137	27HRRPS0072P1ZR	\N	\N	Dhule	Maharashtra	424001	HRRPS0072P
247	Bhavani Traders Proprietor Kansing Premsing Purohit	KANSING PREMSING PUROHIT	9623542311		t	2026-04-02 13:10:46.120304	2026-04-07 17:51:02.234743	27EAKPS6285K1ZR	\N	\N	\N	\N	\N	EAKPS6285K
73	Rohan Dilip Biraris	Rohan Biraris	8600069169	rohanbiraris562@yahoo.com	t	2026-03-23 17:58:03.104306	2026-04-07 17:52:27.126743	27AOSPB2075C1Z4	\N	\N	Dhule	Maharashtra	424001	AOSPB2075C
161	Shri Sai Petrolium - Sonal Dilip Shinde	Sonal Shinde	9822829000	shrisaipetroliummvat@yahoo.com	t	2026-03-23 17:58:03.327883	2026-04-07 17:52:33.549431	27AWHPS1648D1ZF	\N	\N	Dhule	Maharashtra	424001	AWHPS1648D
317	Dr Krupal Sisodiya			\N	t	2026-04-07 17:53:47.224753	2026-04-07 17:53:47.224753	\N	\N	\N	\N	\N	\N	AWEPS1673D
318	Dr Mohan Puna Patel			\N	t	2026-04-07 17:54:17.170814	2026-04-07 17:54:17.170814	\N	\N	\N	\N	\N	\N	AVVPP9467G
319	Dr Nilesh Rajanikant Shah			\N	t	2026-04-07 17:54:51.440136	2026-04-07 17:54:51.440136	\N	\N	\N	\N	\N	\N	CBVPS4702D
320	Dr Pallavi Nirmalkumar Rawandale			\N	t	2026-04-07 17:55:52.752374	2026-04-07 17:55:52.752374	\N	\N	\N	\N	\N	\N	AJUPR8354H
321	Dr. Pankaj Shamrao Deore			\N	t	2026-04-07 17:56:38.749977	2026-04-07 17:56:38.749977	\N	\N	\N	\N	\N	\N	AGXPD8186D
322	Dr Rajesh Rasiklal Agrawal			\N	t	2026-04-07 17:59:22.158757	2026-04-07 17:59:22.158757	\N	\N	\N	\N	\N	\N	AGUPA0739N
323	Dr Ujjwala Jitendra Ghumare			\N	t	2026-04-07 18:00:07.800914	2026-04-07 18:00:07.800914	\N	\N	\N	\N	\N	\N	AJOPG8315R
324	Gajanan Pustakalaya Prop. Hemant Balkrishna Patondekar			\N	t	2026-04-07 18:10:52.565509	2026-04-07 18:10:52.565509	\N	\N	\N	\N	\N	\N	AANPP5747L
325	Geeta Foods			\N	t	2026-04-07 18:11:55.312256	2026-04-07 18:11:55.312256	\N	\N	\N	\N	\N	\N	AAZFG6881G
17	Bhole Sai Trading Co. Prop. Kamalkishor Bhattad HUF	Kamalkishor Bhattad	9822324649	bhattadkr@gmail.com	t	2026-03-23 17:58:02.979237	2026-04-07 18:19:41.523699	27AAIHK1449P1ZO	\N	\N	Dhule	Maharashtra	424001	AAIHK1449P
326	Kushal Furniture And Home Appliances Prop. Jasraj Ranulal Jain			\N	t	2026-04-07 18:32:53.958933	2026-04-07 18:32:53.958933	27ABJPJ4237G1ZO	\N	\N	\N	\N	\N	ABJPJ4237G
327	Kushal Mobile & Computers Prop. Sushila Jasraj Jain			\N	t	2026-04-07 18:33:34.646787	2026-04-07 18:33:34.646787	27AEIPJ3158A1ZT	\N	\N	\N	\N	\N	AEIPJ3158A
346	Shahada Institute of Medical Science			\N	t	2026-04-08 11:22:39.3007	2026-04-08 11:22:39.3007	\N	\N	\N	\N	\N	\N	AEKFS5134D
125	Shree Siddhivinayak Medicals	Sandesh Jain	8669031616	sandeshjain79@gmail.com	t	2026-03-23 17:58:03.229822	2026-04-08 11:23:07.720651	27AEIFS1505E1ZA	\N	\N	Dhule	Maharashtra	424001	AEIFS1505E
330	Malhar Trading Company Prop. Bharat Madhukar Durangi			\N	t	2026-04-07 18:46:25.997679	2026-04-07 18:46:25.997679	\N	\N	\N	\N	\N	\N	AYSPD3448H
331	Malhar Vegetable Company Prop. Rajesh Madhukar Durangi			\N	t	2026-04-07 18:47:05.118849	2026-04-07 18:47:05.118849	\N	\N	\N	\N	\N	\N	AGXPD0623P
347	Shree Enterprises Prop. Abhishek Shashikant Agrawal			\N	t	2026-04-08 11:26:02.137765	2026-04-08 11:26:02.137765	27AMUPA0176F1Z3	\N	\N	\N	\N	\N	AMUPA0176F
354	Vimal Traders			\N	t	2026-04-08 11:57:29.388874	2026-04-08 11:57:29.388874	\N	\N	\N	\N	\N	\N	AAUFV3533H
360	Dr Dipti Vijay Hire				t	2026-04-18 18:51:22.595901	2026-04-18 18:51:22.595901	\N	\N	\N	\N	\N	\N	ABJPH9468B
313	Dr. Meghana Vivek Patel			\N	t	2026-04-07 17:44:56.186844	2026-04-18 19:09:24.989258	\N	\N	\N	\N	\N	\N	AOOPP1910J
\.


--
-- Data for Name: gst_rates_master; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.gst_rates_master (id, rate_percentage, description, is_active, created_at, rate_name) FROM stdin;
1	18.00	Rate	t	2026-03-16 21:10:03.205506	Rate
5	0.00	NA	t	2026-03-28 16:21:55.997298	NA
\.


--
-- Data for Name: header_bank_details; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.header_bank_details (id, header_id, bank_name, account_holder_name, account_number, ifsc_code, branch_name, upi_id, qr_code_image, is_active, created_at) FROM stdin;
1	1	HDFC BANK	MANOJ S DISA AND CO	50200002663828	HDFC0000637	DHULE	\N	\N	t	2026-03-16 20:54:11.403368
4	3	HDFC BANK	Pallavi Manoj Disa	06371930006766	HDFC0000637	DHULE	\N	\N	t	2026-03-28 16:20:52.418418
11	9	DHULE VIKAS SAHAKARI BANK LIMITED	MANOJ S DISA AND COMPANY	01021001652	ICIC00DVSBL		\N	\N	t	2026-04-01 18:27:12.344509
10	8	KOTAK BANK	RISHIKESH N SANGTANI	0145314192	KKBK0002049	DHULE	\N	\N	t	2026-04-01 16:12:00.531353
5	4	HDFC BANK	Pallavi Manoj Disa	06371930006766	HDFC0000637	DHULE	\N	\N	t	2026-03-28 17:46:28.417293
\.


--
-- Data for Name: header_master; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.header_master (id, company_name, proprietor_name, address_line1, address_line2, city, state, pincode, phone, email, gstin, pan, is_active, created_at, updated_at, bill_prefix, upi_id) FROM stdin;
1	MANOJ S DISA AND CO	MANOJ S DISA AND CO	18 A, LANE NO 1	SUBHASH NAGAR OLD DHULE 	DHULE	MAHARASHTRA	424001	9422285352	manojdisa5468@yahoo.com	27AAXFM0200H1ZD	AAXFM0200H	t	2026-03-16 20:54:11.403368	2026-03-23 15:34:48.085331	MSD	
3	URJA COMPUTERS	PALLAVI MANOJ DISA	18 A, LANE NO 1	SUBHASH NAGAR OLD DHULE 	DHULE	MAHARASHTRA	424001	9422285352	manojdisa5468@yahoo.com	\N	\N	t	2026-03-28 16:20:52.418418	2026-03-28 16:20:52.418418	URJ	
9	MANOJ S DISA AND CO	MANOJ S DISA AND CO	18 A, LANE NO 1	SUBHASH NAGAR OLD DHULE 	DHULE	MAHARASHTRA	424001	9422285352	manojdisa5468@yahoo.com	27AAXFM0200H1ZD	AAXFM0200H	t	2026-04-01 18:27:12.344509	2026-04-01 18:27:12.344509	MAN	
8	CA RISHIKESH N. SANGTANI	Rishikesh N. Sangtani	Dhule		Dhule	Maharashtra	424001	7030384944	rishisangtani@gmail.com	\N	\N	t	2026-04-01 16:12:00.531353	2026-04-02 16:31:28.064036	CA 	7030384944@kotak811
4	URJA COMPUTERS	PALLAVI MANOJ DISA	18 A, LANE NO 1	SUBHASH NAGAR OLD DHULE 	DHULE	MAHARASHTRA	424001	9422285352	manojdisa5468@yahoo.com	\N	\N	t	2026-03-28 17:46:28.417293	2026-04-18 19:43:16.890997	URJ	9422895852-2@ybl
\.


--
-- Data for Name: particulars_master; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.particulars_master (id, service_name, is_active, created_at, updated_at) FROM stdin;
3	Account Writing	t	2026-03-17 16:29:12.432281	2026-03-17 16:29:12.432281
1	Income Tax Audit, Account Finalisation	t	2026-03-16 20:42:26.480364	2026-03-17 16:30:18.790087
2	Income Tax Return, Account Finalisation	t	2026-03-17 16:29:04.004934	2026-03-17 16:30:26.178246
4	GST Return - Monthly	t	2026-03-17 16:30:36.077647	2026-03-17 16:30:36.077647
5	GST Returns - Quarterly	t	2026-03-17 16:30:47.553373	2026-03-17 16:30:47.553373
6	GST Annual Return	t	2026-03-17 16:30:55.601059	2026-03-17 16:30:55.601059
7	GST Audit	t	2026-03-17 16:31:09.051546	2026-03-17 16:31:09.051546
8	Income Tax Assessment 	t	2026-03-17 16:31:27.541033	2026-03-17 16:31:27.541033
9	GST Assessment	t	2026-03-17 16:31:34.303777	2026-03-17 16:31:34.303777
10	TDS Returns	t	2026-03-17 16:31:42.538219	2026-03-17 16:31:42.538219
11	Preparation of Partnership Deed, Application at ROF, Pan Card	t	2026-03-17 16:33:09.836409	2026-03-17 16:33:09.836409
12	GST Registration 	t	2026-03-17 16:33:19.961137	2026-03-17 16:33:19.961137
13	Preparation of Project Report/CMA	t	2026-03-17 16:33:57.575192	2026-03-17 16:33:57.575192
14	Other Professional Services	t	2026-03-17 16:34:54.779246	2026-03-17 16:34:54.779246
16	Professional Services	t	2026-03-28 15:51:35.630631	2026-03-28 15:51:35.630631
17	ROC COMPLIANCE	t	2026-03-28 16:32:48.835823	2026-03-28 16:32:48.835823
18	Income Tax Audit , Income Tax Return and\nAccount Finalisation	t	2026-04-02 15:50:54.858188	2026-04-02 15:50:54.858188
19	Income Tax Audit , Income Tax Return, GST Reconciliation , Account Finalisation and other services	t	2026-04-02 15:56:12.826891	2026-04-02 16:44:34.48324
20	Income Tax Audit , GST Reconciliation ,\nAccount Finalisation and other services	t	2026-04-02 16:45:06.818848	2026-04-02 16:45:06.818848
21	Certificate	t	2026-04-03 16:51:12.62394	2026-04-03 16:51:12.62394
22	Income Tax Audit 	t	2026-04-18 19:23:08.395988	2026-04-18 19:23:08.395988
23	Account Writing and Preparation of Income Tax Return 	t	2026-04-18 19:25:26.998667	2026-04-18 19:25:26.998667
\.


--
-- Data for Name: password_reset_tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.password_reset_tokens (id, user_id, token, expires_at, used, created_at) FROM stdin;
\.


--
-- Data for Name: payment_terms_master; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payment_terms_master (id, term_name, days_to_add, is_active, created_at) FROM stdin;
1	Immediate	1	t	2026-03-16 20:56:33.716225
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, username, email, password_hash, full_name, role, phone, is_active, last_login, created_at, updated_at, is_approved) FROM stdin;
4	TESTE	test@gamil.com	$2b$10$0umR/bzQ04iwFg3XdKNEa.TgD6IHRMNxww60Qn6hGJh09fqUqexBq	TESTE	EMPLOYEE	9848681681	f	\N	2026-03-23 12:09:23.940866	2026-03-23 12:18:41.087692	t
1	JATIN	jatshah007@gmail.com	$2b$10$29pi7oF5mM6Uk1mlSHKUDeDYQTk0vUSQCQUUHV117PFpZ7W1V8p6u	Jatin	SUPERADMIN	9819706846	t	\N	2026-03-16 20:41:55.979954	2026-03-31 12:39:19.245908	t
3	Urja	disaurja19@gmail.com	$2b$10$L8ec5DgRysAB9GpRdthtoeabEcLMUMeLvVweTEoysX0W0/eKgeYxO	Urja Manoj Disa	SUPERADMIN	9422382352	t	\N	2026-03-17 12:28:04.790418	2026-03-31 12:39:19.245908	t
2	shrikant	cashrikantsharma83@gmail.com	$2b$10$dIqvNnCaAQA75zT/qpvgv.3iTXKdt2Ovel9JZUlAsyRTVf0mPW2Ae	SHRIKANT SHARMA	SUPERADMIN	9423982118	t	\N	2026-03-16 20:50:04.109797	2026-05-08 10:58:14.032603	t
5	AMIT	amitwadhwa520@gmail.com	$2b$10$4J6vW9rOnieQz1sjhwIN.OH6vak7upO5m9ipksRS8m1gPCax2nFcC	AMIT PRAKASHLAL WADHWA	CA	9405660520	t	\N	2026-05-07 18:16:14.61247	2026-05-23 15:00:29.089467	t
\.


--
-- Name: activity_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.activity_log_id_seq', 626, true);


--
-- Name: bill_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bill_history_id_seq', 1, false);


--
-- Name: bill_merges_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bill_merges_id_seq', 8, true);


--
-- Name: bill_number_counters_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bill_number_counters_id_seq', 85, true);


--
-- Name: bill_number_sequence_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bill_number_sequence_id_seq', 1, false);


--
-- Name: bill_payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bill_payments_id_seq', 44, true);


--
-- Name: bill_services_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bill_services_id_seq', 389, true);


--
-- Name: bill_writeoffs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bill_writeoffs_id_seq', 1, true);


--
-- Name: bills_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bills_id_seq', 159, true);


--
-- Name: clients_master_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.clients_master_id_seq', 361, true);


--
-- Name: gst_rates_master_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.gst_rates_master_id_seq', 5, true);


--
-- Name: header_bank_details_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.header_bank_details_id_seq', 13, true);


--
-- Name: header_master_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.header_master_id_seq', 9, true);


--
-- Name: particulars_master_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.particulars_master_id_seq', 23, true);


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.password_reset_tokens_id_seq', 1, false);


--
-- Name: payment_terms_master_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payment_terms_master_id_seq', 2, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 5, true);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: bill_history bill_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_history
    ADD CONSTRAINT bill_history_pkey PRIMARY KEY (id);


--
-- Name: bill_merges bill_merges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_merges
    ADD CONSTRAINT bill_merges_pkey PRIMARY KEY (id);


--
-- Name: bill_merges bill_merges_source_bill_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_merges
    ADD CONSTRAINT bill_merges_source_bill_id_key UNIQUE (source_bill_id);


--
-- Name: bill_number_counters bill_number_counters_header_id_financial_year_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_number_counters
    ADD CONSTRAINT bill_number_counters_header_id_financial_year_key UNIQUE (header_id, financial_year);


--
-- Name: bill_number_counters bill_number_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_number_counters
    ADD CONSTRAINT bill_number_counters_pkey PRIMARY KEY (id);


--
-- Name: bill_number_sequence bill_number_sequence_financial_year_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_number_sequence
    ADD CONSTRAINT bill_number_sequence_financial_year_key UNIQUE (financial_year);


--
-- Name: bill_number_sequence bill_number_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_number_sequence
    ADD CONSTRAINT bill_number_sequence_pkey PRIMARY KEY (id);


--
-- Name: bill_payments bill_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_payments
    ADD CONSTRAINT bill_payments_pkey PRIMARY KEY (id);


--
-- Name: bill_services bill_services_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_services
    ADD CONSTRAINT bill_services_pkey PRIMARY KEY (id);


--
-- Name: bill_writeoffs bill_writeoffs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_writeoffs
    ADD CONSTRAINT bill_writeoffs_pkey PRIMARY KEY (id);


--
-- Name: bills bills_bill_no_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_bill_no_key UNIQUE (bill_no);


--
-- Name: bills bills_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_pkey PRIMARY KEY (id);


--
-- Name: clients_master clients_gstin_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clients_master
    ADD CONSTRAINT clients_gstin_unique UNIQUE (gstin);


--
-- Name: clients_master clients_master_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clients_master
    ADD CONSTRAINT clients_master_pkey PRIMARY KEY (id);


--
-- Name: clients_master clients_pan_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clients_master
    ADD CONSTRAINT clients_pan_unique UNIQUE (pan);


--
-- Name: gst_rates_master gst_rates_master_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.gst_rates_master
    ADD CONSTRAINT gst_rates_master_pkey PRIMARY KEY (id);


--
-- Name: header_bank_details header_bank_details_header_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.header_bank_details
    ADD CONSTRAINT header_bank_details_header_id_key UNIQUE (header_id);


--
-- Name: header_bank_details header_bank_details_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.header_bank_details
    ADD CONSTRAINT header_bank_details_pkey PRIMARY KEY (id);


--
-- Name: header_master header_master_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.header_master
    ADD CONSTRAINT header_master_pkey PRIMARY KEY (id);


--
-- Name: particulars_master particulars_master_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.particulars_master
    ADD CONSTRAINT particulars_master_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_key UNIQUE (token);


--
-- Name: password_reset_tokens password_reset_tokens_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_key UNIQUE (user_id);


--
-- Name: payment_terms_master payment_terms_master_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_terms_master
    ADD CONSTRAINT payment_terms_master_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_activity_log_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_log_created_at ON public.activity_log USING btree (created_at DESC);


--
-- Name: idx_activity_log_entity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_log_entity ON public.activity_log USING btree (entity_type, entity_id);


--
-- Name: idx_activity_log_performed_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_log_performed_by ON public.activity_log USING btree (performed_by);


--
-- Name: idx_bill_counters_header_fy; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bill_counters_header_fy ON public.bill_number_counters USING btree (header_id, financial_year);


--
-- Name: idx_bill_history_action_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bill_history_action_type ON public.bill_history USING btree (action_type);


--
-- Name: idx_bill_history_bill_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bill_history_bill_id ON public.bill_history USING btree (bill_id);


--
-- Name: idx_bill_merges_merged; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bill_merges_merged ON public.bill_merges USING btree (merged_bill_id);


--
-- Name: idx_bill_merges_source; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bill_merges_source ON public.bill_merges USING btree (source_bill_id);


--
-- Name: idx_bill_payments_bill_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bill_payments_bill_id ON public.bill_payments USING btree (bill_id);


--
-- Name: idx_bill_payments_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bill_payments_date ON public.bill_payments USING btree (payment_date);


--
-- Name: idx_bill_services_bill_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bill_services_bill_id ON public.bill_services USING btree (bill_id);


--
-- Name: idx_bill_writeoffs_bill_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bill_writeoffs_bill_id ON public.bill_writeoffs USING btree (bill_id);


--
-- Name: idx_bills_bill_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bills_bill_date ON public.bills USING btree (bill_date);


--
-- Name: idx_bills_bill_no; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bills_bill_no ON public.bills USING btree (bill_no);


--
-- Name: idx_bills_client_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bills_client_id ON public.bills USING btree (client_id);


--
-- Name: idx_bills_created_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bills_created_by ON public.bills USING btree (created_by);


--
-- Name: idx_bills_financial_year; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bills_financial_year ON public.bills USING btree (financial_year);


--
-- Name: idx_bills_header_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bills_header_id ON public.bills USING btree (header_id);


--
-- Name: idx_bills_payment_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bills_payment_status ON public.bills USING btree (payment_status);


--
-- Name: idx_bills_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bills_status ON public.bills USING btree (status);


--
-- Name: idx_clients_master_client_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_clients_master_client_name ON public.clients_master USING btree (client_name);


--
-- Name: idx_clients_master_is_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_clients_master_is_active ON public.clients_master USING btree (is_active);


--
-- Name: idx_header_master_is_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_header_master_is_active ON public.header_master USING btree (is_active);


--
-- Name: idx_password_reset_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_password_reset_token ON public.password_reset_tokens USING btree (token);


--
-- Name: idx_password_reset_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_password_reset_user ON public.password_reset_tokens USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- Name: bill_services after_insert_update_delete_bill_services; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER after_insert_update_delete_bill_services AFTER INSERT OR DELETE OR UPDATE ON public.bill_services FOR EACH ROW EXECUTE FUNCTION public.trigger_update_bill_totals();


--
-- Name: bill_services before_insert_update_bill_services; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER before_insert_update_bill_services BEFORE INSERT OR UPDATE ON public.bill_services FOR EACH ROW EXECUTE FUNCTION public.trigger_calculate_gst();


--
-- Name: bills before_update_bills; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER before_update_bills BEFORE UPDATE ON public.bills FOR EACH ROW EXECUTE FUNCTION public.trigger_update_timestamp();


--
-- Name: clients_master before_update_clients_master; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER before_update_clients_master BEFORE UPDATE ON public.clients_master FOR EACH ROW EXECUTE FUNCTION public.trigger_update_timestamp();


--
-- Name: particulars_master before_update_particulars_master; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER before_update_particulars_master BEFORE UPDATE ON public.particulars_master FOR EACH ROW EXECUTE FUNCTION public.trigger_update_timestamp();


--
-- Name: users before_update_users; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER before_update_users BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.trigger_update_timestamp();


--
-- Name: bills trigger_assign_bill_number; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_assign_bill_number BEFORE INSERT OR UPDATE ON public.bills FOR EACH ROW EXECUTE FUNCTION public.assign_bill_number();


--
-- Name: bill_payments trigger_update_bill_payment_status; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_update_bill_payment_status AFTER INSERT OR DELETE OR UPDATE ON public.bill_payments FOR EACH ROW EXECUTE FUNCTION public.update_bill_payment_status();


--
-- Name: bill_payments update_payment_status_on_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_payment_status_on_delete AFTER DELETE ON public.bill_payments FOR EACH ROW EXECUTE FUNCTION public.update_bill_payment_status_on_delete();


--
-- Name: bill_payments update_payment_status_on_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_payment_status_on_insert AFTER INSERT ON public.bill_payments FOR EACH ROW EXECUTE FUNCTION public.update_bill_payment_status();


--
-- Name: activity_log activity_log_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bill_history bill_history_action_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_history
    ADD CONSTRAINT bill_history_action_by_fkey FOREIGN KEY (action_by) REFERENCES public.users(id);


--
-- Name: bill_history bill_history_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_history
    ADD CONSTRAINT bill_history_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;


--
-- Name: bill_merges bill_merges_merged_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_merges
    ADD CONSTRAINT bill_merges_merged_bill_id_fkey FOREIGN KEY (merged_bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;


--
-- Name: bill_merges bill_merges_merged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_merges
    ADD CONSTRAINT bill_merges_merged_by_fkey FOREIGN KEY (merged_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bill_merges bill_merges_source_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_merges
    ADD CONSTRAINT bill_merges_source_bill_id_fkey FOREIGN KEY (source_bill_id) REFERENCES public.bills(id) ON DELETE RESTRICT;


--
-- Name: bill_number_counters bill_number_counters_header_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_number_counters
    ADD CONSTRAINT bill_number_counters_header_id_fkey FOREIGN KEY (header_id) REFERENCES public.header_master(id) ON DELETE CASCADE;


--
-- Name: bill_payments bill_payments_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_payments
    ADD CONSTRAINT bill_payments_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;


--
-- Name: bill_payments bill_payments_received_in_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_payments
    ADD CONSTRAINT bill_payments_received_in_account_id_fkey FOREIGN KEY (received_in_account_id) REFERENCES public.header_bank_details(header_id) ON DELETE SET NULL;


--
-- Name: bill_payments bill_payments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_payments
    ADD CONSTRAINT bill_payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: bill_services bill_services_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_services
    ADD CONSTRAINT bill_services_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;


--
-- Name: bill_services bill_services_gst_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_services
    ADD CONSTRAINT bill_services_gst_rate_id_fkey FOREIGN KEY (gst_rate_id) REFERENCES public.gst_rates_master(id);


--
-- Name: bill_services bill_services_particulars_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_services
    ADD CONSTRAINT bill_services_particulars_id_fkey FOREIGN KEY (particulars_id) REFERENCES public.particulars_master(id);


--
-- Name: bill_writeoffs bill_writeoffs_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_writeoffs
    ADD CONSTRAINT bill_writeoffs_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE;


--
-- Name: bill_writeoffs bill_writeoffs_written_off_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bill_writeoffs
    ADD CONSTRAINT bill_writeoffs_written_off_by_fkey FOREIGN KEY (written_off_by) REFERENCES public.users(id);


--
-- Name: bills bills_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients_master(id);


--
-- Name: bills bills_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: bills bills_header_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_header_id_fkey FOREIGN KEY (header_id) REFERENCES public.header_master(id);


--
-- Name: bills bills_override_header_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_override_header_id_fkey FOREIGN KEY (override_header_id) REFERENCES public.header_master(id);


--
-- Name: bills bills_payment_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_payment_term_id_fkey FOREIGN KEY (payment_term_id) REFERENCES public.payment_terms_master(id);


--
-- Name: header_bank_details header_bank_details_header_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.header_bank_details
    ADD CONSTRAINT header_bank_details_header_id_fkey FOREIGN KEY (header_id) REFERENCES public.header_master(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict T3PIM8JTA6pPYdLBKmeaCJhr2sO2c88TTdMeDFkaAsZ1uh6PalZJD9kohswEbon

