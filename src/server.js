import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeDatabase } from './database.js';
import * as database from './database.js';
import { initializeSheets, setupSpreadsheet } from './sheets.js';
import * as plaidClient from './plaid.js';
import { plaidEnvironment } from './plaid.js';
import * as sync from './sync.js';
import * as sheets from './sheets.js';
import * as amazon from './amazon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// Disable caching for all API routes to ensure fresh data
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Initialize database on startup
try {
  initializeDatabase();
  console.log('Database initialized successfully');
} catch (error) {
  console.error('Failed to initialize database:', error.message);
  process.exit(1);
}

// Google Sheets is optional (for backup/sync only)
let sheetsInitialized = false;

async function ensureSheets() {
  if (!sheetsInitialized) {
    try {
      await initializeSheets(database);
      sheetsInitialized = true;
    } catch (error) {
      console.warn('Google Sheets not configured (optional):', error.message);
    }
  }
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', sheetsInitialized });
});

// Get environment info
app.get('/api/environment', (req, res) => {
  res.json({
    environment: plaidEnvironment,
    isProduction: plaidEnvironment === 'production'
  });
});

// Run database migration to add Confidence column
app.post('/api/migrate/add-confidence-column', async (req, res) => {
  try {
    await ensureSheets();
    const result = await sheets.migrateAddConfidenceColumn();
    res.json(result);
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create Plaid Link token
app.post('/api/plaid/create-link-token', async (req, res) => {
  try {
    const linkToken = await plaidClient.createLinkToken();
    res.json({ link_token: linkToken });
  } catch (error) {
    console.error('Error creating link token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Exchange public token and link account
app.post('/api/plaid/exchange-token', async (req, res) => {
  try {
    const { public_token } = req.body;

    if (!public_token) {
      return res.status(400).json({ error: 'public_token is required' });
    }

    console.log('🔄 Exchanging public token...');
    const result = await sync.linkAccount(public_token);
    console.log('✅ Account linked successfully!', result);
    res.json(result);
  } catch (error) {
    console.error('❌ Error exchanging token:', error);
    console.error('   Error details:', error.response?.data || error.message);
    res.status(500).json({
      error: error.message || 'Failed to link account',
      details: error.response?.data
    });
  }
});

// Get all accounts
app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = database.getAccounts();
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 100;
    const filters = {
      category: req.query.category,
      account: req.query.account,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    const transactions = database.getTransactions(limit, filters);
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const stats = database.getTransactionStats(startDate, endDate);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get daily spending and income data
app.get('/api/charts/daily-spending-income', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = database.getDailySpendingIncome(days);
    res.json(data);
  } catch (error) {
    console.error('Error fetching daily spending/income:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get net worth over time
app.get('/api/charts/net-worth', async (req, res) => {
  try {
    const range = req.query.range || '1w';
    const data = database.getNetWorthOverTime(range);
    res.json(data);
  } catch (error) {
    console.error('Error fetching net worth data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get categories
app.get('/api/categories', async (req, res) => {
  try {
    const categories = database.getCategories();
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get category spending statistics
app.get('/api/categories/spending', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const spending = database.getCategorySpending(startDate, endDate);
    res.json(spending);
  } catch (error) {
    console.error('Error fetching category spending:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a new category
app.post('/api/categories', async (req, res) => {
  try {
    const { name, parent_category, icon, color } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const result = database.addCategory(name, parent_category, icon, color);
    res.json(result);
  } catch (error) {
    console.error('Error adding category:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update a category
app.put('/api/categories/:categoryName', async (req, res) => {
  try {
    const oldName = req.params.categoryName;
    const { name: newName, parent_category, icon, color } = req.body;

    if (!newName) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const result = database.updateCategory(oldName, newName, parent_category, icon, color);
    res.json(result);
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a category
app.delete('/api/categories/:categoryName', async (req, res) => {
  try {
    const { categoryName } = req.params;
    const result = database.deleteCategory(categoryName);
    res.json(result);
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update multiple transactions with the same category
// IMPORTANT: This must come BEFORE the :transactionId route to avoid "bulk" being treated as an ID
app.patch('/api/transactions/bulk/category', async (req, res) => {
  try {
    const { transactionIds, category } = req.body;

    console.log('=== Bulk category update request ===');
    console.log('Transaction IDs:', transactionIds);
    console.log('Category:', category);

    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      console.error('Invalid transaction IDs array');
      return res.status(400).json({ error: 'Transaction IDs array is required' });
    }

    if (!category && category !== '') {
      console.error('Invalid category');
      return res.status(400).json({ error: 'Category is required' });
    }

    const updated = database.updateMultipleTransactionCategories(transactionIds, category);

    console.log('Updated count:', updated);

    res.json({
      success: true,
      updated
    });
  } catch (error) {
    console.error('Error updating multiple transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update transaction category
app.patch('/api/transactions/:transactionId/category', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { category } = req.body;

    if (!category && category !== '') {
      return res.status(400).json({ error: 'Category is required' });
    }

    database.updateTransactionCategory(transactionId, category);

    // Find similar transactions to suggest updating
    const transaction = database.getTransactions(1, { transactionId }).find(t => t.transaction_id === transactionId);
    const merchantName = transaction?.merchant_name || '';
    const similarTransactions = database.findSimilarTransactions(transactionId, merchantName);

    res.json({
      success: true,
      similarTransactions: similarTransactions.length > 0 ? similarTransactions : null,
      suggestedCategory: category
    });
  } catch (error) {
    console.error('Error updating transaction category:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get similar transactions for a given transaction
app.get('/api/transactions/:transactionId/similar', async (req, res) => {
  try {
    const { transactionId } = req.params;

    // Get the transaction to find its merchant name
    const transactions = database.getTransactions(999999);
    const transaction = transactions.find(t => t.transaction_id === transactionId);

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const merchantName = transaction.merchant_name || '';
    const similarTransactions = database.findSimilarTransactions(transactionId, merchantName);

    res.json({ similarTransactions });
  } catch (error) {
    console.error('Error finding similar transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify transaction category (confirm auto-assigned category is correct)
app.post('/api/transactions/:transactionId/verify', async (req, res) => {
  try {
    const { transactionId } = req.params;

    const result = database.verifyTransactionCategory(transactionId);
    res.json(result);
  } catch (error) {
    console.error('Error verifying transaction category:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/transactions/:transactionId/unverify', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { originalConfidence } = req.body;

    const result = database.unverifyTransactionCategory(transactionId, originalConfidence);
    res.json(result);
  } catch (error) {
    console.error('Error unverifying transaction category:', error);
    res.status(500).json({ error: error.message });
  }
});

// Auto-categorize existing transactions
app.post('/api/transactions/recategorize', async (req, res) => {
  try {
    const { onlyUncategorized = true } = req.body;
    const result = database.recategorizeExistingTransactions(onlyUncategorized);
    res.json(result);
  } catch (error) {
    console.error('Error recategorizing transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CATEGORY MAPPINGS & RULES
// ============================================================================

// Get Plaid category mappings
app.get('/api/category-mappings/plaid', async (req, res) => {
  try {
    const mappings = database.getPlaidCategoryMappings();
    res.json(mappings);
  } catch (error) {
    console.error('Error fetching Plaid category mappings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get merchant mappings
app.get('/api/category-mappings/merchant', async (req, res) => {
  try {
    const mappings = database.getMerchantMappings();
    res.json(mappings);
  } catch (error) {
    console.error('Error fetching merchant mappings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get category rules
app.get('/api/category-mappings/rules', async (req, res) => {
  try {
    const rules = database.getCategoryRules();
    res.json(rules);
  } catch (error) {
    console.error('Error fetching category rules:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all institutions (Plaid items)
app.get('/api/institutions', async (req, res) => {
  try {
    const items = database.getPlaidItems();
    res.json(items);
  } catch (error) {
    console.error('Error fetching institutions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove an institution and all its data
app.delete('/api/institutions/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;

    if (!itemId) {
      return res.status(400).json({ error: 'itemId is required' });
    }

    console.log(`🗑️  Removing institution ${itemId}...`);
    const result = await sync.removeInstitution(itemId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('❌ Error removing institution:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Google Sheets Sync Endpoints
// ============================================================================

// Check if Google Sheets is configured
app.get('/api/sheets/status', async (req, res) => {
  try {
    // Check if sheet ID is configured in database
    const sheetId = database.getConfig('google_sheet_id');
    const isConfigured = sheetId !== null;

    res.json({
      configured: isConfigured,
      initialized: sheetsInitialized,
      sheetId: isConfigured ? sheetId : null,
      url: isConfigured && sheetsInitialized ? sheets.getSpreadsheetUrl() : null
    });
  } catch (error) {
    console.error('Error checking sheets status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sync SQLite data to Google Sheets
app.post('/api/sheets/sync', async (req, res) => {
  try {
    // Ensure sheets are initialized
    await ensureSheets();

    if (!sheetsInitialized) {
      return res.status(400).json({
        success: false,
        error: 'Google Sheets not configured. Please configure a sheet first.'
      });
    }

    // Perform sync
    const result = await sheets.syncToGoogleSheets(database);
    res.json(result);
  } catch (error) {
    console.error('Error syncing to Google Sheets:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Configure Google Sheet ID
app.post('/api/sheets/configure', async (req, res) => {
  try {
    const { sheetId } = req.body;

    if (!sheetId || typeof sheetId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid sheet ID is required'
      });
    }

    // Save to database config
    database.setConfig('google_sheet_id', sheetId);

    // Reset initialization flag so it will reinitialize on next request
    sheetsInitialized = false;

    // Try to initialize sheets with new ID
    await ensureSheets();

    res.json({
      success: true,
      configured: sheetsInitialized,
      message: sheetsInitialized
        ? 'Google Sheets configured successfully'
        : 'Sheet ID saved, but initialization failed. Check credentials and sheet ID.'
    });
  } catch (error) {
    console.error('Error configuring Google Sheets:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// Plaid Sync Endpoints
// ============================================================================

// Sync all accounts
app.post('/api/sync', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const result = await sync.syncAllAccounts(startDate, endDate);
    res.json(result);
  } catch (error) {
    console.error('Error syncing accounts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sync a single account by item ID
app.post('/api/sync/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const result = await sync.syncSingleAccount(itemId);
    res.json(result);
  } catch (error) {
    console.error('Error syncing account:', error);
    res.status(500).json({ error: error.message });
  }
});

// Backfill historical transactions (up to 2 years)
app.post('/api/backfill', async (req, res) => {
  try {
    console.log('🔄 Starting historical backfill...');
    const result = await sync.backfillHistoricalTransactions();
    res.json(result);
  } catch (error) {
    console.error('Error backfilling transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Initialize spreadsheet structure
app.post('/api/init-spreadsheet', async (req, res) => {
  try {
    await ensureSheets();
    await setupSpreadsheet();
    res.json({ success: true, message: 'Spreadsheet initialized' });
  } catch (error) {
    console.error('Error initializing spreadsheet:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// AMAZON ENDPOINTS
// ============================================================================

// Upload Amazon order history CSV
app.post('/api/amazon/upload', express.text({ limit: '10mb' }), async (req, res) => {
  try {
    const csvContent = req.body;

    if (!csvContent || csvContent.trim().length === 0) {
      return res.status(400).json({ error: 'No CSV content provided' });
    }

    // Import orders from CSV
    const importResult = amazon.importAmazonOrdersFromCSV(csvContent);

    // Auto-match orders to transactions
    const matchResult = await amazon.autoMatchAmazonOrders();

    // Ensure Amazon categories exist
    amazon.ensureAmazonCategories();

    res.json({
      success: true,
      imported: importResult.imported,
      updated: importResult.updated,
      matched: matchResult.matched,
      unmatched: matchResult.unmatched
    });
  } catch (error) {
    console.error('Error uploading Amazon orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all Amazon orders
app.get('/api/amazon/orders', (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      matched: req.query.matched === 'true' ? true : req.query.matched === 'false' ? false : undefined
    };

    const orders = database.getAmazonOrders(filters);
    res.json(orders);
  } catch (error) {
    console.error('Error fetching Amazon orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Amazon order with items by ID
app.get('/api/amazon/orders/:orderId', (req, res) => {
  try {
    const order = database.getAmazonOrderWithItems(req.params.orderId);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // If matched, include transaction details
    if (order.matched_transaction_id) {
      const transaction = database.getTransactions({ limit: 10000 })
        .find(t => t.transaction_id === order.matched_transaction_id);

      order.matched_transaction = transaction || null;
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching Amazon order:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Amazon order statistics
app.get('/api/amazon/stats', (req, res) => {
  try {
    const stats = database.getAmazonOrderStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching Amazon stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manually link Amazon order to transaction
app.post('/api/amazon/orders/:orderId/link', (req, res) => {
  try {
    const { transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: 'Transaction ID is required' });
    }

    database.linkAmazonOrderToTransaction(req.params.orderId, transactionId, 100);

    res.json({ success: true });
  } catch (error) {
    console.error('Error linking Amazon order:', error);
    res.status(500).json({ error: error.message });
  }
});

// Unlink Amazon order from transaction
app.post('/api/amazon/orders/:orderId/unlink', (req, res) => {
  try {
    database.unlinkAmazonOrder(req.params.orderId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error unlinking Amazon order:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run auto-match algorithm
app.post('/api/amazon/auto-match', async (req, res) => {
  try {
    const result = await amazon.autoMatchAmazonOrders();
    res.json(result);
  } catch (error) {
    console.error('Error auto-matching Amazon orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

// Start server
app.listen(PORT, () => {
  const envEmoji = plaidEnvironment === 'production' ? '🟢' : '🟡';
  const envLabel = plaidEnvironment.toUpperCase();

  console.log(`\n🚀 Expense Tracker running at http://localhost:${PORT}\n`);
  console.log(`${envEmoji} Environment: ${envLabel}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Link Account: http://localhost:${PORT}/link`);
  console.log('\nPress Ctrl+C to stop\n');
});
