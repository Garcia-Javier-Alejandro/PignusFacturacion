import { config } from '../config/env.js';

const params = new URLSearchParams({
  response_type: 'code',
  client_id: config.meli.appId,
  redirect_uri: config.meli.redirectUri,
  scope: 'offline_access read write',
});

console.info(`https://auth.mercadolibre.com.ar/authorization?${params.toString()}`);
