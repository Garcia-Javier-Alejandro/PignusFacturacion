import { json, errorResponse } from '../../_lib/http.js';
import { getOrdersCache, saveOrdersCache } from '../../_lib/ordersCache.js';

export async function onRequestPost({ env }) {
  try {
    const cache = await getOrdersCache(env);
    let cleared = 0;
    for (const order of cache.orders) {
      if (order._fecha_factura || order._numero_factura) {
        order._fecha_factura = null;
        order._numero_factura = null;
        order._invoice_source = null;
        cleared++;
      }
    }
    await saveOrdersCache(env, cache);
    return json({ ok: true, cleared });
  } catch (err) {
    return errorResponse(500, err.message);
  }
}
