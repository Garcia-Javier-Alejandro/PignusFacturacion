-- Manual date corrections for `date_suspect` rows (corrupted YEAR in source Excel).
-- Inferred from neighbouring invoice numbers. Applied to history.db after the ETL,
-- because the source Provincias .xlsx files are being deleted (DB becomes source of truth).
-- flags: 'date_fixed:year'   = only the year was wrong, day/month matched neighbours (high confidence)
--        'date_fixed:bracket' = month/day also off; date placed between adjacent invoices (inferred)

UPDATE transactions SET date='2021-05-12', year=2021, flags='date_fixed:bracket' WHERE invoice_number='#107';
UPDATE transactions SET date='2021-12-10', year=2021, flags='date_fixed:year'    WHERE invoice_number='#282';
UPDATE transactions SET date='2022-02-06', year=2022, flags='date_fixed:bracket' WHERE invoice_number='#334';
UPDATE transactions SET date='2023-05-10', year=2023, flags='date_fixed:year'    WHERE invoice_number='#693';
UPDATE transactions SET date='2023-05-13', year=2023, flags='date_fixed:year'    WHERE invoice_number='#696';
UPDATE transactions SET date='2023-06-03', year=2023, flags='date_fixed:year'    WHERE invoice_number='#724';
