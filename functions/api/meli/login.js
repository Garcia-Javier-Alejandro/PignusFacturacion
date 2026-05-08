import { requireAdmin } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  const authError = await requireAdmin(request, env);
  if (authError) return authError;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.MELI_APP_ID,
    redirect_uri: env.MELI_REDIRECT_URI,
    scope: 'offline_access read write',
  });

  return Response.redirect(`https://auth.mercadolibre.com.ar/authorization?${params.toString()}`, 302);
}
