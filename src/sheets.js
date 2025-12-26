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
  CONFIG: 'Config',
  PLAID_CATEGORY_MAPPINGS: 'PlaidCategoryMappings',
  MERCHANT_MAPPINGS: 'MerchantMappings',
  CATEGORY_RULES: 'CategoryRules'
};

// Cache for categorization data to avoid API quota limits
const categorizationCache = {
  data: null,
  timestamp: null,
  TTL: 5 * 60 * 1000 // 5 minutes
};

/**
 * Load categorization data with caching to avoid API quota issues
 */
async function getCategorizationData() {
  const now = Date.now();

  // Return cached data if still valid
  if (categorizationCache.data &&
      categorizationCache.timestamp &&
      (now - categorizationCache.timestamp) < categorizationCache.TTL) {
    return categorizationCache.data;
  }

  // Fetch fresh data
  const [merchantMappings, categoryRules, plaidMappings] = await Promise.all([
    getMerchantMappings(),
    getEnabledCategoryRules(),
    getPlaidCategoryMappings()
  ]);

  // Update cache
  categorizationCache.data = { merchantMappings, categoryRules, plaidMappings };
  categorizationCache.timestamp = now;

  return categorizationCache.data;
}

/**
 * Clear categorization cache (call after updating mappings/rules)
 */
export function clearCategorizationCache() {
  categorizationCache.data = null;
  categorizationCache.timestamp = null;
}

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
      SHEETS.PLAID_ITEMS,
      SHEETS.PLAID_CATEGORY_MAPPINGS,
      SHEETS.MERCHANT_MAPPINGS,
      SHEETS.CATEGORY_RULES
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
      range: `${SHEETS.TRANSACTIONS}!A1:M1`,
      valueInputOption: 'RAW',
      resource: {
        values: [[
          'Transaction ID', 'Date', 'Description', 'Merchant', 'Account',
          'Amount', 'Category', 'Confidence', 'Verified', 'Pending', 'Payment Channel', 'Notes', 'Created At'
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

    // Set up PlaidCategoryMappings sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEETS.PLAID_CATEGORY_MAPPINGS}!A1:C1`,
      valueInputOption: 'RAW',
      resource: {
        values: [['Plaid Category', 'User Category', 'Auto-created']]
      }
    });

    // Set up MerchantMappings sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEETS.MERCHANT_MAPPINGS}!A1:D1`,
      valueInputOption: 'RAW',
      resource: {
        values: [['Merchant Name', 'Category', 'Match Count', 'Last Used']]
      }
    });

    // Set up CategoryRules sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEETS.CATEGORY_RULES}!A1:D1`,
      valueInputOption: 'RAW',
      resource: {
        values: [['Rule Name', 'Pattern', 'Category', 'Enabled']]
      }
    });

    // Add default category rules
    const defaultRules = [
      ['Walmart Pattern', 'walmart|wal-mart', 'Groceries', 'Yes'],
      ['Amazon Pattern', 'amazon|amzn', 'Shopping', 'Yes'],
      ['Gas Stations', 'shell|chevron|exxon|bp|mobil', 'Gas', 'Yes'],
      ['Utilities', 'electric|water|gas company|utility', 'Bills & Utilities', 'Yes'],
      ['Fast Food', 'mcdonalds|burger king|taco bell|kfc|subway', 'Restaurants', 'Yes']
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEETS.CATEGORY_RULES}!A2`,
      valueInputOption: 'RAW',
      resource: { values: defaultRules }
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
 * Batch update multiple rows at once to avoid API quota limits
 * @param {string} sheetName - Name of the sheet
 * @param {Array} updates - Array of {rowIndex, values} objects
 */
async function batchUpdateRows(sheetName, updates) {
  if (updates.length === 0) return;

  const data = updates.map(update => ({
    range: `${sheetName}!A${update.rowIndex}`,
    values: [update.values]
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    resource: {
      valueInputOption: 'RAW',
      data: data
    }
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

  // Load categorization data ONCE (cached) to avoid API quota issues
  const categorizationData = await getCategorizationData();

  // Auto-categorize each transaction
  const values = await Promise.all(newTransactions.map(async (txn) => {
    const { category, confidence } = await autoCategorizeTransaction(txn, categorizationData);

    return [
      txn.transaction_id,
      txn.date,
      txn.name,
      txn.merchant_name || '',
      accountsMap[txn.account_id] || txn.account_id,
      txn.amount,
      category, // Auto-categorized
      confidence, // Confidence % (0-100)
      'No', // verified (auto-categorized, not manually confirmed)
      txn.pending ? 'Yes' : 'No',
      txn.payment_channel || '',
      '', // notes
      now
    ];
  }));

  await appendRows(SHEETS.TRANSACTIONS, values);
  return newTransactions.length;
}

export async function getTransactions(limit = 50, filters = {}) {
  const rows = await getRows(SHEETS.TRANSACTIONS);

  // Apply filters
  let filtered = rows;

  if (filters.category) {
    filtered = filtered.filter(row => row[6] === filters.category);
  }

  if (filters.account) {
    filtered = filtered.filter(row => row[4] === filters.account);
  }

  if (filters.startDate) {
    filtered = filtered.filter(row => row[1] >= filters.startDate);
  }

  if (filters.endDate) {
    filtered = filtered.filter(row => row[1] <= filters.endDate);
  }

  // Sort by date descending (most recent first)
  const sorted = filtered.sort((a, b) => {
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
    confidence: parseInt(row[7]) || 0, // Confidence % (0-100)
    verified: row[8] === 'Yes',
    pending: row[9] === 'Yes',
    payment_channel: row[10],
    notes: row[11],
    created_at: row[12]
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
  filtered = filtered.filter(row => row[8] !== 'Yes');

  const byCategory = {};

  const stats = filtered.reduce((acc, row) => {
    const amount = parseFloat(row[5]) || 0;
    const category = row[6] || 'Uncategorized';

    acc.total_count++;

    // Plaid convention: positive = expense (debit), negative = income (credit)
    if (amount > 0) {
      acc.total_spent += amount;

      // Track spending by category (only expenses)
      if (!byCategory[category]) {
        byCategory[category] = 0;
      }
      byCategory[category] += amount;
    } else if (amount < 0) {
      acc.total_income += Math.abs(amount);
    }
    acc.net += amount;
    return acc;
  }, { total_count: 0, total_spent: 0, total_income: 0, net: 0 });

  stats.byCategory = byCategory;
  stats.income = stats.total_income;
  stats.expenses = -stats.total_spent; // Return as negative for consistency

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
    return txnDate >= startDate && txnDate <= endDate && row[8] !== 'Yes';
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
    return txnDate >= startDate && txnDate <= endDate && row[8] !== 'Yes';
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

  // Deduplicate categories by name (case-insensitive)
  const seen = new Map(); // Map to track seen names (lowercase) -> first occurrence
  const uniqueCategories = [];

  rows.forEach((row, idx) => {
    const name = row[0];
    const lowerName = name.toLowerCase();

    if (!seen.has(lowerName)) {
      seen.set(lowerName, true);
      uniqueCategories.push({
        id: idx + 1,
        name: name,
        parent_category: row[1] || null
      });
    }
  });

  return uniqueCategories;
}

export async function addCategory(name, parentCategory = null) {
  // Check if category already exists
  const existing = await getCategories();
  if (existing.some(cat => cat.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('Category already exists');
  }

  await appendRows(SHEETS.CATEGORIES, [[name, parentCategory || '']]);
  return { success: true, name, parent_category: parentCategory };
}

export async function updateCategory(categoryName, newName, newParentCategory = null) {
  const rows = await getRows(SHEETS.CATEGORIES);
  const index = rows.findIndex(row => row[0] === categoryName);

  if (index < 0) {
    throw new Error('Category not found');
  }

  const values = [newName, newParentCategory || ''];
  await updateRow(SHEETS.CATEGORIES, index + 2, values);

  // Update all transactions that use this category
  const transactions = await getRows(SHEETS.TRANSACTIONS);
  for (let i = 0; i < transactions.length; i++) {
    if (transactions[i][6] === categoryName) {
      transactions[i][6] = newName;
      await updateRow(SHEETS.TRANSACTIONS, i + 2, transactions[i]);
    }
  }

  return { success: true };
}

export async function removeCategory(categoryName) {
  const rows = await getRows(SHEETS.CATEGORIES);
  const index = rows.findIndex(row => row[0] === categoryName);

  if (index < 0) {
    throw new Error('Category not found');
  }

  // Check if any transactions use this category
  const transactions = await getRows(SHEETS.TRANSACTIONS);
  const transactionsUsingCategory = transactions.filter(row => row[6] === categoryName).length;

  if (transactionsUsingCategory > 0) {
    throw new Error(`Cannot delete category: ${transactionsUsingCategory} transaction(s) are using it`);
  }

  await deleteRows(SHEETS.CATEGORIES, [index]);
  return { success: true };
}

export async function getCategorySpending() {
  const transactions = await getRows(SHEETS.TRANSACTIONS);
  const categories = await getCategories();

  // Filter out pending transactions and calculate spending per category
  const categorySpending = {};
  const categoryMap = {};

  categories.forEach(cat => {
    categorySpending[cat.name] = {
      name: cat.name,
      parent_category: cat.parent_category,
      total: 0,
      count: 0
    };
    categoryMap[cat.name] = cat;
  });

  transactions.forEach(row => {
    if (row[8] === 'Yes') return; // Skip pending

    const category = row[6] || 'Uncategorized';
    const amount = parseFloat(row[5]) || 0;

    // Initialize if not exists
    if (!categorySpending[category]) {
      categorySpending[category] = {
        name: category,
        parent_category: null,
        total: 0,
        count: 0
      };
    }

    // Only count positive amounts (expenses) for spending
    if (amount > 0) {
      categorySpending[category].total += amount;
      categorySpending[category].count++;
    }
  });

  // Calculate parent category totals
  const result = Object.values(categorySpending);
  const parentTotals = {};

  result.forEach(cat => {
    if (cat.parent_category) {
      if (!parentTotals[cat.parent_category]) {
        parentTotals[cat.parent_category] = {
          name: cat.parent_category,
          parent_category: null,
          total: 0,
          count: 0,
          children: []
        };
      }
      parentTotals[cat.parent_category].total += cat.total;
      parentTotals[cat.parent_category].count += cat.count;
      parentTotals[cat.parent_category].children.push(cat);
    }
  });

  return {
    categories: result,
    parentTotals: Object.values(parentTotals)
  };
}

export async function updateTransactionCategory(transactionId, newCategory) {
  const rows = await getRows(SHEETS.TRANSACTIONS);
  const index = rows.findIndex(row => row[0] === transactionId);

  if (index < 0) {
    throw new Error('Transaction not found');
  }

  rows[index][6] = newCategory; // Category
  rows[index][7] = 100; // Confidence (100% when manually set)
  rows[index][8] = 'Yes'; // Mark as verified when manually changed
  await updateRow(SHEETS.TRANSACTIONS, index + 2, rows[index]);

  return { success: true };
}

/**
 * Verify a transaction's auto-assigned category without changing it
 */
export async function verifyTransactionCategory(transactionId) {
  const rows = await getRows(SHEETS.TRANSACTIONS);
  const index = rows.findIndex(row => row[0] === transactionId);

  if (index < 0) {
    throw new Error('Transaction not found');
  }

  rows[index][7] = 100; // Confidence (100% when verified)
  rows[index][8] = 'Yes'; // Mark as verified
  await updateRow(SHEETS.TRANSACTIONS, index + 2, rows[index]);

  return { success: true, category: rows[index][6] };
}

/**
 * Auto-categorize existing transactions that don't have categories or aren't verified
 * @param {boolean} onlyUncategorized - If true, only recategorize transactions with no category
 * @returns {Object} - Stats about the recategorization
 */
export async function recategorizeExistingTransactions(onlyUncategorized = true) {
  const rows = await getRows(SHEETS.TRANSACTIONS);

  // Load categorization data once
  const categorizationData = await getCategorizationData();

  let processed = 0;
  let skipped = 0;
  const batchUpdates = []; // Collect all updates for batch processing

  // Process each transaction
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const transactionId = row[0];
    const currentCategory = row[6] || '';
    const isVerified = row[8] === 'Yes'; // Verified column is now at index 8

    // Skip verified transactions (manually set by user)
    if (isVerified) {
      skipped++;
      continue;
    }

    // Skip if onlyUncategorized and it already has a category
    if (onlyUncategorized && currentCategory) {
      skipped++;
      continue;
    }

    processed++;

    // Build transaction object for auto-categorization
    const transaction = {
      transaction_id: row[0],
      date: row[1],
      name: row[2],
      merchant_name: row[3],
      account_id: row[4],
      amount: row[5],
      category: [], // We'll try to parse if stored
      personal_finance_category: null
    };

    // Try to get suggested category (skip saving mappings to avoid quota issues)
    const { category: suggestedCategory, confidence } = await autoCategorizeTransaction(transaction, categorizationData, true);

    // Only add to batch if we got a different category
    if (suggestedCategory && suggestedCategory !== currentCategory) {
      row[6] = suggestedCategory; // Category
      row[7] = confidence; // Confidence
      row[8] = 'No'; // Mark as not verified (auto-categorized)
      batchUpdates.push({
        rowIndex: i + 2, // +2 because: +1 for header, +1 for 0-based to 1-based
        values: row
      });
    }
  }

  // Perform batch update if there are changes
  if (batchUpdates.length > 0) {
    await batchUpdateRows(SHEETS.TRANSACTIONS, batchUpdates);
  }

  return {
    success: true,
    total: rows.length,
    processed,
    updated: batchUpdates.length,
    skipped
  };
}

// ============================================================================
// AUTO-CATEGORIZATION ENGINE
// ============================================================================

/**
 * Calculate Levenshtein distance for fuzzy string matching
 */
function levenshteinDistance(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  const matrix = [];

  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[s2.length][s1.length];
}

/**
 * Check if two strings are similar enough (fuzzy match)
 */
function isFuzzyMatch(str1, str2, threshold = 0.8) {
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  const similarity = 1 - (distance / maxLength);
  return similarity >= threshold;
}

/**
 * Get Plaid category mappings
 */
export async function getPlaidCategoryMappings() {
  const rows = await getRows(SHEETS.PLAID_CATEGORY_MAPPINGS);
  return rows.map(row => ({
    plaid_category: row[0],
    user_category: row[1],
    auto_created: row[2] === 'Yes'
  }));
}

/**
 * Get merchant mappings
 */
export async function getMerchantMappings() {
  const rows = await getRows(SHEETS.MERCHANT_MAPPINGS);
  return rows.map((row, index) => ({
    merchant_name: row[0],
    category: row[1],
    match_count: parseInt(row[2]) || 0,
    last_used: row[3],
    rowIndex: index + 2 // For updating
  }));
}

/**
 * Get category rules (all rules, not just enabled)
 */
export async function getCategoryRules() {
  const rows = await getRows(SHEETS.CATEGORY_RULES);
  return rows.map((row, index) => ({
    name: row[0],
    pattern: row[1],
    category: row[2],
    enabled: row[3] === 'Yes',
    rowIndex: index + 2
  }));
}

/**
 * Get only enabled category rules (for auto-categorization)
 */
async function getEnabledCategoryRules() {
  const rules = await getCategoryRules();
  return rules.filter(rule => rule.enabled);
}

/**
 * Save or update Plaid category mapping
 */
async function savePlaidCategoryMapping(plaidCategory, userCategory) {
  const rows = await getRows(SHEETS.PLAID_CATEGORY_MAPPINGS);
  const existingIndex = rows.findIndex(row => row[0] === plaidCategory);

  const values = [plaidCategory, userCategory, 'Yes'];

  if (existingIndex >= 0) {
    await updateRow(SHEETS.PLAID_CATEGORY_MAPPINGS, existingIndex + 2, values);
  } else {
    await appendRows(SHEETS.PLAID_CATEGORY_MAPPINGS, [values]);
  }

  // Clear cache when mappings are updated
  clearCategorizationCache();
}

/**
 * Save or update merchant mapping
 */
async function saveMerchantMapping(merchantName, category) {
  const rows = await getRows(SHEETS.MERCHANT_MAPPINGS);
  const existingIndex = rows.findIndex(row => row[0].toLowerCase() === merchantName.toLowerCase());

  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    // Update existing mapping
    const matchCount = (parseInt(rows[existingIndex][2]) || 0) + 1;
    const values = [merchantName, category, matchCount, now];
    await updateRow(SHEETS.MERCHANT_MAPPINGS, existingIndex + 2, values);
  } else {
    // Create new mapping
    const values = [merchantName, category, 1, now];
    await appendRows(SHEETS.MERCHANT_MAPPINGS, [values]);
  }

  // Clear cache when mappings are updated
  clearCategorizationCache();
}

/**
 * Auto-categorize a transaction using the hybrid approach:
 * 1. Merchant lookup (exact + fuzzy)
 * 2. Pattern matching
 * 3. Plaid category mapping
 * 4. Fallback to empty (for manual categorization or future LLM)
 *
 * @param {Object} transaction - The transaction to categorize
 * @param {Object} categorizationData - Optional pre-loaded categorization data to avoid API quota
 * @param {boolean} skipSavingMappings - If true, skip saving new mappings (for batch operations to avoid quota)
 * @returns {Object} - {category: string, confidence: number (0-100)}
 */
export async function autoCategorizeTransaction(transaction, categorizationData = null, skipSavingMappings = false) {
  try {
    const merchantName = transaction.merchant_name || transaction.name || '';
    const description = transaction.name || '';

    // Get all mappings and rules (use cached data if provided)
    let merchantMappings, categoryRules, plaidMappings;

    if (categorizationData) {
      // Use pre-loaded data
      ({ merchantMappings, categoryRules, plaidMappings } = categorizationData);
    } else {
      // Fetch from API (backward compatibility)
      const data = await getCategorizationData();
      ({ merchantMappings, categoryRules, plaidMappings } = data);
    }

    // STEP 1: Exact merchant lookup - 95% confidence
    const exactMatch = merchantMappings.find(
      m => m.merchant_name.toLowerCase() === merchantName.toLowerCase()
    );
    if (exactMatch) {
      // Update usage stats (skip during batch operations to avoid quota)
      if (!skipSavingMappings) {
        await saveMerchantMapping(merchantName, exactMatch.category);
      }
      return { category: exactMatch.category, confidence: 95 };
    }

    // STEP 2: Pattern matching (regex rules) - 85% confidence
    for (const rule of categoryRules) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(merchantName) || regex.test(description)) {
          // Save this as a merchant mapping for future use (skip during batch operations)
          if (merchantName && !skipSavingMappings) {
            await saveMerchantMapping(merchantName, rule.category);
          }
          return { category: rule.category, confidence: 85 };
        }
      } catch (e) {
        console.warn(`Invalid regex pattern in rule "${rule.name}": ${rule.pattern}`);
      }
    }

    // STEP 3: Fuzzy merchant matching (80% similarity) - 75% confidence
    if (merchantName) {
      for (const mapping of merchantMappings) {
        if (isFuzzyMatch(merchantName, mapping.merchant_name, 0.8)) {
          // Save exact merchant name for future (skip during batch operations)
          if (!skipSavingMappings) {
            await saveMerchantMapping(merchantName, mapping.category);
          }
          return { category: mapping.category, confidence: 75 };
        }
      }
    }

    // STEP 4: Plaid category mapping - 70% confidence
    if (transaction.category && transaction.category.length > 0) {
      // Try to match the most specific category first (last in array)
      for (let i = transaction.category.length - 1; i >= 0; i--) {
        const plaidCat = transaction.category[i];
        const mapping = plaidMappings.find(m => m.plaid_category === plaidCat);
        if (mapping) {
          return { category: mapping.user_category, confidence: 70 };
        }
      }

      // No mapping exists - try to auto-create one based on Plaid's category (skip during batch operations) - 50% confidence
      if (!skipSavingMappings) {
        const plaidCategory = transaction.category[transaction.category.length - 1];
        const suggestedCategory = mapPlaidCategoryToDefault(plaidCategory);
        if (suggestedCategory) {
          await savePlaidCategoryMapping(plaidCategory, suggestedCategory);
          return { category: suggestedCategory, confidence: 50 };
        }
      }
    }

    // STEP 5: Check personal_finance_category (newer Plaid format) - 70% / 50% confidence
    if (transaction.personal_finance_category) {
      const pfc = transaction.personal_finance_category;
      const pfcString = pfc.detailed || pfc.primary;

      const mapping = plaidMappings.find(m => m.plaid_category === pfcString);
      if (mapping) {
        return { category: mapping.user_category, confidence: 70 };
      }

      // Auto-create mapping (skip during batch operations) - 50% confidence
      if (!skipSavingMappings) {
        const suggestedCategory = mapPlaidCategoryToDefault(pfcString);
        if (suggestedCategory) {
          await savePlaidCategoryMapping(pfcString, suggestedCategory);
          return { category: suggestedCategory, confidence: 50 };
        }
      }
    }

    // STEP 6: Fallback - return empty for manual categorization or future LLM
    return { category: '', confidence: 0 };

  } catch (error) {
    console.error('Error in autoCategorizeTransaction:', error.message);
    return { category: '', confidence: 0 }; // Fallback to uncategorized on error
  }
}

/**
 * Map Plaid's category to our default categories (heuristic)
 */
function mapPlaidCategoryToDefault(plaidCategory) {
  const cat = plaidCategory.toLowerCase();

  // Food & Dining
  if (cat.includes('restaurant') || cat.includes('food') || cat.includes('coffee')) {
    return 'Restaurants';
  }
  if (cat.includes('groceries') || cat.includes('supermarket')) {
    return 'Groceries';
  }

  // Transportation
  if (cat.includes('gas') || cat.includes('fuel')) {
    return 'Gas';
  }
  if (cat.includes('transportation') || cat.includes('taxi') || cat.includes('uber') || cat.includes('parking')) {
    return 'Transportation';
  }

  // Shopping
  if (cat.includes('shop') || cat.includes('retail') || cat.includes('store')) {
    return 'Shopping';
  }

  // Entertainment
  if (cat.includes('entertainment') || cat.includes('recreation') || cat.includes('movie')) {
    return 'Entertainment';
  }

  // Bills & Utilities
  if (cat.includes('utility') || cat.includes('utilities') || cat.includes('bill') ||
      cat.includes('electric') || cat.includes('water') || cat.includes('internet')) {
    return 'Bills & Utilities';
  }

  // Healthcare
  if (cat.includes('health') || cat.includes('medical') || cat.includes('pharmacy')) {
    return 'Healthcare';
  }

  // Travel
  if (cat.includes('travel') || cat.includes('hotel') || cat.includes('airline')) {
    return 'Travel';
  }

  // Income
  if (cat.includes('income') || cat.includes('payroll') || cat.includes('deposit')) {
    return 'Income';
  }

  // Transfer
  if (cat.includes('transfer') || cat.includes('payment')) {
    return 'Transfer';
  }

  // Default fallback
  return 'Other';
}

// Get spreadsheet URL
export function getSpreadsheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}

export { SHEETS };
