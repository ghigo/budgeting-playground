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

/**
 * Delete rows from a sheet by row indices (0-based data indices, will be converted to 1-based sheet indices)
 */
async function deleteRows(sheetName, rowIndices) {
  if (rowIndices.length === 0) return;

  // Get sheet ID from sheet name
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);

  if (!sheet) {
    throw new Error(`Sheet ${sheetName} not found`);
  }

  const sheetId = sheet.properties.sheetId;

  // Sort indices in descending order to delete from bottom to top
  // This prevents index shifting issues
  const sortedIndices = [...rowIndices].sort((a, b) => b - a);

  // Create delete requests for each row
  const requests = sortedIndices.map(dataIndex => {
    // Convert 0-based data index to actual sheet row index (add 2 for header + 0-based to 1-based)
    const sheetRowIndex = dataIndex + 2;
    return {
      deleteDimension: {
        range: {
          sheetId: sheetId,
          dimension: 'ROWS',
          startIndex: sheetRowIndex - 1, // Google API uses 0-based indices
          endIndex: sheetRowIndex // endIndex is exclusive
        }
      }
    };
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests }
  });
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

export async function removePlaidItem(itemId) {
  // Get all accounts for this item
  const accountRows = await getRows(SHEETS.ACCOUNTS);
  const accountsToRemove = [];
  const accountNamesToRemove = [];

  accountRows.forEach((row, index) => {
    if (row[1] === itemId) { // row[1] is item_id
      accountsToRemove.push(index);
      accountNamesToRemove.push(row[3]); // row[3] is account name
    }
  });

  // Get all transactions for these accounts
  const transactionRows = await getRows(SHEETS.TRANSACTIONS);
  const transactionsToRemove = [];

  transactionRows.forEach((row, index) => {
    if (accountNamesToRemove.includes(row[4])) { // row[4] is account_name
      transactionsToRemove.push(index);
    }
  });

  // Find the plaid item row
  const itemRows = await getRows(SHEETS.PLAID_ITEMS);
  const itemIndex = itemRows.findIndex(row => row[0] === itemId);

  if (itemIndex < 0) {
    throw new Error(`Plaid item ${itemId} not found`);
  }

  // Delete in order: transactions, accounts, then item
  if (transactionsToRemove.length > 0) {
    await deleteRows(SHEETS.TRANSACTIONS, transactionsToRemove);
  }

  if (accountsToRemove.length > 0) {
    await deleteRows(SHEETS.ACCOUNTS, accountsToRemove);
  }

  await deleteRows(SHEETS.PLAID_ITEMS, [itemIndex]);

  return {
    institution: itemRows[itemIndex][3], // institution name
    accountsRemoved: accountsToRemove.length,
    transactionsRemoved: transactionsToRemove.length
  };
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
    // Plaid convention: positive = expense (debit), negative = income (credit)
    if (amount > 0) {
      acc.total_spent += amount;
    } else if (amount < 0) {
      acc.total_income += Math.abs(amount);
    }
    acc.net += amount;
    return acc;
  }, { total_count: 0, total_spent: 0, total_income: 0, net: 0 });

  return stats;
}

export async function getDailySpendingIncome(days = 30) {
  const rows = await getRows(SHEETS.TRANSACTIONS);

  // Calculate start date
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Filter transactions within date range and exclude pending
  const filtered = rows.filter(row => {
    const txnDate = new Date(row[1]);
    return txnDate >= startDate && txnDate <= endDate && row[7] !== 'Yes';
  });

  // Group by date
  const dailyData = {};

  filtered.forEach(row => {
    const date = row[1]; // YYYY-MM-DD format
    const amount = parseFloat(row[5]) || 0;

    if (!dailyData[date]) {
      dailyData[date] = { date, income: 0, expenses: 0 };
    }

    // Plaid convention: positive = expense (debit), negative = income (credit)
    if (amount > 0) {
      dailyData[date].expenses += amount;
    } else if (amount < 0) {
      dailyData[date].income += Math.abs(amount);
    }
  });

  // Convert to array and sort by date
  const result = Object.values(dailyData).sort((a, b) =>
    new Date(a.date) - new Date(b.date)
  );

  return result;
}

export async function getNetWorthOverTime(timeRange = '1m') {
  const accounts = await getAccounts();
  const transactions = await getRows(SHEETS.TRANSACTIONS);

  // Calculate current total balance
  const currentBalance = accounts.reduce((sum, acc) =>
    sum + (parseFloat(acc.current_balance) || 0), 0
  );

  // Determine date range
  const endDate = new Date();
  const startDate = new Date();

  switch(timeRange) {
    case '1w':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case '1m':
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case '3m':
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case 'ytd':
      startDate.setMonth(0, 1); // January 1st of current year
      break;
    case '1y':
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    case 'all':
      // Find earliest transaction date
      if (transactions.length > 0) {
        const dates = transactions.map(row => new Date(row[1]));
        startDate.setTime(Math.min(...dates));
      } else {
        startDate.setMonth(startDate.getMonth() - 12); // Default to 1 year
      }
      break;
    default:
      startDate.setMonth(startDate.getMonth() - 1);
  }

  // Filter transactions within range
  const relevantTransactions = transactions.filter(row => {
    const txnDate = new Date(row[1]);
    return txnDate >= startDate && txnDate <= endDate && row[7] !== 'Yes';
  });

  // Group transactions by date and calculate running balance
  const dailyChanges = {};

  relevantTransactions.forEach(row => {
    const date = row[1];
    const amount = parseFloat(row[5]) || 0;

    if (!dailyChanges[date]) {
      dailyChanges[date] = 0;
    }
    dailyChanges[date] += amount;
  });

  // Build time series working backwards from current balance
  const dates = Object.keys(dailyChanges).sort();
  const timeSeries = [];

  // Add today with current balance
  const today = endDate.toISOString().split('T')[0];
  timeSeries.push({ date: today, balance: currentBalance });

  // Work backwards
  let runningBalance = currentBalance;
  for (let i = dates.length - 1; i >= 0; i--) {
    const date = dates[i];
    if (date < today) {
      runningBalance -= dailyChanges[date];
      timeSeries.unshift({ date, balance: runningBalance });
    }
  }

  // Add start date if not present
  if (timeSeries.length === 0 || timeSeries[0].date > startDate.toISOString().split('T')[0]) {
    timeSeries.unshift({
      date: startDate.toISOString().split('T')[0],
      balance: runningBalance
    });
  }

  return timeSeries;
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
