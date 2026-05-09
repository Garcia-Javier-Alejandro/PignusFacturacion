import { errorResponse, json, requireAdmin } from '../../_lib/http.js';
import { fetchOrdersAtOffset } from '../../_lib/meliOrders.js';
import { fetchEnrichAndStore } from '../../_lib/fetchAndStore.js';
import { getOrdersCache, isCacheDone } from '../../_lib/ordersCache.js';
import { OUTPUT_HEADERS, transformOrdersToRows } from '../../_lib/transform.js';

export async function onRequestGet({ request, env }) {
  const authError = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const cache = await getOrdersCache(env);

    if (isCacheDone(cache)) {
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
          done: true,
        },
      });
    }

    const offset = cache.next_older_offset; // null on fresh cache → fetchOrdersAtOffset starts from most recent
    const { orders, total, fetchedOffset } = await fetchOrdersAtOffset(env, offset, 20);
    const result = await fetchEnrichAndStore(env, { orders, total, fetchedOffset, isOlderFetch: true });
    return json(result);
  } catch (error) {
    return errorResponse(500, error.message);
  }
}
