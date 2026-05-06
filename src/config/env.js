import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'MELI_ACCESS_TOKEN',
  'MELI_SELLER_ID',
  'GOOGLE_SHEET_ID',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
];

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const config = {
  meli: {
    baseUrl: 'https://api.mercadolibre.com',
    accessToken: process.env.MELI_ACCESS_TOKEN,
    sellerId: process.env.MELI_SELLER_ID,
    pageSize: Number(process.env.MELI_PAGE_SIZE || 50),
    maxRetries: Number(process.env.MELI_MAX_RETRIES || 3),
    logRawPayments: process.env.LOG_RAW_PAYMENTS === 'true',
  },
  google: {
    sheetId: process.env.GOOGLE_SHEET_ID,
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    sheetName: process.env.SHEET_NAME || 'Ventas',
  },
};
