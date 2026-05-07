import { errorResponse, json, requireAdmin } from '../../_lib/http.js';
import { enrichOrders, fetchRecentPaidOrders } from '../../_lib/meliOrders.js';
import { OUTPUT_HEADERS, transformOrdersToRows } from '../../_lib/transform.js';

export async function onRequestGet({ request, env }) {
  const authError = await requireAdmin(request, env);

  if (authError) {
    return authError;
  }

  try {
    const recent = await fetchRecentPaidOrders(env, 30);

    // Sort newest first before enriching so the cap keeps the most recent orders.
    recent.sort((a, b) => (b.date_created > a.date_created ? 1 : -1));

    const orders = await enrichOrders(recent, env);
    const rows = transformOrdersToRows(orders);

    return json({ headers: OUTPUT_HEADERS, rows, _sample: orders[0] ?? null });
  } catch (error) {
    return errorResponse(500, error.message);
  }
}
