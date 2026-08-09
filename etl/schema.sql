-- Facturación historical store. SQLite / Cloudflare D1 compatible.
-- One unified `transactions` fact table (invoice + line_item grain) + `expenses`.

CREATE TABLE IF NOT EXISTS transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source         TEXT NOT NULL,        -- 'provincias' | 'mascaras' | 'meli_live'
  channel        TEXT,                 -- 'ML' | 'IG' | 'FB' | 'other'
  grain          TEXT NOT NULL,        -- 'invoice' | 'line_item'
  date           TEXT,                 -- ISO 'YYYY-MM-DD'
  year           INTEGER,
  customer_raw   TEXT,
  customer_name  TEXT,
  product        TEXT,                 -- line_item only
  qty            REAL,
  unit_price     REAL,
  gross          REAL,                 -- Pago / TOTAL / EFT en caja
  mp_fee         REAL,                 -- Recargo MP
  iibb           REAL,                 -- Retencion IIBB, AS LABELLED in source (unreliable split in manual files)
  sirtac         REAL,                 -- Imp SIRTAC, AS LABELLED in source
  tax_total      REAL,                 -- canonical withholding total (iibb+sirtac); comparable across all sources
  shipping       REAL,                 -- Envio
  net            REAL,                 -- Neto
  cost           REAL,                 -- Costo Fabrica
  profit         REAL,                 -- Ganancias
  locality       TEXT,                 -- Localidad
  invoice_number TEXT,
  payment_method TEXT,
  notes          TEXT,
  flags          TEXT,                 -- e.g. 'date_suspect' for out-of-range dates
  raw_json       TEXT,                 -- original row, for reprocessing
  ingested_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_date    ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_year    ON transactions(year);
CREATE INDEX IF NOT EXISTS idx_tx_channel ON transactions(channel);
CREATE INDEX IF NOT EXISTS idx_tx_source  ON transactions(source);
CREATE INDEX IF NOT EXISTS idx_tx_product ON transactions(product);
-- facturación dedup: an invoice number can appear once (NULLs unconstrained)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_invoice
  ON transactions(invoice_number) WHERE invoice_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source         TEXT NOT NULL,
  date           TEXT,
  year           INTEGER,
  item           TEXT,
  qty            REAL,
  unit_cost      REAL,
  total_cost     REAL,
  payment_method TEXT,
  flags          TEXT,
  raw_json       TEXT,
  ingested_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ex_date ON expenses(date);
