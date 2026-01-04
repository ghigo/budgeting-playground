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
import * as copilot from './copilot.js';
import aiCategorization from '../services/aiCategorizationService.js';
import { amazonItemCategorization } from '../services/amazonItemCategorizationService.js';

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
    const filters = {
      category: req.query.category,
      account: req.query.account,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      amazonMatch: req.query.amazonMatch
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
    const { name, parent_category, icon, color, description } = req.body;

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

    const result = database.addCategory(name, parent_category, categoryIcon, color, description);
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
    const { name: newName, parent_category, icon, color, description } = req.body;

    if (!newName) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const result = database.updateCategory(oldName, newName, parent_category, icon, color, description);
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

    // Fetch Amazon items for matched transactions
    for (const tx of transactions) {
      if (tx.amazon_order_id) {
        const items = db.prepare('SELECT * FROM amazon_items WHERE order_id = ?').all(tx.amazon_order_id);
        tx.amazon_items = items;
      }
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

    // Fetch Amazon items for matched transactions
    for (const tx of transactions) {
      if (tx.amazon_order_id) {
        const items = db.prepare('SELECT * FROM amazon_items WHERE order_id = ?').all(tx.amazon_order_id);
        tx.amazon_items = items;
      }
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
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      matched: req.query.matched === 'true' ? true : req.query.matched === 'false' ? false : undefined,
      accountName: req.query.accountName
    };

    const orders = database.getAmazonOrders(filters);

    // Include matched transaction details for each order
    const ordersWithTransactions = orders.map(order => {
      if (order.matched_transaction_id) {
        const transaction = database.getTransactions(10000)
          .find(t => t.transaction_id === order.matched_transaction_id);
        return {
          ...order,
          matched_transaction: transaction || null
        };
      }
      return order;
    });

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
      const transaction = database.getTransactions(10000)
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
    const { categorized, verified, orderId } = req.query;
    const filters = {};

    if (categorized) filters.categorized = categorized;
    if (verified) filters.verified = verified;
    if (orderId) filters.orderId = orderId;

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
    const result = await amazonItemCategorization.categorizeItem(item);

    // Save the categorization
    database.updateAmazonItemCategory(
      itemId,
      result.category,
      result.confidence,
      result.reasoning
    );

    // Update rule stats if a rule was used
    if (result.ruleId) {
      database.updateAmazonItemRuleStats(result.ruleId, true);
    }

    res.json(result);
  } catch (error) {
    console.error('Error categorizing Amazon item:', error);
    res.status(500).json({ error: error.message });
  }
});

// Batch categorize Amazon items
app.post('/api/amazon/items/categorize-batch', async (req, res) => {
  try {
    const { limit, itemIds, categorizedOnly } = req.body;

    let items;
    if (itemIds && itemIds.length > 0) {
      // Categorize specific items
      items = database.getAmazonItems({}).filter(item => itemIds.includes(item.id));
    } else if (categorizedOnly === false) {
      // Only uncategorized items
      items = database.getAmazonItems({ categorized: 'no' });
    } else {
      // All items
      items = database.getAmazonItems({});
    }

    const results = await amazonItemCategorization.categorizeItemsBatch(items, limit);

    // Save all categorizations
    for (const result of results) {
      database.updateAmazonItemCategory(
        result.itemId,
        result.category,
        result.confidence,
        result.reasoning
      );

      // Update rule stats if a rule was used
      if (result.ruleId) {
        database.updateAmazonItemRuleStats(result.ruleId, true);
      }
    }

    res.json({ success: true, count: results.length, results });
  } catch (error) {
    console.error('Error batch categorizing Amazon items:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update item category (manual selection)
app.post('/api/amazon/items/:itemId/category', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { category } = req.body;

    if (!category) {
      return res.status(400).json({ error: 'Category required' });
    }

    // Get the item
    const items = database.getAmazonItems({});
    const item = items.find(i => i.id === parseInt(itemId));

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Update category
    database.updateAmazonItemCategory(itemId, category, 100, 'User selected');

    // Learn from user's choice
    const learnResult = await amazonItemCategorization.learnFromUser(item, category);

    res.json({ success: true, learnResult });
  } catch (error) {
    console.error('Error updating Amazon item category:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify item category
app.post('/api/amazon/items/:itemId/verify', (req, res) => {
  try {
    const { itemId } = req.params;
    database.verifyAmazonItemCategory(itemId);
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
const server = app.listen(PORT, () => {
  const envEmoji = plaidEnvironment === 'production' ? '🟢' : '🟡';
  const envLabel = plaidEnvironment.toUpperCase();

  console.log(`\n🚀 Expense Tracker running at http://localhost:${PORT}\n`);
  console.log(`${envEmoji} Environment: ${envLabel}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Link Account: http://localhost:${PORT}/link`);
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
