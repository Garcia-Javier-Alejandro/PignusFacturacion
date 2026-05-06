# Pignus

Pignus connects a Mercado Libre seller account to a Google Sheet.

It fetches paid Mercado Libre orders, shows the raw API response for validation, transforms those orders into the financial table used by the business, and exports only new rows to Google Sheets.

The project has two ways to run the same workflow:

- A Cloudflare Pages debug frontend at `/debug/` for reviewing API data, checking the transformed table, and exporting to Google Sheets.
- A local Node.js command for fetching paid orders and appending new rows directly.

## What It Does

Pignus is built around a simple accounting workflow:

1. Fetch paid Mercado Libre orders from the seller account.
2. Preserve the raw API response so fee and tax mappings can be reviewed.
3. Build the output table expected by the Google Sheet.
4. Skip orders already present in column A.
5. Append only new rows to the configured sheet tab.

The frontend never calls Mercado Libre or Google directly from browser JavaScript. Those calls happen in Cloudflare Pages Functions so OAuth tokens, service account credentials, and API keys stay server-side.

## Output Table

The exported Google Sheets table uses these columns:

- Orden ID
- Fecha
- Nombre
- Pago
- Recargo MP
- Retencion IIBB
- Imp SIRTAC
- Costo Envio
- Neto
- Localidad
- Validacion Neto

`Orden ID` is used for duplicate prevention.

`Neto` is calculated as:

```text
Pago - (Recargo MP + Retencion IIBB + Imp SIRTAC + Costo Envio)
```

`Validacion Neto` is calculated as:

```text
Neto - net_received_amount
```

## Mapping Notes

The current transformation is based on Mercado Libre sales and billing reports:

- `Orden ID` maps to `# de venta` in the sales report and `Numero de venta` in the billing report.
- `Pago` is intended to match `Ingresos por productos (ARS)`.
- `Costo Envio` is intended to match `Costos de envio (ARS)`.
- Product Ads charges are ignored.
- Tax parsing checks `type`, `name`, and `description` from `fee_details` because Mercado Libre tax labels can vary by account.

When validating a real account for the first time, set:

```env
LOG_RAW_PAYMENTS=true
```

That logs raw `payments` data so IIBB and SIRTAC classification can be compared against the live Mercado Libre response.

## Requirements

- Node.js 24 LTS or newer
- npm
- Mercado Libre seller account
- Mercado Libre app credentials with OAuth access
- Google Cloud service account with Google Sheets API enabled
- A Google Sheet shared with the service account
- Cloudflare Pages, KV, and Pages Functions for the deployed frontend

## Local Setup

Install dependencies:

```bash
npm install
```

Create `.env` from the example:

```bash
cp .env.example .env
```

Configure:

```env
MELI_ACCESS_TOKEN=your_mercado_libre_access_token
MELI_REFRESH_TOKEN=your_mercado_libre_refresh_token
MELI_TOKEN_EXPIRES_AT=2026-05-06T18:00:00.000Z
MELI_SELLER_ID=your_seller_id
MELI_APP_ID=your_app_id
MELI_CLIENT_SECRET=your_client_secret
MELI_REDIRECT_URI=https://pignus.pages.dev/api/auth/mercadolibre/callback/

GOOGLE_SHEET_ID=your_spreadsheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

SHEET_NAME=Ventas
MELI_PAGE_SIZE=50
MELI_MAX_RETRIES=3
LOG_RAW_PAYMENTS=false
ADMIN_API_KEY=
```

Keep `GOOGLE_PRIVATE_KEY` line breaks as escaped `\n` characters inside `.env`.

## Mercado Libre Auth

Generate an authorization URL from `.env`:

```bash
npm run meli:auth-url
```

Open the URL, authorize the seller account, then copy the returned `code` query parameter into `.env`:

```env
MELI_AUTH_CODE=TG-...
```

Exchange it for tokens:

```bash
npm run meli:exchange-code
```

Mercado Libre refresh tokens are single-use. Pignus refreshes tokens server-side when possible and stores the latest token bundle in Cloudflare KV for the deployed frontend.

## Google Sheets Setup

1. Create or open the target Google Sheet.
2. Copy the spreadsheet ID from the URL and set `GOOGLE_SHEET_ID`.
3. Enable the Google Sheets API in Google Cloud.
4. Create a service account.
5. Create a JSON key for that service account.
6. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` from `client_email`.
7. Set `GOOGLE_PRIVATE_KEY` from `private_key`.
8. Share the spreadsheet with the service account email as an editor.
9. Make sure the tab is named `Ventas`, or change `SHEET_NAME`.

## Running Locally

Append new paid orders from the command line:

```bash
npm start
```

Generate a local debug snapshot:

```bash
npm run meli:debug-export
```

Serve the static frontend:

```bash
npm run frontend:dev
```

Then open:

```text
http://localhost:8788/debug/
```

For Pages Functions locally, use Wrangler:

```bash
wrangler pages dev public --port 8788
```

If your installed Wrangler runtime does not yet support the repo compatibility date, run with the latest supported date printed by Wrangler.

## Debug Frontend

The `/debug/` page is the main review and export surface. It shows:

- Raw Mercado Libre paid order objects returned by the server-side API call.
- The processed table using the output columns above.
- Per-order payment and fee details for mapping validation.
- An Export to Google Sheets button.

`ADMIN_API_KEY` protects the debug API. Open `/debug/`, paste the value from `.env`, and click Save. The key is stored in browser local storage and sent as an `Authorization: Bearer ...` header.

The export button posts the table currently shown in the browser to:

```text
/api/orders/export
```

The Function re-checks existing order IDs in Google Sheets before appending, so repeated exports skip rows already present in column A.

## Cloudflare Deployment

Cloudflare Pages build settings:

```text
Framework preset: None
Build command: exit 0
Build output directory: public
Root directory: /
Production branch: main
```

Production token storage uses Cloudflare KV:

```text
Binding: PIGNUS_TOKENS
Key: meli_tokens
```

Seed the current local Mercado Libre tokens into KV:

```bash
npm run cloudflare:seed-tokens
```

Set these Cloudflare Pages Function secrets:

```text
MELI_APP_ID
MELI_CLIENT_SECRET
MELI_REDIRECT_URI
MELI_SELLER_ID
ADMIN_API_KEY
GOOGLE_SHEET_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
SHEET_NAME
```

The deployed OAuth callback route is:

```text
https://pignus.pages.dev/api/auth/mercadolibre/callback
```

## Main Scripts

```text
npm start                    Fetch paid orders and append new rows to Google Sheets
npm run meli:auth-url         Build the Mercado Libre OAuth URL
npm run meli:exchange-code    Exchange an OAuth code for tokens
npm run meli:debug-export     Generate a local sanitized order snapshot
npm run frontend:dev          Serve public/ locally
npm run cloudflare:seed-tokens Seed Cloudflare KV with Mercado Libre tokens
```
