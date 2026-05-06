import { errorResponse, json, requireAdmin } from '../../_lib/http.js';
import { fetchPaidOrders } from '../../_lib/meliOrders.js';
import { appendRows, getExistingOrderIds } from '../../_lib/sheets.js';
import { OUTPUT_HEADERS, transformOrdersToRows } from '../../_lib/transform.js';

export async function onRequestPost({ request, env }) {
  const authError = await requireAdmin(request, env);

  if (authError) {
    return authError;
  }

  try {
    const body = await request.json().catch(() => ({}));
    const existingOrderIds = await getExistingOrderIds(env);
    const providedRows = Array.isArray(body.rows)
      ? body.rows.filter((row) => Array.isArray(row) && row.length === OUTPUT_HEADERS.length)
      : null;
    const transformedRows = providedRows || transformOrdersToRows(
      (await fetchPaidOrders(env, Math.min(Math.max(Number(body.limit || 10), 1), 20)))
        .filter((order) => !existingOrderIds.has(String(order.id))),
    );
    const newRows = transformedRows.filter((row) => !existingOrderIds.has(String(row[0])));
    const rows = existingOrderIds.size === 0
      ? [OUTPUT_HEADERS, ...newRows]
      : newRows;
    const result = await appendRows(env, rows);

    return json({
      exported_rows: newRows.length,
      skipped_existing: transformedRows.length - newRows.length,
      included_header: existingOrderIds.size === 0 && newRows.length > 0,
      sheet_name: env.SHEET_NAME || 'Ventas',
      google_updated_rows: result.updates?.updatedRows || rows.length,
    });
  } catch (error) {
    return errorResponse(500, error.message);
  }
}
