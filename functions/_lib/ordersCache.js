export const HISTORY_CUTOFF = '2026-01-01T00:00:00';
const CACHE_KEY = 'orders_cache';

export async function getOrdersCache(env) {
  return await env.PIGNUS_TOKENS.get(CACHE_KEY, 'json') || {
    orders: [],
    seen_ids: [],
    probe_total: 0,
    next_older_offset: null,
    oldest_date: null,
    updated_at: null,
  };
}

export async function saveOrdersCache(env, cache) {
  await env.PIGNUS_TOKENS.put(CACHE_KEY, JSON.stringify(cache));
}

function slimOrder(order) {
  return {
    id: order.id,
    pack_id: order.pack_id,
    date_created: order.date_created,
    payments: (order.payments || []).map((p) => ({
      transaction_amount: p.transaction_amount,
      total_paid_amount: p.total_paid_amount,
      shipping_cost: p.shipping_cost,
      status: p.status,
    })),
    order_items: (order.order_items || []).map((i) => ({
      quantity: i.quantity,
      unit_price: i.unit_price,
      full_unit_price: i.full_unit_price,
      sale_fee: i.sale_fee,
    })),
    buyer: order.buyer ? {
      first_name: order.buyer.first_name,
      last_name: order.buyer.last_name,
      nickname: order.buyer.nickname,
    } : undefined,
    shipping: order.shipping ? {
      cost: order.shipping.cost,
      receiver_address: order.shipping.receiver_address ? {
        city: order.shipping.receiver_address.city,
      } : undefined,
      _state: order.shipping._state,
    } : undefined,
    _iibb: order._iibb,
    _sirtac: order._sirtac,
  };
}

// isOlderFetch=false on "fetch latest" — preserves existing next_older_offset after first load.
export function mergeIntoCache(cache, { newOrders, total, fetchedOffset, isOlderFetch }) {
  const seenSet = new Set(cache.seen_ids || []);

  const added = newOrders
    .filter((order) => {
      const id = String(order.id);
      if (seenSet.has(id)) return false;
      seenSet.add(id);
      return true;
    })
    .map(slimOrder);

  const allOrders = [...(cache.orders || []), ...added];
  allOrders.sort((a, b) => (b.date_created > a.date_created ? 1 : -1));

  const oldestDate = allOrders.length > 0 ? allOrders[allOrders.length - 1].date_created : null;

  const nextOlderOffset = isOlderFetch
    ? fetchedOffset - 20
    : (cache.next_older_offset !== null ? cache.next_older_offset : fetchedOffset - 20);

  return {
    orders: allOrders,
    seen_ids: [...seenSet],
    probe_total: total ?? cache.probe_total,
    next_older_offset: nextOlderOffset,
    oldest_date: oldestDate,
    updated_at: new Date().toISOString(),
  };
}

export function isCacheDone(cache) {
  if (cache.next_older_offset !== null && cache.next_older_offset < 0) return true;
  if (cache.oldest_date && cache.oldest_date < HISTORY_CUTOFF) return true;
  return false;
}
