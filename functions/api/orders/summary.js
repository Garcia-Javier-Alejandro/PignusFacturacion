import { errorResponse, json, requireAdmin } from '../../_lib/http.js';
import { fetchPaidOrders } from '../../_lib/meliOrders.js';
import {
  OUTPUT_HEADERS,
  summarizeOrder,
  transformOrdersToRows,
} from '../../_lib/transform.js';

export async function onRequestGet({ request, env }) {
  const authError = await requireAdmin(request, env);

  if (authError) {
    return authError;
  }

  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') || 10);
    const orders = await fetchPaidOrders(env, Math.min(Math.max(limit, 1), 20));

    return json({
      generated_at: new Date().toISOString(),
      count: orders.length,
      output_headers: OUTPUT_HEADERS,
      output_rows: transformOrdersToRows(orders),
      raw_orders: orders,
      orders: orders.map(summarizeOrder),
    });
  } catch (error) {
    return errorResponse(500, error.message);
  }
}
