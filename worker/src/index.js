// Scheduled-only Worker (no routes — never intercepts Pages traffic).
// Hits the public *.pages.dev URL of the Pignusfacturacion Pages project so
// it bypasses the Cloudflare Access policy on facturacion.pignuslabs.com.ar;
// the Pages Function authenticates the call via the shared CRON_AUTH_SECRET.
const ENDPOINT = 'https://pignusfacturacion.pages.dev/api/orders/today';

export default {
  async scheduled(event, env, ctx) {
    const run = async () => {
      const started = Date.now();
      try {
        const res = await fetch(ENDPOINT, {
          headers: { 'x-cron-auth': env.CRON_AUTH_SECRET },
        });
        const body = await res.text();
        const ms = Date.now() - started;
        console.log(`[cron sync] status=${res.status} ms=${ms} body=${body.slice(0, 800)}`);
      } catch (err) {
        console.error('[cron sync] failed:', err?.stack || err?.message || err);
      }
    };
    ctx.waitUntil(run());
  },
};
