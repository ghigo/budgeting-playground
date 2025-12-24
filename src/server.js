import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeSheets, setupSpreadsheet } from './sheets.js';
import * as plaidClient from './plaid.js';
import { plaidEnvironment } from './plaid.js';
import * as sync from './sync.js';
import * as sheets from './sheets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// Initialize Google Sheets on startup
let sheetsInitialized = false;

async function ensureSheets() {
  if (!sheetsInitialized) {
    await initializeSheets();
    sheetsInitialized = true;
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

// Create Plaid Link token
app.post('/api/plaid/create-link-token', async (req, res) => {
  try {
    await ensureSheets();
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
    await ensureSheets();
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
    await ensureSheets();
    const accounts = await sheets.getAccounts();
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transactions
app.get('/api/transactions', async (req, res) => {
  try {
    await ensureSheets();
    const limit = req.query.limit ? parseInt(req.query.limit) : 100;
    const transactions = await sheets.getTransactions(limit);
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
  try {
    await ensureSheets();
    const { startDate, endDate } = req.query;
    const stats = await sheets.getTransactionStats(startDate, endDate);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get categories
app.get('/api/categories', async (req, res) => {
  try {
    await ensureSheets();
    const categories = await sheets.getCategories();
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sync all accounts
app.post('/api/sync', async (req, res) => {
  try {
    await ensureSheets();
    const { startDate, endDate } = req.body;
    const result = await sync.syncAllAccounts(startDate, endDate);
    res.json(result);
  } catch (error) {
    console.error('Error syncing accounts:', error);
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
