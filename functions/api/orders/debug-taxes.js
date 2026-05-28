import { errorResponse, json } from '../../_lib/http.js';
import { getValidAccessToken } from '../../_lib/meliAuth.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get('order_ids') || url.searchParams.get('order_id');
    if (!raw) return errorResponse(400, 'missing order_id or order_ids query param');

    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
    if (!ids.length) return errorResponse(400, 'no valid order ids');

    const tokens = await getValidAccessToken(env);
    const res = await fetch(
      `https://api.mercadolibre.com/billing/integration/group/ML/order/details?order_ids=${ids.join(',')}`,
      { headers: { accept: 'application/json', authorization: `Bearer ${tokens.access_token}` } },
    );
    const body = await res.json();
    if (!res.ok) return json({ ok: false, status: res.status, body }, { status: 502 });

    const summary = (body.results || []).map((item) => {
      const taxLines = [];
      let iibb = 0;
      let sirtac = 0;
      for (const payment of item.payment_info || []) {
        for (const tax of payment.tax_details || []) {
          const detail = (tax.mov_detail || '').toLowerCase();
          const entity = (tax.mov_financial_entity || '').toLowerCase();
          const amount = Number(tax.original_amount || 0);
          let matched = null;
          if (detail.includes('sirtac')) { sirtac += amount; matched = 'sirtac'; }
          else if (detail.startsWith('tax_withholding') || detail.includes('iibb') || entity.includes('iibb')) { iibb += amount; matched = 'iibb'; }
          taxLines.push({
            mov_detail: tax.mov_detail,
            mov_financial_entity: tax.mov_financial_entity,
            original_amount: amount,
            matched,
          });
        }
      }
      return {
        order_id: item.order_id,
        payment_count: (item.payment_info || []).length,
        tax_lines_count: taxLines.length,
        iibb,
        sirtac,
        suma_impuestos: iibb + sirtac,
        tax_lines: taxLines,
      };
    });

    return json({
      ok: true,
      requested_ids: ids,
      returned_count: summary.length,
      summary,
      raw: body,
    });
  } catch (error) {
    return errorResponse(500, error.message);
  }
}
