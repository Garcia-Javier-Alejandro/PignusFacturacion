import { OUTPUT_HEADERS, transformOrdersToRows } from './transform.js';

// Live dual-write: mirror synced ML orders into the D1 `transactions` table
// (source='meli_live') alongside the KV orders_cache. Rows use the exact same
// financials as the ReporteFacturación sheet (via transformOrdersToRows), so the
// live data is directly comparable to the historical Excel-imported rows.
// The ML billing split is authoritative here: iibb/sirtac are stored as returned.

const H = Object.fromEntries(OUTPUT_HEADERS.map((h, i) => [h, i]));
const txt = (v) => (v === '' || v == null ? null : v);
const nbr = (v) => (typeof v === 'number' && isFinite(v) ? v : v == null || v === '' ? null : Number(v));

const UPSERT = `INSERT INTO transactions
  (source,channel,grain,order_id,date,year,customer_raw,customer_name,
   gross,mp_fee,iibb,sirtac,tax_total,shipping,net,locality,invoice_number,raw_json,ingested_at)
  VALUES ('meli_live','ML','invoice',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(order_id) DO UPDATE SET
    date=excluded.date, year=excluded.year,
    customer_raw=excluded.customer_raw, customer_name=excluded.customer_name,
    gross=excluded.gross, mp_fee=excluded.mp_fee,
    iibb=excluded.iibb, sirtac=excluded.sirtac, tax_total=excluded.tax_total,
    shipping=excluded.shipping, net=excluded.net, locality=excluded.locality,
    invoice_number=excluded.invoice_number, raw_json=excluded.raw_json,
    ingested_at=excluded.ingested_at`;

// orders: complete packs to write (already merged/deduped). cancelledIds: purge from D1.
export async function dualWriteToD1(env, { orders = [], cancelledIds = [] }) {
  const db = env.PIGNUS_DB;
  if (!db) return { skipped: 'no_binding' };

  const rows = transformOrdersToRows(orders); // groups packs, drops cancelled
  const now = new Date().toISOString();
  const upsert = db.prepare(UPSERT);
  const stmts = [];

  for (const r of rows) {
    const orderId = txt(r[H['Orden ID']]);
    if (!orderId) continue;
    const date = txt(r[H['Fecha Compra']]);
    const year = date ? Number(date.slice(0, 4)) : null;
    const name = txt(r[H['Nombre']]);
    const iibb = nbr(r[H['Retencion IIBB']]);
    const sirtac = nbr(r[H['Imp SIRTAC']]);
    const taxTotal = (iibb || 0) + (sirtac || 0);
    const raw = JSON.stringify(Object.fromEntries(OUTPUT_HEADERS.map((h, i) => [h, r[i]])));
    stmts.push(upsert.bind(
      orderId, date, year, name, name,
      nbr(r[H['Pago']]), nbr(r[H['Recargo MP']]), iibb, sirtac, taxTotal,
      nbr(r[H['Costo Envio']]), nbr(r[H['Neto']]), txt(r[H['Localidad']]),
      txt(r[H['Nº Factura']]), raw, now,
    ));
  }

  // Purge cancelled orders/packs (mirrors mergeIntoCache's cache purge).
  if (cancelledIds.length) {
    const del = db.prepare("DELETE FROM transactions WHERE source='meli_live' AND order_id=?");
    for (const id of new Set(cancelledIds.map(String))) stmts.push(del.bind(id));
  }

  if (!stmts.length) return { written: 0 };

  // D1 batch is transactional; chunk to stay well within limits.
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
  return { upserted: rows.length, statements: stmts.length };
}
