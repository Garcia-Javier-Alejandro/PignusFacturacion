const toNumber = (value) => Number(value || 0);
const nameOf = (v) => (typeof v === 'string' ? v : v?.name) || '';

// ML returns dates with inconsistent timezone offsets (e.g. -04:00 instead of ART -03:00).
// Always convert to the true ART date before slicing so FECHA COMPRA/FACTURA are correct.
const ART_OFFSET_MS = 3 * 60 * 60 * 1000;
const toDateStr = (iso) => {
  if (!iso) return '';
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) return '';
  return new Date(ms - ART_OFFSET_MS).toISOString().slice(0, 10);
};

export const OUTPUT_HEADERS = [
  'Orden ID',
  'Fecha Compra',
  'Nombre',
  'Pago',
  'Cupón',
  'Recargo MP',
  'Retencion IIBB',
  'Imp SIRTAC',
  'Suma Impuestos',
  'Costo Envio',
  'Neto',
  'Monto Facturable',
  'Localidad',
  'Provincia',
  'Orígen',
  'Fecha Factura',
  'Nº Factura',
];

const sumPaymentsField = (payments, field) => (
  payments.reduce((total, payment) => total + toNumber(payment[field]), 0)
);

const calculateProductRevenue = (order, payments) => {
  const productsTotal = (order.order_items || []).reduce((total, item) => {
    const quantity = toNumber(item.quantity || 1);
    const unitPrice = toNumber(item.unit_price ?? item.full_unit_price);
    return total + quantity * unitPrice;
  }, 0);
  return productsTotal || sumPaymentsField(payments, 'transaction_amount') || sumPaymentsField(payments, 'total_paid_amount');
};

const calculateMercadoPagoFee = (order) => (
  (order.order_items || []).reduce((total, item) => total + toNumber(item.sale_fee), 0)
);

export function transformOrderToRow(order) {
  const payments = order.payments || [];
  const pago = calculateProductRevenue(order, payments);
  const recargoMp = calculateMercadoPagoFee(order);
  const retencionIibb = toNumber(order._iibb);
  const impSirtac = toNumber(order._sirtac);
  const sumaImpuestos = retencionIibb + impSirtac;
  const costoEnvio = order._sender_shipping_cost !== undefined
    ? toNumber(order._sender_shipping_cost)
    : (sumPaymentsField(payments, 'shipping_cost') || toNumber(order.shipping?.cost));
  const neto = pago - (recargoMp + retencionIibb + impSirtac + costoEnvio);
  const montoFacturable = pago + (order._receiver_shipping_cost !== undefined
    ? toNumber(order._receiver_shipping_cost)
    : sumPaymentsField(payments, 'shipping_cost'));

  return [
    String(order.id || ''),
    toDateStr(order.date_created),
    `${order.buyer?.first_name || ''} ${order.buyer?.last_name || ''}`.trim() || order.buyer?.nickname || '',
    pago,
    toNumber(order._cupon),
    recargoMp,
    retencionIibb,
    impSirtac,
    sumaImpuestos,
    costoEnvio,
    neto,
    montoFacturable,
    nameOf(order.shipping?.receiver_address?.city),
    nameOf(order.shipping?._state),
    'ML',
    toDateStr(order._fecha_factura),
    order._numero_factura ?? '',
  ];
}

function mergePackOrders(orders) {
  if (orders.length === 1) return orders[0];
  const first = orders[0];
  return {
    ...first,
    id: first.pack_id || first.id,
    payments: orders.flatMap((o) => o.payments || []),
    order_items: orders.flatMap((o) => o.order_items || []),
    _iibb: orders.reduce((sum, o) => sum + toNumber(o._iibb), 0),
    _sirtac: orders.reduce((sum, o) => sum + toNumber(o._sirtac), 0),
    _fecha_factura: orders.find((o) => o._fecha_factura)?._fecha_factura ?? undefined,
    _numero_factura: orders.find((o) => o._numero_factura)?._numero_factura ?? undefined,
    _invoice_source: orders.find((o) => o._invoice_source)?._invoice_source ?? undefined,
    _cupon: orders.reduce((sum, o) => sum + toNumber(o._cupon), 0),
  };
}

function groupOrdersByPack(orders) {
  const groups = new Map();
  for (const order of orders) {
    const key = String(order.pack_id || order.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  }
  return Array.from(groups.values()).map(mergePackOrders);
}

export function transformOrdersToRows(orders) {
  return groupOrdersByPack(orders).map(transformOrderToRow);
}
