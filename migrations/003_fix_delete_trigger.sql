-- Migration 003: Fix update_bill_payment_status_on_delete trigger function
-- The schema.sql version was missing last_payment_date recalculation.
-- This is the corrected, authoritative version. Run once.
--
--   psql -U postgres -d CA_FIRM -f migrations/003_fix_delete_trigger.sql

CREATE OR REPLACE FUNCTION update_bill_payment_status_on_delete()
RETURNS TRIGGER AS $$
DECLARE
    v_total_invoice  NUMERIC(15,2);
    v_total_paid     NUMERIC(15,2);
    v_last_date      DATE;
    v_new_status     VARCHAR(20);
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
