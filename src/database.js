import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db = null;

/**
 * Initialize SQLite database
 */
export function initializeDatabase() {
  try {
    const dbPath = join(__dirname, '../data/expense-tracker.db');

    // Ensure data directory exists
    const dataDir = dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); // Better concurrency

    // Create tables
    createTables();

    console.log('✓ SQLite database initialized');
    console.log(`  Database: ${dbPath}`);

    return true;
  } catch (error) {
    console.error('Failed to initialize database:', error.message);
    throw error;
  }
}

/**
 * Create database tables
 */
function createTables() {
  db.exec(`
    -- Plaid Items (linked institutions)
    CREATE TABLE IF NOT EXISTS plaid_items (
      item_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      institution_id TEXT NOT NULL,
      institution_name TEXT NOT NULL,
      last_synced TEXT
    );

    -- Accounts
    CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      institution_name TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT,
      mask TEXT,
      current_balance REAL DEFAULT 0,
      available_balance REAL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES plaid_items(item_id) ON DELETE CASCADE
    );

    -- Transactions
    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      merchant_name TEXT,
      account_name TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT,
      confidence INTEGER DEFAULT 0,
      verified TEXT DEFAULT 'No',
      pending TEXT DEFAULT 'No',
      payment_channel TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    -- Categories
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_category TEXT
    );

    -- Plaid Category Mappings
    CREATE TABLE IF NOT EXISTS plaid_category_mappings (
      plaid_category TEXT PRIMARY KEY,
      user_category TEXT NOT NULL,
      auto_created TEXT DEFAULT 'No'
    );

    -- Merchant Mappings
    CREATE TABLE IF NOT EXISTS merchant_mappings (
      merchant_name TEXT PRIMARY KEY COLLATE NOCASE,
      category TEXT NOT NULL,
      match_count INTEGER DEFAULT 1,
      last_used TEXT NOT NULL
    );

    -- Category Rules
    CREATE TABLE IF NOT EXISTS category_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      pattern TEXT NOT NULL,
      category TEXT NOT NULL,
      enabled TEXT DEFAULT 'Yes'
    );

    -- Config (key-value store)
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
    CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_name);
    CREATE INDEX IF NOT EXISTS idx_accounts_item_id ON accounts(item_id);
  `);

  // Seed default data if tables are empty
  seedDefaultData();
}

/**
 * Seed default categories and rules
 */
function seedDefaultData() {
  // Check if categories already exist
  const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();

  if (categoryCount.count === 0) {
    console.log('Seeding default categories...');
    const defaultCategories = [
      ['Groceries', ''],
      ['Restaurants', ''],
      ['Transportation', ''],
      ['Gas', ''],
      ['Shopping', ''],
      ['Entertainment', ''],
      ['Bills & Utilities', ''],
      ['Healthcare', ''],
      ['Travel', ''],
      ['Income', ''],
      ['Transfer', ''],
      ['Other', '']
    ];

    const stmt = db.prepare('INSERT INTO categories (name, parent_category) VALUES (?, ?)');
    const insertMany = db.transaction((categories) => {
      for (const cat of categories) {
        stmt.run(cat[0], cat[1]);
      }
    });
    insertMany(defaultCategories);
    console.log(`✓ Added ${defaultCategories.length} default categories`);
  }

  // Check if category rules already exist
  const rulesCount = db.prepare('SELECT COUNT(*) as count FROM category_rules').get();

  if (rulesCount.count === 0) {
    console.log('Seeding default category rules...');
    const defaultRules = [
      ['Walmart Pattern', 'walmart|wal-mart', 'Groceries', 'Yes'],
      ['Amazon Pattern', 'amazon|amzn', 'Shopping', 'Yes'],
      ['Gas Stations', 'shell|chevron|exxon|bp|mobil', 'Gas', 'Yes'],
      ['Utilities', 'electric|water|gas company|utility', 'Bills & Utilities', 'Yes'],
      ['Fast Food', 'mcdonalds|burger king|taco bell|kfc|subway', 'Restaurants', 'Yes']
    ];

    const stmt = db.prepare('INSERT INTO category_rules (name, pattern, category, enabled) VALUES (?, ?, ?, ?)');
    const insertMany = db.transaction((rules) => {
      for (const rule of rules) {
        stmt.run(rule[0], rule[1], rule[2], rule[3]);
      }
    });
    insertMany(defaultRules);
    console.log(`✓ Added ${defaultRules.length} default category rules`);
  }
}

/**
 * Get database instance
 */
export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

// ============================================================================
// PLAID ITEMS
// ============================================================================

export function getPlaidItems() {
  const items = db.prepare('SELECT * FROM plaid_items').all();
  return items;
}

export function savePlaidItem(itemId, accessToken, institutionId, institutionName) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO plaid_items (item_id, access_token, institution_id, institution_name, last_synced)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(itemId, accessToken, institutionId, institutionName);
}

export function removePlaidItem(itemId) {
  // Delete plaid item (cascades to accounts)
  const stmt = db.prepare('DELETE FROM plaid_items WHERE item_id = ?');
  stmt.run(itemId);

  // Delete related transactions
  const deleteTransactions = db.prepare(`
    DELETE FROM transactions WHERE account_name IN (
      SELECT name FROM accounts WHERE item_id = ?
    )
  `);
  deleteTransactions.run(itemId);
}

export function updatePlaidItemLastSynced(itemId) {
  const stmt = db.prepare(`
    UPDATE plaid_items SET last_synced = datetime('now') WHERE item_id = ?
  `);
  stmt.run(itemId);
}

// ============================================================================
// ACCOUNTS
// ============================================================================

export function getAccounts() {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY institution_name, name').all();
  return accounts;
}

export function saveAccount(account, institutionName) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO accounts (
      account_id, item_id, institution_name, name, type, subtype, mask,
      current_balance, available_balance, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  stmt.run(
    account.account_id,
    account.item_id,
    institutionName,
    account.name,
    account.type,
    account.subtype || '',
    account.mask || '',
    account.balances.current || 0,
    account.balances.available || 0
  );
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

export function getTransactions(limit = 50, filters = {}) {
  let sql = 'SELECT * FROM transactions WHERE 1=1';
  const params = [];

  if (filters.category) {
    sql += ' AND category = ?';
    params.push(filters.category);
  }

  if (filters.account) {
    sql += ' AND account_name = ?';
    params.push(filters.account);
  }

  if (filters.startDate) {
    sql += ' AND date >= ?';
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    sql += ' AND date <= ?';
    params.push(filters.endDate);
  }

  sql += ' ORDER BY date DESC LIMIT ?';
  params.push(limit);

  const transactions = db.prepare(sql).all(...params);
  return transactions.map(tx => ({
    ...tx,
    amount: parseFloat(tx.amount),
    confidence: parseInt(tx.confidence) || 0,
    verified: tx.verified === 'Yes'
  }));
}

export function saveTransactions(transactions, categorizationData) {
  if (transactions.length === 0) return 0;

  // Get categorization data if not provided
  if (!categorizationData) {
    categorizationData = {
      merchantMappings: getMerchantMappings(),
      categoryRules: getEnabledCategoryRules(),
      plaidMappings: getPlaidCategoryMappings()
    };
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO transactions (
      transaction_id, date, description, merchant_name, account_name,
      amount, category, confidence, verified, pending, payment_channel, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  let inserted = 0;
  const insertMany = db.transaction((txns) => {
    for (const tx of txns) {
      // Auto-categorize if not already categorized
      let category = tx.category || '';
      let confidence = tx.confidence || 0;

      if (!category) {
        const result = autoCategorizeTransaction(tx, categorizationData, true);
        category = result.category;
        confidence = result.confidence;
      }

      const info = stmt.run(
        tx.transaction_id,
        tx.date,
        tx.name,
        tx.merchant_name || '',
        tx.account_name,
        tx.amount,
        category,
        confidence,
        'No',
        tx.pending ? 'Yes' : 'No',
        tx.payment_channel || '',
        ''
      );

      if (info.changes > 0) inserted++;
    }
  });

  insertMany(transactions);
  return inserted;
}

// ============================================================================
// AUTO-CATEGORIZATION
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
 * Check if two strings are fuzzy matches
 */
function isFuzzyMatch(str1, str2, threshold = 0.8) {
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  const similarity = 1 - (distance / maxLength);
  return similarity >= threshold;
}

/**
 * Map Plaid's category to default categories
 */
function mapPlaidCategoryToDefault(plaidCategory) {
  const cat = plaidCategory.toLowerCase();

  if (cat.includes('restaurant') || cat.includes('food') || cat.includes('coffee')) {
    return 'Restaurants';
  }
  if (cat.includes('groceries') || cat.includes('supermarket')) {
    return 'Groceries';
  }
  if (cat.includes('gas') || cat.includes('fuel')) {
    return 'Gas';
  }
  if (cat.includes('transport') || cat.includes('taxi') || cat.includes('uber')) {
    return 'Transportation';
  }
  if (cat.includes('shop') || cat.includes('retail')) {
    return 'Shopping';
  }
  if (cat.includes('entertainment') || cat.includes('recreation')) {
    return 'Entertainment';
  }
  if (cat.includes('travel') || cat.includes('hotel') || cat.includes('airfare')) {
    return 'Travel';
  }
  if (cat.includes('healthcare') || cat.includes('medical')) {
    return 'Healthcare';
  }
  if (cat.includes('utility') || cat.includes('utilities')) {
    return 'Bills & Utilities';
  }
  if (cat.includes('income') || cat.includes('paycheck')) {
    return 'Income';
  }
  if (cat.includes('transfer')) {
    return 'Transfer';
  }

  return 'Other';
}

/**
 * Auto-categorize a transaction
 */
function autoCategorizeTransaction(transaction, categorizationData, skipSavingMappings = false) {
  try {
    const merchantName = transaction.merchant_name || transaction.name || '';
    const description = transaction.name || '';

    const { merchantMappings, categoryRules, plaidMappings } = categorizationData;

    // STEP 1: Exact merchant lookup - 95% confidence
    const exactMatch = merchantMappings.find(
      m => m.merchant_name.toLowerCase() === merchantName.toLowerCase()
    );
    if (exactMatch) {
      if (!skipSavingMappings) {
        saveMerchantMapping(merchantName, exactMatch.category);
      }
      return { category: exactMatch.category, confidence: 95 };
    }

    // STEP 2: Pattern matching (regex rules) - 85% confidence
    for (const rule of categoryRules) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(merchantName) || regex.test(description)) {
          if (merchantName && !skipSavingMappings) {
            saveMerchantMapping(merchantName, rule.category);
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
          if (!skipSavingMappings) {
            saveMerchantMapping(merchantName, mapping.category);
          }
          return { category: mapping.category, confidence: 75 };
        }
      }
    }

    // STEP 4: Plaid category mapping - 70% confidence
    if (transaction.category && transaction.category.length > 0) {
      for (let i = transaction.category.length - 1; i >= 0; i--) {
        const plaidCat = transaction.category[i];
        const mapping = plaidMappings.find(m => m.plaid_category === plaidCat);
        if (mapping) {
          return { category: mapping.user_category, confidence: 70 };
        }
      }

      // Auto-create mapping - 50% confidence
      if (!skipSavingMappings) {
        const plaidCategory = transaction.category[transaction.category.length - 1];
        const suggestedCategory = mapPlaidCategoryToDefault(plaidCategory);
        if (suggestedCategory) {
          savePlaidCategoryMapping(plaidCategory, suggestedCategory);
          return { category: suggestedCategory, confidence: 50 };
        }
      }
    }

    // STEP 5: Check personal_finance_category - 70% / 50% confidence
    if (transaction.personal_finance_category) {
      const pfc = transaction.personal_finance_category;
      const pfcString = pfc.detailed || pfc.primary;

      const mapping = plaidMappings.find(m => m.plaid_category === pfcString);
      if (mapping) {
        return { category: mapping.user_category, confidence: 70 };
      }

      if (!skipSavingMappings) {
        const suggestedCategory = mapPlaidCategoryToDefault(pfcString);
        if (suggestedCategory) {
          savePlaidCategoryMapping(pfcString, suggestedCategory);
          return { category: suggestedCategory, confidence: 50 };
        }
      }
    }

    return { category: '', confidence: 0 };
  } catch (error) {
    console.error('Error in autoCategorizeTransaction:', error.message);
    return { category: '', confidence: 0 };
  }
}

export function updateTransactionCategory(transactionId, category) {
  const stmt = db.prepare(`
    UPDATE transactions
    SET category = ?, confidence = 100, verified = 'Yes'
    WHERE transaction_id = ?
  `);
  stmt.run(category, transactionId);
}

export function verifyTransactionCategory(transactionId) {
  const stmt = db.prepare(`
    UPDATE transactions
    SET confidence = 100, verified = 'Yes'
    WHERE transaction_id = ?
  `);
  stmt.run(transactionId);

  const tx = db.prepare('SELECT category FROM transactions WHERE transaction_id = ?').get(transactionId);
  return { success: true, category: tx.category };
}

export function recategorizeExistingTransactions(onlyUncategorized = true) {
  const rows = db.prepare('SELECT * FROM transactions').all();

  const categorizationData = {
    merchantMappings: getMerchantMappings(),
    categoryRules: getEnabledCategoryRules(),
    plaidMappings: getPlaidCategoryMappings()
  };

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  const batchUpdates = [];

  for (const row of rows) {
    // Skip verified transactions
    if (row.verified === 'Yes') {
      skipped++;
      continue;
    }

    // Skip if onlyUncategorized and it already has a category
    if (onlyUncategorized && row.category) {
      skipped++;
      continue;
    }

    processed++;

    // Build transaction object
    const transaction = {
      transaction_id: row.transaction_id,
      date: row.date,
      name: row.description,
      merchant_name: row.merchant_name,
      account_id: row.account_name,
      amount: row.amount,
      category: [],
      personal_finance_category: null
    };

    const { category, confidence } = autoCategorizeTransaction(transaction, categorizationData, true);

    if (category && category !== row.category) {
      batchUpdates.push({
        transaction_id: row.transaction_id,
        category,
        confidence
      });
    }
  }

  // Batch update
  if (batchUpdates.length > 0) {
    const updateStmt = db.prepare(`
      UPDATE transactions
      SET category = ?, confidence = ?, verified = 'No'
      WHERE transaction_id = ?
    `);

    const batchUpdate = db.transaction((updates) => {
      for (const update of updates) {
        updateStmt.run(update.category, update.confidence, update.transaction_id);
      }
    });

    batchUpdate(batchUpdates);
    updated = batchUpdates.length;
  }

  return {
    success: true,
    total: rows.length,
    processed,
    updated,
    skipped
  };
}

export function getTransactionStats(startDate = null, endDate = null) {
  let sql = `
    SELECT
      category,
      SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as total
    FROM transactions
    WHERE category IS NOT NULL AND category != ''
  `;
  const params = [];

  if (startDate) {
    sql += ' AND date >= ?';
    params.push(startDate);
  }

  if (endDate) {
    sql += ' AND date <= ?';
    params.push(endDate);
  }

  sql += ' GROUP BY category ORDER BY total DESC';

  const results = db.prepare(sql).all(...params);
  return results.map(r => ({
    category: r.category,
    total: parseFloat(r.total)
  }));
}

// ============================================================================
// CATEGORIES
// ============================================================================

export function getCategories() {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  // Deduplicate by name (case-insensitive)
  const seen = new Map();
  const unique = [];

  for (const cat of categories) {
    const lowerName = cat.name.toLowerCase();
    if (!seen.has(lowerName)) {
      seen.set(lowerName, true);
      unique.push(cat);
    }
  }

  return unique;
}

export function addCategory(name, parentCategory = null) {
  const stmt = db.prepare(`
    INSERT INTO categories (name, parent_category) VALUES (?, ?)
  `);

  try {
    stmt.run(name, parentCategory || '');
    return { success: true, name, parent_category: parentCategory };
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      throw new Error('Category already exists');
    }
    throw error;
  }
}

export function getCategorySpending(startDate = null, endDate = null) {
  let sql = `
    SELECT
      c.name,
      c.parent_category,
      COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0) as total
    FROM categories c
    LEFT JOIN transactions t ON c.name = t.category
  `;
  const params = [];

  if (startDate || endDate) {
    sql += ' WHERE 1=1';
    if (startDate) {
      sql += ' AND t.date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND t.date <= ?';
      params.push(endDate);
    }
  }

  sql += ' GROUP BY c.name, c.parent_category ORDER BY total DESC';

  const results = db.prepare(sql).all(...params);
  return results.map(r => ({
    name: r.name,
    parent_category: r.parent_category,
    total: parseFloat(r.total)
  }));
}

// ============================================================================
// MAPPINGS & RULES
// ============================================================================

export function getPlaidCategoryMappings() {
  return db.prepare('SELECT * FROM plaid_category_mappings').all();
}

export function getMerchantMappings() {
  return db.prepare('SELECT * FROM merchant_mappings ORDER BY last_used DESC').all();
}

export function getCategoryRules() {
  return db.prepare('SELECT * FROM category_rules').all();
}

export function getEnabledCategoryRules() {
  return db.prepare('SELECT * FROM category_rules WHERE enabled = "Yes"').all();
}

export function saveMerchantMapping(merchantName, category) {
  const stmt = db.prepare(`
    INSERT INTO merchant_mappings (merchant_name, category, match_count, last_used)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(merchant_name) DO UPDATE SET
      category = excluded.category,
      match_count = match_count + 1,
      last_used = datetime('now')
  `);
  stmt.run(merchantName, category);
}

export function savePlaidCategoryMapping(plaidCategory, userCategory) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO plaid_category_mappings (plaid_category, user_category, auto_created)
    VALUES (?, ?, 'Yes')
  `);
  stmt.run(plaidCategory, userCategory);
}

// ============================================================================
// CONFIG
// ============================================================================

export function getConfig(key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setConfig(key, value) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)
  `);
  stmt.run(key, value);
}

export function deleteConfig(key) {
  const stmt = db.prepare('DELETE FROM config WHERE key = ?');
  stmt.run(key);
}
