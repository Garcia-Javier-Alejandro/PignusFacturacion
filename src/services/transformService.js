import { config } from '../config/env.js';

const HEADERS = [
  'Orden ID',
  'Fecha',
  'Nombre',
  'Pago',
  'Recargo MP',
  'Retencion IIBB',
  'Imp SIRTAC',
  'Costo Envio',
  'Neto',
  'Localidad',
  'Validacion Neto',
];

const toNumber = (value) => Number(value || 0);

const normalize = (value = '') => String(value).toLowerCase();

const getFeeAmount = (fee) => toNumber(fee.amount ?? fee.fee_amount);

const isMercadoPagoFee = (fee) => {
  const text = `${fee.type || ''} ${fee.name || ''} ${fee.description || ''}`;
  const normalized = normalize(text);
  return normalized.includes('mercadopago_fee') || normalized.includes('cargo por venta');
};

const isIibbFee = (fee) => {
  const text = `${fee.type || ''} ${fee.name || ''} ${fee.description || ''}`;
  return normalize(text).includes('iibb') || normalize(text).includes('ingresos brutos');
};

const isSirtacFee = (fee) => {
  const text = `${fee.type || ''} ${fee.name || ''} ${fee.description || ''}`;
  return normalize(text).includes('sirtac');
};

const getBuyerName = (buyer = {}) => {
  const firstName = buyer.first_name || '';
  const lastName = buyer.last_name || '';
  return `${firstName} ${lastName}`.trim();
};

const getLocalidad = (shipping = {}) => shipping.receiver_address?.city?.name || '';

const sumPaymentsField = (payments, field) => (
  payments.reduce((total, payment) => total + toNumber(payment[field]), 0)
);

const sumFeeDetails = (payments, predicate) => payments.reduce((total, payment) => {
  const feeDetails = payment.fee_details || [];
  return total + feeDetails
    .filter(predicate)
    .reduce((feeTotal, fee) => feeTotal + getFeeAmount(fee), 0);
}, 0);

const calculateProductRevenue = (order, payments) => {
  const orderItems = order.order_items || [];
  const productsTotal = orderItems.reduce((total, item) => {
    const quantity = toNumber(item.quantity || 1);
    const unitPrice = toNumber(item.unit_price ?? item.full_unit_price);
    return total + quantity * unitPrice;
  }, 0);

  if (productsTotal > 0) {
    return productsTotal;
  }

  return sumPaymentsField(payments, 'transaction_amount') || sumPaymentsField(payments, 'total_paid_amount');
};

const calculateMercadoPagoFee = (order, payments) => {
  const paymentFee = sumFeeDetails(payments, isMercadoPagoFee);

  if (paymentFee > 0) {
    return paymentFee;
  }

  // The downloaded billing report shows selling charges separately as
  // "Cargo por venta" / "Costo por unidad vendida". In the orders API those
  // commonly appear as order_items[].sale_fee, so this is the report-aligned
  // fallback when payment fee_details does not expose the same classification.
  return (order.order_items || []).reduce((total, item) => total + toNumber(item.sale_fee), 0);
};

export function buildHeaderRow() {
  return HEADERS;
}

export function transformOrder(order) {
  const payments = order.payments || [];

  if (config.meli.logRawPayments) {
    console.debug(`Raw payments for order ${order.id}:`, JSON.stringify(payments, null, 2));
  }

  const pago = calculateProductRevenue(order, payments);
  const recargoMp = calculateMercadoPagoFee(order, payments);

  // Mercado Libre can expose Argentine tax with different names depending on
  // the seller/account context, so classification checks type/name/description.
  // Enable LOG_RAW_PAYMENTS=true while validating real-world labels.
  const retencionIibb = sumFeeDetails(payments, isIibbFee);
  const impSirtac = sumFeeDetails(payments, isSirtacFee);

  // Review after seeing live API data: the sales report's source of truth is
  // "Costos de envio (ARS)". The closest order API fields are checked here.
  const costoEnvio = sumPaymentsField(payments, 'shipping_cost') || toNumber(order.shipping?.cost);
  const netReceivedAmount = sumPaymentsField(payments, 'net_received_amount');
  const neto = pago - (recargoMp + retencionIibb + impSirtac + costoEnvio);
  const validationDelta = neto - netReceivedAmount;

  return [
    String(order.id || ''),
    order.date_created || '',
    getBuyerName(order.buyer),
    pago,
    recargoMp,
    retencionIibb,
    impSirtac,
    costoEnvio,
    neto,
    getLocalidad(order.shipping),
    validationDelta,
  ];
}

export function transformOrders(orders) {
  return orders.map(transformOrder);
}
