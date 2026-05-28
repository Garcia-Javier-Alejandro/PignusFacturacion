import { spawnSync } from 'node:child_process';

const NAMESPACE_ID = '1ddcfd99d51c4d5ab6cae8b1c8526ddb';
const IDS = [
  '2000016487551450', '2000016490718006', '2000016485981258', '2000016487499104',
  '2000016516453282', '2000016516852980', '2000016517337236',
  '2000016510138248', '2000016498371312', '2000016504989850',
];

const r = spawnSync('npx.cmd', ['--yes', 'wrangler', 'kv', 'key', 'get', 'orders_cache',
  '--namespace-id', NAMESPACE_ID, '--remote'], { encoding: 'utf8', shell: true, maxBuffer: 200 * 1024 * 1024 });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const cache = JSON.parse(r.stdout.trim());
console.log('cache total orders:', cache.orders.length, 'updated_at:', cache.updated_at);

for (const id of IDS) {
  const o = cache.orders.find((x) => String(x.id) === id);
  if (!o) { console.log(`${id}: NOT IN CACHE`); continue; }
  console.log(`${id} date=${o.date_created} _iibb=${o._iibb} _sirtac=${o._sirtac} _fecha_factura=${o._fecha_factura}`);
}
