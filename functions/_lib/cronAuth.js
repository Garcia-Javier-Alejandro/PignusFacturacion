// today.js is reachable via two hostnames:
//   - facturacion.pignuslabs.com.ar — protected by Cloudflare Access (user clicks the button)
//   - *.pages.dev                   — public, used by the scheduled cron Worker
// We trust Access for the production host and gate the pages.dev host on a shared secret.
export function requireSyncAuth(request, env) {
  const host = new URL(request.url).host;
  if (!host.endsWith('.pages.dev')) return null;
  const provided = request.headers.get('x-cron-auth');
  if (env.CRON_AUTH_SECRET && provided === env.CRON_AUTH_SECRET) return null;
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}
