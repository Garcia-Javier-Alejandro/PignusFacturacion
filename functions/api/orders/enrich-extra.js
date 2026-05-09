import { requireAdmin, json } from '../../_lib/http.js';
import { getOrdersCache, saveOrdersCache, isCacheDone } from '../../_lib/ordersCache.js';
import { getValidAccessToken } from '../../_lib/meliAuth.js';
import { fetchFiscalDate, fetchCouponAmount } from '../../_lib/meliOrders.js';
import { OUTPUT_HEADERS, transformOrdersToRows } from '../../_lib/transform.js';

const BATCH = 8;

export async function onRequestGet({ env, request }) {
  const err = await requireAdmin(request, env);
  if (err) return err;

  const cache = await getOrdersCache(env);

  const needsEnrich = (o) => o._fecha_factura === undefined || o._cupon === undefined;
  const toEnrich = cache.orders.filter(needsEnrich).slice(0, BATCH);

  if (toEnrich.length > 0) {
    const tokens = await getValidAccessToken(env);
    const { access_token } = tokens;
    const seenPacks = new Set();

    for (const order of toEnrich) {
      if (order._fecha_factura === undefined) {
        const packId = order.pack_id ? String(order.pack_id) : null;
        if (packId && seenPacks.has(packId)) {
          const sibling = cache.orders.find(
            (o) => String(o.pack_id) === packId && o._fecha_factura !== undefined,
          );
          order._fecha_factura = sibling?._fecha_factura ?? null;
        } else {
          if (packId) seenPacks.add(packId);
          order._fecha_factura = await fetchFiscalDate(order.pack_id, order.id, access_token) ?? null;
          if (packId) {
            for (const o of cache.orders) {
              if (String(o.pack_id) === packId && o._fecha_factura === undefined) {
                o._fecha_factura = order._fecha_factura;
              }
            }
          }
        }
      }
      if (order._cupon === undefined) {
        order._cupon = await fetchCouponAmount(order.id, access_token);
      }
    }

    await saveOrdersCache(env, cache);
  }

  const remaining = cache.orders.filter(needsEnrich).length;
  const rows = transformOrdersToRows(cache.orders);
  rows.sort((a, b) => (b[1] > a[1] ? 1 : -1));

  return json({
    headers: OUTPUT_HEADERS,
    rows,
    enrichDone: remaining === 0,
    meta: {
      loaded: cache.orders.length,
      total: cache.probe_total,
      oldest_date: cache.oldest_date,
      next_older_offset: cache.next_older_offset,
      done: isCacheDone(cache),
    },
  });
}
