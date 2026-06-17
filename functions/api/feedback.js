import { json } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const { type, screen, tried, expected, happened, impact, proposed_change, justification } = body;

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
    JSON.stringify({ id, type, screen: screen ?? null, tried: tried ?? null, expected: expected ?? null, happened: happened ?? null, impact: impact ?? null, proposed_change: proposed_change ?? null, justification: justification ?? null, app: 'facturacion', created_at: now }),
  );

  return json({ ok: true });
}
