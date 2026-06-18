import { json } from '../_lib/http.js';

function getReporterEmail(request) {
  const header = request.headers.get('CF-Access-Authenticated-User-Email');
  if (header) return header;
  const jwt = request.headers.get('CF-Access-Jwt-Assertion');
  if (!jwt) return 'unknown';
  try {
    let b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    b64 += '='.repeat((4 - b64.length % 4) % 4);
    return JSON.parse(atob(b64)).email ?? 'unknown';
  } catch { return 'unknown'; }
}

async function sendEmail(apiKey, { to, subject, html }) {
  if (!apiKey || !to || to === 'unknown' || !to.includes('@')) return;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Pignus <noreply@pignuslabs.com.ar>', to, subject, html }),
    });
    if (!res.ok) console.error(`[email] Resend error ${res.status}`);
  } catch (err) {
    console.error('[email] Failed:', err.message);
  }
}

function buildReceivedHtml({ type, screen, tried, expected, happened, impact, proposed_change, justification }) {
  const esc = (s) => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
  const row = (label, val) => val ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e8e2d9;font-size:13px;color:#6b7280;width:150px;vertical-align:top">${label}</td><td style="padding:8px 0;border-bottom:1px solid #e8e2d9;font-size:13px;color:#1c1814;white-space:pre-wrap">${esc(val)}</td></tr>` : '';
  const typeLabel = type === 'bug' ? 'Problema' : 'Mejora';
  const detailRows = type === 'bug'
    ? row('¿Qué intentaste?', tried) + row('¿Qué esperabas?', expected) + row('¿Qué pasó?', happened) + row('Impacto', impact)
    : row('Cambio propuesto', proposed_change) + row('Justificación', justification);
  const tableRows = row('Tipo', typeLabel) + row('Pantalla', screen) + detailRows;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f0e8;font-family:Georgia,serif;color:#1c1814;"><table style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);" cellpadding="0" cellspacing="0" width="100%"><tr><td style="background:#1c1814;padding:24px 32px;"><p style="margin:0;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#a89880;">Pignus Facturación</p><h1 style="margin:4px 0 0;font-size:22px;font-weight:500;color:#f5f0e8;">Reporte recibido</h1></td></tr><tr><td style="padding:24px 32px;"><p style="margin:0 0 16px;font-size:15px;">Tu reporte fue recibido y será revisado próximamente.</p><table cellpadding="0" cellspacing="0" width="100%">${tableRows}</table></td></tr><tr><td style="padding:0 32px 32px;"><a href="https://facturacion.pignuslabs.com.ar" style="display:inline-block;background:#1BBFA1;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-family:sans-serif;font-weight:600;">Abrir Facturación</a></td></tr><tr><td style="padding:16px 32px;background:#f5f0e8;border-top:1px solid #e8e2d9;"><p style="margin:0;font-size:11px;color:#9ca3af;font-family:sans-serif;">Este correo fue enviado automáticamente en respuesta a tu reporte.</p></td></tr></table></body></html>`;
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const { type, screen, tried, expected, happened, impact, proposed_change, justification } = body;
  const reportedBy = getReporterEmail(request);

  if (type !== 'bug' && type !== 'feature_request') {
    return json({ error: 'VALIDATION_ERROR', message: 'type must be bug or feature_request' }, { status: 400 });
  }
  if (type === 'bug') {
    if (!tried?.trim()) return json({ error: 'VALIDATION_ERROR', message: 'tried is required' }, { status: 400 });
    if (!expected?.trim()) return json({ error: 'VALIDATION_ERROR', message: 'expected is required' }, { status: 400 });
    if (!happened?.trim()) return json({ error: 'VALIDATION_ERROR', message: 'happened is required' }, { status: 400 });
  } else {
    if (!proposed_change?.trim()) return json({ error: 'VALIDATION_ERROR', message: 'proposed_change is required' }, { status: 400 });
    if (!justification?.trim()) return json({ error: 'VALIDATION_ERROR', message: 'justification is required' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.PIGNUS_TOKENS.put(
    `feedback:${id}`,
    JSON.stringify({ id, type, screen: screen ?? null, tried: tried ?? null, expected: expected ?? null, happened: happened ?? null, impact: impact ?? null, proposed_change: proposed_change ?? null, justification: justification ?? null, reported_by: reportedBy, app: 'facturacion', created_at: now }),
  );

  await sendEmail(env.RESEND_API_KEY, {
    to: reportedBy,
    subject: 'Reporte recibido — Pignus Facturación',
    html: buildReceivedHtml({ type, screen, tried, expected, happened, impact, proposed_change, justification }),
  });

  return json({ ok: true });
}
