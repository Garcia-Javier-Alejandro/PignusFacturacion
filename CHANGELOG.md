# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are dated rather than semver-numbered while the system is pre-1.0.

---

## [2026-05-31]

### Changed
- "Añadir a sheets" and "Re-exportar todo" now open the sheet anchored to the last row instead of the top

---

## [2026-05-28]

### Fixed
- IIBB/SIRTAC tax fields stuck at `$0.00` for orders whose ML billing data was populated after the order was first cached — `mergeIntoCache` now updates tax fields on existing rows when they were previously null or zero
- Santa Fe IIBB regime (`mov_detail: tax_withholding`) was silently excluded by the tax-line matcher — the matcher now handles it correctly alongside the standard `iibb` substring

### Added
- `debug-taxes.js` endpoint (`GET /api/orders/debug-taxes`) for inspecting raw ML billing data per order
- `backfillTaxes.js` script for re-hydrating `_iibb`/`_sirtac` on the production KV cache (dry-run by default, `--apply` to commit)
- `probeTaxes.js` and `dumpCachedOrder.js` ops scripts for diagnosing tax field discrepancies

---

## [2026-05-22]

### Added
- "Obsoleto" state for pending orders older than 13 months
- "Monto Facturable" column showing the per-order invoiceable amount
- Oldest/newest order dates displayed on the import progress bar

### Changed
- "Facturado" state now triggered when either *Fecha Factura* **or** *Nº Factura* is set (previously required both)
- All KPI calculations switched to use Monto Facturable instead of raw payment amount
- Card 3: replaced progress bars with plain invoiced/limit text; updated labels and rolling window to 30 days; pending filtered to post-2024 only
- Monotributo KPI and history fetch switched to a rolling 12-month window

### Fixed
- Column shift on non-ML rows after Monto Facturable was inserted
- Cron shipping-cost enrichment not running; stale import status message persisting
- Shipping-cost enrichment now captures `receiver.cost` (the seller-borne amount) correctly

---

## [2026-05-21]

### Added
- "Re-exportar todo" button (Aux Debug Tools): wipes the Google Sheet and rewrites all rows from the cache, replacing any stale values
- Re-enrich shipping costs endpoint and matching debug button

### Changed
- KPI sparklines: calendar-month view with x-axis dates and week dividers
- Restante en Categoría card redesigned; category bar label size and layout adjusted
- Card 1 delta: reduced font size, stacked layout; Card 3 eyebrow/select gap tightened
- Date inputs in manual rows switched from native `<input type="date">` to text input with auto-format (avoids browser-locale display inconsistencies)

### Fixed
- Sparkline week dividers: equal-width segments, W3 always visible, filter is day-based not pixel-based
- Full-export ghost rows: sheet is now fully wiped before writing (respects Sheets' minimum-row requirement)
- Cloudflare subrequest limit: shipping-cost fetch moved out of `enrichOrders` into its own request
- Shipping cost now sourced from the shipment costs API; the order's shipment object was unreliable for seller-borne amounts

---

## [2026-05-20]

### Added
- KPI sparklines: calendar-month view with x-axis dates and week dividers (initial implementation)
- "Ingresos GRA" button: records a GRA income row with one-per-month validation and error modal

---

## [2026-05-19]

### Changed
- Brand blue updated to `#1BBFA1` across charts, pill styles, and the KPI strip

---

## [2026-05-18]

### Added
- Inventario link in the cross-app navigation bar

### Changed
- Cross-app nav: Portal text replaced with a home icon

---

## [2026-05-15]

### Added
- Insights section (collapsible panel): revenue analytics Phase A (monthly trend, weekly sparkline, geographic map) and Phase B (SKU table + 12-month stacked bar chart)
- SKU table: sortable top-20 by units or gross revenue; stacked bar shows revenue mix over 12 months
- Leaflet map now loads from cdnjs.cloudflare.com (unpkg SRI hash mismatches prevented map rendering)

### Changed
- Toolbar simplified: "Importar historial" and "Detener" moved to Aux Debug Tools

### Fixed
- Date display one day behind: `formatDate` now uses `parseDate` (appends `T00:00:00` for local midnight) instead of `new Date()`, which parses bare `YYYY-MM-DD` strings as UTC midnight — in ART (UTC-3) that resolved to the previous day at 21:00
- `toDateStr` in `transform.js`: ART date conversion now goes through UTC milliseconds; previously `getFullYear/Month/Date` returned local system time, which differed from ART on other machines
- Cache sort now uses epoch milliseconds instead of ISO string comparison so orders with mixed timezone offsets (`-03:00` vs `-04:00`) sort chronologically

---

## [2026-05-14]

### Added
- "Cargar hoy" button: fetches the 50 most recent ML orders and filters to today and yesterday in ART client-side; status bar shows today/yesterday counts

### Changed
- ML's `date_created.from/to` filter removed — it is silently ignored by the ML API; loading today's orders now relies on `sort=date_desc` + client-side ART date comparison
- KPI invoiceable line uses the monthly limit (annual cap ÷ 12 minus month-to-date invoiced); handles zero invoiceable orders with a distinct message
