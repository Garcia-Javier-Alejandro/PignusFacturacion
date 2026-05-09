import { json, requireAdmin } from '../../_lib/http.js';
import { getOrdersCache, isCacheDone } from '../../_lib/ordersCache.js';
import { OUTPUT_HEADERS, transformOrdersToRows } from '../../_lib/transform.js';

export async function onRequestDelete({ request, env }) {
  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  await env.PIGNUS_TOKENS.delete('orders_cache');
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  const authError = await requireAdmin(request, env);
  if (authError) return authError;

  const cache = await getOrdersCache(env);
  const rows = transformOrdersToRows(cache.orders || []);
  rows.sort((a, b) => (b[1] > a[1] ? 1 : -1));

  return json({
    headers: OUTPUT_HEADERS,
    rows,
    meta: {
      loaded: (cache.orders || []).length,
      total: cache.probe_total,
      oldest_date: cache.oldest_date,
      next_older_offset: cache.next_older_offset,
      done: isCacheDone(cache),
    },
  });
}
