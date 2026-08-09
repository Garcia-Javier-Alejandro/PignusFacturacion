-- Dedup provincias vs meli_live (both are the ML invoice channel and overlap in time).
-- meli_live (real ML billing) is authoritative; provincias (manual workbook) is the
-- fallback for history BEFORE meli_live coverage begins. Cutover = earliest meli_live date.
-- v_ml_facturacion is the canonical, double-count-free ML facturación series (invoice grain).
--
-- NOT included here: source='mascaras' (line-item grain, multi-channel retail 2020-2023).
-- It is a different granularity/era; query it separately. Its early 'ML' rows may overlap
-- provincias for 2021-2023 — reconcile at analysis time, do not naively SUM with this view.

DROP VIEW IF EXISTS v_ml_facturacion;
CREATE VIEW v_ml_facturacion AS
SELECT *
FROM transactions
WHERE grain = 'invoice'
  AND (
    source = 'meli_live'
    OR (source = 'provincias'
        AND date < COALESCE((SELECT MIN(date) FROM transactions WHERE source = 'meli_live'), '9999-12-31'))
  );
