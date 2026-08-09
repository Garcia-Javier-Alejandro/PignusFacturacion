// One-time backfill of the live KV orders_cache into D1 as source='meli_live'.
// Reuses the real transform.js (pack grouping, cancelled filter, financials) so the
// backfilled rows are identical to what the live dual-write (d1Sync.js) produces.
//
// Usage: node etl/backfill_meli_live.mjs <cache.json> <out.sql>
//   cache.json = `wrangler kv key get orders_cache --namespace-id=... --remote`
//   out.sql    = load with `wrangler d1 execute <db> --remote --file=out.sql`
// Keep out.sql OUT of the repo (customer PII).

import { readFileSync, writeFileSync } from 'node:fs';
import { OUTPUT_HEADERS, transformOrdersToRows } from '../functions/_lib/transform.js';

const [, , cachePath, outPath] = process.argv;
const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
const orders = cache.orders || [];
const rows = transformOrdersToRows(orders); // groups packs, drops cancelled

const H = Object.fromEntries(OUTPUT_HEADERS.map((h, i) => [h, i]));
const txt = (v) => (v === '' || v == null ? null : v);
const nbr = (v) => (typeof v === 'number' && isFinite(v) ? v : v == null || v === '' ? null : Number(v));
const lit = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const COLS = 'source,channel,grain,order_id,date,year,customer_raw,customer_name,gross,mp_fee,iibb,sirtac,tax_total,shipping,net,locality,invoice_number,raw_json,ingested_at';
const SET = ['date', 'year', 'customer_raw', 'customer_name', 'gross', 'mp_fee', 'iibb', 'sirtac', 'tax_total', 'shipping', 'net', 'locality', 'invoice_number', 'raw_json', 'ingested_at']
  .map((c) => `${c}=excluded.${c}`).join(',');
const now = new Date().toISOString();

const stmts = [];
for (const r of rows) {
  const orderId = txt(r[H['Orden ID']]);
  if (!orderId) continue;
  const date = txt(r[H['Fecha Compra']]);
  const year = date ? Number(date.slice(0, 4)) : null;
  const name = txt(r[H['Nombre']]);
  const iibb = nbr(r[H['Retencion IIBB']]);
  const sirtac = nbr(r[H['Imp SIRTAC']]);
  const tax = (iibb || 0) + (sirtac || 0);
  const raw = JSON.stringify(Object.fromEntries(OUTPUT_HEADERS.map((h, i) => [h, r[i]])));
  const vals = ['meli_live', 'ML', 'invoice', orderId, date, year, name, name,
    nbr(r[H['Pago']]), nbr(r[H['Recargo MP']]), iibb, sirtac, tax,
    nbr(r[H['Costo Envio']]), nbr(r[H['Neto']]), txt(r[H['Localidad']]),
    txt(r[H['Nº Factura']]), raw, now];
  stmts.push(`INSERT INTO transactions (${COLS}) VALUES (${vals.map(lit).join(',')}) ON CONFLICT(order_id) DO UPDATE SET ${SET};`);
}

writeFileSync(outPath, stmts.join('\n') + '\n');
console.log(`orders=${orders.length} packs(rows)=${rows.length} statements=${stmts.length}`);
