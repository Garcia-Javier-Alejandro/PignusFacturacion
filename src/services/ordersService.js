import { config } from '../config/env.js';
import { searchOrders } from '../clients/meliClient.js';

const isPaidOrder = (order) => {
  if (order.status === 'paid') {
    return true;
  }

  return Array.isArray(order.payments) && order.payments.some((payment) => payment.status === 'approved');
};

async function fetchOrdersWithOffset() {
  const orders = [];
  let offset = 0;
  let total = null;

  do {
    const data = await searchOrders({
      seller: config.meli.sellerId,
      limit: config.meli.pageSize,
      offset,
    });

    const results = data.results || [];
    orders.push(...results);

    total = data.paging?.total ?? orders.length;
    offset += results.length;

    if (results.length === 0) {
      break;
    }
  } while (offset < total);

  return orders;
}

async function fetchOrdersWithScroll() {
  const orders = [];
  let scrollId;

  do {
    const data = await searchOrders({
      seller: config.meli.sellerId,
      search_type: 'scan',
      limit: config.meli.pageSize,
      ...(scrollId ? { scroll_id: scrollId } : {}),
    });

    const results = data.results || [];
    orders.push(...results);
    scrollId = data.scroll_id;

    if (results.length === 0) {
      break;
    }
  } while (scrollId);

  return orders;
}

export async function fetchPaidOrders() {
  let orders;

  try {
    orders = await fetchOrdersWithScroll();
  } catch (error) {
    console.warn('Scroll pagination failed; falling back to offset pagination.');
    orders = await fetchOrdersWithOffset();
  }

  return orders.filter(isPaidOrder);
}
