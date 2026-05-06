# Pignus

Minimal Node.js backend script that fetches paid Mercado Libre orders, transforms them into a financial table, and appends the rows to a Google Sheet.

There is no frontend. Run it from the command line.

## Requirements

- Node.js 24 LTS or newer
- npm
- Mercado Libre seller account and OAuth access token
- Google Cloud service account with Google Sheets API enabled
- A Google Sheet shared with the service account

## Install

```bash
npm install
```

## Configure

Create a local `.env` file from the example:

```bash
cp .env.example .env
```

Fill in these values:

```env
MELI_ACCESS_TOKEN=your_mercado_libre_access_token
MELI_SELLER_ID=your_seller_id

GOOGLE_SHEET_ID=your_spreadsheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

SHEET_NAME=Ventas
MELI_PAGE_SIZE=50
MELI_MAX_RETRIES=3
LOG_RAW_PAYMENTS=false
```

### Mercado Libre

The script calls:

```text
GET https://api.mercadolibre.com/orders/search?seller={SELLER_ID}
```

It sends the token as:

```text
Authorization: Bearer <MELI_ACCESS_TOKEN>
```

To get the token:

1. Create an app in the Mercado Libre developer portal.
2. Complete the OAuth authorization flow for your seller account.
3. Store the resulting access token in `MELI_ACCESS_TOKEN`.
4. Store your seller id in `MELI_SELLER_ID`.

The script fetches all pages, keeps only paid orders, and retries temporary API failures.

### Google Sheets

1. Create or open the target Google Sheet.
2. Copy the spreadsheet ID from the URL and set `GOOGLE_SHEET_ID`.
3. Enable the Google Sheets API in Google Cloud.
4. Create a service account.
5. Create a JSON key for that service account.
6. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` from the JSON key's `client_email`.
7. Set `GOOGLE_PRIVATE_KEY` from the JSON key's `private_key`.
8. Share the spreadsheet with the service account email as an editor.
9. Make sure the sheet tab is named `Ventas`, or change `SHEET_NAME`.

Keep the private key line breaks as escaped `\n` characters inside `.env`.

## Run

```bash
npm start
```

The script will:

1. Fetch paid Mercado Libre orders.
2. Read existing order ids from column A of the sheet.
3. Skip orders already present in the sheet.
4. Append only new rows.

## Output Columns

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

## Current Mapping Notes

The mapping is based on the Mercado Libre reports you downloaded:

- `Orden ID` maps to `# de venta` in the sales report and `Numero de venta` in the billing report.
- `Pago` is intended to match `Ingresos por productos (ARS)`.
- `Costo Envio` is intended to match `Costos de envio (ARS)`, but this needs to be reviewed after seeing the live API response.
- Product Ads charges are ignored.
- Tax parsing checks `type`, `name`, and `description` from `fee_details` because Mercado Libre tax labels can vary by account.

For the first real run, set:

```env
LOG_RAW_PAYMENTS=true
```

That logs raw `payments` data so IIBB and SIRTAC classification can be verified against the actual API response.

## Cloudflare Pages Placeholder

This repo also includes a minimal static frontend in `public/` so you can deploy it to Cloudflare Pages and reserve a stable domain for the future website.

The useful OAuth callback path is:

```text
https://YOUR_PAGES_DOMAIN/api/auth/mercadolibre/callback/
```

Use that URL as the Mercado Libre app redirect URI once the Cloudflare Pages site is deployed.

### Deploy From GitHub

1. Push this repository to GitHub.
2. In Cloudflare, go to Workers & Pages.
3. Select Create application.
4. Select Pages.
5. Select Import an existing Git repository.
6. Choose this repository.
7. Use these build settings:

```text
Framework preset: None
Build command: exit 0
Build output directory: public
Root directory: /
Production branch: main
```

Cloudflare will deploy the contents of `public/` and give you a `*.pages.dev` domain. Every push to the production branch will trigger a new deployment.

The callback page is static. It does not store secrets or exchange tokens; it only displays the temporary Mercado Libre `code` query parameter so you can copy it during the current manual setup.
