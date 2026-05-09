-- Migration: Add PAN to clients_master and write-off fields to bills
-- Run this file once against your existing database

-- 1. Add PAN column to clients_master (optional, unique, format-validated)
ALTER TABLE clients_master ADD COLUMN IF NOT EXISTS pan VARCHAR(10);
ALTER TABLE clients_master ADD CONSTRAINT clients_pan_unique UNIQUE (pan);
ALTER TABLE clients_master ADD CONSTRAINT pan_format_check CHECK (
  pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$'
);

-- 2. Add write-off fields to bills table
ALTER TABLE bills ADD COLUMN IF NOT EXISTS writeoff_amount NUMERIC(15,2) DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS writeoff_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS writeoff_date DATE;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS writeoff_notes TEXT;
