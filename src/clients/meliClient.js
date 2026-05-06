import axios from 'axios';
import { config } from '../config/env.js';
import { withRetry } from '../utils/retry.js';

const client = axios.create({
  baseURL: config.meli.baseUrl,
  timeout: 30000,
  headers: {
    Authorization: `Bearer ${config.meli.accessToken}`,
    Accept: 'application/json',
  },
});

export async function searchOrders(params) {
  const response = await withRetry(
    () => client.get('/orders/search', { params }),
    { retries: config.meli.maxRetries },
  );

  return response.data;
}
