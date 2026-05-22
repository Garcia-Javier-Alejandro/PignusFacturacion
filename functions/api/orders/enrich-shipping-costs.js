import { json } from '../../_lib/http.js';
import { getOrdersCache, saveOrdersCache } from '../../_lib/ordersCache.js';
import { getValidAccessToken } from '../../_lib/meliAuth.js';
import { OUTPUT_HEADERS, transformOrdersToRows } from '../../_lib/transform.js';
import { isCacheDone } from '../../_lib/ordersCache.js';

const BATCH = 20;

export async function onRequestGet({ env }) {
  const cache = await getOrdersCache(env);

  const needsEnrich = (o) => (o._sender_shipping_cost === undefined || o._receiver_shipping_cost === undefined) && (o.shipping?.id);
  const toEnrich = cache.orders.filter(needsEnrich).slice(0, BATCH);

  if (toEnrich.length > 0) {
    const tokens = await getValidAccessToken(env);
    const { access_token } = tokens;

    for (const order of toEnrich) {
      const shippingId = order.shipping?.id;
      try {
        const res = await fetch(`https://api.mercadolibre.com/shipments/${shippingId}/costs`, {
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${access_token}`,
            'x-format-new': 'true',
          },
        });
        if (res.ok) {
          const data = await res.json();
          order._sender_shipping_cost   = (data.senders || []).reduce((sum, s) => sum + Number(s.cost || 0), 0);
          order._receiver_shipping_cost = Number(data.receiver?.cost || 0);
        } else {
          order._sender_shipping_cost   = null;
          order._receiver_shipping_cost = null;
        }
      } catch {
        order._sender_shipping_cost   = null;
        order._receiver_shipping_cost = null;
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
    remaining,
    meta: {
      loaded: cache.orders.length,
      total: cache.probe_total,
      oldest_date: cache.oldest_date,
      newest_date: cache.newest_date,
      next_older_offset: cache.next_older_offset,
      done: isCacheDone(cache),
    },
  });
}
