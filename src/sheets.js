import { google } from 'googleapis';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let sheets = null;
let spreadsheetId = null;

// Sheet names
const SHEETS = {
  ACCOUNTS: 'Accounts',
  TRANSACTIONS: 'Transactions',
  CATEGORIES: 'Categories',
  PLAID_ITEMS: 'PlaidItems',
  CONFIG: 'Config'
};

/**
 * Initialize Google Sheets API
 */
export async function initializeSheets() {
  try {
    // Load credentials
    const credentialsPath = join(__dirname, '../credentials/google-credentials.json');
    const configPath = join(__dirname, '../config.json');

    if (!fs.existsSync(credentialsPath)) {
      throw new Error('Google credentials file not found. Run npm run setup first.');
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // Detect environment
    const environment = (process.env.MODE || process.env.NODE_ENV || 'sandbox').toLowerCase();
    const isProduction = environment === 'production';

    // Get sheet ID based on environment (with backward compatibility)
    if (config.google_sheets) {
      // New format with separate sheets
      if (isProduction && config.google_sheets.production) {
        spreadsheetId = config.google_sheets.production.sheet_id;
      } else if (config.google_sheets.sandbox) {
        spreadsheetId = config.google_sheets.sandbox.sheet_id;
      }
    } else if (config.google_sheet_id) {
      // Old format (backward compatibility)
      spreadsheetId = config.google_sheet_id;
    }

    if (!spreadsheetId) {
      throw new Error(`Google Sheet ID not configured for ${environment} environment. Check config.json.`);
    }

    // Authenticate
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    sheets = google.sheets({ version: 'v4', auth: authClient });

    console.log(`✓ Connected to Google Sheets (${environment} environment)`);
    console.log(`  Sheet ID: ${spreadsheetId}`);
    return true;
  } catch (error) {
    console.error('Failed to initialize Google Sheets:', error.message);
    throw error;
  }
}

/**
 * Create initial spreadsheet structure
 */
export async function setupSpreadsheet() {
  try {
    // First, get existing sheets
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

    console.log('Existing sheets:', existingSheets.join(', '));

    // Create missing sheets
    const requiredSheets = [
      SHEETS.ACCOUNTS,
      SHEETS.TRANSACTIONS,
      SHEETS.CATEGORIES,
      SHEETS.PLAID_ITEMS
    ];

    const requests = [];
    for (const sheetName of requiredSheets) {
      if (!existingSheets.includes(sheetName)) {
        console.log(`Creating sheet: ${sheetName}`);
        requests.push({
          addSheet: {
            properties: {
              title: sheetName
            }
          }
        });
      }
    }

    // Execute sheet creation if needed
    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests }
      });
      console.log('✓ Sheets created');
    }

    // Set up Accounts sheet headers
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEETS.ACCOUNTS}!A1:J1`,
      valueInputOption: 'RAW',
      resource: {
        values: [[
          'Account ID', 'Item ID', 'Institution', 'Account Name', 'Type',
          'Subtype', 'Mask', 'Current Balance', 'Available Balance', 'Last Updated'
        ]]
      }
    });

    // Set up Transactions sheet headers
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEETS.TRANSACTIONS}!A1:K1`,
      valueInputOption: 'RAW',
      resource: {
        values: [[
          'Transaction ID', 'Date', 'Description', 'Merchant', 'Account', 
          'Amount', 'Category', 'Pending', 'Payment Channel', 'Notes', 'Created At'
        ]]
      }
    });

    // Set up Categories sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEETS.CATEGORIES}!A1:B1`,
      valueInputOption: 'RAW',
      resource: {
        values: [['Category', 'Parent Category']]
      }
    });

    // Add default categories
    const defaultCategories = [
      ['Groceries', ''], ['Restaurants', ''], ['Transportation', ''], 
      ['Gas', ''], ['Shopping', ''], ['Entertainment', ''],
      ['Bills & Utilities', ''], ['Healthcare', ''], ['Travel', ''],
      ['Income', ''], ['Transfer', ''], ['Other', '']
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEETS.CATEGORIES}!A2`,
      valueInputOption: 'RAW',
      resource: { values: defaultCategories }
    });

    // Set up PlaidItems sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEETS.PLAID_ITEMS}!A1:E1`,
      valueInputOption: 'RAW',
      resource: {
        values: [['Item ID', 'Access Token', 'Institution ID', 'Institution Name', 'Last Synced']]
      }
    });

    console.log('✓ Spreadsheet structure created');
    return true;
  } catch (error) {
    console.error('Failed to setup spreadsheet:', error.message);
    throw error;
  }
}

/**
 * Append rows to a sheet
 */
async function appendRows(sheetName, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A2`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values }
  });
}

/**
 * Get all rows from a sheet
 */
async function getRows(sheetName, range = 'A2:Z') {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${range}`
  });
  return response.data.values || [];
}

/**
 * Update a specific row
 */
async function updateRow(sheetName, rowIndex, values) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${rowIndex}`,
    valueInputOption: 'RAW',
    resource: { values: [values] }
  });
}

/**
 * Find row index by matching first column value
 */
async function findRowIndex(sheetName, searchValue) {
  const rows = await getRows(sheetName);
  return rows.findIndex(row => row[0] === searchValue);
}

// Plaid Items operations
export async function savePlaidItem(itemId, accessToken, institutionId, institutionName) {
  const rows = await getRows(SHEETS.PLAID_ITEMS);
  const existingIndex = rows.findIndex(row => row[0] === itemId);
  const now = new Date().toISOString();

  const values = [itemId, accessToken, institutionId, institutionName, now];

  if (existingIndex >= 0) {
    await updateRow(SHEETS.PLAID_ITEMS, existingIndex + 2, values);
  } else {
    await appendRows(SHEETS.PLAID_ITEMS, [values]);
  }
}

export async function getPlaidItems() {
  const rows = await getRows(SHEETS.PLAID_ITEMS);
  return rows.map(row => ({
    item_id: row[0],
    access_token: row[1],
    institution_id: row[2],
    institution_name: row[3],
    last_synced_at: row[4]
  }));
}

export async function updatePlaidItemSyncTime(itemId) {
  const rows = await getRows(SHEETS.PLAID_ITEMS);
  const index = rows.findIndex(row => row[0] === itemId);
  if (index >= 0) {
    const row = rows[index];
    row[4] = new Date().toISOString();
    await updateRow(SHEETS.PLAID_ITEMS, index + 2, row);
  }
}

// Account operations
export async function saveAccount(account, institutionName) {
  const rows = await getRows(SHEETS.ACCOUNTS);
  const existingIndex = rows.findIndex(row => row[0] === account.account_id);
  const now = new Date().toISOString();

  const values = [
    account.account_id,
    account.item_id,
    institutionName,
    account.name,
    account.type,
    account.subtype || '',
    account.mask || '',
    account.balances.current || 0,
    account.balances.available || 0,
    now
  ];

  if (existingIndex >= 0) {
    await updateRow(SHEETS.ACCOUNTS, existingIndex + 2, values);
  } else {
    await appendRows(SHEETS.ACCOUNTS, [values]);
  }
}

export async function getAccounts() {
  const rows = await getRows(SHEETS.ACCOUNTS);
  return rows.map(row => ({
    account_id: row[0],
    item_id: row[1],
    institution_name: row[2],
    name: row[3],
    type: row[4],
    subtype: row[5],
    mask: row[6],
    current_balance: parseFloat(row[7]) || 0,
    available_balance: parseFloat(row[8]) || 0,
    updated_at: row[9]
  }));
}

// Transaction operations
export async function saveTransactions(transactions, accountsMap) {
  if (transactions.length === 0) return 0;

  // Get existing transaction IDs
  const existingRows = await getRows(SHEETS.TRANSACTIONS);
  const existingIds = new Set(existingRows.map(row => row[0]));

  // Filter out transactions that already exist
  const newTransactions = transactions.filter(txn => !existingIds.has(txn.transaction_id));

  if (newTransactions.length === 0) return 0;

  const now = new Date().toISOString();
  const values = newTransactions.map(txn => [
    txn.transaction_id,
    txn.date,
    txn.name,
    txn.merchant_name || '',
    accountsMap[txn.account_id] || txn.account_id,
    txn.amount,
    '', // category (to be filled manually)
    txn.pending ? 'Yes' : 'No',
    txn.payment_channel || '',
    '', // notes
    now
  ]);

  await appendRows(SHEETS.TRANSACTIONS, values);
  return newTransactions.length;
}

export async function getTransactions(limit = 50) {
  const rows = await getRows(SHEETS.TRANSACTIONS);
  
  // Sort by date descending (most recent first)
  const sorted = rows.sort((a, b) => {
    const dateA = new Date(a[1]);
    const dateB = new Date(b[1]);
    return dateB - dateA;
  });

  return sorted.slice(0, limit).map(row => ({
    transaction_id: row[0],
    date: row[1],
    name: row[2],
    merchant_name: row[3],
    account_name: row[4],
    amount: parseFloat(row[5]) || 0,
    category: row[6],
    pending: row[7] === 'Yes',
    payment_channel: row[8],
    notes: row[9],
    created_at: row[10]
  }));
}

export async function getTransactionStats(startDate = null, endDate = null) {
  const rows = await getRows(SHEETS.TRANSACTIONS);
  
  let filtered = rows;
  if (startDate || endDate) {
    filtered = rows.filter(row => {
      const date = row[1];
      if (startDate && date < startDate) return false;
      if (endDate && date > endDate) return false;
      return true;
    });
  }

  // Filter out pending transactions
  filtered = filtered.filter(row => row[7] !== 'Yes');

  const stats = filtered.reduce((acc, row) => {
    const amount = parseFloat(row[5]) || 0;
    acc.total_count++;
    if (amount < 0) {
      acc.total_spent += amount;
    } else {
      acc.total_income += amount;
    }
    acc.net += amount;
    return acc;
  }, { total_count: 0, total_spent: 0, total_income: 0, net: 0 });

  return stats;
}

// Category operations
export async function getCategories() {
  const rows = await getRows(SHEETS.CATEGORIES);
  return rows.map((row, idx) => ({
    id: idx + 1,
    name: row[0],
    parent_category: row[1] || null
  }));
}

// Get spreadsheet URL
export function getSpreadsheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}

export { SHEETS };
