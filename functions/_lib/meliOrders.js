import { getValidAccessToken, refreshAccessToken } from './meliAuth.js';

const PAGE_SIZE = 50;

const isPaidOrder = (order) => (
  order.status === 'paid'
  || (order.payments || []).some((payment) => payment.status === 'approved')
);

async function requestOrders(params, accessToken) {
  const url = new URL('https://api.mercadolibre.com/orders/search');

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  });
}

// Fetch all orders using scroll (cursor) pagination. More efficient for large result sets.
async function fetchWithScroll(sellerId, accessToken) {
  const orders = [];
  let scrollId;

  do {
    const response = await requestOrders({
      seller: sellerId,
      search_type: 'scan',
      limit: String(PAGE_SIZE),
      ...(scrollId ? { scroll_id: scrollId } : {}),
    }, accessToken);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
    }

    const results = data.results || [];
    orders.push(...results);
    scrollId = data.scroll_id;

    if (!results.length) break;
  } while (scrollId);

  return orders;
}

// Fetch all orders using offset pagination. Accepts extra params (e.g. date filters).
async function fetchWithOffset(sellerId, accessToken, extraParams = {}) {
  const orders = [];
  let offset = 0;
  let total = null;

  do {
    const response = await requestOrders({
      seller: sellerId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      ...extraParams,
    }, accessToken);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
    }

    const results = data.results || [];
    orders.push(...results);
    total = data.paging?.total ?? orders.length;
    offset += results.length;

    if (!results.length) break;
  } while (offset < total);

  return orders;
}

// Fetch every paid order. Used by the scheduled cron and the manual export endpoint.
export async function fetchAllPaidOrders(env) {
  const tokens = await getValidAccessToken(env);
  const sellerId = tokens.seller_id || env.MELI_SELLER_ID;
  let orders;

  try {
    orders = await fetchWithScroll(sellerId, tokens.access_token);
  } catch {
    // Scroll pagination can be unavailable on some accounts; fall back to offset.
    const refreshed = await refreshAccessToken(env);
    orders = await fetchWithOffset(sellerId, refreshed.access_token);
  }

  return orders.filter(isPaidOrder);
}

// Fetch paid orders created within the last `days` days.
// Probes total count first, then starts pagination near the tail so the most
// recent orders are captured regardless of API sort order.
export async function fetchRecentPaidOrders(env, days = 30) {
  const tokens = await getValidAccessToken(env);
  const sellerId = tokens.seller_id || env.MELI_SELLER_ID;
  const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // One cheap request to learn the total order count.
  const probe = await requestOrders({ seller: sellerId, limit: '1', offset: '0' }, tokens.access_token);
  const probeData = await probe.json();
  if (!probe.ok) throw new Error(probeData.message || probeData.error || 'Mercado Libre orders request failed');

  const total = probeData.paging?.total ?? 0;
  const MAX_PAGES = 4;
  let offset = Math.max(0, total - PAGE_SIZE * MAX_PAGES);

  const orders = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await requestOrders({
      seller: sellerId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    }, tokens.access_token);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
    }

    const results = data.results || [];
    if (!results.length) break;

    orders.push(...results);

    if (results.length < PAGE_SIZE) break;
    offset += results.length;
  }

  return orders
    .filter(isPaidOrder)
    .filter((o) => o.date_created && o.date_created >= dateFrom);
}

// Enrich orders with full detail (fee_details, receiver_address, buyer name).
// Runs sequentially to stay under the 50 subrequest limit; capped at 40 orders.
const ENRICH_LIMIT = 40;

export async function enrichOrders(orders, env) {
  const tokens = await getValidAccessToken(env);
  const enriched = [];

  for (const order of orders.slice(0, ENRICH_LIMIT)) {
    const res = await fetch(`https://api.mercadolibre.com/orders/${order.id}`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${tokens.access_token}`,
      },
    });
    enriched.push(res.ok ? await res.json() : order);
  }

  // Return enriched orders + unenriched remainder (IIBB/SIRTAC/Localidad will be
  // empty for orders beyond the cap, but at least they appear in the table).
  return [...enriched, ...orders.slice(ENRICH_LIMIT)];
}
