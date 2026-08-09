-- Migrate the loaded D1 to support the live dual-write (meli_live rows).
-- Adds order_id (idempotency key) and relaxes invoice_number to non-unique,
-- since the same invoice number can now legitimately appear across sources
-- (manual 'provincias' vs authoritative 'meli_live') during overlap periods.

ALTER TABLE transactions ADD COLUMN order_id TEXT;
DROP INDEX IF EXISTS idx_tx_invoice;
CREATE INDEX IF NOT EXISTS idx_tx_invoice ON transactions(invoice_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_order ON transactions(order_id);
