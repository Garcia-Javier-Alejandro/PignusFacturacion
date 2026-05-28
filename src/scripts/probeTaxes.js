import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NAMESPACE_ID = '1ddcfd99d51c4d5ab6cae8b1c8526ddb';
const TOKEN_KEY = 'meli_tokens';

const ZERO_TAX_IDS = [
  '2000016487551450', // Miriam Anah Pavon
  '2000016490718006', // Monica karina Rapado
  '2000016485981258', // Paula Alejandra Alvarez
  '2000016487499104', // VALERIA HIDALGO
  '2000016516453282', // CAMILA GIANNATASIO
  '2000016516852980', // esteban Benelbaz Barcelo
  '2000016517337236', // Franco Joel Pivac
];

const CONTROL_IDS = [
  '2000016510138248', // Romina Montenegro ($300.05)
  '2000016498371312', // BRUNO LEDESMA ($178.67)
  '2000016504989850', // Carlos Alberto Oliveira ($133.93)
];

function wrangler(args) {
  return spawnSync('npx.cmd', ['--yes', 'wrangler', ...args], { encoding: 'utf8', shell: true });
}

function readKvTokens() {
  const r = wrangler(['kv', 'key', 'get', TOKEN_KEY, '--namespace-id', NAMESPACE_ID, '--remote']);
  if (r.status !== 0) throw new Error(`wrangler get failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

function writeKvTokens(tokens) {
  const tmp = path.join(os.tmpdir(), `meli-tokens-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(tokens));
  const r = wrangler(['kv', 'key', 'put', TOKEN_KEY, '--namespace-id', NAMESPACE_ID, '--path', tmp, '--remote']);
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) throw new Error(`wrangler put failed: ${r.stderr}`);
}

async function refreshTokens(refreshToken) {
  const res = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.MELI_APP_ID,
      client_secret: process.env.MELI_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`refresh failed: ${JSON.stringify(data)}`);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + Number(data.expires_in || 0) * 1000).toISOString(),
    seller_id: String(data.user_id || process.env.MELI_SELLER_ID),
  };
}

async function getValidToken() {
  const stored = readKvTokens();
  const expiresAt = Date.parse(stored.expires_at || '');
  console.log('[debug] stored.expires_at:', stored.expires_at, 'parsed:', expiresAt, 'now:', Date.now());
  if (!stored.access_token || Number.isNaN(expiresAt) || expiresAt <= Date.now() + 5 * 60 * 1000) {
    console.log('[token] expired or missing — refreshing');
    const fresh = await refreshTokens(stored.refresh_token);
    writeKvTokens(fresh);
    console.log(`[token] refreshed, new expires_at=${fresh.expires_at}`);
    return fresh.access_token;
  }
  return stored.access_token;
}

async function fetchBatch(ids, token) {
  const res = await fetch(
    `https://api.mercadolibre.com/billing/integration/group/ML/order/details?order_ids=${ids.join(',')}`,
    { headers: { accept: 'application/json', authorization: `Bearer ${token}` } },
  );
  const body = await res.json();
  return { ok: res.ok, status: res.status, body };
}

function summarize(item) {
  const taxLines = [];
  let iibb = 0;
  let sirtac = 0;
  for (const payment of item.payment_info || []) {
    for (const tax of payment.tax_details || []) {
      const detail = (tax.mov_detail || '').toLowerCase();
      const entity = (tax.mov_financial_entity || '').toLowerCase();
      const amount = Number(tax.original_amount || 0);
      let matched = null;
      if (detail.includes('sirtac')) { sirtac += amount; matched = 'sirtac'; }
      else if (detail.includes('iibb') || entity.includes('iibb')) { iibb += amount; matched = 'iibb'; }
      taxLines.push({
        mov_detail: tax.mov_detail,
        mov_financial_entity: tax.mov_financial_entity,
        original_amount: amount,
        matched,
      });
    }
  }
  return {
    order_id: item.order_id,
    payment_count: (item.payment_info || []).length,
    tax_lines_count: taxLines.length,
    iibb,
    sirtac,
    suma_impuestos: iibb + sirtac,
    tax_lines: taxLines,
  };
}

async function run(label, ids, token) {
  console.log(`\n=== ${label} (${ids.length} orders) ===`);
  const { ok, status, body } = await fetchBatch(ids, token);
  if (!ok) {
    console.log(`HTTP ${status}`, JSON.stringify(body, null, 2));
    return;
  }
  const results = body.results || [];
  console.log(`returned ${results.length} of ${ids.length} requested`);
  for (const item of results) {
    console.log(JSON.stringify(summarize(item), null, 2));
  }
  const missing = ids.filter((id) => !results.find((r) => String(r.order_id) === String(id)));
  if (missing.length) console.log('MISSING from response:', missing);
}

const token = await getValidToken();
await run('ZERO-TAX rows', ZERO_TAX_IDS, token);
await run('CONTROL rows (non-zero tax)', CONTROL_IDS, token);
