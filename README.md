# Pignus

Pignus is a Cloudflare Pages app that fetches paid Mercado Libre Argentina orders, stores them in Cloudflare KV, and lets the seller review and export them to a Google Sheet.

## What It Does

1. Fetch the most recent paid orders from the Mercado Libre seller account.
2. Enrich each order with shipment details (city, province) and billing taxes (IIBB, SIRTAC).
3. Store orders in a Cloudflare KV cache so the full 2026 history can be imported incrementally.
4. Display the table in the browser UI with monetary totals and manual row entry.
5. Append only new rows (by Orden ID) to the configured Google Sheet tab.

All API calls run inside Cloudflare Pages Functions so OAuth tokens and service account credentials stay server-side.

## Output Table

| Column | Source |
|---|---|
| Orden ID | `order.id` (or `pack_id` if multi-item) |
| Fecha Compra | `order.date_created` |
| Nombre | `buyer.first_name + last_name` or `nickname` |
| Pago | Sum of `order_items[].quantity × unit_price` |
| Recargo MP | Sum of `order_items[].sale_fee` |
| Retencion IIBB | Billing API — `mov_financial_entity` contains `iibb` |
| Imp SIRTAC | Billing API — `mov_detail` contains `sirtac` |
| Suma Impuestos | IIBB + SIRTAC |
| Costo Envio | `payments[].shipping_cost` |
| Neto | Pago − (Recargo MP + Suma Impuestos + Costo Envio) |
| Localidad | `shipments.receiver_address.city.name` |
| Provincia | `shipments.destination.shipping_address.state.name` |
| Orígen | `ML` (or `MANUAL` for manually added rows) |

Orders sharing a `pack_id` are merged into a single row.

## Architecture

```
public/
  index.html        Frontend — vanilla JS, no framework
  styles.css
  Logo_Pignus_Facturacion.png

functions/
  _lib/
    meliAuth.js     ML OAuth token storage and refresh (KV: meli_tokens)
    meliOrders.js   ML API calls: fetch, enrich, billing taxes
    ordersCache.js  KV cache helpers: get, merge, save, done-check
    fetchAndStore.js  Shared enrichment + cache-write pipeline
    transform.js    Order → spreadsheet row mapping
    googleSheets.js Google Sheets JWT auth and append
    http.js         JSON response helpers
  api/
    meli/
      login.js      GET  /api/meli/login        → ML OAuth redirect
      callback.js   GET  /api/meli/callback      → exchange code, store tokens
    orders/
      cache.js      GET/DELETE /api/orders/cache  → load or wipe KV order cache
      recent.js     GET  /api/orders/recent       → fetch latest ~20, enrich, cache
      older.js      GET  /api/orders/older        → fetch next older batch, enrich, cache
      export.js     POST /api/orders/export       → append new rows to Google Sheet
  edits.js          GET/POST /api/edits           → read or write manual edits state
```

## KV — Source of Truth

**Cloudflare KV (`PIGNUS_TOKENS`) is the single source of truth for all application data.** Nothing meaningful is stored client-side.

| Key | Contents |
|---|---|
| `meli_tokens` | OAuth access + refresh token bundle |
| `orders_cache` | Slim ML order objects, seen IDs, pagination offset, oldest date |
| `edits` | Manual rows added by the user, hidden ML row IDs, ML row overrides |

On page load the frontend fetches `orders_cache` and `edits` in parallel before rendering.

The order cache is built incrementally. "Import 2026 history" fetches batches of 20 orders going backwards from the oldest cached order, stopping when `oldest_date < 2026-01-01` or `next_older_offset < 0`.

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

The export endpoint (`POST /api/orders/export`) reads all existing values in column A and skips any Orden ID already present before appending.
