const DEFAULT_SHEET_NAME = 'Ventas';

const requireGoogleEnv = (env) => {
  const missing = [
    'GOOGLE_SHEET_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
  ].filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing Google Sheets env vars: ${missing.join(', ')}`);
  }
};

const normalizePrivateKey = (value) => value.replace(/\\n/g, '\n');

const base64UrlEncode = (input) => {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(input);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const privateKeyToArrayBuffer = (privateKey) => {
  const pem = normalizePrivateKey(privateKey)
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(pem);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
};

async function createJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyToArrayBuffer(env.GOOGLE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );

  return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function getAccessToken(env) {
  const assertion = await createJwt(env);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Google OAuth token request failed');
  }

  return data.access_token;
}

async function sheetsFetch(env, path, init = {}) {
  requireGoogleEnv(env);

  const token = await getAccessToken(env);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error?.message || 'Google Sheets request failed');
  }

  return data;
}

export async function getExistingOrderIds(env) {
  const sheetName = env.SHEET_NAME || DEFAULT_SHEET_NAME;
  const range = encodeURIComponent(`${sheetName}!A:A`);
  const data = await sheetsFetch(env, `/values/${range}`);
  const values = data.values || [];

  return new Set(
    values
      .flat()
      .map((value) => String(value).trim())
      .filter((value) => value && value !== 'Orden ID'),
  );
}

export async function appendRows(env, rows) {
  if (rows.length === 0) {
    return { updates: { updatedRows: 0 } };
  }

  const sheetName = env.SHEET_NAME || DEFAULT_SHEET_NAME;
  const range = encodeURIComponent(`${sheetName}!A:K`);

  return sheetsFetch(env, `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: rows }),
  });
}
