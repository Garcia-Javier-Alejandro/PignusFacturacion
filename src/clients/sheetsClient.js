import { google } from 'googleapis';
import { config } from '../config/env.js';

const auth = new google.auth.JWT({
  email: config.google.clientEmail,
  key: config.google.privateKey,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

export async function getExistingOrderIds() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: `${config.google.sheetName}!A:A`,
  });

  const values = response.data.values || [];
  return new Set(
    values
      .flat()
      .map((value) => String(value).trim())
      .filter((value) => value && value !== 'Orden ID'),
  );
}

export async function appendRows(rows) {
  if (rows.length === 0) {
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.google.sheetId,
    range: `${config.google.sheetName}!A:K`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: rows,
    },
  });
}
