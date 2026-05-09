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
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
  });
}

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
    if (!response.ok) throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
    const results = data.results || [];
    orders.push(...results);
    scrollId = data.scroll_id;
    if (!results.length) break;
  } while (scrollId);
  return orders;
}

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
    if (!response.ok) throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
    const results = data.results || [];
    orders.push(...results);
    total = data.paging?.total ?? orders.length;
    offset += results.length;
    if (!results.length) break;
  } while (offset < total);
  return orders;
}

export async function fetchAllPaidOrders(env) {
  const tokens = await getValidAccessToken(env);
  const sellerId = tokens.seller_id || env.MELI_SELLER_ID;
  let orders;
  try {
    orders = await fetchWithScroll(sellerId, tokens.access_token);
  } catch {
    const refreshed = await refreshAccessToken(env);
    orders = await fetchWithOffset(sellerId, refreshed.access_token);
  }
  return orders.filter(isPaidOrder);
}

async function probeTotal(sellerId, accessToken) {
  const probe = await requestOrders({ seller: sellerId, limit: '1', offset: '0' }, accessToken);
  const probeData = await probe.json();
  if (!probe.ok) throw new Error(probeData.message || probeData.error || 'Mercado Libre orders request failed');
  return probeData.paging?.total ?? 0;
}

export async function fetchLatestOrders(env, count = 20) {
  const tokens = await getValidAccessToken(env);
  const sellerId = tokens.seller_id || env.MELI_SELLER_ID;
  const total = await probeTotal(sellerId, tokens.access_token);
  const offset = Math.max(0, total - count);
  const response = await requestOrders(
    { seller: sellerId, limit: String(count), offset: String(offset) },
    tokens.access_token,
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
  return { orders: (data.results || []).filter(isPaidOrder), total, fetchedOffset: offset };
}

export async function fetchOrdersAtOffset(env, offset, count = 20) {
  const tokens = await getValidAccessToken(env);
  const sellerId = tokens.seller_id || env.MELI_SELLER_ID;
  const total = await probeTotal(sellerId, tokens.access_token);
  const clampedOffset = Math.max(0, Math.min(offset, total - 1));
  const response = await requestOrders(
    { seller: sellerId, limit: String(count), offset: String(clampedOffset) },
    tokens.access_token,
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || 'Mercado Libre orders request failed');
  return { orders: (data.results || []).filter(isPaidOrder), total, fetchedOffset: clampedOffset };
}

const ENRICH_LIMIT = 20;

export async function enrichOrders(orders, env) {
  const tokens = await getValidAccessToken(env);
  const enriched = [];
  for (const order of orders.slice(0, ENRICH_LIMIT)) {
    const orderRes = await fetch(`https://api.mercadolibre.com/orders/${order.id}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${tokens.access_token}` },
    });
    const fullOrder = orderRes.ok ? await orderRes.json() : order;
    const shippingId = fullOrder.shipping?.id ?? order.shipping?.id;
    if (shippingId) {
      const shipRes = await fetch(`https://api.mercadolibre.com/shipments/${shippingId}`, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${tokens.access_token}`,
          'x-format-new': 'true',
        },
      });
      if (shipRes.ok) {
        const shipData = await shipRes.json();
        fullOrder.shipping = {
          ...fullOrder.shipping,
          receiver_address: shipData.receiver_address,
          _state: shipData.destination?.shipping_address?.state,
        };
      }
    }
    enriched.push(fullOrder);
  }
  return [...enriched, ...orders.slice(ENRICH_LIMIT)];
}

export async function fetchFiscalDate(packId, orderId, accessToken) {
  const path = packId ? `packs/${packId}` : `orders/${orderId}`;
  const res = await fetch(`https://api.mercadolibre.com/${path}/fiscal_documents`, {
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const docs = Array.isArray(data) ? data : (data.results || []);
  return docs[0]?.date ?? null;
}

export async function fetchCouponAmount(orderId, accessToken) {
  const res = await fetch(`https://api.mercadolibre.com/orders/${orderId}/discounts`, {
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return 0;
  const data = await res.json();
  let total = 0;
  for (const detail of data.details || []) {
    if (detail.type === 'coupon') {
      for (const item of detail.items || []) {
        total += Number(item.amounts?.total || 0);
      }
    }
  }
  return total;
}

export async function fetchBillingTaxes(orders, env) {
  const tokens = await getValidAccessToken(env);
  const orderIds = orders.map((o) => o.id).join(',');
  const res = await fetch(
    `https://api.mercadolibre.com/billing/integration/group/ML/order/details?order_ids=${orderIds}`,
    { headers: { accept: 'application/json', authorization: `Bearer ${tokens.access_token}` } },
  );
  const data = await res.json();
  if (!res.ok) return new Map();
  const taxes = new Map();
  for (const item of data.results || []) {
    let iibb = 0;
    let sirtac = 0;
    for (const payment of item.payment_info || []) {
      for (const tax of payment.tax_details || []) {
        const detail = (tax.mov_detail || '').toLowerCase();
        const entity = (tax.mov_financial_entity || '').toLowerCase();
        if (detail.includes('sirtac')) sirtac += Number(tax.original_amount || 0);
        else if (detail.includes('iibb') || entity.includes('iibb')) iibb += Number(tax.original_amount || 0);
      }
    }
    taxes.set(String(item.order_id), { iibb, sirtac });
  }
  return taxes;
}
