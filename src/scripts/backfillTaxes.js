// Backfill _iibb / _sirtac for orders in the production cache that were either
// (a) never enriched (undefined) — caused by the prior add-only mergeIntoCache, or
// (b) enriched with stale matcher (e.g. Santa Fe tax_withholding rows dropped).
//
// Usage:
//   node Pignusfacturacion/src/scripts/backfillTaxes.js           # dry-run
//   node Pignusfacturacion/src/scripts/backfillTaxes.js --apply   # write back to KV

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NAMESPACE_ID = '1ddcfd99d51c4d5ab6cae8b1c8526ddb';
const TOKEN_KEY = 'meli_tokens';
const CACHE_KEY = 'orders_cache';
const BATCH = 10;
const APPLY = process.argv.includes('--apply');

function wrangler(args) {
  return spawnSync('npx.cmd', ['--yes', 'wrangler', ...args],
    { encoding: 'utf8', shell: true, maxBuffer: 200 * 1024 * 1024 });
}

function kvGet(key) {
  const r = wrangler(['kv', 'key', 'get', key, '--namespace-id', NAMESPACE_ID, '--remote']);
  if (r.status !== 0) throw new Error(`kv get ${key}: ${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

function kvPut(key, value) {
  const tmp = path.join(os.tmpdir(), `kv-${key}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(value));
  const r = wrangler(['kv', 'key', 'put', key, '--namespace-id', NAMESPACE_ID, '--path', tmp, '--remote']);
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) throw new Error(`kv put ${key}: ${r.stderr}`);
}

function computeTaxes(item) {
  let iibb = 0;
  let sirtac = 0;
  for (const payment of item.payment_info || []) {
    for (const tax of payment.tax_details || []) {
      const detail = (tax.mov_detail || '').toLowerCase();
      const entity = (tax.mov_financial_entity || '').toLowerCase();
      const amount = Number(tax.original_amount || 0);
      if (detail.includes('sirtac')) sirtac += amount;
      else if (detail.startsWith('tax_withholding') || detail.includes('iibb') || entity.includes('iibb')) iibb += amount;
    }
  }
  return { iibb, sirtac };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBatchTaxes(ids, token, attempt = 0) {
  const res = await fetch(
    `https://api.mercadolibre.com/billing/integration/group/ML/order/details?order_ids=${ids.join(',')}`,
    { headers: { accept: 'application/json', authorization: `Bearer ${token}` } },
  );
  if (res.status === 429 && attempt < 3) {
    const backoff = 60_000 * (attempt + 1);
    console.warn(`  429 — backing off ${backoff / 1000}s (attempt ${attempt + 1})`);
    await sleep(backoff);
    return fetchBatchTaxes(ids, token, attempt + 1);
  }
  if (!res.ok) {
    return { ok: false, status: res.status, results: [] };
  }
  const body = await res.json();
  const results = (body.results || []).map((item) => ({
    id: String(item.order_id),
    ...computeTaxes(item),
  }));
  return { ok: true, status: 200, results };
}

const tokens = kvGet(TOKEN_KEY);
if (!tokens.access_token) throw new Error('no access_token in KV');
if (Date.parse(tokens.expires_at || '') <= Date.now()) {
  console.warn(`WARNING: KV access_token expired at ${tokens.expires_at}. Trigger a UI action to refresh it, then re-run.`);
  process.exit(1);
}
const accessToken = tokens.access_token;

const cache = kvGet(CACHE_KEY);
console.log(`cache: ${cache.orders.length} orders, updated_at=${cache.updated_at}`);

const YEAR_FROM = process.env.YEAR_FROM || '2026';
const candidates = cache.orders.filter((o) => (o.date_created || '') >= YEAR_FROM);
console.log(`candidates (date>=${YEAR_FROM}): ${candidates.length}`);

const stats = { fetched: 0, changed: 0, unchanged: 0, missingInResponse: 0, recoveredIndividually: 0, stillMissing: 0, batchErrors: 0 };
const orderById = new Map(cache.orders.map((o) => [String(o.id), o]));
const changes = [];
const missingIds = [];

function applyResult({ id, iibb, sirtac }) {
  const order = orderById.get(id);
  if (!order) return;
  const before = { _iibb: order._iibb, _sirtac: order._sirtac };
  if (before._iibb === iibb && before._sirtac === sirtac) {
    stats.unchanged++;
    return;
  }
  stats.changed++;
  changes.push({ id, before, after: { _iibb: iibb, _sirtac: sirtac } });
  order._iibb = iibb;
  order._sirtac = sirtac;
}

for (let i = 0; i < candidates.length; i += BATCH) {
  const slice = candidates.slice(i, i + BATCH);
  const ids = slice.map((o) => String(o.id));
  const { ok, status, results } = await fetchBatchTaxes(ids, accessToken);
  if (!ok) {
    stats.batchErrors++;
    console.warn(`batch ${i / BATCH + 1}: HTTP ${status}, skipping ${ids.length} orders`);
    continue;
  }
  stats.fetched += ids.length;
  const returnedIds = new Set(results.map((r) => r.id));
  for (const id of ids) {
    if (!returnedIds.has(id)) {
      stats.missingInResponse++;
      missingIds.push(id);
    }
  }

  for (const result of results) applyResult(result);

  if ((i / BATCH + 1) % 10 === 0) {
    console.log(`  progress: ${i + slice.length}/${candidates.length} processed, ${stats.changed} changed`);
  }
  await sleep(8000);
}

// Fallback: ML's batch endpoint silently omits orders whose billing document
// is in PROCESSING state. Individual queries to the same endpoint return them.
if (missingIds.length) {
  console.log(`\nfallback: ${missingIds.length} orders missing from batch responses, retrying individually`);
  for (let i = 0; i < missingIds.length; i++) {
    const id = missingIds[i];
    const { ok, results } = await fetchBatchTaxes([id], accessToken);
    if (!ok) {
      stats.stillMissing++;
      continue;
    }
    if (results.length === 0) {
      stats.stillMissing++;
    } else {
      stats.recoveredIndividually++;
      for (const result of results) applyResult(result);
    }
    await sleep(2000);
  }
}

console.log('\n=== summary ===');
console.log(stats);
console.log(`sample changes (first 10):`);
for (const c of changes.slice(0, 10)) console.log(`  ${c.id}: iibb ${c.before._iibb} → ${c.after._iibb} | sirtac ${c.before._sirtac} → ${c.after._sirtac}`);

if (!APPLY) {
  console.log('\nDRY RUN — no KV writes. Re-run with --apply to commit changes.');
  process.exit(0);
}

cache.updated_at = new Date().toISOString();
kvPut(CACHE_KEY, cache);
console.log(`\nAPPLIED: wrote ${cache.orders.length} orders back to KV (${stats.changed} updated).`);
