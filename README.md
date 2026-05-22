# Pignus

Pignus is a Cloudflare Pages app that fetches paid Mercado Libre Argentina orders, stores them in Cloudflare KV, and lets the seller review and export them to a Google Sheet.

## What It Does

1. Fetch the most recent paid orders from the Mercado Libre seller account.
2. Enrich each order with shipment details (city, province), billing taxes (IIBB, SIRTAC), sender and receiver shipping costs, fiscal invoice date, and coupon amount.
3. Store orders in a Cloudflare KV cache covering a rolling 12-month window, importable incrementally.
4. Display the table in the browser UI with monetary totals and manual row entry.
5. Append only new rows (by Orden ID) to the configured Google Sheet tab.

All API calls run inside Cloudflare Pages Functions so OAuth tokens and service account credentials stay server-side.

## UI / Dashboard

The frontend (`public/index.html`) is a single vanilla JS page with no framework. Styles come entirely from the shared PignusUI package (`https://ui.pignuslabs.com.ar/pignus.css`). App-specific overrides live in a thin local `app.css` if needed.

**Header:** PignusLabs logo (links to Portal) + pill tab nav (Portal / Facturación / Inversiones) + Welcome [user] resolved from Cloudflare Access identity.

**KPI strip (3 cards above the table):**
- **Ventas** — order count this month, % change vs previous month, 30-day rolling sparkline.
- **Facturado** — `neto + costo` this month (invoiced rows only), % change vs previous month, gold pill showing pending order count and amount (post-2024, uninvoiced rows), 30-day rolling sparkline.
- **Restante en categoría** — two plain rows against the selected Monotributo category (A–K): *Facturado últimos 12 meses* (rolling 12-month window) and *Facturado últimos 30 días*, both compared against the category annual limit and its monthly average (limit ÷ 12). Both use `neto + costo` for invoiced rows.

**Period row:** custom date range selector showing Ventas and Facturado for any chosen period.

**Table:** order data with a computed **Estado** column — `Pendiente` (amber) if `Nº Factura` is empty, `Facturado` (green) otherwise. Collapsed and expanded column sets both include Estado.

**History import bar (below table):** "Re importar historial" button auto-loops fetching batches of 20 orders backwards until the oldest cached order reaches the rolling 12-month cutoff. Shows order count, oldest date, and newest date on a progress bar.

## TODO

- **Use Monto Facturable as the Monotributo base:** Card 3 and Card 2 currently use `neto + costo` (`Pago − Recargo MP − IIBB − SIRTAC`). The correct Monotributo gross income base is `Monto Facturable` (`order_items[].quantity × unit_price + shipments/{id}/costs receiver.cost`). This should replace `neto + costo` in all KPI calculations once confirmed with an accountant.
- **Integrate factura data (non-ML source):** Orders invoiced outside Mercado Libre (direct sales, other channels) are not currently captured. The table and KPI calculations should support rows sourced from actual invoice records — not just ML orders. This requires a new data ingestion path (manual upload, AFIP integration, or similar) and a way to distinguish invoice-sourced rows from ML-sourced rows in the cache.
- **Wire pending orders properly:** The `Estado` column currently derives status from whether `Nº Factura` is filled. A proper implementation would track billing status independently so an order can be marked Facturado even if the invoice date comes from a non-ML source.
- **Métricas del negocio section:** Ticket promedio, clientes únicos, recurrencia, impuestos acumulados, cupones, días facturando — designed but not yet implemented.

## Output Table

| Column | Source |
|---|---|
| Orden ID | `order.id` (or `pack_id` if multi-item) |
| Fecha Compra | `order.date_created` |
| Nombre | `buyer.first_name + last_name` or `nickname` |
| Pago | Sum of `order_items[].quantity × unit_price` |
| Cupón | Coupon discount — `billing/integration` API |
| Recargo MP | Sum of `order_items[].sale_fee` |
| Retencion IIBB | Billing API — `mov_financial_entity` contains `iibb` |
| Imp SIRTAC | Billing API — `mov_detail` contains `sirtac` |
| Suma Impuestos | IIBB + SIRTAC |
| Costo Envio | `shipments/{id}/costs senders[].cost` (seller's carrier cost); falls back to `payments[].shipping_cost` if not yet enriched |
| Neto | Pago − (Recargo MP + Suma Impuestos + Costo Envio) |
| Monto Facturable | `Pago + shipments/{id}/costs receiver.cost` — total paid by the buyer (products + buyer's shipping). Intended as the Monotributo gross income base. Falls back to `Pago + payments[].shipping_cost` if not yet enriched. |
| Localidad | `shipments/{id} receiver_address.city.name` |
| Provincia | `shipments/{id} receiver_address.state.name` |
| Orígen | `ML` (or `MANUAL` / `GRA` for manually added rows) |
| Fecha Factura | Fiscal invoice date from `packs/{pack_id}/fiscal_documents` |
| Nº Factura | Invoice number from Contabilium import or manual entry |

Orders sharing a `pack_id` are merged into a single row.

## Enrichment Pipeline

New orders go through two enrichment passes after initial fetch:

1. **`enrichOrders` + `fetchBillingTaxes`** (runs inline during fetch, `fetchAndStore.js`): fetches `/orders/{id}` and `/shipments/{id}` for shipment details, then `/billing/integration` for IIBB and SIRTAC. Consumes ~40–60 subrequests per batch of 20 orders.

2. **`enrich-extra`** (separate pass, `api/orders/enrich-extra.js`): fetches `packs/{id}/fiscal_documents` for invoice date and `billing/integration` for coupon amount. Batches of 20, auto-loops from the frontend until `enrichDone: true`.

3. **`enrich-shipping-costs`** (separate pass, `api/orders/enrich-shipping-costs.js`): fetches `/shipments/{id}/costs` for `senders[].cost` (seller cost → `_sender_shipping_cost`) and `receiver.cost` (buyer cost → `_receiver_shipping_cost`). Batches of 20, auto-loops until `enrichDone: true`. Also triggered via `waitUntil` from the nightly cron (`recent.js`).

The split into separate passes is required by Cloudflare's 50-subrequest-per-invocation limit.

## Architecture

```
public/
  index.html          Frontend — vanilla JS, no framework
  styles.css
  PignusLabs_Logo.png

functions/
  _lib/
    meliAuth.js       ML OAuth token storage and refresh (KV: meli_tokens)
    meliOrders.js     ML API calls: fetch, enrich, billing taxes, fiscal dates, coupons
    ordersCache.js    KV cache helpers: get, merge, save, done-check (rolling 12-month cutoff)
    fetchAndStore.js  Shared enrichment + cache-write pipeline
    transform.js      Order → spreadsheet row mapping
    sheets.js         Google Sheets JWT auth, append, reset, and overwrite
    http.js           JSON response helpers
  api/
    meli/
      login.js        GET  /api/meli/login              → ML OAuth redirect
      callback.js     GET  /api/meli/callback            → exchange code, store tokens
    orders/
      cache.js        GET/DELETE /api/orders/cache       → load or wipe KV order cache
      recent.js       GET  /api/orders/recent            → fetch latest ~20, enrich, cache; triggers shipping cost enrichment via waitUntil
      older.js        GET  /api/orders/older             → fetch next older batch, enrich, cache
      enrich-extra.js GET  /api/orders/enrich-extra      → enrich fiscal dates + coupons (batch of 20)
      enrich-shipping-costs.js GET /api/orders/enrich-shipping-costs → enrich sender + receiver shipping costs (batch of 20)
      export.js       POST /api/orders/export            → append new rows to Google Sheet
      full-export.js  POST /api/orders/full-export       → reset sheet and overwrite all rows from cache
    edits.js          GET/POST /api/edits                → read or write manual edits state
```

## KV — Source of Truth

**Cloudflare KV (`PIGNUS_TOKENS`) is the single source of truth for all application data.** Nothing meaningful is stored client-side.

| Key | Contents |
|---|---|
| `meli_tokens` | OAuth access + refresh token bundle |
| `orders_cache` | Slim ML order objects, seen IDs, pagination offset, oldest date, newest date |
| `edits` | Manual rows added by the user, hidden ML row IDs, ML row overrides |

On page load the frontend fetches `orders_cache` and `edits` in parallel before rendering.

The order cache is built incrementally. "Re importar historial" fetches batches of 20 orders going backwards from the oldest cached order, stopping when `oldest_date` is before the rolling 12-month cutoff (first day of the month 11 months ago) or `next_older_offset ≤ −20`.

### Resetting state

To wipe everything and start fresh (dev/recovery only — no UI button):

```bash
# Clear ML orders cache
curl -X DELETE https://facturacion.pignuslabs.com.ar/api/orders/cache \
  -H "Authorization: Bearer <ADMIN_API_KEY>"

# Clear manual edits (manual rows, hidden IDs, overrides)
curl -X POST https://facturacion.pignuslabs.com.ar/api/edits \
  -H "Authorization: Bearer <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"manualRows":[],"hiddenIds":[],"mlOverrides":{}}'
```

## Requirements

- Mercado Libre seller account + app credentials
- Google Cloud service account with Google Sheets API enabled
- A Google Sheet shared with the service account
- Cloudflare Pages with KV binding and Pages Functions

## Cloudflare Deployment

Build settings:

```
Framework preset: None
Build command:    exit 0
Output directory: public
Root directory:   /
```

KV binding: `PIGNUS_TOKENS`

Pages Function secrets:

```
ADMIN_API_KEY
MELI_APP_ID
MELI_CLIENT_SECRET
MELI_REDIRECT_URI
MELI_SELLER_ID
GOOGLE_SHEET_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
SHEET_NAME
```

## Mercado Libre Auth

Navigate to `/api/meli/login` (or click "Re-authorize ML" in the header) on the seller's computer to start the OAuth flow. After authorizing, the callback stores the token bundle in KV automatically.

Tokens are refreshed server-side on every API call that needs them. Refresh tokens are single-use; the latest bundle is always written back to KV.

## Google Sheets Setup

1. Create the target Google Sheet and copy its ID from the URL.
2. Set `GOOGLE_SHEET_ID` in Cloudflare Pages secrets.
3. Share the sheet with the service account email as editor.
4. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` from the service account JSON key.
5. Set `SHEET_NAME` to the tab name (e.g. `Ventas`).

The export endpoint (`POST /api/orders/export`) reads all existing values in column A and skips any Orden ID already present before appending. `POST /api/orders/full-export` resets the sheet entirely and overwrites from row 1.
