import express from 'express';
import cors from 'cors';
import compression from 'compression';
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
import * as copilot from './copilot.js';
import aiCategorization from '../services/aiCategorizationService.js';
import { amazonItemCategorization } from '../services/amazonItemCategorizationService.js';
import { backgroundJobService } from '../services/backgroundJobService.js';
import * as budgetManager from './budgets/budgetManager.js';
import * as budgetCalculations from './budgets/budgetCalculations.js';
import * as incomeManager from './income/incomeManager.js';
import * as projectionEngine from './projections/projectionEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
// Enable gzip compression for all responses (significantly reduces payload size)
app.use(compression({
  threshold: 1024, // Only compress responses larger than 1KB
  level: 6 // Compression level (0-9, 6 is a good balance of speed vs size)
}));
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// Smart API caching: cache static data, disable for dynamic data
app.use('/api', (req, res, next) => {
  // Static data that rarely changes - cache for 5 minutes
  const staticEndpoints = [
    '/api/categories',
    '/api/accounts',
    '/api/category-mappings/rules'
  ];

  // Check if this is a GET request to a static endpoint
  const isStaticEndpoint = req.method === 'GET' && staticEndpoints.some(endpoint => req.path === endpoint);

  if (isStaticEndpoint) {
    // Cache for 5 minutes (300 seconds)
    res.set('Cache-Control', 'public, max-age=300');
  } else {
    // Disable caching for dynamic data
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
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

// Rename an account
app.put('/api/accounts/:accountId/rename', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { newName } = req.body;

    if (!newName || newName.trim().length === 0) {
      return res.status(400).json({ error: 'New name is required' });
    }

    const result = database.renameAccount(accountId, newName.trim());
    res.json(result);
  } catch (error) {
    console.error('Error renaming account:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const filters = {
      category: req.query.category,
      account: req.query.account,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      amazonMatch: req.query.amazonMatch,
      offset: offset
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
    const { name, parent_category, icon, color, description, use_for_amazon } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    // Use AI to suggest emoji if no icon provided
    let categoryIcon = icon;
    if (!categoryIcon) {
      try {
        categoryIcon = await aiCategorization.suggestEmojiForCategory(name, description);
      } catch (error) {
        console.error('Error generating emoji with AI:', error.message);
        // Will fall back to suggestIconForCategory in database.addCategory
      }
    }

    const result = database.addCategory(name, parent_category, categoryIcon, color, description, use_for_amazon);
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
    const { name: newName, parent_category, icon, color, description, use_for_amazon } = req.body;

    if (!newName) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const result = database.updateCategory(oldName, newName, parent_category, icon, color, description, use_for_amazon);
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

// Generate emoji suggestions for a category
app.post('/api/categories/suggest-emojis', async (req, res) => {
  try {
    const { name, description, count = 3 } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const emojis = await aiCategorization.suggestMultipleEmojis(name, description, count);
    res.json({ emojis });
  } catch (error) {
    console.error('Error generating emoji suggestions:', error);
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
    const transaction = database.getTransactionById(transactionId);

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
    const { onlyUncategorized = true, transactionIds = null } = req.body;
    const result = database.recategorizeExistingTransactions(onlyUncategorized, transactionIds);
    res.json(result);
  } catch (error) {
    console.error('Error recategorizing transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// AI CATEGORIZATION
// ============================================================================

// Get AI categorization service status
app.get('/api/ai/status', async (req, res) => {
  try {
    const status = await aiCategorization.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting AI status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Categorize a single transaction using AI
app.post('/api/ai/categorize', async (req, res) => {
  try {
    const { transaction } = req.body;

    if (!transaction) {
      return res.status(400).json({ error: 'Transaction data required' });
    }

    const result = await aiCategorization.categorizeTransaction(transaction);
    res.json(result);
  } catch (error) {
    console.error('Error categorizing transaction:', error);
    res.status(500).json({ error: error.message });
  }
});

// Batch categorize multiple transactions
app.post('/api/ai/categorize/batch', async (req, res) => {
  try {
    const { transactions, options = {} } = req.body;

    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Transactions array required' });
    }

    const results = await aiCategorization.batchCategorize(transactions, options);
    res.json({ results, count: results.length });
  } catch (error) {
    console.error('Error batch categorizing transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Auto-categorize all uncategorized transactions with AI
app.post('/api/ai/auto-categorize', async (req, res) => {
  try {
    const { onlyUncategorized = true, updateDatabase = false } = req.body;

    // Get database instance
    const db = database.getDatabase();

    // Get uncategorized or all transactions (with Amazon order info)
    let transactions;
    if (onlyUncategorized) {
      transactions = db.prepare(`
        SELECT
          t.*,
          ao.order_id as amazon_order_id,
          ao.total_amount as amazon_total,
          ao.order_date as amazon_order_date,
          ao.match_confidence as amazon_match_confidence,
          ao.order_status as amazon_order_status,
          ao.subtotal as amazon_subtotal,
          ao.tax as amazon_tax,
          ao.shipping as amazon_shipping,
          ao.payment_method as amazon_payment_method
        FROM transactions t
        LEFT JOIN amazon_orders ao ON t.transaction_id = ao.matched_transaction_id
        WHERE t.category = 'Uncategorized' OR t.category IS NULL
        ORDER BY t.date DESC
      `).all();
    } else {
      transactions = db.prepare(`
        SELECT
          t.*,
          ao.order_id as amazon_order_id,
          ao.total_amount as amazon_total,
          ao.order_date as amazon_order_date,
          ao.match_confidence as amazon_match_confidence,
          ao.order_status as amazon_order_status,
          ao.subtotal as amazon_subtotal,
          ao.tax as amazon_tax,
          ao.shipping as amazon_shipping,
          ao.payment_method as amazon_payment_method
        FROM transactions t
        LEFT JOIN amazon_orders ao ON t.transaction_id = ao.matched_transaction_id
        ORDER BY t.date DESC
      `).all();
    }

    // Fetch Amazon items for matched transactions (optimized to avoid N+1 queries)
    const orderIds = transactions
      .filter(tx => tx.amazon_order_id)
      .map(tx => tx.amazon_order_id);

    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      const allItems = db.prepare(`SELECT * FROM amazon_items WHERE order_id IN (${placeholders})`).all(...orderIds);

      // Group items by order_id
      const itemsByOrderId = {};
      allItems.forEach(item => {
        if (!itemsByOrderId[item.order_id]) {
          itemsByOrderId[item.order_id] = [];
        }
        itemsByOrderId[item.order_id].push(item);
      });

      // Attach items to transactions
      transactions.forEach(tx => {
        if (tx.amazon_order_id) {
          tx.amazon_items = itemsByOrderId[tx.amazon_order_id] || [];
        }
      });
    }

    // Categorize them
    const results = await aiCategorization.batchCategorize(transactions);

    // Optionally update database
    let updated = 0;
    if (updateDatabase) {
      const updateStmt = db.prepare(`
        UPDATE transactions
        SET category = ?
        WHERE id = ?
      `);

      for (let i = 0; i < transactions.length; i++) {
        const transaction = transactions[i];
        const result = results[i];

        // Only update if confidence is high enough
        if (result.confidence >= 0.7) {
          updateStmt.run(result.category, transaction.id);
          updated++;
        }
      }
    }

    res.json({
      total: transactions.length,
      categorized: results.length,
      updated,
      results
    });
  } catch (error) {
    console.error('Error auto-categorizing transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Learn from user correction
app.post('/api/ai/learn', async (req, res) => {
  try {
    const { transaction, userCategory } = req.body;

    if (!transaction || !userCategory) {
      return res.status(400).json({ error: 'Transaction and userCategory required' });
    }

    await aiCategorization.learnFromCorrection(transaction, userCategory);
    res.json({ success: true, message: 'Learning updated' });
  } catch (error) {
    console.error('Error learning from correction:', error);
    res.status(500).json({ error: error.message });
  }
});

// Review all transactions and suggest improvements
app.post('/api/ai/review-all', async (req, res) => {
  try {
    const { confidenceThreshold = 100, limit = 10, offset = 0 } = req.body;

    // Get database instance
    const db = database.getDatabase();

    // Get all transactions with confidence < threshold (with limit and offset for progressive loading)
    // Include Amazon order information if matched
    const transactions = db.prepare(`
      SELECT
        t.*,
        ao.order_id as amazon_order_id,
        ao.total_amount as amazon_total,
        ao.order_date as amazon_order_date,
        ao.match_confidence as amazon_match_confidence,
        ao.order_status as amazon_order_status,
        ao.subtotal as amazon_subtotal,
        ao.tax as amazon_tax,
        ao.shipping as amazon_shipping,
        ao.payment_method as amazon_payment_method
      FROM transactions t
      LEFT JOIN amazon_orders ao ON t.transaction_id = ao.matched_transaction_id
      WHERE t.confidence < ?
      ORDER BY t.date DESC
      LIMIT ? OFFSET ?
    `).all(confidenceThreshold, limit, offset);

    // Fetch Amazon items for matched transactions (optimized to avoid N+1 queries)
    const orderIds = transactions
      .filter(tx => tx.amazon_order_id)
      .map(tx => tx.amazon_order_id);

    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      const allItems = db.prepare(`SELECT * FROM amazon_items WHERE order_id IN (${placeholders})`).all(...orderIds);

      // Group items by order_id
      const itemsByOrderId = {};
      allItems.forEach(item => {
        if (!itemsByOrderId[item.order_id]) {
          itemsByOrderId[item.order_id] = [];
        }
        itemsByOrderId[item.order_id].push(item);
      });

      // Attach items to transactions
      transactions.forEach(tx => {
        if (tx.amazon_order_id) {
          tx.amazon_items = itemsByOrderId[tx.amazon_order_id] || [];
        }
      });
    }

    // Get total count for info
    const totalCount = db.prepare(`
      SELECT COUNT(*) as count FROM transactions WHERE confidence < ?
    `).get(confidenceThreshold).count;

    console.log(`Reviewing ${transactions.length} of ${totalCount} transactions with confidence < ${confidenceThreshold}%`);

    if (transactions.length === 0) {
      return res.json({
        total_reviewed: 0,
        total_available: totalCount,
        suggestions_count: 0,
        suggestions: []
      });
    }

    // Get AI suggestions for each (batch size 3 to prevent memory issues with Mistral 7B)
    const suggestions = [];
    const results = await aiCategorization.batchCategorize(transactions, { batchSize: 3 });

    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];
      const aiResult = results[i];

      // Only suggest if:
      // 1. Category is different
      // 2. AI confidence is higher than current confidence
      // 3. AI confidence >= 70%
      const currentConfidence = transaction.confidence || 0;
      const shouldSuggest =
        aiResult.category !== transaction.category &&
        aiResult.confidence >= 0.7 &&
        aiResult.confidence * 100 > currentConfidence;

      if (shouldSuggest) {
        suggestions.push({
          transaction_id: transaction.transaction_id,
          date: transaction.date,
          description: transaction.description,
          merchant_name: transaction.merchant_name,
          account_name: transaction.account_name,
          amount: transaction.amount,
          current_category: transaction.category,
          current_confidence: currentConfidence,
          suggested_category: aiResult.category,
          suggested_confidence: Math.round(aiResult.confidence * 100),
          reasoning: aiResult.reasoning,
          method: aiResult.method,
          // Include all transaction metadata for learning
          payment_channel: transaction.payment_channel,
          transaction_type: transaction.transaction_type,
          plaid_primary_category: transaction.plaid_primary_category,
          plaid_detailed_category: transaction.plaid_detailed_category,
          plaid_confidence_level: transaction.plaid_confidence_level,
          location_city: transaction.location_city,
          location_region: transaction.location_region,
          location_address: transaction.location_address,
          merchant_entity_id: transaction.merchant_entity_id,
          authorized_datetime: transaction.authorized_datetime,
          pending: transaction.pending,
          verified: transaction.verified,
          // Amazon order information (if matched)
          amazon_order: transaction.amazon_order_id ? {
            order_id: transaction.amazon_order_id,
            total_amount: transaction.amazon_total,
            order_date: transaction.amazon_order_date,
            match_confidence: transaction.amazon_match_confidence,
            order_status: transaction.amazon_order_status
          } : null
        });
      }
    }

    res.json({
      total_reviewed: transactions.length,
      total_available: totalCount,
      suggestions_count: suggestions.length,
      suggestions,
      offset: offset,
      limit: limit,
      has_more: (offset + limit) < totalCount
    });
  } catch (error) {
    console.error('Error reviewing transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Apply re-categorization suggestions
app.post('/api/ai/apply-suggestions', async (req, res) => {
  try {
    const { suggestions } = req.body;

    if (!suggestions || !Array.isArray(suggestions)) {
      return res.status(400).json({ error: 'Suggestions array required' });
    }

    // Get database instance
    const db = database.getDatabase();

    let updated = 0;
    const updateStmt = db.prepare(`
      UPDATE transactions
      SET category = ?,
          confidence = ?,
          categorization_reasoning = ?
      WHERE transaction_id = ?
    `);

    const transaction = db.transaction((suggs) => {
      for (const suggestion of suggs) {
        updateStmt.run(
          suggestion.suggested_category,
          suggestion.suggested_confidence,
          suggestion.reasoning,
          suggestion.transaction_id
        );
        updated++;
      }
    });

    transaction(suggestions);

    res.json({
      success: true,
      updated
    });
  } catch (error) {
    console.error('Error applying suggestions:', error);
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

// Create a new category rule
app.post('/api/category-mappings/rules', async (req, res) => {
  try {
    const { name, pattern, category, matchType } = req.body;

    if (!name || !pattern || !category || !matchType) {
      return res.status(400).json({ error: 'Missing required fields: name, pattern, category, matchType' });
    }

    const result = database.createCategoryRule(name, pattern, category, matchType, 'Yes');
    res.json({
      id: result.id,
      name: result.name,
      message: 'Rule created successfully'
    });
  } catch (error) {
    console.error('Error creating category rule:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update an existing category rule
app.put('/api/category-mappings/rules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, pattern, category, matchType, enabled } = req.body;

    if (!name || !pattern || !category || !matchType) {
      return res.status(400).json({ error: 'Missing required fields: name, pattern, category, matchType' });
    }

    database.updateCategoryRule(parseInt(id), name, pattern, category, matchType, enabled || 'Yes');
    res.json({ message: 'Rule updated successfully' });
  } catch (error) {
    console.error('Error updating category rule:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a category rule
app.delete('/api/category-mappings/rules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    database.deleteCategoryRule(parseInt(id));
    res.json({ message: 'Rule deleted successfully' });
  } catch (error) {
    console.error('Error deleting category rule:', error);
    res.status(500).json({ error: error.message });
  }
});

// Preview transactions that match a rule
app.post('/api/category-mappings/rules/preview', async (req, res) => {
  try {
    const { pattern, matchType } = req.body;

    if (!pattern || !matchType) {
      return res.status(400).json({ error: 'Missing required fields: pattern, matchType' });
    }

    const matches = database.previewRuleMatches(pattern, matchType);
    res.json({ transactions: matches, count: matches.length });
  } catch (error) {
    console.error('Error previewing rule matches:', error);
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

// Backfill all available historical transactions
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

// Backfill historical transactions for a single account
app.post('/api/backfill/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    console.log(`🔄 Starting historical backfill for item ${itemId}...`);
    const result = await sync.backfillSingleAccountById(itemId);
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
    const accountName = req.query.accountName || 'Primary';

    if (!csvContent || csvContent.trim().length === 0) {
      return res.status(400).json({ error: 'No CSV content provided' });
    }

    // Import orders from CSV with account name
    const importResult = amazon.importAmazonOrdersFromCSV(csvContent, accountName);

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
    // Helper to parse boolean query parameters
    const parseQueryBoolean = (value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return undefined;
    };

    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      matched: parseQueryBoolean(req.query.matched),
      accountName: req.query.accountName,
      limit: req.query.limit ? parseInt(req.query.limit) : 100,  // Default limit to prevent slow loads
      offset: req.query.offset ? parseInt(req.query.offset) : 0
    };

    const orders = database.getAmazonOrders(filters);

    // Include matched transaction details for each order (optimized to avoid N+1 queries)
    const matchedTransactionIds = orders
      .filter(order => order.matched_transaction_id)
      .map(order => order.matched_transaction_id);

    let transactionMap = {};
    if (matchedTransactionIds.length > 0) {
      // Fetch all matched transactions in a single query
      const transactions = database.getTransactionsByIds(matchedTransactionIds);
      transactionMap = transactions.reduce((map, t) => {
        map[t.transaction_id] = t;
        return map;
      }, {});
    }

    const ordersWithTransactions = orders.map(order => ({
      ...order,
      matched_transaction: order.matched_transaction_id ? transactionMap[order.matched_transaction_id] || null : undefined
    }));

    res.json(ordersWithTransactions);
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
      const transaction = database.getTransactionById(order.matched_transaction_id);
      order.matched_transaction = transaction || null;
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching Amazon order:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Amazon product image URL by ASIN (scrapes actual product page)
app.get('/api/amazon/product-image/:asin', async (req, res) => {
  try {
    const { asin } = req.params;

    // Validate ASIN format
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      return res.status(400).json({ error: 'Invalid ASIN format' });
    }

    // Check if we have a cached image URL in database first
    const cachedItems = database.getAmazonItems({ asin });
    if (cachedItems.length > 0 && cachedItems[0].image_url) {
      // Return cached image URL silently (no console spam)
      return res.json({ asin, imageUrl: cachedItems[0].image_url, cached: true });
    }

    // Fetch Amazon product page
    const productUrl = `https://www.amazon.com/dp/${asin}`;
    const response = await fetch(productUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'Product not found on Amazon' });
    }

    const html = await response.text();

    // Extract image URL from HTML - try multiple patterns
    let imageUrl = null;

    // Pattern 1: OpenGraph image (most reliable)
    const ogImageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (ogImageMatch) {
      imageUrl = ogImageMatch[1];
    }

    // Pattern 2: Main product image in data attribute
    if (!imageUrl) {
      const dataImageMatch = html.match(/data-old-hires="([^"]+)"/);
      if (dataImageMatch) {
        imageUrl = dataImageMatch[1];
      }
    }

    // Pattern 3: Image in imageBlock
    if (!imageUrl) {
      const imgSrcMatch = html.match(/id="landingImage"[^>]*src="([^"]+)"/);
      if (imgSrcMatch) {
        imageUrl = imgSrcMatch[1];
      }
    }

    // Pattern 4: colorImages JSON data
    if (!imageUrl) {
      const colorImagesMatch = html.match(/'colorImages':\s*{\s*'initial':\s*\[({[^}]+})/);
      if (colorImagesMatch) {
        try {
          const imageData = JSON.parse(colorImagesMatch[1]);
          if (imageData.large) {
            imageUrl = imageData.large;
          } else if (imageData.hiRes) {
            imageUrl = imageData.hiRes;
          }
        } catch (e) {
          // JSON parse failed, continue
        }
      }
    }

    if (!imageUrl) {
      return res.status(404).json({ error: 'Image not found in product page' });
    }

    // Clean up the image URL (remove size parameters for better quality)
    imageUrl = imageUrl.split('._')[0] + '._AC_SL500_.jpg';

    // Cache the image URL in database for future use (silently)
    try {
      database.updateAmazonItemImageUrl(asin, imageUrl);
    } catch (dbError) {
      // Only log errors, not successes
      console.error(`[Image Cache] Failed to save image URL for ASIN ${asin}:`, dbError);
    }

    res.json({ asin, imageUrl, cached: false });
  } catch (error) {
    console.error('Error fetching Amazon product image:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Amazon order statistics
app.get('/api/amazon/stats', (req, res) => {
  try {
    const accountName = req.query.accountName || null;
    const stats = database.getAmazonOrderStats(accountName);
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

// Verify Amazon order match
app.post('/api/amazon/orders/:orderId/verify', (req, res) => {
  try {
    const result = database.verifyAmazonMatch(req.params.orderId);
    res.json(result);
  } catch (error) {
    console.error('Error verifying Amazon match:', error);
    res.status(500).json({ error: error.message });
  }
});

// Unverify Amazon order match
app.post('/api/amazon/orders/:orderId/unverify', (req, res) => {
  try {
    const result = database.unverifyAmazonMatch(req.params.orderId);
    res.json(result);
  } catch (error) {
    console.error('Error unverifying Amazon match:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run auto-match algorithm
app.post('/api/amazon/auto-match', async (req, res) => {
  try {
    const result = await amazon.autoMatchAmazonOrders();
    // Extract order IDs from matches for frontend highlighting
    const matchedOrderIds = result.matches ? result.matches.map(m => m.order_id) : [];
    res.json({
      ...result,
      matchedOrderIds
    });
  } catch (error) {
    console.error('Error auto-matching Amazon orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reset all Amazon matchings
app.post('/api/amazon/reset-matchings', (req, res) => {
  try {
    const result = database.resetAllAmazonMatchings();
    res.json(result);
  } catch (error) {
    console.error('Error resetting Amazon matchings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete all Amazon data (DEBUG - destructive operation)
app.post('/api/amazon/delete-all', (req, res) => {
  try {
    const result = database.deleteAllAmazonData();
    res.json(result);
  } catch (error) {
    console.error('Error deleting all Amazon data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete Amazon data for a specific account
app.post('/api/amazon/delete-account', (req, res) => {
  try {
    const { accountName } = req.body;

    if (!accountName) {
      return res.status(400).json({ error: 'Account name is required' });
    }

    const result = database.deleteAmazonDataByAccount(accountName);
    res.json(result);
  } catch (error) {
    console.error('Error deleting Amazon account data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all Amazon account names
app.get('/api/amazon/accounts', (req, res) => {
  try {
    const accounts = database.getAmazonAccountNames();
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching Amazon accounts:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// AMAZON ITEM CATEGORIZATION ENDPOINTS
// ============================================================================

// Get Amazon items with optional filters
app.get('/api/amazon/items', (req, res) => {
  try {
    const { categorized, verified, orderId, limit, offset } = req.query;
    const filters = {};

    if (categorized) filters.categorized = categorized;
    if (verified) filters.verified = verified;
    if (orderId) filters.orderId = orderId;

    // Add pagination support (default limit to prevent excessive data transfer)
    filters.limit = limit ? parseInt(limit) : 100;
    filters.offset = offset ? parseInt(offset) : 0;

    const items = database.getAmazonItems(filters);
    res.json(items);
  } catch (error) {
    console.error('Error fetching Amazon items:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Amazon item categorization stats
app.get('/api/amazon/items/stats', (req, res) => {
  try {
    const stats = database.getAmazonItemStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching Amazon item stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Categorize a single Amazon item
app.post('/api/amazon/items/:itemId/categorize', async (req, res) => {
  try {
    const { itemId } = req.params;
    const items = database.getAmazonItems({ itemId });

    if (items.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = items[0];

    // Use new enhanced AI categorization service
    const { default: enhancedAI } = await import('../services/enhancedAICategorizationService.js');
    const result = await enhancedAI.categorize(item, 'amazon_item', itemId);

    // Save the categorization
    database.updateAmazonItemCategory(
      itemId,
      result.category,
      Math.round((result.confidence || 0.5) * 100),
      result.reasoning
    );

    res.json(result);
  } catch (error) {
    console.error('Error categorizing Amazon item:', error);
    res.status(500).json({ error: error.message });
  }
});

// Batch categorize Amazon items (synchronous - for small batches)
app.post('/api/amazon/items/categorize-batch', async (req, res) => {
  try {
    const { limit, itemIds, categorizedOnly, skipVerified } = req.body;

    let items;
    if (itemIds && itemIds.length > 0) {
      // Categorize specific items (optimized: filter in database not JavaScript)
      items = database.getAmazonItems({ itemIds });
    } else if (categorizedOnly === false) {
      // Only uncategorized items, skip verified by default
      const filters = { categorized: 'no', limit: limit || 1000 };
      if (skipVerified !== false) {
        filters.verified = 'no';
      }
      items = database.getAmazonItems(filters);
    } else {
      // All items, skip verified by default
      const filters = { limit: limit || 1000 };
      if (skipVerified !== false) {
        filters.verified = 'no';
      }
      items = database.getAmazonItems(filters);
    }

    // Use new enhanced AI categorization service
    const { default: enhancedAI } = await import('../services/enhancedAICategorizationService.js');
    const results = await enhancedAI.batchCategorize(items, 'amazon_item', {
      batchSize: 10
    });

    // Save all categorizations
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const item = items[i];

      database.updateAmazonItemCategory(
        item.id,
        result.category,
        Math.round((result.confidence || 0.5) * 100),
        result.reasoning
      );
    }

    res.json({ success: true, count: results.length, results });
  } catch (error) {
    console.error('Error batch categorizing Amazon items:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start background categorization job
app.post('/api/amazon/items/categorize-background', async (req, res) => {
  try {
    const { limit, itemIds, categorizedOnly, skipVerified } = req.body;

    // Get items to categorize (optimized: filter in database not JavaScript)
    let items;
    if (itemIds && itemIds.length > 0) {
      items = database.getAmazonItems({ itemIds, limit: limit || 1000 });
    } else if (categorizedOnly === false) {
      // Only uncategorized items, and optionally skip verified items
      const filters = { categorized: 'no', limit: limit || 1000 };
      if (skipVerified !== false) {
        // By default, skip verified items
        filters.verified = 'no';
      }
      items = database.getAmazonItems(filters);
    } else {
      // All items, but skip verified ones by default
      const filters = { limit: limit || 1000 };
      if (skipVerified !== false) {
        filters.verified = 'no';
      }
      items = database.getAmazonItems(filters);
    }

    const itemsToProcess = items;

    // Create background job
    const jobId = backgroundJobService.createJob('amazon-item-categorization', {
      totalItems: itemsToProcess.length,
      limit
    });

    // Start processing in background (don't await)
    processCategorizationJob(jobId, itemsToProcess).catch(error => {
      console.error(`[Background Job ${jobId}] Uncaught error:`, error);
      backgroundJobService.failJob(jobId, error);
    });

    // Return job ID immediately
    res.json({ success: true, jobId, totalItems: itemsToProcess.length });
  } catch (error) {
    console.error('Error starting background categorization:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get job status
app.get('/api/jobs/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const job = backgroundJobService.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get incremental updates and clear them
    const updates = backgroundJobService.getAndClearUpdates(jobId);

    // Return job status with incremental updates
    res.json({
      ...job,
      updates  // Only includes new updates since last poll
    });
  } catch (error) {
    console.error('Error fetching job status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Process categorization job in background
 * @param {string} jobId - Job ID
 * @param {Array} items - Items to categorize
 */
async function processCategorizationJob(jobId, items) {
  try {
    backgroundJobService.startJob(jobId, items.length);

    const results = [];

    for (const item of items) {
      try {
        const result = await amazonItemCategorization.categorizeItem(item);

        // Save categorization
        database.updateAmazonItemCategory(
          item.id,
          result.category,
          result.confidence,
          result.reasoning
        );

        // Update rule stats if a rule was used
        if (result.ruleId) {
          database.updateAmazonItemRuleStats(result.ruleId, true);
        }

        results.push({
          itemId: item.id,
          ...result
        });

        // Add incremental update for reactive UI
        backgroundJobService.addUpdate(jobId, {
          itemId: item.id,
          category: result.category,
          confidence: result.confidence,
          reasoning: result.reasoning,
          verified: 'No'
        });

        // Update progress
        backgroundJobService.incrementProgress(jobId);
      } catch (error) {
        console.error(`[Background Job ${jobId}] Error categorizing item ${item.id}:`, error);
        // Continue processing other items
        backgroundJobService.incrementProgress(jobId);
      }
    }

    // Mark job as completed
    backgroundJobService.completeJob(jobId, {
      count: results.length,
      results
    });
  } catch (error) {
    backgroundJobService.failJob(jobId, error);
  }
}

// Update item category (manual selection)
app.post('/api/amazon/items/:itemId/category', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { category, previousCategory } = req.body;

    if (!category) {
      return res.status(400).json({ error: 'Category required' });
    }

    // Get the item (optimized: query by ID instead of loading all)
    const items = database.getAmazonItems({ itemId: parseInt(itemId) });

    if (items.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = items[0];

    // Update category and auto-verify (manual selection implies verification)
    database.updateAmazonItemCategory(itemId, category, 100, 'User selected');
    database.verifyAmazonItemCategory(itemId);

    // Record feedback with new enhanced AI service
    const { default: enhancedAI } = await import('../services/enhancedAICategorizationService.js');
    await enhancedAI.recordFeedback(
      itemId.toString(),
      'amazon_item',
      previousCategory || item.user_category || 'Uncategorized',
      category,
      'user_manual',
      1.0
    );

    console.log(`✓ User corrected Amazon item #${itemId}: ${item.title} → ${category}`);

    res.json({
      success: true,
      message: 'Category updated and feedback recorded'
    });
  } catch (error) {
    console.error('Error updating Amazon item category:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify item category
app.post('/api/amazon/items/:itemId/verify', async (req, res) => {
  try {
    const { itemId } = req.params;

    // Get the item to see its current category (optimized: query by ID instead of loading all)
    const items = database.getAmazonItems({ itemId: parseInt(itemId) });

    if (items.length === 0 || !items[0].user_category) {
      return res.status(400).json({ error: 'Item not found or not categorized' });
    }

    const item = items[0];

    // Mark as verified in database
    database.verifyAmazonItemCategory(itemId);

    // Record positive confirmation feedback with enhanced AI
    // This tells the AI that its categorization was correct
    const { default: enhancedAI } = await import('../services/enhancedAICategorizationService.js');

    // Get the AI categorization record to see what method was used
    const aiCategorization = database.getAICategorization(itemId.toString(), 'amazon_item');

    await enhancedAI.recordFeedback(
      itemId.toString(),
      'amazon_item',
      item.user_category, // Suggested category
      item.user_category, // Actual category (same because verified)
      aiCategorization?.method || 'unknown',
      aiCategorization?.confidence || item.confidence / 100
    );

    console.log(`✓ User verified Amazon item #${itemId}: ${item.title} as ${item.user_category}`);

    res.json({ success: true });
  } catch (error) {
    console.error('Error verifying Amazon item category:', error);
    res.status(500).json({ error: error.message });
  }
});

// Unverify item category
app.post('/api/amazon/items/:itemId/unverify', (req, res) => {
  try {
    const { itemId } = req.params;
    const { originalConfidence } = req.body;
    database.unverifyAmazonItemCategory(itemId, originalConfidence || 0);
    res.json({ success: true });
  } catch (error) {
    console.error('Error unverifying Amazon item category:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Amazon item rules
app.get('/api/amazon/items/rules', (req, res) => {
  try {
    const rules = database.getAmazonItemRules();
    res.json(rules);
  } catch (error) {
    console.error('Error fetching Amazon item rules:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create Amazon item rule
app.post('/api/amazon/items/rules', (req, res) => {
  try {
    const result = database.createAmazonItemRule(req.body);
    res.json(result);
  } catch (error) {
    console.error('Error creating Amazon item rule:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete Amazon item rule
app.delete('/api/amazon/items/rules/:ruleId', (req, res) => {
  try {
    const { ruleId } = req.params;
    database.deleteAmazonItemRule(ruleId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting Amazon item rule:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// TRANSACTION SPLITTING ENDPOINTS
// ============================================================================

// Get split suggestions for a transaction
app.get('/api/transactions/:transactionId/split-suggestions', (req, res) => {
  try {
    const { transactionId } = req.params;
    const suggestions = database.suggestTransactionSplits(transactionId);
    res.json(suggestions);
  } catch (error) {
    console.error('Error getting split suggestions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create transaction splits
app.post('/api/transactions/:transactionId/splits', (req, res) => {
  try {
    const { transactionId } = req.params;
    const { splits } = req.body;

    if (!splits || !Array.isArray(splits)) {
      return res.status(400).json({ error: 'Splits array required' });
    }

    const result = database.createTransactionSplits(transactionId, splits);
    res.json(result);
  } catch (error) {
    console.error('Error creating transaction splits:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transaction splits
app.get('/api/transactions/:transactionId/splits', (req, res) => {
  try {
    const { transactionId } = req.params;
    const splits = database.getTransactionSplits(transactionId);
    res.json({ splits });
  } catch (error) {
    console.error('Error getting transaction splits:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete transaction splits
app.delete('/api/transactions/:transactionId/splits', (req, res) => {
  try {
    const { transactionId } = req.params;
    const result = database.deleteTransactionSplits(transactionId);
    res.json(result);
  } catch (error) {
    console.error('Error deleting transaction splits:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all transactions with splits
app.get('/api/transactions/with-splits', (req, res) => {
  try {
    const transactions = database.getTransactionsWithSplits();
    res.json(transactions);
  } catch (error) {
    console.error('Error getting transactions with splits:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// COPILOT IMPORT ENDPOINTS
// ============================================================================

// Analyze Copilot CSV and detect unmapped categories
app.post('/api/copilot/analyze', express.text({ limit: '10mb' }), async (req, res) => {
  try {
    const csvContent = req.body;

    if (!csvContent || csvContent.trim().length === 0) {
      return res.status(400).json({ error: 'No CSV content provided' });
    }

    // Analyze CSV for unmapped categories
    const analysis = copilot.analyzeCopilotCSV(csvContent);

    res.json({
      success: true,
      ...analysis
    });
  } catch (error) {
    console.error('Error analyzing Copilot CSV:', error);
    res.status(500).json({ error: error.message });
  }
});

// Import transactions from Copilot Money CSV export with category mappings
app.post('/api/copilot/import', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { csvContent, categoryMappings } = req.body;

    if (!csvContent || csvContent.trim().length === 0) {
      return res.status(400).json({ error: 'No CSV content provided' });
    }

    // Import transactions with category mappings
    const importResult = copilot.importCopilotTransactionsWithMappings(csvContent, categoryMappings || {});

    res.json({
      success: true,
      imported: importResult.imported,
      skipped: importResult.skipped,
      total: importResult.total
    });
  } catch (error) {
    console.error('Error importing Copilot transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SETTINGS ENDPOINTS
// ============================================================================

// Get all settings
app.get('/api/settings', (req, res) => {
  try {
    const settings = database.getAllSettings();
    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update a setting
app.put('/api/settings/:key', (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: 'Value is required' });
    }

    const result = database.setSetting(key, value);
    res.json(result);
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(400).json({ error: error.message });
  }
});

// Reset a setting to default
app.delete('/api/settings/:key', (req, res) => {
  try {
    const { key } = req.params;
    const result = database.resetSetting(key);
    res.json(result);
  } catch (error) {
    console.error('Error resetting setting:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reset all settings to defaults
app.post('/api/settings/reset-all', (req, res) => {
  try {
    const result = database.resetAllSettings();
    res.json(result);
  } catch (error) {
    console.error('Error resetting all settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// EXTERNAL CATEGORY MAPPINGS
// ============================================================================

// Get unmapped external categories
app.get('/api/external-categories/unmapped', (req, res) => {
  try {
    const unmapped = database.getUnmappedExternalCategories();
    res.json({ categories: unmapped });
  } catch (error) {
    console.error('Error getting unmapped categories:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all external category mappings
app.get('/api/external-categories/mappings', (req, res) => {
  try {
    const mappings = database.getAllExternalMappings();
    res.json({ mappings });
  } catch (error) {
    console.error('Error getting external mappings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get pending external category mappings
app.get('/api/external-categories/pending', (req, res) => {
  try {
    const { source } = req.query;
    const pending = database.getPendingExternalMappings(source || null);
    res.json({ mappings: pending });
  } catch (error) {
    console.error('Error getting pending mappings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create or update external category mapping
app.post('/api/external-categories/mappings', (req, res) => {
  try {
    const { external_category, source, user_category, status, confidence } = req.body;

    if (!external_category || !source) {
      return res.status(400).json({ error: 'external_category and source are required' });
    }

    // Get or create mapping
    const mapping = database.getOrCreateExternalMapping(external_category, source);

    // Update it with user's choice
    database.updateExternalMapping(
      mapping.id,
      user_category || null,
      status || 'approved',
      confidence || 90
    );

    res.json({ success: true, mapping });
  } catch (error) {
    console.error('Error creating/updating external mapping:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update external category mapping
app.put('/api/external-categories/mappings/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { user_category, status, confidence } = req.body;

    database.updateExternalMapping(
      parseInt(id),
      user_category || null,
      status || 'approved',
      confidence || 90
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating external mapping:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete external category mapping
app.delete('/api/external-categories/mappings/:id', (req, res) => {
  try {
    const { id } = req.params;
    database.deleteExternalMapping(parseInt(id));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting external mapping:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get LLM suggestions for external category mappings
app.post('/api/external-categories/suggest-mapping', async (req, res) => {
  try {
    const { external_category, source } = req.body;

    if (!external_category) {
      return res.status(400).json({ error: 'external_category is required' });
    }

    // Get all user categories
    const userCategories = database.getCategories();

    // Use LLM to suggest best mapping
    const aiService = await import('./services/aiCategorizationService.js');
    const suggestion = await aiService.suggestCategoryMapping(
      external_category,
      source,
      userCategories
    );

    res.json(suggestion);
  } catch (error) {
    console.error('Error getting LLM suggestion:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ENHANCED AI CATEGORIZATION (4-STAGE PIPELINE)
// ============================================================================

// Categorize a single purchase/item
app.post('/api/categorize', async (req, res) => {
  try {
    const { purchase, item_type = 'amazon_item', item_id } = req.body;

    if (!purchase) {
      return res.status(400).json({ error: 'Purchase data is required' });
    }

    const { default: enhancedAI } = await import('../services/enhancedAICategorizationService.js');
    const result = await enhancedAI.categorize(purchase, item_type, item_id);

    res.json(result);
  } catch (error) {
    console.error('Error categorizing purchase:', error);
    res.status(500).json({ error: error.message });
  }
});

// Batch categorize purchases
app.post('/api/categorize/batch', async (req, res) => {
  try {
    const { purchases, item_type = 'amazon_item', batch_size = 10 } = req.body;

    if (!purchases || !Array.isArray(purchases)) {
      return res.status(400).json({ error: 'Purchases array is required' });
    }

    const { default: enhancedAI } = await import('../services/enhancedAICategorizationService.js');

    const results = await enhancedAI.batchCategorize(purchases, item_type, {
      batchSize: batch_size
    });

    res.json({
      total: purchases.length,
      results: results
    });
  } catch (error) {
    console.error('Error batch categorizing:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit user feedback/correction
app.post('/api/feedback', async (req, res) => {
  try {
    const {
      purchase_id,
      item_type = 'amazon_item',
      suggested_category,
      actual_category,
      suggestion_method,
      suggestion_confidence
    } = req.body;

    if (!purchase_id || !actual_category) {
      return res.status(400).json({
        error: 'purchase_id and actual_category are required'
      });
    }

    const { default: enhancedAI } = await import('../services/enhancedAICategorizationService.js');

    await enhancedAI.recordFeedback(
      purchase_id,
      item_type,
      suggested_category || 'Unknown',
      actual_category,
      suggestion_method,
      suggestion_confidence
    );

    res.json({
      success: true,
      message: 'Feedback recorded successfully'
    });
  } catch (error) {
    console.error('Error recording feedback:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get AI categorization status and metrics
app.get('/api/categorize/status', async (req, res) => {
  try {
    const { default: enhancedAI } = await import('../services/enhancedAICategorizationService.js');
    const status = await enhancedAI.getStatus();

    // Get metrics
    const metrics = database.getAIMetrics();
    const trainingHistory = database.getAITrainingHistory(5);
    const accuracyByMethod = database.getCategorizationAccuracyByMethod(null, 30);

    res.json({
      ...status,
      metrics,
      trainingHistory,
      accuracyByMethod
    });
  } catch (error) {
    console.error('Error getting categorization status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Trigger manual retraining
app.post('/api/categorize/retrain', async (req, res) => {
  try {
    const { default: scheduledRetraining } = await import('../services/scheduledRetrainingService.js');

    // Trigger retraining asynchronously
    scheduledRetraining.manualRetrain().catch(err =>
      console.error('Manual retraining failed:', err)
    );

    res.json({
      success: true,
      message: 'Retraining initiated in background'
    });
  } catch (error) {
    console.error('Error triggering retraining:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get retraining status
app.get('/api/categorize/retrain/status', async (req, res) => {
  try {
    const { default: scheduledRetraining } = await import('../services/scheduledRetrainingService.js');
    const status = scheduledRetraining.getStatus();

    res.json(status);
  } catch (error) {
    console.error('Error getting retraining status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Import Amazon CSV with categorization
app.post('/api/imports/amazon-csv', async (req, res) => {
  try {
    // TODO: Implement CSV import with auto-categorization
    res.status(501).json({ error: 'Not yet implemented' });
  } catch (error) {
    console.error('Error importing Amazon CSV:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get categorization metrics
app.get('/api/metrics/categorization', async (req, res) => {
  try {
    const { item_type, start_date, end_date, days = 30 } = req.query;

    const metrics = database.getAIMetrics(item_type, start_date, end_date);
    const accuracyByMethod = database.getCategorizationAccuracyByMethod(item_type, parseInt(days));

    res.json({
      metrics,
      accuracyByMethod
    });
  } catch (error) {
    console.error('Error getting categorization metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// BUDGETING & INCOME TRACKING
// ============================================================================

// Get all budgets for a year
app.get('/api/budgets', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const budgets = budgetManager.getBudgetsByYear(year);
    res.json(budgets);
  } catch (error) {
    console.error('Error fetching budgets:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new budget
app.post('/api/budgets', (req, res) => {
  try {
    const { category_id, year, annual_amount, notes } = req.body;

    if (!category_id || !year || annual_amount === undefined) {
      return res.status(400).json({ error: 'category_id, year, and annual_amount are required' });
    }

    const budget = budgetManager.createBudget({
      categoryId: category_id,
      year: parseInt(year),
      annualAmount: parseFloat(annual_amount),
      notes
    });

    res.json(budget);
  } catch (error) {
    console.error('Error creating budget:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update a budget
app.put('/api/budgets/:budgetId', (req, res) => {
  try {
    const { budgetId } = req.params;
    const { annual_amount, notes, reason } = req.body;

    const updates = {};
    if (annual_amount !== undefined) updates.annualAmount = parseFloat(annual_amount);
    if (notes !== undefined) updates.notes = notes;

    const result = budgetManager.updateBudget(budgetId, updates, reason);
    res.json(result);
  } catch (error) {
    console.error('Error updating budget:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a budget
app.delete('/api/budgets/:budgetId', (req, res) => {
  try {
    const { budgetId } = req.params;
    budgetManager.deleteBudget(budgetId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting budget:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clone budgets from one year to another
app.post('/api/budgets/clone', (req, res) => {
  try {
    const { source_year, target_year, adjustment_percent } = req.body;

    if (!source_year || !target_year) {
      return res.status(400).json({ error: 'source_year and target_year are required' });
    }

    const result = budgetManager.cloneBudgets(
      parseInt(source_year),
      parseInt(target_year),
      parseFloat(adjustment_percent) || 0
    );

    res.json(result);
  } catch (error) {
    console.error('Error cloning budgets:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get budget suggestions based on previous spending
app.get('/api/budgets/suggest', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const suggestions = budgetManager.suggestBudgets(year);
    res.json(suggestions);
  } catch (error) {
    console.error('Error getting budget suggestions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get budget history (adjustments)
app.get('/api/budgets/:budgetId/history', (req, res) => {
  try {
    const { budgetId } = req.params;
    const history = database.getBudgetAdjustments(budgetId);
    res.json(history);
  } catch (error) {
    console.error('Error fetching budget history:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get budget compliance status
app.get('/api/budgets/compliance', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const compliance = budgetCalculations.calculateFullCompliance(year);
    res.json(compliance);
  } catch (error) {
    console.error('Error calculating budget compliance:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get monthly spending breakdown
app.get('/api/budgets/monthly', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const categoryId = req.query.category_id ? parseInt(req.query.category_id) : null;
    const breakdown = budgetCalculations.getMonthlyBreakdown(year, categoryId);
    res.json(breakdown);
  } catch (error) {
    console.error('Error getting monthly breakdown:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get cumulative spending comparison
app.get('/api/budgets/cumulative', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const data = budgetCalculations.getCumulativeComparison(year);
    res.json(data);
  } catch (error) {
    console.error('Error getting cumulative comparison:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get categories needing attention
app.get('/api/budgets/alerts', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const alerts = budgetCalculations.getCategoriesNeedingAttention(year);
    res.json(alerts);
  } catch (error) {
    console.error('Error getting budget alerts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get savings rate
app.get('/api/budgets/savings', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const savings = budgetCalculations.calculateSavingsRate(year);
    res.json(savings);
  } catch (error) {
    console.error('Error calculating savings rate:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// INCOME TRACKING
// ============================================================================

// Get income transactions
app.get('/api/income', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month) : null;
    const transactions = incomeManager.getIncomeTransactions(year, month);
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching income transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add income transaction
app.post('/api/income', (req, res) => {
  try {
    const { date, amount, source, type, description, account_id } = req.body;

    if (!date || amount === undefined || !source || !type) {
      return res.status(400).json({ error: 'date, amount, source, and type are required' });
    }

    const income = incomeManager.addIncome({
      date,
      amount: parseFloat(amount),
      source,
      type,
      description,
      accountId: account_id
    });

    res.json(income);
  } catch (error) {
    console.error('Error adding income:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update income transaction
app.put('/api/income/:incomeId', (req, res) => {
  try {
    const { incomeId } = req.params;
    const updates = {};

    if (req.body.date) updates.date = req.body.date;
    if (req.body.amount !== undefined) updates.amount = parseFloat(req.body.amount);
    if (req.body.source) updates.source = req.body.source;
    if (req.body.type) updates.type = req.body.type;
    if (req.body.description !== undefined) updates.description = req.body.description;

    const result = incomeManager.updateIncome(incomeId, updates);
    res.json({ success: result });
  } catch (error) {
    console.error('Error updating income:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete income transaction
app.delete('/api/income/:incomeId', (req, res) => {
  try {
    const { incomeId } = req.params;
    incomeManager.deleteIncome(incomeId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting income:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get income analysis
app.get('/api/income/analysis', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const analysis = incomeManager.getIncomeAnalysis(year);
    res.json(analysis);
  } catch (error) {
    console.error('Error getting income analysis:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get income types
app.get('/api/income/types', (req, res) => {
  res.json(incomeManager.INCOME_TYPES);
});

// Get expected income budgets
app.get('/api/income/budgets', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const budgets = incomeManager.getIncomeBudgets(year);
    res.json(budgets);
  } catch (error) {
    console.error('Error fetching income budgets:', error);
    res.status(500).json({ error: error.message });
  }
});

// Set expected income
app.post('/api/income/budgets', (req, res) => {
  try {
    const { source, type, year, annual_expected, notes } = req.body;

    if (!source || !type || !year || annual_expected === undefined) {
      return res.status(400).json({ error: 'source, type, year, and annual_expected are required' });
    }

    const result = incomeManager.setExpectedIncome({
      source,
      type,
      year: parseInt(year),
      annualExpected: parseFloat(annual_expected),
      notes
    });

    res.json(result);
  } catch (error) {
    console.error('Error setting expected income:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PROJECTIONS
// ============================================================================

// Get spending projections
app.get('/api/projections', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const projections = projectionEngine.generateAllProjections(year);

    // Transform to match expected API response format
    const response = {
      year: projections.year,
      yearProgress: projections.year_progress,
      overall: projections.overall,
      summary: projections.summary,
      projections: projections.categories.map(cat => ({
        category_id: cat.category_id,
        category_name: cat.category_name,
        annual_budget: cat.annual_budget,
        ytd_spent: cat.current_spent,
        linear_projection: cat.linear_projection.projected_year_end,
        trend_projection: cat.trend_projection ? cat.trend_projection.projected_year_end : cat.linear_projection.projected_year_end,
        confidence: cat.best_estimate.confidence?.score ? cat.best_estimate.confidence.score / 100 : cat.best_estimate.confidence / 100,
        status: cat.status,
        warning: cat.warning_message
      }))
    };

    res.json(response);
  } catch (error) {
    console.error('Error getting projections:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test a scenario
app.post('/api/projections/scenario', (req, res) => {
  try {
    const { year, category_name, adjustment_percent } = req.body;

    if (!year) {
      return res.status(400).json({ error: 'year is required' });
    }

    if (category_name && adjustment_percent !== undefined) {
      // Single category scenario
      const result = projectionEngine.calculateScenario(parseInt(year), category_name, parseFloat(adjustment_percent));
      res.json(result);
    } else {
      // Return current projections if no specific scenario
      const projections = projectionEngine.generateAllProjections(parseInt(year));
      res.json({
        original: projections.overall,
        adjusted: projections.overall,
        savings: 0,
        message: 'No adjustments specified'
      });
    }
  } catch (error) {
    console.error('Error testing scenario:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get zero-based budget suggestions
app.get('/api/projections/zero-based', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const expectedIncome = parseFloat(req.query.expected_income) || 100000;
    const suggestions = projectionEngine.zeroBudgetHelper(expectedIncome, year);
    res.json(suggestions);
  } catch (error) {
    console.error('Error getting zero-based suggestions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Detect recurring expenses
app.get('/api/projections/recurring', (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const recurring = projectionEngine.detectRecurringExpenses(year);

    // Transform to match expected format
    res.json({
      year: recurring.year,
      fixed: recurring.recurring.items.map(item => ({
        merchant_name: item.merchant,
        description: item.merchant,
        avg_amount: item.average_amount,
        occurrences: item.transaction_count,
        frequency: item.frequency,
        estimated_annual: item.estimated_annual,
        category: item.category
      })),
      variable: recurring.variable.items.map(item => ({
        merchant_name: item.merchant,
        description: item.merchant,
        total_spent: item.total_spent,
        occurrences: item.transaction_count,
        category: item.category
      })),
      summary: recurring.summary
    });
  } catch (error) {
    console.error('Error detecting recurring expenses:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SERVER START
// ============================================================================

app.post('/api/settings/reset-all-OLD', (req, res) => {
  try {
    const result = database.resetAllSettings();
    res.json(result);
  } catch (error) {
    console.error('Error resetting all settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

// Start server
const server = app.listen(PORT, async () => {
  const envEmoji = plaidEnvironment === 'production' ? '🟢' : '🟡';
  const envLabel = plaidEnvironment.toUpperCase();

  console.log(`\n🚀 Expense Tracker running at http://localhost:${PORT}\n`);
  console.log(`${envEmoji} Environment: ${envLabel}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Link Account: http://localhost:${PORT}/link`);

  // Initialize retraining service (checks and retrains on startup if needed)
  try {
    const { default: scheduledRetraining } = await import('../services/scheduledRetrainingService.js');
    await scheduledRetraining.initialize();

    // Optionally start scheduled jobs for long-running services
    // Comment out if service restarts frequently
    if (process.env.ENABLE_SCHEDULED_RETRAINING !== 'false') {
      scheduledRetraining.start();
    }
  } catch (error) {
    console.error('⚠️  Failed to initialize retraining service:', error.message);
  }

  console.log('\nPress Ctrl+C to stop\n');
});

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  console.log(`\n\n${signal} received, shutting down gracefully...`);

  // Stop accepting new connections
  server.close(() => {
    console.log('✓ HTTP server closed');
  });

  try {
    // Stop scheduled retraining service
    try {
      const { default: scheduledRetraining } = await import('../services/scheduledRetrainingService.js');
      scheduledRetraining.stop();
    } catch (error) {
      console.error('   Failed to stop scheduled retraining:', error.message);
    }

    // Cleanup AI resources (unload Ollama model, stop processes)
    await aiCategorization.cleanup();

    // Close database connection
    console.log('   Closing database connection...');
    database.closeDatabase();
    console.log('   ✓ Database connection closed');

    console.log('\n✓ Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
