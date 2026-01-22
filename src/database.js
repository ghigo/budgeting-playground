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
    console.error('Stack trace:', error.stack);
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
      parent_category TEXT,
      icon TEXT DEFAULT '📁',
      color TEXT DEFAULT '#6B7280'
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

    -- Amazon Orders
    CREATE TABLE IF NOT EXISTS amazon_orders (
      order_id TEXT PRIMARY KEY,
      order_date TEXT NOT NULL,
      total_amount REAL NOT NULL,
      subtotal REAL,
      tax REAL,
      shipping REAL,
      payment_method TEXT,
      shipping_address TEXT,
      order_status TEXT,
      matched_transaction_id TEXT,
      match_confidence INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (matched_transaction_id) REFERENCES transactions(transaction_id) ON DELETE SET NULL
    );

    -- Amazon Items (individual products within orders)
    CREATE TABLE IF NOT EXISTS amazon_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      asin TEXT,
      title TEXT NOT NULL,
      category TEXT,
      price REAL NOT NULL,
      quantity INTEGER DEFAULT 1,
      seller TEXT,
      product_url TEXT,
      image_url TEXT,
      return_status TEXT,
      return_date TEXT,
      refund_amount REAL,
      FOREIGN KEY (order_id) REFERENCES amazon_orders(order_id) ON DELETE CASCADE
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
    CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_name);
    CREATE INDEX IF NOT EXISTS idx_transactions_id ON transactions(transaction_id);
    -- Composite indexes for common query patterns (date range + filters)
    CREATE INDEX IF NOT EXISTS idx_transactions_date_category ON transactions(date, category);
    CREATE INDEX IF NOT EXISTS idx_transactions_date_account ON transactions(date, account_name);
    CREATE INDEX IF NOT EXISTS idx_accounts_item_id ON accounts(item_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name);
    CREATE INDEX IF NOT EXISTS idx_amazon_orders_date ON amazon_orders(order_date);
    CREATE INDEX IF NOT EXISTS idx_amazon_orders_matched ON amazon_orders(matched_transaction_id);
    CREATE INDEX IF NOT EXISTS idx_amazon_items_order ON amazon_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_amazon_items_category ON amazon_items(category);
    -- Note: idx_amazon_items_user_category is created later in migrations after column is added
    -- Additional performance indexes
    CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_name);
    CREATE INDEX IF NOT EXISTS idx_amazon_items_asin ON amazon_items(asin);
    CREATE INDEX IF NOT EXISTS idx_transactions_confidence ON transactions(confidence);
    -- Compound index for common transaction queries
    CREATE INDEX IF NOT EXISTS idx_transactions_date_desc ON transactions(date DESC);
    CREATE INDEX IF NOT EXISTS idx_accounts_name_lookup ON accounts(name);
  `);

  // Run migrations to add new columns to existing tables
  runMigrations();

  // Seed default data if tables are empty
  seedDefaultData();
}

/**
 * Run database migrations
 */
function runMigrations() {
  // Check if icon and color columns exist in categories table
  const tableInfo = db.prepare("PRAGMA table_info(categories)").all();
  const hasIcon = tableInfo.some(col => col.name === 'icon');
  const hasColor = tableInfo.some(col => col.name === 'color');
  const hasDescription = tableInfo.some(col => col.name === 'description');
  const hasKeywords = tableInfo.some(col => col.name === 'keywords');
  const hasExamples = tableInfo.some(col => col.name === 'examples');
  const hasUseForAmazon = tableInfo.some(col => col.name === 'use_for_amazon');

  let columnsAdded = false;

  if (!hasIcon) {
    console.log('Adding icon column to categories table...');
    db.exec("ALTER TABLE categories ADD COLUMN icon TEXT DEFAULT '📁'");
    columnsAdded = true;
  }

  if (!hasColor) {
    console.log('Adding color column to categories table...');
    db.exec("ALTER TABLE categories ADD COLUMN color TEXT DEFAULT '#6B7280'");
    columnsAdded = true;
  }

  if (!hasDescription) {
    console.log('Adding description column to categories table...');
    db.exec("ALTER TABLE categories ADD COLUMN description TEXT");
    columnsAdded = true;
  }

  if (!hasKeywords) {
    console.log('Adding keywords column to categories table...');
    db.exec("ALTER TABLE categories ADD COLUMN keywords TEXT");  // JSON array
    columnsAdded = true;
  }

  if (!hasExamples) {
    console.log('Adding examples column to categories table...');
    db.exec("ALTER TABLE categories ADD COLUMN examples TEXT");
    columnsAdded = true;
  }

  if (!hasUseForAmazon) {
    console.log('Adding use_for_amazon column to categories table...');
    db.exec("ALTER TABLE categories ADD COLUMN use_for_amazon INTEGER DEFAULT 1");
    columnsAdded = true;
  }

  // Check if enhanced Plaid fields exist in transactions table
  const transactionsInfo = db.prepare("PRAGMA table_info(transactions)").all();
  const hasPlaidPrimaryCategory = transactionsInfo.some(col => col.name === 'plaid_primary_category');
  const hasPlaidDetailedCategory = transactionsInfo.some(col => col.name === 'plaid_detailed_category');
  const hasPlaidConfidence = transactionsInfo.some(col => col.name === 'plaid_confidence_level');
  const hasLocationCity = transactionsInfo.some(col => col.name === 'location_city');
  const hasLocationRegion = transactionsInfo.some(col => col.name === 'location_region');
  const hasLocationAddress = transactionsInfo.some(col => col.name === 'location_address');
  const hasTransactionType = transactionsInfo.some(col => col.name === 'transaction_type');
  const hasAuthorizedDatetime = transactionsInfo.some(col => col.name === 'authorized_datetime');
  const hasMerchantEntityId = transactionsInfo.some(col => col.name === 'merchant_entity_id');
  const hasCategorizationReasoning = transactionsInfo.some(col => col.name === 'categorization_reasoning');

  if (!hasPlaidPrimaryCategory) {
    console.log('Adding Plaid enhanced category fields to transactions table...');
    db.exec("ALTER TABLE transactions ADD COLUMN plaid_primary_category TEXT");
    columnsAdded = true;
  }

  if (!hasPlaidDetailedCategory) {
    db.exec("ALTER TABLE transactions ADD COLUMN plaid_detailed_category TEXT");
    columnsAdded = true;
  }

  if (!hasPlaidConfidence) {
    db.exec("ALTER TABLE transactions ADD COLUMN plaid_confidence_level TEXT");
    columnsAdded = true;
  }

  if (!hasLocationCity) {
    console.log('Adding location fields to transactions table...');
    db.exec("ALTER TABLE transactions ADD COLUMN location_city TEXT");
    columnsAdded = true;
  }

  if (!hasLocationRegion) {
    db.exec("ALTER TABLE transactions ADD COLUMN location_region TEXT");
    columnsAdded = true;
  }

  if (!hasLocationAddress) {
    db.exec("ALTER TABLE transactions ADD COLUMN location_address TEXT");
    columnsAdded = true;
  }

  if (!hasTransactionType) {
    console.log('Adding transaction metadata fields...');
    db.exec("ALTER TABLE transactions ADD COLUMN transaction_type TEXT");
    columnsAdded = true;
  }

  if (!hasAuthorizedDatetime) {
    db.exec("ALTER TABLE transactions ADD COLUMN authorized_datetime TEXT");
    columnsAdded = true;
  }

  if (!hasMerchantEntityId) {
    db.exec("ALTER TABLE transactions ADD COLUMN merchant_entity_id TEXT");
    columnsAdded = true;
  }

  if (!hasCategorizationReasoning) {
    console.log('Adding AI categorization reasoning field...');
    db.exec("ALTER TABLE transactions ADD COLUMN categorization_reasoning TEXT");
    columnsAdded = true;
  }

  // Create transaction_splits table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS transaction_splits (
      id TEXT PRIMARY KEY,
      parent_transaction_id TEXT NOT NULL,
      split_index INTEGER NOT NULL,
      amount REAL NOT NULL,
      category TEXT,
      description TEXT,
      reasoning TEXT,
      source TEXT DEFAULT 'manual',
      created_at TEXT NOT NULL,
      FOREIGN KEY (parent_transaction_id) REFERENCES transactions(transaction_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_transaction_splits_parent ON transaction_splits(parent_transaction_id);
  `);

  // Add external category tracking fields to transactions table
  const hasExternalCategory = transactionsInfo.some(col => col.name === 'external_category');
  const hasCategorySource = transactionsInfo.some(col => col.name === 'category_source');

  if (!hasExternalCategory) {
    console.log('Adding external category tracking fields to transactions table...');
    db.exec("ALTER TABLE transactions ADD COLUMN external_category TEXT");
    columnsAdded = true;
  }

  if (!hasCategorySource) {
    db.exec("ALTER TABLE transactions ADD COLUMN category_source TEXT");
    columnsAdded = true;
  }

  // Create external_category_mappings table for all external category sources
  db.exec(`
    CREATE TABLE IF NOT EXISTS external_category_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_category TEXT NOT NULL,
      source TEXT NOT NULL,
      user_category TEXT,
      confidence INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(external_category, source)
    );

    CREATE INDEX IF NOT EXISTS idx_external_mappings_source ON external_category_mappings(source);
    CREATE INDEX IF NOT EXISTS idx_external_mappings_status ON external_category_mappings(status);
  `);

  // Check if account_name column exists in amazon_orders table
  const amazonOrdersInfo = db.prepare("PRAGMA table_info(amazon_orders)").all();
  const hasAccountName = amazonOrdersInfo.some(col => col.name === 'account_name');
  const hasMatchVerified = amazonOrdersInfo.some(col => col.name === 'match_verified');

  if (!hasAccountName) {
    console.log('Adding account_name column to amazon_orders table...');
    db.exec("ALTER TABLE amazon_orders ADD COLUMN account_name TEXT DEFAULT 'Primary'");
    columnsAdded = true;
  }

  if (!hasMatchVerified) {
    console.log('Adding match_verified column to amazon_orders table...');
    db.exec("ALTER TABLE amazon_orders ADD COLUMN match_verified TEXT DEFAULT 'No'");
    columnsAdded = true;
  }

  // Update merchant_mappings table to track accuracy
  const merchantMappingsInfo = db.prepare("PRAGMA table_info(merchant_mappings)").all();
  const hasUsageCount = merchantMappingsInfo.some(col => col.name === 'usage_count');
  const hasAccuracyRate = merchantMappingsInfo.some(col => col.name === 'accuracy_rate');

  // Rename match_count to usage_count if needed
  if (!hasUsageCount) {
    const hasMatchCount = merchantMappingsInfo.some(col => col.name === 'match_count');
    if (hasMatchCount) {
      console.log('Renaming match_count to usage_count in merchant_mappings...');
      // SQLite doesn't support renaming columns easily, so we'll just add the new one
      db.exec("ALTER TABLE merchant_mappings ADD COLUMN usage_count INTEGER DEFAULT 1");
      // Copy data if both exist
      try {
        db.exec("UPDATE merchant_mappings SET usage_count = match_count WHERE usage_count IS NULL");
      } catch (e) {
        // Ignore if match_count doesn't exist
      }
      columnsAdded = true;
    } else {
      db.exec("ALTER TABLE merchant_mappings ADD COLUMN usage_count INTEGER DEFAULT 1");
      columnsAdded = true;
    }
  }

  if (!hasAccuracyRate) {
    console.log('Adding accuracy tracking to merchant_mappings...');
    db.exec("ALTER TABLE merchant_mappings ADD COLUMN accuracy_rate REAL DEFAULT 1.0");
    db.exec("ALTER TABLE merchant_mappings ADD COLUMN correct_count INTEGER DEFAULT 0");
    db.exec("ALTER TABLE merchant_mappings ADD COLUMN incorrect_count INTEGER DEFAULT 0");
    db.exec("ALTER TABLE merchant_mappings ADD COLUMN updated_at TEXT");
    // Update existing rows to set current timestamp
    db.exec("UPDATE merchant_mappings SET updated_at = datetime('now') WHERE updated_at IS NULL");
    columnsAdded = true;
  }

  // Add comprehensive Amazon CSV fields to amazon_orders table
  const hasWebsite = amazonOrdersInfo.some(col => col.name === 'website');
  const hasPurchaseOrderNumber = amazonOrdersInfo.some(col => col.name === 'purchase_order_number');
  const hasCurrency = amazonOrdersInfo.some(col => col.name === 'currency');
  const hasTotalDiscounts = amazonOrdersInfo.some(col => col.name === 'total_discounts');
  const hasBillingAddress = amazonOrdersInfo.some(col => col.name === 'billing_address');
  const hasShipDate = amazonOrdersInfo.some(col => col.name === 'ship_date');
  const hasShippingOption = amazonOrdersInfo.some(col => col.name === 'shipping_option');

  if (!hasWebsite || !hasPurchaseOrderNumber || !hasCurrency || !hasTotalDiscounts ||
      !hasBillingAddress || !hasShipDate || !hasShippingOption) {
    console.log('Adding comprehensive CSV fields to amazon_orders table...');

    if (!hasWebsite) {
      db.exec("ALTER TABLE amazon_orders ADD COLUMN website TEXT");
    }
    if (!hasPurchaseOrderNumber) {
      db.exec("ALTER TABLE amazon_orders ADD COLUMN purchase_order_number TEXT");
    }
    if (!hasCurrency) {
      db.exec("ALTER TABLE amazon_orders ADD COLUMN currency TEXT");
    }
    if (!hasTotalDiscounts) {
      db.exec("ALTER TABLE amazon_orders ADD COLUMN total_discounts REAL");
    }
    if (!hasBillingAddress) {
      db.exec("ALTER TABLE amazon_orders ADD COLUMN billing_address TEXT");
    }
    if (!hasShipDate) {
      db.exec("ALTER TABLE amazon_orders ADD COLUMN ship_date TEXT");
    }
    if (!hasShippingOption) {
      db.exec("ALTER TABLE amazon_orders ADD COLUMN shipping_option TEXT");
    }

    columnsAdded = true;
  }

  // Add comprehensive Amazon CSV fields to amazon_items table
  const amazonItemsInfo = db.prepare("PRAGMA table_info(amazon_items)").all();
  const hasProductCondition = amazonItemsInfo.some(col => col.name === 'product_condition');
  const hasUnitPriceTax = amazonItemsInfo.some(col => col.name === 'unit_price_tax');
  const hasShipmentSubtotal = amazonItemsInfo.some(col => col.name === 'shipment_item_subtotal');
  const hasShipmentSubtotalTax = amazonItemsInfo.some(col => col.name === 'shipment_item_subtotal_tax');
  const hasShipmentStatus = amazonItemsInfo.some(col => col.name === 'shipment_status');
  const hasItemShipDate = amazonItemsInfo.some(col => col.name === 'ship_date');
  const hasCarrierTracking = amazonItemsInfo.some(col => col.name === 'carrier_tracking');
  const hasGiftMessage = amazonItemsInfo.some(col => col.name === 'gift_message');
  const hasGiftSenderName = amazonItemsInfo.some(col => col.name === 'gift_sender_name');
  const hasGiftRecipientContact = amazonItemsInfo.some(col => col.name === 'gift_recipient_contact');
  const hasItemSerialNumber = amazonItemsInfo.some(col => col.name === 'item_serial_number');

  if (!hasProductCondition || !hasUnitPriceTax || !hasShipmentSubtotal || !hasShipmentSubtotalTax ||
      !hasShipmentStatus || !hasItemShipDate || !hasCarrierTracking || !hasGiftMessage ||
      !hasGiftSenderName || !hasGiftRecipientContact || !hasItemSerialNumber) {
    console.log('Adding comprehensive CSV fields to amazon_items table...');

    if (!hasProductCondition) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN product_condition TEXT");
    }
    if (!hasUnitPriceTax) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN unit_price_tax REAL");
    }
    if (!hasShipmentSubtotal) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN shipment_item_subtotal REAL");
    }
    if (!hasShipmentSubtotalTax) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN shipment_item_subtotal_tax REAL");
    }
    if (!hasShipmentStatus) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN shipment_status TEXT");
    }
    if (!hasItemShipDate) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN ship_date TEXT");
    }
    if (!hasCarrierTracking) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN carrier_tracking TEXT");
    }
    if (!hasGiftMessage) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN gift_message TEXT");
    }
    if (!hasGiftSenderName) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN gift_sender_name TEXT");
    }
    if (!hasGiftRecipientContact) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN gift_recipient_contact TEXT");
    }
    if (!hasItemSerialNumber) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN item_serial_number TEXT");
    }

    columnsAdded = true;
  }

  // Add user categorization fields to amazon_items table
  const hasUserCategory = amazonItemsInfo.some(col => col.name === 'user_category');
  const hasItemConfidence = amazonItemsInfo.some(col => col.name === 'confidence');
  const hasItemVerified = amazonItemsInfo.some(col => col.name === 'verified');
  const hasItemReasoning = amazonItemsInfo.some(col => col.name === 'categorization_reasoning');

  if (!hasUserCategory || !hasItemConfidence || !hasItemVerified || !hasItemReasoning) {
    console.log('Adding user categorization fields to amazon_items table...');

    if (!hasUserCategory) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN user_category TEXT");
      // Create index for user_category now that column exists
      db.exec("CREATE INDEX IF NOT EXISTS idx_amazon_items_user_category ON amazon_items(user_category)");
    }
    if (!hasItemConfidence) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN confidence INTEGER DEFAULT 0");
    }
    if (!hasItemVerified) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN verified TEXT DEFAULT 'No'");
    }
    if (!hasItemReasoning) {
      db.exec("ALTER TABLE amazon_items ADD COLUMN categorization_reasoning TEXT");
    }

    columnsAdded = true;
  }

  // Create amazon_item_rules table for learned categorization patterns
  db.exec(`
    CREATE TABLE IF NOT EXISTS amazon_item_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      pattern TEXT NOT NULL,
      category TEXT NOT NULL,
      enabled TEXT DEFAULT 'Yes',
      match_type TEXT DEFAULT 'partial',
      rule_source TEXT DEFAULT 'user',
      asin TEXT,
      amazon_category TEXT,
      usage_count INTEGER DEFAULT 0,
      correct_count INTEGER DEFAULT 0,
      incorrect_count INTEGER DEFAULT 0,
      accuracy_rate REAL DEFAULT 1.0,
      last_used TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_amazon_item_rules_category ON amazon_item_rules(category);
    CREATE INDEX IF NOT EXISTS idx_amazon_item_rules_enabled ON amazon_item_rules(enabled);
    CREATE INDEX IF NOT EXISTS idx_amazon_item_rules_asin ON amazon_item_rules(asin);
  `);

  // Check if match_type and user_created columns exist in category_rules table
  const categoryRulesInfo = db.prepare("PRAGMA table_info(category_rules)").all();
  const hasMatchType = categoryRulesInfo.some(col => col.name === 'match_type');
  const hasUserCreated = categoryRulesInfo.some(col => col.name === 'user_created');

  if (!hasMatchType) {
    console.log('Adding match_type column to category_rules table...');
    db.exec("ALTER TABLE category_rules ADD COLUMN match_type TEXT DEFAULT 'regex'");
    columnsAdded = true;
  }

  if (!hasUserCreated) {
    console.log('Adding user_created column to category_rules table...');
    db.exec("ALTER TABLE category_rules ADD COLUMN user_created TEXT DEFAULT 'No'");
    columnsAdded = true;
  }

  // Update existing categories with default values to have appropriate icons and colors
  const categoriesToUpdate = db.prepare(`
    SELECT name FROM categories
    WHERE (icon = '📁' OR icon IS NULL OR icon = '')
    OR (color = '#6B7280' OR color IS NULL OR color = '')
  `).all();

  if (categoriesToUpdate.length > 0) {
    console.log(`Applying icons and colors to ${categoriesToUpdate.length} existing categories...`);

    const palette = getCategoryColorPalette();
    const updateStmt = db.prepare('UPDATE categories SET icon = ?, color = ? WHERE name = ?');

    const transaction = db.transaction(() => {
      categoriesToUpdate.forEach((cat, index) => {
        const icon = suggestIconForCategory(cat.name);
        const color = palette[index % palette.length];
        updateStmt.run(icon, color, cat.name);
        console.log(`  ✓ ${cat.name}: ${icon} ${color}`);
      });
    });

    transaction();
  }

  // Create AI categorization tracking tables
  db.exec(`
    -- AI Categorizations (track all categorization attempts with detailed metadata)
    CREATE TABLE IF NOT EXISTS ai_categorizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      category TEXT NOT NULL,
      confidence REAL NOT NULL,
      method TEXT NOT NULL,
      alternatives TEXT,
      reasoning TEXT,
      user_confirmed TEXT DEFAULT 'No',
      created_at TEXT NOT NULL,
      UNIQUE(item_id, item_type, created_at)
    );

    CREATE INDEX IF NOT EXISTS idx_ai_categorizations_item ON ai_categorizations(item_id, item_type);
    CREATE INDEX IF NOT EXISTS idx_ai_categorizations_method ON ai_categorizations(method);
    CREATE INDEX IF NOT EXISTS idx_ai_categorizations_confidence ON ai_categorizations(confidence);

    -- AI Feedback (track user corrections for learning)
    CREATE TABLE IF NOT EXISTS ai_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      suggested_category TEXT NOT NULL,
      actual_category TEXT NOT NULL,
      suggestion_method TEXT,
      suggestion_confidence REAL,
      processed TEXT DEFAULT 'No',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_feedback_item ON ai_feedback(item_id, item_type);
    CREATE INDEX IF NOT EXISTS idx_ai_feedback_processed ON ai_feedback(processed);
    CREATE INDEX IF NOT EXISTS idx_ai_feedback_created ON ai_feedback(created_at);

    -- AI Training History (track retraining runs)
    CREATE TABLE IF NOT EXISTS ai_training_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      feedback_count INTEGER NOT NULL,
      rules_generated INTEGER DEFAULT 0,
      embeddings_updated INTEGER DEFAULT 0,
      duration_ms INTEGER,
      trigger_type TEXT,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ai_training_timestamp ON ai_training_history(timestamp);

    -- AI Embeddings (store embeddings for semantic similarity search)
    CREATE TABLE IF NOT EXISTS ai_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      embedding_text TEXT NOT NULL,
      embedding_vector TEXT NOT NULL,
      category TEXT NOT NULL,
      user_confirmed TEXT DEFAULT 'No',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(item_id, item_type)
    );

    CREATE INDEX IF NOT EXISTS idx_ai_embeddings_item ON ai_embeddings(item_id, item_type);
    CREATE INDEX IF NOT EXISTS idx_ai_embeddings_category ON ai_embeddings(category);
    CREATE INDEX IF NOT EXISTS idx_ai_embeddings_confirmed ON ai_embeddings(user_confirmed);

    -- AI Metrics (track categorization performance over time)
    CREATE TABLE IF NOT EXISTS ai_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      item_type TEXT NOT NULL,
      total_categorizations INTEGER DEFAULT 0,
      correct_categorizations INTEGER DEFAULT 0,
      accuracy_rate REAL DEFAULT 0.0,
      avg_confidence REAL DEFAULT 0.0,
      method_breakdown TEXT,
      confidence_breakdown TEXT,
      UNIQUE(date, item_type)
    );

    CREATE INDEX IF NOT EXISTS idx_ai_metrics_date ON ai_metrics(date);
  `);

  // Enhance category_rules table with additional AI learning fields
  const aiCategoryRulesInfo = db.prepare("PRAGMA table_info(category_rules)").all();
  const hasConfidenceOverride = aiCategoryRulesInfo.some(col => col.name === 'confidence_override');
  const hasAutoGenerated = aiCategoryRulesInfo.some(col => col.name === 'auto_generated');
  const hasRuleSource = aiCategoryRulesInfo.some(col => col.name === 'rule_source');
  const hasCreatedAt = aiCategoryRulesInfo.some(col => col.name === 'created_at');
  const hasUpdatedAt = aiCategoryRulesInfo.some(col => col.name === 'updated_at');

  if (!hasConfidenceOverride) {
    console.log('Adding AI learning fields to category_rules table...');
    db.exec("ALTER TABLE category_rules ADD COLUMN confidence_override REAL");
  }
  if (!hasAutoGenerated) {
    db.exec("ALTER TABLE category_rules ADD COLUMN auto_generated TEXT DEFAULT 'No'");
  }
  if (!hasRuleSource) {
    db.exec("ALTER TABLE category_rules ADD COLUMN rule_source TEXT DEFAULT 'user'");
  }
  if (!hasCreatedAt) {
    db.exec("ALTER TABLE category_rules ADD COLUMN created_at TEXT");
    db.exec("UPDATE category_rules SET created_at = datetime('now') WHERE created_at IS NULL");
  }
  if (!hasUpdatedAt) {
    db.exec("ALTER TABLE category_rules ADD COLUMN updated_at TEXT");
    db.exec("UPDATE category_rules SET updated_at = datetime('now') WHERE updated_at IS NULL");
  }

  // ====================================================================
  // CATEGORY NORMALIZATION MIGRATION
  // Migrate from storing category names (TEXT) to category IDs (INTEGER FK)
  // This ensures category renames propagate to all items
  // ====================================================================

  console.log('Checking category normalization migration...');

  // Helper function to get or create category by name
  const getOrCreateCategoryId = (categoryName) => {
    if (!categoryName || categoryName.trim() === '') {
      return null;
    }

    const trimmedName = categoryName.trim();

    // Try to find existing category
    let category = db.prepare('SELECT id FROM categories WHERE name = ?').get(trimmedName);

    if (!category) {
      // Create missing category with default icon/color
      console.log(`  Creating missing category: "${trimmedName}"`);
      const icon = suggestIconForCategory(trimmedName);
      const color = getNextCategoryColor();

      const result = db.prepare(
        'INSERT INTO categories (name, icon, color) VALUES (?, ?, ?)'
      ).run(trimmedName, icon, color);

      return result.lastInsertRowid;
    }

    return category.id;
  };

  // 1. TRANSACTIONS TABLE
  const transactionsHasCategoryId = transactionsInfo.some(col => col.name === 'category_id');
  if (!transactionsHasCategoryId) {
    console.log('Migrating transactions.category to category_id...');
    db.exec("ALTER TABLE transactions ADD COLUMN category_id INTEGER REFERENCES categories(id)");

    // Migrate existing data
    const transactionsToMigrate = db.prepare(
      'SELECT transaction_id, category FROM transactions WHERE category IS NOT NULL'
    ).all();

    const updateStmt = db.prepare('UPDATE transactions SET category_id = ? WHERE transaction_id = ?');
    const migrateTransaction = db.transaction(() => {
      for (const row of transactionsToMigrate) {
        const categoryId = getOrCreateCategoryId(row.category);
        if (categoryId) {
          updateStmt.run(categoryId, row.transaction_id);
        }
      }
    });
    migrateTransaction();

    console.log(`  ✓ Migrated ${transactionsToMigrate.length} transactions`);
  }

  // 2. AMAZON_ITEMS TABLE
  const amazonItemsHasCategoryId = amazonItemsInfo.some(col => col.name === 'category_id');
  const amazonItemsHasUserCategory = amazonItemsInfo.some(col => col.name === 'user_category');

  if (!amazonItemsHasCategoryId) {
    console.log('Migrating amazon_items.user_category to category_id...');
    db.exec("ALTER TABLE amazon_items ADD COLUMN category_id INTEGER REFERENCES categories(id)");

    // Only migrate existing data if user_category column exists
    if (amazonItemsHasUserCategory) {
      const itemsToMigrate = db.prepare(
        'SELECT id, user_category FROM amazon_items WHERE user_category IS NOT NULL'
      ).all();

      const updateStmt = db.prepare('UPDATE amazon_items SET category_id = ? WHERE id = ?');
      const migrateItems = db.transaction(() => {
        for (const row of itemsToMigrate) {
          const categoryId = getOrCreateCategoryId(row.user_category);
          if (categoryId) {
            updateStmt.run(categoryId, row.id);
          }
        }
      });
      migrateItems();

      console.log(`  ✓ Migrated ${itemsToMigrate.length} Amazon items`);
    } else {
      console.log(`  ✓ No Amazon items to migrate (user_category column doesn't exist yet)`);
    }
  }

  // 3. TRANSACTION_SPLITS TABLE
  const splitsInfo = db.prepare("PRAGMA table_info(transaction_splits)").all();
  const splitsHasCategoryId = splitsInfo.some(col => col.name === 'category_id');
  const splitsHasCategory = splitsInfo.some(col => col.name === 'category');

  if (!splitsHasCategoryId) {
    console.log('Migrating transaction_splits.category to category_id...');
    db.exec("ALTER TABLE transaction_splits ADD COLUMN category_id INTEGER REFERENCES categories(id)");

    // Only migrate if category column exists (table might not even exist yet)
    if (splitsHasCategory && splitsInfo.length > 0) {
      const splitsToMigrate = db.prepare(
        'SELECT id, category FROM transaction_splits WHERE category IS NOT NULL'
      ).all();

      const updateStmt = db.prepare('UPDATE transaction_splits SET category_id = ? WHERE id = ?');
      const migrateSplits = db.transaction(() => {
        for (const row of splitsToMigrate) {
          const categoryId = getOrCreateCategoryId(row.category);
          if (categoryId) {
            updateStmt.run(categoryId, row.id);
          }
        }
      });
      migrateSplits();

      console.log(`  ✓ Migrated ${splitsToMigrate.length} transaction splits`);
    } else {
      console.log(`  ✓ No transaction splits to migrate`);
    }
  }

  // 4. MERCHANT_MAPPINGS TABLE
  const merchantMappingsHasCategoryId = merchantMappingsInfo.some(col => col.name === 'category_id');
  if (!merchantMappingsHasCategoryId) {
    console.log('Migrating merchant_mappings.category to category_id...');
    db.exec("ALTER TABLE merchant_mappings ADD COLUMN category_id INTEGER REFERENCES categories(id)");

    const mappingsToMigrate = db.prepare(
      'SELECT merchant_name, category FROM merchant_mappings WHERE category IS NOT NULL'
    ).all();

    const updateStmt = db.prepare('UPDATE merchant_mappings SET category_id = ? WHERE merchant_name = ?');
    const migrateMappings = db.transaction(() => {
      for (const row of mappingsToMigrate) {
        const categoryId = getOrCreateCategoryId(row.category);
        if (categoryId) {
          updateStmt.run(categoryId, row.merchant_name);
        }
      }
    });
    migrateMappings();

    console.log(`  ✓ Migrated ${mappingsToMigrate.length} merchant mappings`);
  }

  // 5. CATEGORY_RULES TABLE
  const categoryRulesHasCategoryId = categoryRulesInfo.some(col => col.name === 'category_id');
  if (!categoryRulesHasCategoryId) {
    console.log('Migrating category_rules.category to category_id...');
    db.exec("ALTER TABLE category_rules ADD COLUMN category_id INTEGER REFERENCES categories(id)");

    const rulesToMigrate = db.prepare(
      'SELECT id, category FROM category_rules WHERE category IS NOT NULL'
    ).all();

    const updateStmt = db.prepare('UPDATE category_rules SET category_id = ? WHERE id = ?');
    const migrateRules = db.transaction(() => {
      for (const row of rulesToMigrate) {
        const categoryId = getOrCreateCategoryId(row.category);
        if (categoryId) {
          updateStmt.run(categoryId, row.id);
        }
      }
    });
    migrateRules();

    console.log(`  ✓ Migrated ${rulesToMigrate.length} category rules`);
  }

  // 6. PLAID_CATEGORY_MAPPINGS TABLE
  const plaidMappingsInfo = db.prepare("PRAGMA table_info(plaid_category_mappings)").all();
  const plaidMappingsHasCategoryId = plaidMappingsInfo.some(col => col.name === 'category_id');
  if (!plaidMappingsHasCategoryId) {
    console.log('Migrating plaid_category_mappings.user_category to category_id...');
    db.exec("ALTER TABLE plaid_category_mappings ADD COLUMN category_id INTEGER REFERENCES categories(id)");

    const mappingsToMigrate = db.prepare(
      'SELECT plaid_category, user_category FROM plaid_category_mappings WHERE user_category IS NOT NULL'
    ).all();

    const updateStmt = db.prepare('UPDATE plaid_category_mappings SET category_id = ? WHERE plaid_category = ?');
    const migrateMappings = db.transaction(() => {
      for (const row of mappingsToMigrate) {
        const categoryId = getOrCreateCategoryId(row.user_category);
        if (categoryId) {
          updateStmt.run(categoryId, row.plaid_category);
        }
      }
    });
    migrateMappings();

    console.log(`  ✓ Migrated ${mappingsToMigrate.length} Plaid category mappings`);
  }

  // 7. EXTERNAL_CATEGORY_MAPPINGS TABLE
  const externalMappingsInfo = db.prepare("PRAGMA table_info(external_category_mappings)").all();
  const externalMappingsHasCategoryId = externalMappingsInfo.some(col => col.name === 'category_id');
  if (!externalMappingsHasCategoryId) {
    console.log('Migrating external_category_mappings.user_category to category_id...');
    db.exec("ALTER TABLE external_category_mappings ADD COLUMN category_id INTEGER REFERENCES categories(id)");

    const mappingsToMigrate = db.prepare(
      'SELECT id, user_category FROM external_category_mappings WHERE user_category IS NOT NULL'
    ).all();

    const updateStmt = db.prepare('UPDATE external_category_mappings SET category_id = ? WHERE id = ?');
    const migrateMappings = db.transaction(() => {
      for (const row of mappingsToMigrate) {
        const categoryId = getOrCreateCategoryId(row.user_category);
        if (categoryId) {
          updateStmt.run(categoryId, row.id);
        }
      }
    });
    migrateMappings();

    console.log(`  ✓ Migrated ${mappingsToMigrate.length} external category mappings`);
  }

  // 8. AMAZON_ITEM_RULES TABLE
  const amazonRulesInfo = db.prepare("PRAGMA table_info(amazon_item_rules)").all();
  const amazonRulesHasCategoryId = amazonRulesInfo.some(col => col.name === 'category_id');
  if (!amazonRulesHasCategoryId) {
    console.log('Migrating amazon_item_rules.category to category_id...');
    db.exec("ALTER TABLE amazon_item_rules ADD COLUMN category_id INTEGER REFERENCES categories(id)");

    const rulesToMigrate = db.prepare(
      'SELECT id, category FROM amazon_item_rules WHERE category IS NOT NULL'
    ).all();

    const updateStmt = db.prepare('UPDATE amazon_item_rules SET category_id = ? WHERE id = ?');
    const migrateRules = db.transaction(() => {
      for (const row of rulesToMigrate) {
        const categoryId = getOrCreateCategoryId(row.category);
        if (categoryId) {
          updateStmt.run(categoryId, row.id);
        }
      }
    });
    migrateRules();

    console.log(`  ✓ Migrated ${rulesToMigrate.length} Amazon item rules`);
  }

  // 9. CATEGORIES.PARENT_CATEGORY
  const categoriesInfo = db.prepare("PRAGMA table_info(categories)").all();
  const categoriesHasParentCategoryId = categoriesInfo.some(col => col.name === 'parent_category_id');
  if (!categoriesHasParentCategoryId) {
    console.log('Migrating categories.parent_category to parent_category_id...');
    db.exec("ALTER TABLE categories ADD COLUMN parent_category_id INTEGER REFERENCES categories(id)");

    const categoriesToMigrate = db.prepare(
      "SELECT id, parent_category FROM categories WHERE parent_category IS NOT NULL AND parent_category != ''"
    ).all();

    const updateStmt = db.prepare('UPDATE categories SET parent_category_id = ? WHERE id = ?');
    const migrateCategories = db.transaction(() => {
      for (const row of categoriesToMigrate) {
        const parentId = getOrCreateCategoryId(row.parent_category);
        if (parentId) {
          updateStmt.run(parentId, row.id);
        }
      }
    });
    migrateCategories();

    console.log(`  ✓ Migrated ${categoriesToMigrate.length} parent categories`);
  }

  // 10. AI_CATEGORIZATIONS TABLE
  const aiCategorizationsInfo = db.prepare("PRAGMA table_info(ai_categorizations)").all();
  const aiCategorizationsHasCategoryId = aiCategorizationsInfo.some(col => col.name === 'category_id');
  if (!aiCategorizationsHasCategoryId) {
    console.log('Migrating ai_categorizations.category to category_id...');
    db.exec("ALTER TABLE ai_categorizations ADD COLUMN category_id INTEGER REFERENCES categories(id)");

    const categorizationsToMigrate = db.prepare(
      'SELECT id, category FROM ai_categorizations WHERE category IS NOT NULL'
    ).all();

    const updateStmt = db.prepare('UPDATE ai_categorizations SET category_id = ? WHERE id = ?');
    const migrateCategorizations = db.transaction(() => {
      for (const row of categorizationsToMigrate) {
        const categoryId = getOrCreateCategoryId(row.category);
        if (categoryId) {
          updateStmt.run(categoryId, row.id);
        }
      }
    });
    migrateCategorizations();

    console.log(`  ✓ Migrated ${categorizationsToMigrate.length} AI categorizations`);
  }

  // 11. AI_EMBEDDINGS TABLE
  const aiEmbeddingsInfo = db.prepare("PRAGMA table_info(ai_embeddings)").all();
  const aiEmbeddingsHasCategoryId = aiEmbeddingsInfo.some(col => col.name === 'category_id');
  if (!aiEmbeddingsHasCategoryId) {
    console.log('Migrating ai_embeddings.category to category_id...');
    db.exec("ALTER TABLE ai_embeddings ADD COLUMN category_id INTEGER REFERENCES categories(id)");

    const embeddingsToMigrate = db.prepare(
      'SELECT id, category FROM ai_embeddings WHERE category IS NOT NULL'
    ).all();

    const updateStmt = db.prepare('UPDATE ai_embeddings SET category_id = ? WHERE id = ?');
    const migrateEmbeddings = db.transaction(() => {
      for (const row of embeddingsToMigrate) {
        const categoryId = getOrCreateCategoryId(row.category);
        if (categoryId) {
          updateStmt.run(categoryId, row.id);
        }
      }
    });
    migrateEmbeddings();

    console.log(`  ✓ Migrated ${embeddingsToMigrate.length} AI embeddings`);
  }

  // 12. AI_FEEDBACK TABLE
  const aiFeedbackInfo = db.prepare("PRAGMA table_info(ai_feedback)").all();
  const aiFeedbackHasSuggestedCategoryId = aiFeedbackInfo.some(col => col.name === 'suggested_category_id');
  const aiFeedbackHasActualCategoryId = aiFeedbackInfo.some(col => col.name === 'actual_category_id');

  if (!aiFeedbackHasSuggestedCategoryId) {
    console.log('Migrating ai_feedback.suggested_category to suggested_category_id...');
    db.exec("ALTER TABLE ai_feedback ADD COLUMN suggested_category_id INTEGER REFERENCES categories(id)");

    const feedbackToMigrate = db.prepare(
      'SELECT id, suggested_category FROM ai_feedback WHERE suggested_category IS NOT NULL'
    ).all();

    const updateStmt = db.prepare('UPDATE ai_feedback SET suggested_category_id = ? WHERE id = ?');
    const migrateFeedback = db.transaction(() => {
      for (const row of feedbackToMigrate) {
        const categoryId = getOrCreateCategoryId(row.suggested_category);
        if (categoryId) {
          updateStmt.run(categoryId, row.id);
        }
      }
    });
    migrateFeedback();

    console.log(`  ✓ Migrated ${feedbackToMigrate.length} suggested categories in AI feedback`);
  }

  if (!aiFeedbackHasActualCategoryId) {
    console.log('Migrating ai_feedback.actual_category to actual_category_id...');
    db.exec("ALTER TABLE ai_feedback ADD COLUMN actual_category_id INTEGER REFERENCES categories(id)");

    const feedbackToMigrate = db.prepare(
      'SELECT id, actual_category FROM ai_feedback WHERE actual_category IS NOT NULL'
    ).all();

    const updateStmt = db.prepare('UPDATE ai_feedback SET actual_category_id = ? WHERE id = ?');
    const migrateFeedback = db.transaction(() => {
      for (const row of feedbackToMigrate) {
        const categoryId = getOrCreateCategoryId(row.actual_category);
        if (categoryId) {
          updateStmt.run(categoryId, row.id);
        }
      }
    });
    migrateFeedback();

    console.log(`  ✓ Migrated ${feedbackToMigrate.length} actual categories in AI feedback`);
  }

  console.log('✓ Category normalization migration complete');
}

/**
 * Get a color palette for categories (vibrant, high contrast)
 */
function getCategoryColorPalette() {
  return [
    '#10B981', // Green - Groceries
    '#F59E0B', // Amber - Restaurants
    '#3B82F6', // Blue - Transportation
    '#EF4444', // Red - Gas
    '#8B5CF6', // Purple - Shopping
    '#EC4899', // Pink - Entertainment
    '#6366F1', // Indigo - Bills & Utilities
    '#14B8A6', // Teal - Healthcare
    '#06B6D4', // Cyan - Travel
    '#22C55E', // Lime - Income
    '#6B7280', // Gray - Transfer
    '#84CC16', // Green-Yellow - Other
  ];
}

/**
 * Suggest an emoji icon based on category name
 */
function suggestIconForCategory(categoryName) {
  const name = categoryName.toLowerCase();

  // Common category mappings
  const iconMap = {
    'groceries': '🛒',
    'food': '🍔',
    'restaurants': '🍽️',
    'dining': '🍴',
    'transportation': '🚗',
    'gas': '⛽',
    'fuel': '⛽',
    'shopping': '🛍️',
    'entertainment': '🎬',
    'bills': '📄',
    'utilities': '💡',
    'healthcare': '🏥',
    'medical': '💊',
    'travel': '✈️',
    'income': '💰',
    'salary': '💵',
    'transfer': '🔄',
    'rent': '🏠',
    'mortgage': '🏠',
    'insurance': '🛡️',
    'education': '📚',
    'fitness': '💪',
    'gym': '🏋️',
    'sports': '⚽',
    'coffee': '☕',
    'drinks': '🥤',
    'alcohol': '🍺',
    'clothing': '👕',
    'electronics': '💻',
    'phone': '📱',
    'internet': '🌐',
    'streaming': '📺',
    'music': '🎵',
    'pets': '🐕',
    'gifts': '🎁',
    'charity': '❤️',
    'personal': '👤',
    'beauty': '💄',
    'car': '🚙',
    'parking': '🅿️',
    'taxi': '🚕',
    'uber': '🚕',
    'subscriptions': '📱',
    'services': '🔧',
    'service': '🔧',
    'pair': '👶',
    'childcare': '👶',
    'babysit': '👶',
    'nanny': '👶',
    'other': '📁'
  };

  // Check for exact matches or partial matches
  for (const [key, icon] of Object.entries(iconMap)) {
    if (name.includes(key)) {
      return icon;
    }
  }

  // Default icon
  return '📁';
}

/**
 * Get next available color from palette (avoiding recently used colors)
 */
function getNextCategoryColor() {
  const palette = getCategoryColorPalette();
  const existingCategories = db.prepare('SELECT color FROM categories').all();
  const usedColors = new Set(existingCategories.map(c => c.color));

  // Find first unused color
  for (const color of palette) {
    if (!usedColors.has(color)) {
      return color;
    }
  }

  // If all colors used, cycle back through palette
  const colorIndex = existingCategories.length % palette.length;
  return palette[colorIndex];
}

/**
 * Seed default categories and rules
 */
function seedDefaultData() {
  // Check if categories already exist
  const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();

  if (categoryCount.count === 0) {
    console.log('Seeding default categories...');
    const palette = getCategoryColorPalette();
    const defaultCategories = [
      ['Groceries', '', '🛒', palette[0]],
      ['Restaurants', '', '🍽️', palette[1]],
      ['Transportation', '', '🚗', palette[2]],
      ['Gas', '', '⛽', palette[3]],
      ['Shopping', '', '🛍️', palette[4]],
      ['Entertainment', '', '🎬', palette[5]],
      ['Bills & Utilities', '', '💡', palette[6]],
      ['Healthcare', '', '🏥', palette[7]],
      ['Travel', '', '✈️', palette[8]],
      ['Income', '', '💰', palette[9]],
      ['Transfer', '', '🔄', palette[10]],
      ['Other', '', '📁', palette[11]]
    ];

    const stmt = db.prepare('INSERT INTO categories (name, parent_category, icon, color) VALUES (?, ?, ?, ?)');
    const insertMany = db.transaction((categories) => {
      for (const cat of categories) {
        stmt.run(cat[0], cat[1], cat[2], cat[3]);
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
// CATEGORY HELPERS
// ============================================================================

/**
 * Get category ID from category name
 * Returns null if category doesn't exist
 */
export function getCategoryIdByName(categoryName) {
  if (!categoryName || categoryName.trim() === '') {
    return null;
  }

  const category = db.prepare('SELECT id FROM categories WHERE name = ?').get(categoryName.trim());
  return category ? category.id : null;
}

/**
 * Get category name from category ID
 * Returns null if category doesn't exist
 */
export function getCategoryNameById(categoryId) {
  if (!categoryId) {
    return null;
  }

  const category = db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId);
  return category ? category.name : null;
}

/**
 * Get or create category by name, returning the category ID
 * This is useful during data imports/migrations
 */
function getOrCreateCategoryIdByName(categoryName) {
  if (!categoryName || categoryName.trim() === '') {
    return null;
  }

  const trimmedName = categoryName.trim();

  // Try to find existing category
  let categoryId = getCategoryIdByName(trimmedName);

  if (!categoryId) {
    // Create missing category with default icon/color
    const icon = suggestIconForCategory(trimmedName);
    const color = getNextCategoryColor();

    const result = db.prepare(
      'INSERT INTO categories (name, icon, color) VALUES (?, ?, ?)'
    ).run(trimmedName, icon, color);

    categoryId = result.lastInsertRowid;
  }

  return categoryId;
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

/**
 * Rename an account and update all related transactions
 */
export function renameAccount(accountId, newName) {
  // Get the old name first
  const account = db.prepare('SELECT name FROM accounts WHERE account_id = ?').get(accountId);

  if (!account) {
    throw new Error('Account not found');
  }

  const oldName = account.name;

  // Use transaction to update both accounts and transactions atomically
  const updateAll = db.transaction(() => {
    // Update the account name
    db.prepare('UPDATE accounts SET name = ?, updated_at = datetime(\'now\') WHERE account_id = ?')
      .run(newName, accountId);

    // Update all transactions with this account name
    const result = db.prepare('UPDATE transactions SET account_name = ? WHERE account_name = ?')
      .run(newName, oldName);

    return {
      success: true,
      oldName,
      newName,
      transactionsUpdated: result.changes
    };
  });

  return updateAll();
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

export function getTransactions(limit = 50, filters = {}) {
  const startTime = Date.now();

  // Join with amazon_orders to include matching information
  // Join with categories to get current category name (handles renames automatically)
  let sql = `
    SELECT
      t.*,
      COALESCE(c.name, t.category) as category,
      c.icon as category_icon,
      c.color as category_color,
      ao.order_id as amazon_order_id,
      ao.total_amount as amazon_total,
      ao.order_date as amazon_order_date,
      ao.match_confidence as amazon_match_confidence,
      ao.order_status as amazon_order_status
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN amazon_orders ao ON t.transaction_id = ao.matched_transaction_id
    WHERE 1=1
  `;
  const params = [];

  if (filters.category) {
    sql += ' AND c.name = ?';
    params.push(filters.category);
  }

  if (filters.account) {
    sql += ' AND t.account_name = ?';
    params.push(filters.account);
  }

  if (filters.startDate) {
    sql += ' AND t.date >= ?';
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    sql += ' AND t.date <= ?';
    params.push(filters.endDate);
  }

  if (filters.amazonMatch === 'matched') {
    sql += ' AND ao.order_id IS NOT NULL';
  } else if (filters.amazonMatch === 'unmatched') {
    sql += ' AND ao.order_id IS NULL';
  }

  sql += ' ORDER BY t.date DESC LIMIT ? OFFSET ?';
  params.push(limit);
  params.push(filters.offset || 0);

  const transactions = db.prepare(sql).all(...params);

  // Optimization: Fetch all splits for this batch of transactions in ONE query (avoids N+1 problem)
  // Build a map of transaction_id -> splits for fast lookup
  const splitsMap = new Map();

  if (transactions.length > 0) {
    const transactionIds = transactions.map(tx => tx.transaction_id);
    const placeholders = transactionIds.map(() => '?').join(',');
    const allSplits = db.prepare(`
      SELECT * FROM transaction_splits
      WHERE parent_transaction_id IN (${placeholders})
      ORDER BY parent_transaction_id, split_index
    `).all(...transactionIds);

    // Group splits by parent transaction ID
    for (const split of allSplits) {
      if (!splitsMap.has(split.parent_transaction_id)) {
        splitsMap.set(split.parent_transaction_id, []);
      }
      splitsMap.get(split.parent_transaction_id).push(split);
    }
  }

  // Process transactions: replace split parents with their children
  const processedTransactions = [];

  for (const tx of transactions) {
    // Check if this transaction has splits (using pre-fetched map)
    const splits = splitsMap.get(tx.transaction_id) || [];

    if (splits.length > 0) {
      // Add split children as "virtual transactions"
      for (const split of splits) {
        processedTransactions.push({
          ...tx,
          transaction_id: split.id, // Use split ID
          amount: parseFloat(split.amount),
          category: split.category,
          confidence: 95, // High confidence for manual splits
          verified: 'Yes', // Manual splits are verified
          description: split.description || tx.description,
          is_split: true,
          split_parent_id: tx.transaction_id,
          // Amazon order information (if matched)
          amazon_order: tx.amazon_order_id ? {
            order_id: tx.amazon_order_id,
            total_amount: parseFloat(tx.amazon_total),
            order_date: tx.amazon_order_date,
            match_confidence: parseInt(tx.amazon_match_confidence) || 0,
            order_status: tx.amazon_order_status
          } : null
        });
      }
    } else {
      // Regular transaction (no splits)
      processedTransactions.push({
        ...tx,
        amount: parseFloat(tx.amount),
        confidence: parseInt(tx.confidence) || 0,
        verified: tx.verified === 'Yes',
        is_split: false,
        // Amazon order information (if matched)
        amazon_order: tx.amazon_order_id ? {
          order_id: tx.amazon_order_id,
          total_amount: parseFloat(tx.amazon_total),
          order_date: tx.amazon_order_date,
          match_confidence: parseInt(tx.amazon_match_confidence) || 0,
          order_status: tx.amazon_order_status
        } : null
      });
    }
  }

  const elapsed = Date.now() - startTime;
  if (elapsed > 100) {
    console.log(`⚠️  getTransactions took ${elapsed}ms (limit: ${limit}, filters: ${JSON.stringify(filters)})`);
  }

  return processedTransactions;
}

export function saveTransactions(transactions, categorizationData) {
  if (transactions.length === 0) return 0;

  console.log(`  📝 Processing ${transactions.length} transaction(s) from Plaid...`);

  // Debug: Log first transaction to see Plaid data structure
  if (transactions.length > 0 && process.env.DEBUG_CATEGORIZATION) {
    console.log('  🔍 Debug - Sample Plaid transaction:');
    console.log('     merchant_name:', transactions[0].merchant_name);
    console.log('     name:', transactions[0].name);
    console.log('     category:', transactions[0].category);
    console.log('     personal_finance_category:', transactions[0].personal_finance_category);
  }

  // Get categorization data if not provided
  if (!categorizationData) {
    categorizationData = {
      merchantMappings: getMerchantMappings(),
      categoryRules: getEnabledCategoryRules(),
      plaidMappings: getPlaidCategoryMappings()
    };
  }

  // Debug: Log categorization data availability
  if (process.env.DEBUG_CATEGORIZATION) {
    console.log(`  📊 Categorization data:`);
    console.log(`     Merchant mappings: ${categorizationData.merchantMappings.length}`);
    console.log(`     Category rules: ${categorizationData.categoryRules.length}`);
    console.log(`     Plaid mappings: ${categorizationData.plaidMappings.length}`);
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO transactions (
      transaction_id, date, description, merchant_name, account_name,
      amount, category, category_id, confidence, verified, pending, payment_channel, notes, created_at,
      plaid_primary_category, plaid_detailed_category, plaid_confidence_level,
      location_city, location_region, location_address,
      transaction_type, authorized_datetime, merchant_entity_id,
      external_category, category_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  let duplicates = 0;
  const insertMany = db.transaction((txns) => {
    for (const tx of txns) {
      // Extract Plaid personal_finance_category
      const pfc = tx.personal_finance_category || {};
      const plaidPrimary = pfc.primary || null;
      const plaidDetailed = pfc.detailed || null;
      const plaidConfidence = pfc.confidence_level || null;

      // Track external category source
      let externalCategory = null;
      let categorySource = null;

      // If transaction has a Plaid category, track it as external
      if (plaidDetailed || plaidPrimary) {
        externalCategory = plaidDetailed || plaidPrimary;
        categorySource = 'plaid';

        // Check if there's an approved mapping for this external category
        const mappedCategory = getExternalCategoryMapping(externalCategory, categorySource);
        if (mappedCategory) {
          // Use the mapped category (will be null if user chose "unmapped")
          tx.category = mappedCategory;
          tx.confidence = 90; // High confidence for approved mappings
        }
      }

      // Auto-categorize if not already categorized
      let category = tx.category || '';
      let confidence = tx.confidence || 0;

      if (!category) {
        const result = autoCategorizeTransaction(tx, categorizationData, true);
        category = result.category;
        confidence = result.confidence;
      }

      // Get category ID from category name
      const categoryId = category ? getOrCreateCategoryIdByName(category) : null;

      // Extract location data
      const location = tx.location || {};
      const locationCity = location.city || null;
      const locationRegion = location.region || null;
      const locationAddress = location.address || null;

      // Extract transaction metadata
      const transactionType = tx.transaction_type || null;
      const authorizedDatetime = tx.authorized_datetime || tx.authorized_date || null;
      const merchantEntityId = tx.merchant_entity_id || null;

      const info = stmt.run(
        tx.transaction_id,
        tx.date,
        tx.name,
        tx.merchant_name || '',
        tx.account_name,
        tx.amount,
        category,
        categoryId,
        confidence,
        'No',
        tx.pending ? 'Yes' : 'No',
        tx.payment_channel || '',
        '',
        plaidPrimary,
        plaidDetailed,
        plaidConfidence,
        locationCity,
        locationRegion,
        locationAddress,
        transactionType,
        authorizedDatetime,
        merchantEntityId,
        externalCategory,
        categorySource
      );

      if (info.changes > 0) {
        inserted++;
      } else {
        duplicates++;
      }
    }
  });

  insertMany(transactions);

  console.log(`  ✓ Inserted ${inserted} new, skipped ${duplicates} duplicates`);

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
 * Handles both old category array format and new personal_finance_category format
 */
function mapPlaidCategoryToDefault(plaidCategory) {
  if (!plaidCategory) return null;

  const cat = plaidCategory.toLowerCase();

  // Food & Dining
  if (cat.includes('restaurant') || cat.includes('food_and_drink') || cat.includes('dining') ||
      cat.includes('coffee') || cat.includes('fast food') || cat.includes('bar')) {
    return 'Restaurants';
  }
  if (cat.includes('groceries') || cat.includes('supermarket') || cat.includes('food_store')) {
    return 'Groceries';
  }

  // Transportation
  if (cat.includes('gas') || cat.includes('fuel') || cat.includes('service_station')) {
    return 'Gas';
  }
  if (cat.includes('transport') || cat.includes('taxi') || cat.includes('uber') ||
      cat.includes('lyft') || cat.includes('parking') || cat.includes('public_transit') ||
      cat.includes('automotive')) {
    return 'Transportation';
  }

  // Shopping
  if (cat.includes('shop') || cat.includes('retail') || cat.includes('general_merchandise') ||
      cat.includes('clothing') || cat.includes('electronics') || cat.includes('home_improvement')) {
    return 'Shopping';
  }

  // Entertainment & Recreation
  if (cat.includes('entertainment') || cat.includes('recreation') || cat.includes('gym') ||
      cat.includes('fitness') || cat.includes('sports') || cat.includes('movie') ||
      cat.includes('music') || cat.includes('streaming')) {
    return 'Entertainment';
  }

  // Travel
  if (cat.includes('travel') || cat.includes('hotel') || cat.includes('airfare') ||
      cat.includes('lodging') || cat.includes('airline') || cat.includes('vacation')) {
    return 'Travel';
  }

  // Healthcare
  if (cat.includes('healthcare') || cat.includes('medical') || cat.includes('doctor') ||
      cat.includes('pharmacy') || cat.includes('hospital') || cat.includes('dental')) {
    return 'Healthcare';
  }

  // Bills & Utilities
  if (cat.includes('utility') || cat.includes('utilities') || cat.includes('electric') ||
      cat.includes('water') || cat.includes('internet') || cat.includes('phone') ||
      cat.includes('cable') || cat.includes('rent') || cat.includes('mortgage')) {
    return 'Bills & Utilities';
  }

  // Income
  if (cat.includes('income') || cat.includes('paycheck') || cat.includes('salary') ||
      cat.includes('deposit') || cat.includes('refund') || cat.includes('reimbursement')) {
    return 'Income';
  }

  // Transfer
  if (cat.includes('transfer') || cat.includes('payment') || cat.includes('credit_card_payment')) {
    return 'Transfer';
  }

  // Personal Care
  if (cat.includes('personal_care') || cat.includes('salon') || cat.includes('spa') ||
      cat.includes('barber')) {
    return 'Personal Care';
  }

  // Education
  if (cat.includes('education') || cat.includes('school') || cat.includes('tuition') ||
      cat.includes('student')) {
    return 'Education';
  }

  // Subscriptions
  if (cat.includes('subscription') || cat.includes('membership')) {
    return 'Subscriptions';
  }

  // Catch-all for uncategorized
  return 'Other';
}

/**
 * Auto-categorize a transaction
 */
function autoCategorizeTransaction(transaction, categorizationData, skipSavingMappings = false) {
  try {
    const merchantName = transaction.merchant_name || '';
    const description = transaction.name || '';

    const { merchantMappings, categoryRules, plaidMappings } = categorizationData;

    if (process.env.DEBUG_CATEGORIZATION) {
      console.log(`  🔍 Categorizing: "${description}"`);
      console.log(`     Merchant: "${merchantName}"`);
    }

    // STEP 1: Exact merchant/description lookup - 95% confidence
    // Check merchant_name first
    if (merchantName) {
      const exactMatch = merchantMappings.find(
        m => m.merchant_name.toLowerCase() === merchantName.toLowerCase()
      );
      if (exactMatch) {
        if (!skipSavingMappings) {
          saveMerchantMapping(merchantName, exactMatch.category);
        }
        if (process.env.DEBUG_CATEGORIZATION) {
          console.log(`     ✓ Exact merchant match: "${exactMatch.category}" (95%)`);
        }
        return { category: exactMatch.category, confidence: 95 };
      }
    }

    // If no merchant_name, check description for exact match
    if (!merchantName && description) {
      const exactDescMatch = merchantMappings.find(
        m => m.merchant_name.toLowerCase() === description.toLowerCase()
      );
      if (exactDescMatch) {
        if (process.env.DEBUG_CATEGORIZATION) {
          console.log(`     ✓ Exact description match: "${exactDescMatch.category}" (95%)`);
        }
        return { category: exactDescMatch.category, confidence: 95 };
      }
    }

    // STEP 2: Pattern matching (rules with different match types) - 85% confidence
    for (const rule of categoryRules) {
      try {
        let isMatch = false;
        const matchType = rule.match_type || 'regex'; // Default to regex for backward compatibility

        switch (matchType) {
          case 'exact':
            // Exact match (case-insensitive)
            isMatch =
              merchantName?.toLowerCase() === rule.pattern.toLowerCase() ||
              description?.toLowerCase() === rule.pattern.toLowerCase();
            break;

          case 'partial':
            // Partial match (case-insensitive)
            const patternLower = rule.pattern.toLowerCase();
            isMatch =
              merchantName?.toLowerCase().includes(patternLower) ||
              description?.toLowerCase().includes(patternLower);
            break;

          case 'regex':
          default:
            // Regex match
            const regex = new RegExp(rule.pattern, 'i');
            isMatch = regex.test(merchantName) || regex.test(description);
            break;
        }

        if (isMatch) {
          if (merchantName && !skipSavingMappings) {
            saveMerchantMapping(merchantName, rule.category);
          }
          if (process.env.DEBUG_CATEGORIZATION) {
            console.log(`     ✓ Pattern match (${matchType}): "${rule.category}" (85%)`);
          }
          return { category: rule.category, confidence: 85 };
        }
      } catch (e) {
        console.warn(`Invalid pattern in rule "${rule.name}": ${rule.pattern}`, e);
      }
    }

    // STEP 3: Fuzzy merchant/description matching (80% similarity) - 75% confidence
    const searchText = merchantName || description;
    if (searchText && searchText.length >= 3) {
      for (const mapping of merchantMappings) {
        if (isFuzzyMatch(searchText, mapping.merchant_name, 0.8)) {
          if (!skipSavingMappings && merchantName) {
            saveMerchantMapping(merchantName, mapping.category);
          }
          if (process.env.DEBUG_CATEGORIZATION) {
            console.log(`     ✓ Fuzzy match: "${mapping.category}" (75%)`);
          }
          return { category: mapping.category, confidence: 75 };
        }
      }
    }

    // STEP 4: Check personal_finance_category first (newer Plaid field) - 70% / 50% confidence
    if (transaction.personal_finance_category) {
      const pfc = transaction.personal_finance_category;
      const pfcString = pfc.detailed || pfc.primary;

      if (pfcString) {
        const mapping = plaidMappings.find(m => m.plaid_category === pfcString);
        if (mapping) {
          if (process.env.DEBUG_CATEGORIZATION) {
            console.log(`     ✓ Plaid PFC mapping: "${mapping.user_category}" (70%)`);
          }
          return { category: mapping.user_category, confidence: 70 };
        }

        // Auto-create mapping from PFC
        if (!skipSavingMappings) {
          const suggestedCategory = mapPlaidCategoryToDefault(pfcString);
          if (suggestedCategory) {
            savePlaidCategoryMapping(pfcString, suggestedCategory);
            if (process.env.DEBUG_CATEGORIZATION) {
              console.log(`     ✓ Auto-created PFC mapping: "${suggestedCategory}" (50%)`);
            }
            return { category: suggestedCategory, confidence: 50 };
          }
        }
      }
    }

    // STEP 5: Plaid legacy category array - 70% / 50% confidence
    if (Array.isArray(transaction.category) && transaction.category.length > 0) {
      // Check from most specific to least specific
      for (let i = transaction.category.length - 1; i >= 0; i--) {
        const plaidCat = transaction.category[i];
        const mapping = plaidMappings.find(m => m.plaid_category === plaidCat);
        if (mapping) {
          if (process.env.DEBUG_CATEGORIZATION) {
            console.log(`     ✓ Plaid category mapping: "${mapping.user_category}" (70%)`);
          }
          return { category: mapping.user_category, confidence: 70 };
        }
      }

      // Auto-create mapping from category array
      if (!skipSavingMappings) {
        const plaidCategory = transaction.category[transaction.category.length - 1];
        const suggestedCategory = mapPlaidCategoryToDefault(plaidCategory);
        if (suggestedCategory) {
          savePlaidCategoryMapping(plaidCategory, suggestedCategory);
          if (process.env.DEBUG_CATEGORIZATION) {
            console.log(`     ✓ Auto-created category mapping: "${suggestedCategory}" (50%)`);
          }
          return { category: suggestedCategory, confidence: 50 };
        }
      }
    }

    if (process.env.DEBUG_CATEGORIZATION) {
      console.log(`     ✗ No category match found`);
    }

    return { category: '', confidence: 0 };
  } catch (error) {
    console.error('Error in autoCategorizeTransaction:', error.message);
    return { category: '', confidence: 0 };
  }
}

export function updateTransactionCategory(transactionId, category) {
  // Get the transaction to extract merchant name
  const transaction = db.prepare('SELECT * FROM transactions WHERE transaction_id = ?').get(transactionId);

  // Get category ID from name
  const categoryId = getOrCreateCategoryIdByName(category);

  // Update the transaction (both category name and ID for backward compatibility)
  const stmt = db.prepare(`
    UPDATE transactions
    SET category = ?, category_id = ?, confidence = 100, verified = 'Yes'
    WHERE transaction_id = ?
  `);
  stmt.run(category, categoryId, transactionId);

  // Save merchant mapping so future transactions from this merchant auto-categorize
  if (transaction) {
    if (transaction.merchant_name && transaction.merchant_name.trim() !== '') {
      // Has merchant name - save merchant mapping
      saveMerchantMapping(transaction.merchant_name, category);
      console.log(`  📚 Learned: "${transaction.merchant_name}" → "${category}"`);
    } else if (transaction.description && transaction.description.trim() !== '') {
      // No merchant name, but has description - try to create a pattern-based learning
      const description = transaction.description.trim();

      // Check if this is a common pattern we can learn from
      // For example: "Interest Paid", "Transfer from...", etc.
      if (description.length > 0) {
        // Save as a merchant mapping using the description
        // This allows the system to learn from description-based transactions
        saveMerchantMapping(description, category);
        console.log(`  📚 Learned: "${description}" → "${category}" (description-based)`);
      }
    } else {
      // Transaction categorized but can't create a learning pattern
      console.log(`  ℹ️  Categorized transaction → "${category}" (no pattern to learn)`);
    }
  }
}

/**
 * Find similar transactions based on merchant name
 * Used to suggest applying category changes to similar transactions
 */
export function findSimilarTransactions(transactionId, merchantName) {
  // Get the transaction being updated
  const transaction = db.prepare('SELECT * FROM transactions WHERE transaction_id = ?').get(transactionId);

  if (!transaction) {
    return [];
  }

  let similarTransactions = [];

  // Strategy: If we have a merchant_name, use exact match. Otherwise, use description fuzzy match
  if (merchantName && merchantName.trim() !== '') {
    // Has merchant name - find exact merchant matches only
    similarTransactions = db.prepare(`
      SELECT * FROM transactions
      WHERE transaction_id != ?
        AND (confidence IS NULL OR confidence < 100)
        AND merchant_name = ?
      ORDER BY date DESC
      LIMIT 50
    `).all(transactionId, merchantName.trim());
  } else {
    // No merchant name - find by similar description
    // Use the description to find similar transactions
    const description = transaction.description || '';

    if (description.trim() !== '') {
      similarTransactions = db.prepare(`
        SELECT * FROM transactions
        WHERE transaction_id != ?
          AND (confidence IS NULL OR confidence < 100)
          AND (merchant_name IS NULL OR merchant_name = '')
          AND description LIKE ?
        ORDER BY date DESC
        LIMIT 50
      `).all(transactionId, `%${description.trim()}%`);
    }
  }

  return similarTransactions.map(tx => ({
    transaction_id: tx.transaction_id,
    date: tx.date,
    description: tx.description,
    merchant_name: tx.merchant_name,
    account_name: tx.account_name,
    amount: tx.amount,
    category: tx.category,
    confidence: tx.confidence
  }));
}

/**
 * Update categories for multiple transactions at once
 */
export function updateMultipleTransactionCategories(transactionIds, category) {
  console.log('=== updateMultipleTransactionCategories ===');
  console.log('Transaction IDs:', transactionIds);
  console.log('Category:', category);

  if (!transactionIds || transactionIds.length === 0) {
    console.log('No transaction IDs provided, returning 0');
    return 0;
  }

  // Get category ID from name
  const categoryId = getOrCreateCategoryIdByName(category);

  const placeholders = transactionIds.map(() => '?').join(',');
  console.log('SQL placeholders:', placeholders);

  const sql = `
    UPDATE transactions
    SET category = ?, category_id = ?, confidence = 95, verified = 'No'
    WHERE transaction_id IN (${placeholders})
  `;
  console.log('SQL query:', sql);

  const stmt = db.prepare(sql);
  const params = [category, categoryId, ...transactionIds];
  console.log('SQL params:', params);

  const result = stmt.run(...params);
  console.log('Update result:', result);
  console.log('Rows changed:', result.changes);

  return result.changes;
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

export function unverifyTransactionCategory(transactionId, originalConfidence) {
  // Restore original confidence (or default to 0 if not provided)
  const confidenceToRestore = originalConfidence !== undefined ? originalConfidence : 0;

  const stmt = db.prepare(`
    UPDATE transactions
    SET verified = 'No', confidence = ?
    WHERE transaction_id = ?
  `);
  stmt.run(confidenceToRestore, transactionId);

  const tx = db.prepare('SELECT category FROM transactions WHERE transaction_id = ?').get(transactionId);
  return { success: true, category: tx.category };
}

export function recategorizeExistingTransactions(onlyUncategorized = true, transactionIds = null) {
  let rows;

  if (transactionIds && Array.isArray(transactionIds) && transactionIds.length > 0) {
    // Filter by specific transaction IDs
    const placeholders = transactionIds.map(() => '?').join(',');
    rows = db.prepare(`SELECT * FROM transactions WHERE transaction_id IN (${placeholders})`).all(...transactionIds);
  } else {
    // Get all transactions
    rows = db.prepare('SELECT * FROM transactions').all();
  }

  const categorizationData = {
    merchantMappings: getMerchantMappings(),
    categoryRules: getEnabledCategoryRules(),
    plaidMappings: getPlaidCategoryMappings()
  };

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  const batchUpdates = [];
  const categorizedTransactions = []; // Track details for recap

  for (const row of rows) {
    // Skip manually categorized transactions (confidence = 100)
    // Re-categorize everything else, including auto-categorized transactions
    if (row.confidence === 100) {
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

      // Add to recap
      categorizedTransactions.push({
        transaction_id: row.transaction_id,
        date: row.date,
        description: row.description,
        merchant_name: row.merchant_name || row.description,
        amount: row.amount,
        oldCategory: row.category || '',
        newCategory: category,
        confidence: confidence
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
    skipped,
    categorizedTransactions // Include detailed list
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

/**
 * Get daily spending and income data for charts
 * @param {number} days - Number of days to retrieve
 * @returns {Array} Array of {date, income, expenses} objects
 */
export function getDailySpendingIncome(days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  const sql = `
    SELECT
      date,
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income,
      ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)) as expenses
    FROM transactions
    WHERE date >= ?
    GROUP BY date
    ORDER BY date ASC
  `;

  const results = db.prepare(sql).all(startDateStr);
  return results.map(r => ({
    date: r.date,
    income: parseFloat(r.income) || 0,
    expenses: parseFloat(r.expenses) || 0
  }));
}

/**
 * Get net worth over time for charts
 * @param {string} range - Time range: '1w', '1m', '3m', '6m', '1y'
 * @returns {Array} Array of {date, balance} objects
 */
export function getNetWorthOverTime(range = '1w') {
  // Calculate start date based on range
  const now = new Date();
  let daysBack = 7;

  switch (range) {
    case '1w': daysBack = 7; break;
    case '1m': daysBack = 30; break;
    case '3m': daysBack = 90; break;
    case '6m': daysBack = 180; break;
    case '1y': daysBack = 365; break;
    default: daysBack = 7;
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  const startDateStr = startDate.toISOString().split('T')[0];

  // Get all unique dates in the range
  const datesSql = `
    SELECT DISTINCT date
    FROM transactions
    WHERE date >= ?
    ORDER BY date ASC
  `;

  const dates = db.prepare(datesSql).all(startDateStr);

  // If no transactions in this range, return empty array
  if (dates.length === 0) {
    return [];
  }

  // Get current account balances
  const accounts = db.prepare('SELECT current_balance FROM accounts').all();
  const currentTotalBalance = accounts.reduce((sum, acc) => sum + parseFloat(acc.current_balance || 0), 0);

  // Calculate balance for each date by working backwards from current balance
  const results = [];

  for (const { date } of dates) {
    // Get total of all transactions after this date
    const transactionsAfterSql = `
      SELECT SUM(amount) as total
      FROM transactions
      WHERE date > ?
    `;

    const afterResult = db.prepare(transactionsAfterSql).get(date);
    const transactionsAfter = parseFloat(afterResult.total || 0);

    // Balance on this date = current balance - transactions after this date
    const balanceOnDate = currentTotalBalance - transactionsAfter;

    results.push({
      date,
      balance: balanceOnDate
    });
  }

  return results;
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
      // Convert use_for_amazon from integer to boolean
      unique.push({
        ...cat,
        use_for_amazon: cat.use_for_amazon === 1
      });
    }
  }

  return unique;
}

export function addCategory(name, parentCategory = null, icon = null, color = null, description = null, useForAmazon = true) {
  // Auto-generate icon and color if not provided
  const categoryIcon = icon || suggestIconForCategory(name);
  const categoryColor = color || getNextCategoryColor();

  const stmt = db.prepare(`
    INSERT INTO categories (name, parent_category, icon, color, description, use_for_amazon) VALUES (?, ?, ?, ?, ?, ?)
  `);

  try {
    stmt.run(name, parentCategory || '', categoryIcon, categoryColor, description || '', useForAmazon ? 1 : 0);
    return { success: true, name, parent_category: parentCategory, icon: categoryIcon, color: categoryColor, description, use_for_amazon: useForAmazon };
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      throw new Error('Category already exists');
    }
    throw error;
  }
}

export function updateCategory(oldName, newName, newParentCategory = null, icon = null, color = null, description = null, useForAmazon = null) {
  // Check if category exists
  const existingCategory = db.prepare('SELECT * FROM categories WHERE name = ?').get(oldName);
  if (!existingCategory) {
    throw new Error('Category not found');
  }

  // Check if new name already exists (if name is changing)
  if (oldName !== newName) {
    const duplicate = db.prepare('SELECT * FROM categories WHERE name = ? AND name != ?').get(newName, oldName);
    if (duplicate) {
      throw new Error('A category with this name already exists');
    }
  }

  // Use existing values if not provided
  const categoryIcon = icon || existingCategory.icon || suggestIconForCategory(newName);
  const categoryColor = color || existingCategory.color || getNextCategoryColor();
  const categoryDescription = description !== null ? description : existingCategory.description || '';
  const categoryUseForAmazon = useForAmazon !== null ? (useForAmazon ? 1 : 0) : existingCategory.use_for_amazon;

  // Use transaction to update both category and all related tables
  const transaction = db.transaction(() => {
    // Get parent category ID if specified
    const parentCategoryId = newParentCategory ? getCategoryIdByName(newParentCategory) : null;

    // Update category (this is the key change - name is updated in one place)
    const updateCategoryStmt = db.prepare(`
      UPDATE categories
      SET name = ?, parent_category = ?, parent_category_id = ?, icon = ?, color = ?, description = ?, use_for_amazon = ?
      WHERE name = ?
    `);
    updateCategoryStmt.run(newName, newParentCategory || '', parentCategoryId, categoryIcon, categoryColor, categoryDescription, categoryUseForAmazon, oldName);

    // Handle parent/child cascade for use_for_amazon changes
    if (useForAmazon !== null && categoryUseForAmazon !== existingCategory.use_for_amazon) {
      // Find all children of this category
      const children = db.prepare('SELECT name FROM categories WHERE parent_category = ?').all(oldName === newName ? oldName : newName);

      if (children.length > 0) {
        // Cascade the use_for_amazon value to all children
        const updateChildrenStmt = db.prepare('UPDATE categories SET use_for_amazon = ? WHERE parent_category = ?');
        updateChildrenStmt.run(categoryUseForAmazon, oldName === newName ? oldName : newName);
        console.log(`[Category] Cascaded use_for_amazon=${categoryUseForAmazon} to ${children.length} child category(ies)`);
      }

      // If enabling this category and it has a parent that's disabled, enable the parent
      if (categoryUseForAmazon === 1 && newParentCategory) {
        const parent = db.prepare('SELECT use_for_amazon FROM categories WHERE name = ?').get(newParentCategory);
        if (parent && parent.use_for_amazon === 0) {
          const updateParentStmt = db.prepare('UPDATE categories SET use_for_amazon = 1 WHERE name = ?');
          updateParentStmt.run(newParentCategory);
          console.log(`[Category] Auto-enabled parent category "${newParentCategory}" because child was enabled`);
        }
      }
    }

    // Update all transactions that use this category
    const updateTransactionsStmt = db.prepare(`
      UPDATE transactions
      SET category = ?
      WHERE category = ?
    `);
    const result = updateTransactionsStmt.run(newName, oldName);

    return { success: true, name: newName, parent_category: newParentCategory, icon: categoryIcon, color: categoryColor, description: categoryDescription, use_for_amazon: categoryUseForAmazon === 1, transactionsUpdated: result.changes };
  });

  return transaction();
}

export function deleteCategory(name) {
  // Check if category exists
  const existingCategory = db.prepare('SELECT * FROM categories WHERE name = ?').get(name);
  if (!existingCategory) {
    throw new Error('Category not found');
  }

  const categoryId = existingCategory.id;

  // Use transaction to delete category and uncategorize related records
  const transaction = db.transaction(() => {
    // Delete category (this will cascade to child categories via parent_category_id if we had CASCADE)
    const deleteCategoryStmt = db.prepare('DELETE FROM categories WHERE name = ?');
    deleteCategoryStmt.run(name);

    // Move all transactions in this category to uncategorized and unverify them
    // Update both category (backward compat) and category_id (normalized)
    const updateTransactionsStmt = db.prepare(`
      UPDATE transactions
      SET category = '', category_id = NULL, verified = 'No', confidence = 0
      WHERE category_id = ?
    `);
    const result = updateTransactionsStmt.run(categoryId);

    // Delete all merchant mappings for this category
    const deleteMappingsStmt = db.prepare('DELETE FROM merchant_mappings WHERE category_id = ?');
    deleteMappingsStmt.run(categoryId);

    // Update other tables that reference this category
    db.prepare('UPDATE amazon_items SET user_category = NULL, category_id = NULL WHERE category_id = ?').run(categoryId);
    db.prepare('UPDATE category_rules SET category = NULL, category_id = NULL WHERE category_id = ?').run(categoryId);

    return { success: true, transactionsAffected: result.changes };
  });

  return transaction();
}

export function getCategorySpending(startDate = null, endDate = null) {
  let sql = `
    SELECT
      c.name,
      c.parent_category,
      COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) as total,
      COUNT(CASE WHEN t.amount > 0 THEN 1 END) as count
    FROM categories c
    LEFT JOIN transactions t ON c.id = t.category_id
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

  sql += ' GROUP BY c.id, c.name, c.parent_category ORDER BY total DESC';

  const results = db.prepare(sql).all(...params);
  const categories = results.map(r => ({
    name: r.name,
    parent_category: r.parent_category,
    total: parseFloat(r.total),
    count: r.count
  }));

  // Calculate parent category totals
  const parentTotals = {};
  categories.forEach(cat => {
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
    categories,
    parentTotals: Object.values(parentTotals)
  };
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
  return db.prepare('SELECT * FROM category_rules WHERE enabled = \'Yes\'').all();
}

export function saveMerchantMapping(merchantName, category) {
  const categoryId = getOrCreateCategoryIdByName(category);

  const stmt = db.prepare(`
    INSERT INTO merchant_mappings (merchant_name, category, category_id, match_count, last_used)
    VALUES (?, ?, ?, 1, datetime('now'))
    ON CONFLICT(merchant_name) DO UPDATE SET
      category = excluded.category,
      category_id = excluded.category_id,
      match_count = match_count + 1,
      last_used = datetime('now')
  `);
  stmt.run(merchantName, category, categoryId);
}

export function savePlaidCategoryMapping(plaidCategory, userCategory) {
  const categoryId = getOrCreateCategoryIdByName(userCategory);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO plaid_category_mappings (plaid_category, user_category, category_id, auto_created)
    VALUES (?, ?, ?, 'Yes')
  `);
  stmt.run(plaidCategory, userCategory, categoryId);
}

export function createCategoryRule(name, pattern, category, matchType = 'regex', userCreated = 'Yes') {
  // Generate a unique name if the provided name already exists
  let uniqueName = name;
  let counter = 2;

  while (true) {
    const existingRule = db.prepare('SELECT id FROM category_rules WHERE name = ?').get(uniqueName);
    if (!existingRule) {
      break; // Name is unique
    }
    uniqueName = `${name} (${counter})`;
    counter++;
  }

  const categoryId = getOrCreateCategoryIdByName(category);

  const stmt = db.prepare(`
    INSERT INTO category_rules (name, pattern, category, category_id, match_type, user_created, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 'Yes')
  `);
  const result = stmt.run(uniqueName, pattern, category, categoryId, matchType, userCreated);
  return {
    id: result.lastInsertRowid,
    name: uniqueName
  };
}

export function updateCategoryRule(id, name, pattern, category, matchType, enabled = 'Yes') {
  const categoryId = getOrCreateCategoryIdByName(category);

  const stmt = db.prepare(`
    UPDATE category_rules
    SET name = ?, pattern = ?, category = ?, category_id = ?, match_type = ?, enabled = ?
    WHERE id = ?
  `);
  stmt.run(name, pattern, category, categoryId, matchType, enabled, id);
}

export function deleteCategoryRule(id) {
  const stmt = db.prepare('DELETE FROM category_rules WHERE id = ?');
  stmt.run(id);
}

export function previewRuleMatches(pattern, matchType) {
  let query;

  switch (matchType) {
    case 'exact':
      // Exact match on merchant_name or description (case-insensitive)
      query = db.prepare(`
        SELECT * FROM transactions
        WHERE merchant_name = ? COLLATE NOCASE OR description = ? COLLATE NOCASE
        ORDER BY date DESC
        LIMIT 100
      `);
      return query.all(pattern, pattern);

    case 'partial':
      // Case-insensitive partial match
      const likePattern = `%${pattern}%`;
      query = db.prepare(`
        SELECT * FROM transactions
        WHERE merchant_name LIKE ? OR description LIKE ?
        ORDER BY date DESC
        LIMIT 100
      `);
      return query.all(likePattern, likePattern);

    case 'regex':
    default:
      // Regex match - fetch all transactions and filter in JavaScript
      const allTransactions = db.prepare(`
        SELECT * FROM transactions
        ORDER BY date DESC
      `).all();

      try {
        const regex = new RegExp(pattern, 'i');
        return allTransactions.filter(t =>
          regex.test(t.merchant_name || '') || regex.test(t.description || '')
        ).slice(0, 100);
      } catch (error) {
        console.error('Invalid regex pattern:', error);
        return [];
      }
  }
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

// ============================================================================
// AMAZON ORDERS & ITEMS
// ============================================================================

/**
 * Add or update an Amazon order
 */
export function upsertAmazonOrder(orderData) {
  console.log(`\n[DATABASE] Saving order ${orderData.order_id}:`);
  console.log(`  total_amount: ${orderData.total_amount}`);
  console.log(`  subtotal: ${orderData.subtotal || null}`);
  console.log(`  tax: ${orderData.tax || null}`);
  console.log(`  shipping: ${orderData.shipping || null}`);

  const stmt = db.prepare(`
    INSERT INTO amazon_orders (
      order_id, order_date, total_amount, subtotal, tax, shipping,
      payment_method, shipping_address, order_status, account_name,
      website, purchase_order_number, currency, total_discounts,
      billing_address, ship_date, shipping_option,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(order_id) DO UPDATE SET
      order_date = excluded.order_date,
      total_amount = excluded.total_amount,
      subtotal = excluded.subtotal,
      tax = excluded.tax,
      shipping = excluded.shipping,
      payment_method = excluded.payment_method,
      shipping_address = excluded.shipping_address,
      order_status = excluded.order_status,
      account_name = excluded.account_name,
      website = excluded.website,
      purchase_order_number = excluded.purchase_order_number,
      currency = excluded.currency,
      total_discounts = excluded.total_discounts,
      billing_address = excluded.billing_address,
      ship_date = excluded.ship_date,
      shipping_option = excluded.shipping_option,
      updated_at = datetime('now')
  `);

  stmt.run(
    orderData.order_id,
    orderData.order_date,
    orderData.total_amount,
    orderData.subtotal || null,
    orderData.tax || null,
    orderData.shipping || null,
    orderData.payment_method || null,
    orderData.shipping_address || null,
    orderData.order_status || 'delivered',
    orderData.account_name || 'Primary',
    orderData.website || null,
    orderData.purchase_order_number || null,
    orderData.currency || null,
    orderData.total_discounts || null,
    orderData.billing_address || null,
    orderData.ship_date || null,
    orderData.shipping_option || null
  );

  return orderData.order_id;
}

/**
 * Add Amazon items for an order
 */
export function addAmazonItems(orderId, items) {
  // Delete existing items for this order
  db.prepare('DELETE FROM amazon_items WHERE order_id = ?').run(orderId);

  const stmt = db.prepare(`
    INSERT INTO amazon_items (
      order_id, asin, title, category, price, quantity,
      seller, product_url, image_url, return_status, return_date, refund_amount,
      product_condition, unit_price_tax, shipment_item_subtotal, shipment_item_subtotal_tax,
      shipment_status, ship_date, carrier_tracking, gift_message, gift_sender_name,
      gift_recipient_contact, item_serial_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const item of items) {
      stmt.run(
        orderId,
        item.asin || null,
        item.title,
        item.category || null,
        item.price,
        item.quantity || 1,
        item.seller || null,
        item.product_url || null,
        item.image_url || null,
        item.return_status || null,
        item.return_date || null,
        item.refund_amount || null,
        item.product_condition || null,
        item.unit_price_tax || null,
        item.shipment_item_subtotal || null,
        item.shipment_item_subtotal_tax || null,
        item.shipment_status || null,
        item.ship_date || null,
        item.carrier_tracking || null,
        item.gift_message || null,
        item.gift_sender_name || null,
        item.gift_recipient_contact || null,
        item.item_serial_number || null
      );
    }
  });

  insertMany(items);
}

/**
 * Get all Amazon orders with optional filters
 */
export function getAmazonOrders(filters = {}) {
  let sql = 'SELECT * FROM amazon_orders';
  const conditions = [];
  const params = [];

  // Always exclude $0 orders (cancelled/refunded items)
  conditions.push('total_amount > 0');

  if (filters.startDate) {
    conditions.push('order_date >= ?');
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    conditions.push('order_date <= ?');
    params.push(filters.endDate);
  }

  if (filters.matched !== undefined) {
    if (filters.matched) {
      conditions.push('matched_transaction_id IS NOT NULL');
    } else {
      conditions.push('matched_transaction_id IS NULL');
    }
  }

  if (filters.accountName) {
    conditions.push('account_name = ?');
    params.push(filters.accountName);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY order_date DESC';

  // Add pagination support
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);

    if (filters.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }
  }

  const orders = db.prepare(sql).all(...params);

  // Fetch all items for these orders in a single query (fix N+1 problem)
  if (orders.length === 0) {
    return [];
  }

  const orderIds = orders.map(o => o.order_id);
  const placeholders = orderIds.map(() => '?').join(',');
  const allItems = db.prepare(`SELECT * FROM amazon_items WHERE order_id IN (${placeholders})`).all(...orderIds);

  // Group items by order_id
  const itemsByOrderId = {};
  for (const item of allItems) {
    if (!itemsByOrderId[item.order_id]) {
      itemsByOrderId[item.order_id] = [];
    }
    itemsByOrderId[item.order_id].push(item);
  }

  // Attach items to each order
  return orders.map(order => ({
    ...order,
    items: itemsByOrderId[order.order_id] || []
  }));
}

/**
 * Get Amazon order by ID with items
 */
export function getAmazonOrderWithItems(orderId) {
  const order = db.prepare('SELECT * FROM amazon_orders WHERE order_id = ?').get(orderId);

  if (!order) {
    return null;
  }

  const items = db.prepare('SELECT * FROM amazon_items WHERE order_id = ?').all(orderId);

  return {
    ...order,
    items
  };
}

/**
 * Get all Amazon items with order info
 */
export function getAmazonItemsWithOrders() {
  return db.prepare(`
    SELECT
      i.*,
      o.order_date,
      o.total_amount as order_total,
      o.matched_transaction_id
    FROM amazon_items i
    JOIN amazon_orders o ON i.order_id = o.order_id
    ORDER BY o.order_date DESC, i.id
  `).all();
}

/**
 * Link an Amazon order to a transaction
 */
export function linkAmazonOrderToTransaction(orderId, transactionId, confidence = 85) {
  const stmt = db.prepare(`
    UPDATE amazon_orders
    SET matched_transaction_id = ?, match_confidence = ?, updated_at = datetime('now')
    WHERE order_id = ?
  `);

  stmt.run(transactionId, confidence, orderId);
}

/**
 * Unlink an Amazon order from its transaction
 */
export function unlinkAmazonOrder(orderId) {
  const stmt = db.prepare(`
    UPDATE amazon_orders
    SET matched_transaction_id = NULL, match_confidence = 0, match_verified = 'No', updated_at = datetime('now')
    WHERE order_id = ?
  `);

  stmt.run(orderId);
}

/**
 * Verify an Amazon order match
 */
export function verifyAmazonMatch(orderId) {
  const stmt = db.prepare(`
    UPDATE amazon_orders
    SET match_verified = 'Yes', updated_at = datetime('now')
    WHERE order_id = ?
  `);

  stmt.run(orderId);

  const order = db.prepare('SELECT * FROM amazon_orders WHERE order_id = ?').get(orderId);
  return { success: true, order };
}

/**
 * Unverify an Amazon order match
 */
export function unverifyAmazonMatch(orderId) {
  const stmt = db.prepare(`
    UPDATE amazon_orders
    SET match_verified = 'No', updated_at = datetime('now')
    WHERE order_id = ?
  `);

  stmt.run(orderId);

  const order = db.prepare('SELECT * FROM amazon_orders WHERE order_id = ?').get(orderId);
  return { success: true, order };
}

/**
 * Reset all Amazon order matchings
 * Unlinks all matched transactions from Amazon orders
 */
export function resetAllAmazonMatchings() {
  const stmt = db.prepare(`
    UPDATE amazon_orders
    SET matched_transaction_id = NULL,
        match_confidence = 0,
        match_verified = 'No',
        updated_at = datetime('now')
    WHERE matched_transaction_id IS NOT NULL
  `);

  const result = stmt.run();
  console.log(`Reset ${result.changes} Amazon order matchings`);

  return {
    success: true,
    count: result.changes,
    message: `Reset ${result.changes} Amazon order matchings`
  };
}

/**
 * Delete all Amazon orders and items
 * WARNING: This is destructive and cannot be undone
 */
export function deleteAllAmazonData() {
  const deleteAll = db.transaction(() => {
    // Get counts before deleting
    const orderCount = db.prepare('SELECT COUNT(*) as count FROM amazon_orders').get().count;
    const itemCount = db.prepare('SELECT COUNT(*) as count FROM amazon_items').get().count;

    // Delete all items first (due to foreign key constraint)
    db.prepare('DELETE FROM amazon_items').run();

    // Delete all orders
    db.prepare('DELETE FROM amazon_orders').run();

    console.log(`Deleted ${orderCount} Amazon orders and ${itemCount} items`);

    return {
      success: true,
      ordersDeleted: orderCount,
      itemsDeleted: itemCount,
      message: `Deleted ${orderCount} orders and ${itemCount} items`
    };
  });

  return deleteAll();
}

/**
 * Delete Amazon data for a specific account
 */
export function deleteAmazonDataByAccount(accountName) {
  const deleteByAccount = db.transaction(() => {
    // Get order IDs for this account
    const orderIds = db.prepare('SELECT order_id FROM amazon_orders WHERE account_name = ?').all(accountName);

    if (orderIds.length === 0) {
      return {
        success: true,
        ordersDeleted: 0,
        itemsDeleted: 0,
        message: `No orders found for account "${accountName}"`
      };
    }

    // Count items before deleting
    const itemCount = db.prepare(`
      SELECT COUNT(*) as count FROM amazon_items
      WHERE order_id IN (SELECT order_id FROM amazon_orders WHERE account_name = ?)
    `).get(accountName).count;

    // Delete items for orders in this account
    db.prepare(`
      DELETE FROM amazon_items
      WHERE order_id IN (SELECT order_id FROM amazon_orders WHERE account_name = ?)
    `).run(accountName);

    // Delete orders for this account
    const result = db.prepare('DELETE FROM amazon_orders WHERE account_name = ?').run(accountName);

    console.log(`Deleted ${result.changes} Amazon orders and ${itemCount} items for account "${accountName}"`);

    return {
      success: true,
      ordersDeleted: result.changes,
      itemsDeleted: itemCount,
      message: `Deleted ${result.changes} orders and ${itemCount} items for account "${accountName}"`
    };
  });

  return deleteByAccount();
}

/**
 * Get all unique Amazon account names
 */
export function getAmazonAccountNames() {
  return db.prepare(`
    SELECT DISTINCT account_name
    FROM amazon_orders
    WHERE account_name IS NOT NULL
    ORDER BY account_name
  `).all().map(row => row.account_name);
}

/**
 * Get unmatched Amazon orders
 */
export function getUnmatchedAmazonOrders() {
  return db.prepare(`
    SELECT * FROM amazon_orders
    WHERE matched_transaction_id IS NULL
      AND total_amount > 0
    ORDER BY order_date DESC
  `).all();
}

/**
 * Get Amazon order statistics
 */
export function getAmazonOrderStats(accountName = null) {
  const whereClause = accountName
    ? 'WHERE total_amount > 0 AND account_name = ?'
    : 'WHERE total_amount > 0';
  const params = accountName ? [accountName] : [];

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_orders,
      SUM(CASE WHEN matched_transaction_id IS NOT NULL THEN 1 ELSE 0 END) as matched_orders,
      SUM(total_amount) as total_spent,
      COUNT(DISTINCT strftime('%Y-%m', order_date)) as months_with_orders
    FROM amazon_orders
    ${whereClause}
  `).get(...params);

  const categoryWhereClause = accountName
    ? 'WHERE i.category IS NOT NULL AND o.total_amount > 0 AND o.account_name = ?'
    : 'WHERE i.category IS NOT NULL AND o.total_amount > 0';

  const categoryBreakdown = db.prepare(`
    SELECT
      i.category,
      COUNT(*) as item_count,
      SUM(i.price * i.quantity) as total_spent
    FROM amazon_items i
    JOIN amazon_orders o ON i.order_id = o.order_id
    ${categoryWhereClause}
    GROUP BY i.category
    ORDER BY total_spent DESC
    LIMIT 10
  `).all(...params);

  return {
    ...stats,
    categoryBreakdown
  };
}

// ============================================================================
// TRANSACTION SPLITTING
// ============================================================================

/**
 * Suggest transaction splits based on Amazon items
 * @param {string} transactionId - Transaction ID
 * @returns {Object} - Suggested splits with reasoning
 */
export function suggestTransactionSplits(transactionId) {
  // Get the transaction
  const transaction = db.prepare(`
    SELECT t.*, o.order_id
    FROM transactions t
    LEFT JOIN amazon_orders o ON t.transaction_id = o.matched_transaction_id
    WHERE t.transaction_id = ?
  `).get(transactionId);

  if (!transaction) {
    throw new Error('Transaction not found');
  }

  // If not linked to Amazon order, can't auto-suggest
  if (!transaction.order_id) {
    return {
      canSplit: false,
      reason: 'Transaction not linked to Amazon order',
      suggestions: []
    };
  }

  // Get Amazon items for this order
  const items = db.prepare(`
    SELECT * FROM amazon_items
    WHERE order_id = ?
    ORDER BY price DESC
  `).all(transaction.order_id);

  if (items.length <= 1) {
    return {
      canSplit: false,
      reason: 'Order has only one item',
      suggestions: []
    };
  }

  // Group items by category
  const categoryGroups = {};
  items.forEach(item => {
    const category = item.category || 'Uncategorized';
    if (!categoryGroups[category]) {
      categoryGroups[category] = {
        category,
        items: [],
        total: 0
      };
    }
    categoryGroups[category].items.push(item);
    categoryGroups[category].total += (item.price || 0) * (item.quantity || 1);
  });

  // Create split suggestions
  const suggestions = Object.values(categoryGroups).map(group => ({
    category: group.category,
    amount: -Math.abs(group.total), // Negative for expense
    items: group.items.map(item => item.title || 'Unknown item'),
    item_count: group.items.length,
    reasoning: `${group.items.length} item(s) in ${group.category}`
  }));

  return {
    canSplit: true,
    transaction_id: transactionId,
    original_amount: transaction.amount,
    suggestions,
    total_suggested: suggestions.reduce((sum, s) => sum + Math.abs(s.amount), 0)
  };
}

/**
 * Create transaction splits
 * @param {string} transactionId - Parent transaction ID
 * @param {Array} splits - Array of split data
 */
export function createTransactionSplits(transactionId, splits) {
  // Delete existing splits for this transaction
  db.prepare('DELETE FROM transaction_splits WHERE parent_transaction_id = ?')
    .run(transactionId);

  if (!splits || splits.length === 0) {
    return { created: 0 };
  }

  const stmt = db.prepare(`
    INSERT INTO transaction_splits (
      id, parent_transaction_id, split_index, amount, category, description, reasoning, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const insertMany = db.transaction((splitList) => {
    splitList.forEach((split, index) => {
      const id = `split_${transactionId}_${index}`;
      stmt.run(
        id,
        transactionId,
        index,
        split.amount,
        split.category,
        split.description || null,
        split.reasoning || null,
        split.source || 'manual'
      );
    });
  });

  insertMany(splits);

  return { created: splits.length };
}

/**
 * Get transaction splits
 * @param {string} transactionId - Parent transaction ID
 * @returns {Array} - Array of splits
 */
export function getTransactionSplits(transactionId) {
  return db.prepare(`
    SELECT * FROM transaction_splits
    WHERE parent_transaction_id = ?
    ORDER BY split_index
  `).all(transactionId);
}

/**
 * Delete transaction splits
 * @param {string} transactionId - Parent transaction ID
 */
export function deleteTransactionSplits(transactionId) {
  const result = db.prepare('DELETE FROM transaction_splits WHERE parent_transaction_id = ?')
    .run(transactionId);

  return { deleted: result.changes };
}

/**
 * Get all transactions with splits
 * @returns {Array} - Array of transaction IDs that have splits
 */
export function getTransactionsWithSplits() {
  return db.prepare(`
    SELECT DISTINCT parent_transaction_id as transaction_id
    FROM transaction_splits
  `).all();
}

/**
 * Check if transaction has splits
 * @param {string} transactionId - Transaction ID
 * @returns {boolean}
 */
export function hasTransactionSplits(transactionId) {
  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM transaction_splits
    WHERE parent_transaction_id = ?
  `).get(transactionId);

  return result.count > 0;
}

// ============================================================================
// SETTINGS
// ============================================================================

/**
 * Default settings with descriptions
 */
const DEFAULT_SETTINGS = {
  // Amazon Matching
  amazon_matching_max_days: {
    value: 180,
    type: 'number',
    description: 'Maximum days between Amazon order and transaction match',
    category: 'Amazon Matching',
    min: 1,
    max: 365
  },
  amazon_matching_confidence_decrease_per_day: {
    value: 0.5,
    type: 'number',
    description: 'Confidence score decrease per day (percentage)',
    category: 'Amazon Matching',
    min: 0.1,
    max: 10,
    step: 0.1
  },
  amazon_matching_amount_tolerance: {
    value: 0.001,
    type: 'number',
    description: 'Floating point tolerance for exact amount matching (dollars)',
    category: 'Amazon Matching',
    min: 0.0001,
    max: 0.01,
    step: 0.0001
  },

  // Logging
  enable_matching_debug_logs: {
    value: true,
    type: 'boolean',
    description: 'Enable detailed Amazon matching debug logs',
    category: 'Logging'
  },
  enable_csv_parsing_logs: {
    value: true,
    type: 'boolean',
    description: 'Enable Amazon CSV parsing logs',
    category: 'Logging'
  },
  enable_amazon_item_ai_logs: {
    value: false,
    type: 'boolean',
    description: 'Enable Amazon item AI categorization logs (shows prompts and responses)',
    category: 'Logging'
  },

  // General
  default_transaction_limit: {
    value: 500,
    type: 'number',
    description: 'Default number of transactions to fetch',
    category: 'General',
    min: 50,
    max: 5000,
    step: 50
  },
  use_relative_dates: {
    value: false,
    type: 'boolean',
    description: 'Display dates in relative format (e.g., "2 days ago") instead of absolute format',
    category: 'General'
  }
};

/**
 * Get a setting value
 * @param {string} key - Setting key
 * @returns {any} - Setting value (parsed to appropriate type)
 */
export function getSetting(key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);

  if (!row) {
    // Return default if not set
    const defaultSetting = DEFAULT_SETTINGS[key];
    return defaultSetting ? defaultSetting.value : null;
  }

  // Parse value based on type
  const defaultSetting = DEFAULT_SETTINGS[key];
  if (!defaultSetting) return row.value;

  switch (defaultSetting.type) {
    case 'number':
      return parseFloat(row.value);
    case 'boolean':
      return row.value === 'true';
    default:
      return row.value;
  }
}

/**
 * Get all settings
 * @returns {Object} - All settings with values and metadata
 */
export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM config').all();
  const settingsMap = {};

  rows.forEach(row => {
    settingsMap[row.key] = row.value;
  });

  // Build result with defaults and current values
  const result = {};
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    const def = DEFAULT_SETTINGS[key];
    const storedValue = settingsMap[key];

    let value;
    if (storedValue !== undefined) {
      // Parse stored value
      switch (def.type) {
        case 'number':
          value = parseFloat(storedValue);
          break;
        case 'boolean':
          value = storedValue === 'true';
          break;
        default:
          value = storedValue;
      }
    } else {
      value = def.value;
    }

    result[key] = {
      value,
      type: def.type,
      description: def.description,
      category: def.category,
      default: def.value,
      ...(def.min !== undefined && { min: def.min }),
      ...(def.max !== undefined && { max: def.max }),
      ...(def.step !== undefined && { step: def.step })
    };
  });

  return result;
}

/**
 * Set a setting value
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 */
export function setSetting(key, value) {
  // Validate against defaults
  const defaultSetting = DEFAULT_SETTINGS[key];
  if (!defaultSetting) {
    throw new Error(`Unknown setting: ${key}`);
  }

  // Validate type and range
  let stringValue;
  switch (defaultSetting.type) {
    case 'number':
      const numValue = parseFloat(value);
      if (isNaN(numValue)) {
        throw new Error(`Invalid number value for ${key}`);
      }
      if (defaultSetting.min !== undefined && numValue < defaultSetting.min) {
        throw new Error(`Value for ${key} must be at least ${defaultSetting.min}`);
      }
      if (defaultSetting.max !== undefined && numValue > defaultSetting.max) {
        throw new Error(`Value for ${key} must be at most ${defaultSetting.max}`);
      }
      stringValue = numValue.toString();
      break;
    case 'boolean':
      stringValue = (!!value).toString();
      break;
    default:
      stringValue = value.toString();
  }

  // Upsert setting
  db.prepare(`
    INSERT INTO config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, stringValue);

  return { success: true };
}

/**
 * Reset a setting to default
 * @param {string} key - Setting key
 */
export function resetSetting(key) {
  db.prepare('DELETE FROM config WHERE key = ?').run(key);
  return { success: true };
}

/**
 * Reset all settings to defaults
 */
export function resetAllSettings() {
  db.prepare('DELETE FROM config').run();
  return { success: true };
}

// ============================================================================
// EXTERNAL CATEGORY MAPPINGS
// ============================================================================

/**
 * Get pending external category mappings (need user review)
 * @param {string} source - Optional source filter (plaid, amazon, copilot, etc.)
 * @returns {Array} Pending mappings
 */
export function getPendingExternalMappings(source = null) {
  let sql = 'SELECT * FROM external_category_mappings WHERE status = ?';
  const params = ['pending'];

  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }

  sql += ' ORDER BY created_at DESC';

  return db.prepare(sql).all(...params);
}

/**
 * Get all external category mappings
 * @returns {Array} All mappings
 */
export function getAllExternalMappings() {
  return db.prepare('SELECT * FROM external_category_mappings ORDER BY source, external_category').all();
}

/**
 * Get or create external category mapping
 * @param {string} externalCategory - External category name
 * @param {string} source - Source (plaid, amazon, copilot, etc.)
 * @returns {Object} Mapping record
 */
export function getOrCreateExternalMapping(externalCategory, source) {
  let mapping = db.prepare(
    'SELECT * FROM external_category_mappings WHERE external_category = ? AND source = ?'
  ).get(externalCategory, source);

  if (!mapping) {
    const result = db.prepare(`
      INSERT INTO external_category_mappings (
        external_category, source, status, created_at, updated_at
      ) VALUES (?, ?, 'pending', datetime('now'), datetime('now'))
    `).run(externalCategory, source);

    mapping = db.prepare('SELECT * FROM external_category_mappings WHERE id = ?').get(result.lastInsertRowid);
  }

  return mapping;
}

/**
 * Update external category mapping
 * @param {number} id - Mapping ID
 * @param {string} userCategory - User category to map to (or null for unmapped)
 * @param {string} status - Status: pending, approved, rejected, unmapped
 * @param {number} confidence - Confidence score 0-100
 */
export function updateExternalMapping(id, userCategory, status = 'approved', confidence = 100) {
  db.prepare(`
    UPDATE external_category_mappings
    SET user_category = ?, status = ?, confidence = ?,
        reviewed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(userCategory, status, confidence, id);

  return { success: true };
}

/**
 * Apply external category mapping to a transaction
 * @param {string} externalCategory - External category
 * @param {string} source - Source
 * @returns {string|null} Mapped user category or null
 */
export function getExternalCategoryMapping(externalCategory, source) {
  const mapping = db.prepare(`
    SELECT user_category FROM external_category_mappings
    WHERE external_category = ? AND source = ?
      AND status IN ('approved', 'unmapped')
  `).get(externalCategory, source);

  return mapping?.user_category || null;
}

/**
 * Get unmapped external categories from transactions
 * @returns {Array} Categories that need mapping
 */
export function getUnmappedExternalCategories() {
  return db.prepare(`
    SELECT DISTINCT
      t.external_category,
      t.category_source as source,
      COUNT(*) as transaction_count,
      MIN(t.date) as first_seen,
      MAX(t.date) as last_seen
    FROM transactions t
    LEFT JOIN external_category_mappings ecm
      ON t.external_category = ecm.external_category
      AND t.category_source = ecm.source
    WHERE t.external_category IS NOT NULL
      AND t.category_source IS NOT NULL
      AND (ecm.id IS NULL OR ecm.status = 'pending')
    GROUP BY t.external_category, t.category_source
    ORDER BY transaction_count DESC
  `).all();
}

/**
 * Delete external category mapping
 * @param {number} id - Mapping ID
 */
export function deleteExternalMapping(id) {
  db.prepare('DELETE FROM external_category_mappings WHERE id = ?').run(id);
  return { success: true };
}

/**
 * Get all Amazon items with their categorization status
 * @param {Object} filters - Optional filters (categorized, verified, orderId)
 * @returns {Array} Amazon items
 */
export function getAmazonItems(filters = {}) {
  let whereClause = 'WHERE 1=1';
  const params = [];

  if (filters.itemId) {
    whereClause += ' AND ai.id = ?';
    params.push(filters.itemId);
  }

  if (filters.itemIds && Array.isArray(filters.itemIds) && filters.itemIds.length > 0) {
    const placeholders = filters.itemIds.map(() => '?').join(',');
    whereClause += ` AND ai.id IN (${placeholders})`;
    params.push(...filters.itemIds);
  }

  if (filters.orderId) {
    whereClause += ' AND ai.order_id = ?';
    params.push(filters.orderId);
  }

  if (filters.asin) {
    whereClause += ' AND ai.asin = ?';
    params.push(filters.asin);
  }

  if (filters.categorized === 'yes') {
    whereClause += ' AND ai.user_category IS NOT NULL';
  } else if (filters.categorized === 'no') {
    whereClause += ' AND ai.user_category IS NULL';
  }

  if (filters.verified === 'yes') {
    whereClause += ' AND ai.verified = \'Yes\'';
  } else if (filters.verified === 'no') {
    whereClause += ' AND ai.verified = \'No\'';
  }

  // Build data query with pagination
  // JOIN with categories to get current category name (handles renames automatically)
  let query = `
    SELECT
      ai.*,
      COALESCE(c.name, ai.user_category) as user_category,
      c.icon as category_icon,
      c.color as category_color,
      ao.order_date,
      ao.order_id,
      ao.account_name
    FROM amazon_items ai
    JOIN amazon_orders ao ON ai.order_id = ao.order_id
    LEFT JOIN categories c ON ai.category_id = c.id
    ${whereClause}
    ORDER BY ao.order_date DESC, ai.id DESC
  `;

  // Add pagination if limit is specified
  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);

    if (filters.offset) {
      query += ' OFFSET ?';
      params.push(filters.offset);
    }
  }

  return db.prepare(query).all(...params);
}

/**
 * Update Amazon item category
 * @param {number} itemId - Item ID
 * @param {string} category - Category name
 * @param {number} confidence - Confidence score 0-100
 * @param {string} reasoning - Categorization reasoning
 */
export function updateAmazonItemCategory(itemId, category, confidence = 0, reasoning = null) {
  const categoryId = category ? getOrCreateCategoryIdByName(category) : null;

  db.prepare(`
    UPDATE amazon_items
    SET user_category = ?, category_id = ?, confidence = ?, categorization_reasoning = ?
    WHERE id = ?
  `).run(category, categoryId, confidence, reasoning, itemId);

  return { success: true };
}

/**
 * Verify Amazon item category
 * @param {number} itemId - Item ID
 */
export function verifyAmazonItemCategory(itemId) {
  db.prepare(`
    UPDATE amazon_items
    SET verified = 'Yes', confidence = 100
    WHERE id = ?
  `).run(itemId);

  return { success: true };
}

/**
 * Unverify Amazon item category
 * @param {number} itemId - Item ID
 * @param {number} originalConfidence - Original confidence to restore
 */
export function unverifyAmazonItemCategory(itemId, originalConfidence = 0) {
  db.prepare(`
    UPDATE amazon_items
    SET verified = 'No', confidence = ?
    WHERE id = ?
  `).run(originalConfidence, itemId);

  return { success: true };
}

/**
 * Update Amazon item image URL (cache scraped image URL)
 * @param {string} asin - Product ASIN
 * @param {string} imageUrl - Scraped image URL
 */
export function updateAmazonItemImageUrl(asin, imageUrl) {
  db.prepare(`
    UPDATE amazon_items
    SET image_url = ?
    WHERE asin = ?
  `).run(imageUrl, asin);

  return { success: true };
}

/**
 * Get Amazon item categorization rules
 * @returns {Array} Rules
 */
export function getAmazonItemRules() {
  return db.prepare(`
    SELECT * FROM amazon_item_rules
    ORDER BY accuracy_rate DESC, usage_count DESC
  `).all();
}

/**
 * Get enabled Amazon item categorization rules
 * @returns {Array} Enabled rules
 */
export function getEnabledAmazonItemRules() {
  return db.prepare(`
    SELECT * FROM amazon_item_rules
    WHERE enabled = 'Yes'
    ORDER BY accuracy_rate DESC, usage_count DESC
  `).all();
}

/**
 * Create Amazon item categorization rule
 * @param {Object} ruleData - Rule data
 * @returns {Object} Result with rule ID
 */
export function createAmazonItemRule(ruleData) {
  const {
    name,
    pattern,
    category,
    matchType = 'partial',
    ruleSource = 'user',
    asin = null,
    amazonCategory = null
  } = ruleData;

  const now = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO amazon_item_rules
    (name, pattern, category, match_type, rule_source, asin, amazon_category, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, pattern, category, matchType, ruleSource, asin, amazonCategory, now, now);

  return { success: true, id: result.lastInsertRowid };
}

/**
 * Update Amazon item rule usage stats
 * @param {number} ruleId - Rule ID
 * @param {boolean} wasCorrect - Whether the categorization was correct
 */
export function updateAmazonItemRuleStats(ruleId, wasCorrect = true) {
  const now = new Date().toISOString();

  if (wasCorrect) {
    db.prepare(`
      UPDATE amazon_item_rules
      SET usage_count = usage_count + 1,
          correct_count = correct_count + 1,
          accuracy_rate = CAST(correct_count + 1 AS REAL) / (usage_count + 1),
          last_used = ?,
          updated_at = ?
      WHERE id = ?
    `).run(now, now, ruleId);
  } else {
    db.prepare(`
      UPDATE amazon_item_rules
      SET usage_count = usage_count + 1,
          incorrect_count = incorrect_count + 1,
          accuracy_rate = CAST(correct_count AS REAL) / (usage_count + 1),
          last_used = ?,
          updated_at = ?
      WHERE id = ?
    `).run(now, now, ruleId);
  }

  return { success: true };
}

/**
 * Delete Amazon item rule
 * @param {number} ruleId - Rule ID
 */
export function deleteAmazonItemRule(ruleId) {
  db.prepare('DELETE FROM amazon_item_rules WHERE id = ?').run(ruleId);
  return { success: true };
}

/**
 * Find Amazon item rule by title pattern
 * @param {string} title - Item title
 * @returns {Object|null} Matching rule or null
 */
export function findAmazonItemRuleByTitle(title) {
  const rules = getEnabledAmazonItemRules();

  for (const rule of rules) {
    const pattern = rule.pattern;
    const matchType = rule.match_type;

    try {
      if (matchType === 'exact') {
        if (title.toLowerCase() === pattern.toLowerCase()) {
          return rule;
        }
      } else if (matchType === 'partial') {
        if (title.toLowerCase().includes(pattern.toLowerCase())) {
          return rule;
        }
      } else if (matchType === 'regex') {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(title)) {
          return rule;
        }
      }
    } catch (error) {
      console.error(`Error matching rule ${rule.id}:`, error);
    }
  }

  return null;
}

/**
 * Find Amazon item rule by ASIN
 * @param {string} asin - Product ASIN
 * @returns {Object|null} Matching rule or null
 */
export function findAmazonItemRuleByASIN(asin) {
  if (!asin) return null;

  return db.prepare(`
    SELECT * FROM amazon_item_rules
    WHERE asin = ? AND enabled = 'Yes'
    ORDER BY accuracy_rate DESC, usage_count DESC
    LIMIT 1
  `).get(asin);
}

/**
 * Get Amazon item categorization stats
 * @returns {Object} Stats
 */
export function getAmazonItemStats() {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_items,
      COUNT(CASE WHEN user_category IS NOT NULL THEN 1 END) as categorized_items,
      COUNT(CASE WHEN verified = 'Yes' THEN 1 END) as verified_items,
      AVG(CASE WHEN user_category IS NOT NULL THEN confidence ELSE NULL END) as avg_confidence
    FROM amazon_items
  `).get();

  return {
    total_items: stats.total_items || 0,
    categorized_items: stats.categorized_items || 0,
    verified_items: stats.verified_items || 0,
    avg_confidence: stats.avg_confidence || 0,
    uncategorized_items: (stats.total_items || 0) - (stats.categorized_items || 0)
  };
}

// ============================================================================
// AI CATEGORIZATION FUNCTIONS
// ============================================================================

/**
 * Save AI categorization result
 */
export function saveAICategorization(itemId, itemType, category, confidence, method, alternatives = null, reasoning = null, userConfirmed = 'No') {
  const stmt = db.prepare(`
    INSERT INTO ai_categorizations (
      item_id, item_type, category, confidence, method,
      alternatives, reasoning, user_confirmed, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const alternativesJson = alternatives ? JSON.stringify(alternatives) : null;

  return stmt.run(itemId, itemType, category, confidence, method, alternativesJson, reasoning, userConfirmed);
}

/**
 * Get AI categorization for an item
 */
export function getAICategorization(itemId, itemType) {
  const result = db.prepare(`
    SELECT * FROM ai_categorizations
    WHERE item_id = ? AND item_type = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(itemId, itemType);

  if (result && result.alternatives) {
    try {
      result.alternatives = JSON.parse(result.alternatives);
    } catch (e) {
      result.alternatives = [];
    }
  }

  return result;
}

/**
 * Save AI feedback (user correction)
 */
export function saveAIFeedback(itemId, itemType, suggestedCategory, actualCategory, suggestionMethod = null, suggestionConfidence = null) {
  const stmt = db.prepare(`
    INSERT INTO ai_feedback (
      item_id, item_type, suggested_category, actual_category,
      suggestion_method, suggestion_confidence, processed, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'No', datetime('now'))
  `);

  return stmt.run(itemId, itemType, suggestedCategory, actualCategory, suggestionMethod, suggestionConfidence);
}

/**
 * Get unprocessed AI feedback for learning
 */
export function getUnprocessedFeedback(limit = 100) {
  return db.prepare(`
    SELECT * FROM ai_feedback
    WHERE processed = 'No'
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit);
}

/**
 * Get feedback count since last training
 */
export function getFeedbackCountSinceLastTraining() {
  const lastTraining = db.prepare(`
    SELECT timestamp FROM ai_training_history
    ORDER BY timestamp DESC
    LIMIT 1
  `).get();

  if (!lastTraining) {
    return db.prepare(`SELECT COUNT(*) as count FROM ai_feedback WHERE processed = 'No'`).get().count;
  }

  return db.prepare(`
    SELECT COUNT(*) as count FROM ai_feedback
    WHERE created_at > ? AND processed = 'No'
  `).get(lastTraining.timestamp).count;
}

/**
 * Mark feedback as processed
 */
export function markFeedbackAsProcessed(feedbackIds) {
  if (!Array.isArray(feedbackIds) || feedbackIds.length === 0) return;

  const placeholders = feedbackIds.map(() => '?').join(',');
  const stmt = db.prepare(`
    UPDATE ai_feedback
    SET processed = 'Yes'
    WHERE id IN (${placeholders})
  `);

  return stmt.run(...feedbackIds);
}

/**
 * Save AI training history
 */
export function saveAITrainingHistory(feedbackCount, rulesGenerated = 0, embeddingsUpdated = 0, durationMs = null, triggerType = 'manual', notes = null) {
  const stmt = db.prepare(`
    INSERT INTO ai_training_history (
      timestamp, feedback_count, rules_generated, embeddings_updated,
      duration_ms, trigger_type, notes
    ) VALUES (datetime('now'), ?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(feedbackCount, rulesGenerated, embeddingsUpdated, durationMs, triggerType, notes);
}

/**
 * Get AI training history
 */
export function getAITrainingHistory(limit = 10) {
  return db.prepare(`
    SELECT * FROM ai_training_history
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Get last training timestamp
 */
export function getLastTrainingTimestamp() {
  const result = db.prepare(`
    SELECT timestamp FROM ai_training_history
    ORDER BY timestamp DESC
    LIMIT 1
  `).get();

  return result ? result.timestamp : null;
}

/**
 * Save or update embedding for an item
 */
export function saveEmbedding(itemId, itemType, embeddingText, embeddingVector, category, userConfirmed = 'No') {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO ai_embeddings (
      item_id, item_type, embedding_text, embedding_vector, category,
      user_confirmed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?,
      COALESCE((SELECT created_at FROM ai_embeddings WHERE item_id = ? AND item_type = ?), datetime('now')),
      datetime('now')
    )
  `);

  const vectorJson = JSON.stringify(embeddingVector);
  return stmt.run(itemId, itemType, embeddingText, vectorJson, category, userConfirmed, itemId, itemType);
}

/**
 * Get embedding for an item
 */
export function getEmbedding(itemId, itemType) {
  const result = db.prepare(`
    SELECT * FROM ai_embeddings
    WHERE item_id = ? AND item_type = ?
  `).get(itemId, itemType);

  if (result && result.embedding_vector) {
    try {
      result.embedding_vector = JSON.parse(result.embedding_vector);
    } catch (e) {
      result.embedding_vector = [];
    }
  }

  return result;
}

/**
 * Get all confirmed embeddings for similarity search
 */
export function getConfirmedEmbeddings(itemType = null, limit = 1000) {
  let query = `
    SELECT * FROM ai_embeddings
    WHERE user_confirmed = 'Yes'
  `;

  if (itemType) {
    query += ` AND item_type = ?`;
  }

  query += ` ORDER BY updated_at DESC LIMIT ?`;

  const results = itemType
    ? db.prepare(query).all(itemType, limit)
    : db.prepare(query).all(limit);

  // Parse embedding vectors
  return results.map(r => {
    try {
      r.embedding_vector = JSON.parse(r.embedding_vector);
    } catch (e) {
      r.embedding_vector = [];
    }
    return r;
  });
}

/**
 * Delete embeddings for an item
 */
export function deleteEmbedding(itemId, itemType) {
  return db.prepare(`
    DELETE FROM ai_embeddings
    WHERE item_id = ? AND item_type = ?
  `).run(itemId, itemType);
}

/**
 * Save or update AI metrics for a date
 */
export function saveAIMetrics(date, itemType, totalCategorizations, correctCategorizations, avgConfidence, methodBreakdown, confidenceBreakdown) {
  const accuracyRate = totalCategorizations > 0 ? correctCategorizations / totalCategorizations : 0;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO ai_metrics (
      date, item_type, total_categorizations, correct_categorizations,
      accuracy_rate, avg_confidence, method_breakdown, confidence_breakdown
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    date,
    itemType,
    totalCategorizations,
    correctCategorizations,
    accuracyRate,
    avgConfidence,
    JSON.stringify(methodBreakdown),
    JSON.stringify(confidenceBreakdown)
  );
}

/**
 * Get AI metrics for a date range
 */
export function getAIMetrics(itemType = null, startDate = null, endDate = null) {
  let query = `SELECT * FROM ai_metrics WHERE 1=1`;
  const params = [];

  if (itemType) {
    query += ` AND item_type = ?`;
    params.push(itemType);
  }

  if (startDate) {
    query += ` AND date >= ?`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND date <= ?`;
    params.push(endDate);
  }

  query += ` ORDER BY date DESC`;

  const results = db.prepare(query).all(...params);

  // Parse JSON fields
  return results.map(r => {
    try {
      r.method_breakdown = JSON.parse(r.method_breakdown);
      r.confidence_breakdown = JSON.parse(r.confidence_breakdown);
    } catch (e) {
      r.method_breakdown = {};
      r.confidence_breakdown = {};
    }
    return r;
  });
}

/**
 * Get AI categorization accuracy by method
 */
export function getCategorizationAccuracyByMethod(itemType = null, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  let query = `
    SELECT
      c.method,
      COUNT(*) as total,
      SUM(CASE WHEN c.user_confirmed = 'Yes' THEN 1 ELSE 0 END) as confirmed,
      AVG(c.confidence) as avg_confidence
    FROM ai_categorizations c
    WHERE c.created_at >= ?
  `;

  const params = [startDateStr];

  if (itemType) {
    query += ` AND c.item_type = ?`;
    params.push(itemType);
  }

  query += `
    GROUP BY c.method
    ORDER BY total DESC
  `;

  const results = db.prepare(query).all(...params);

  return results.map(r => ({
    ...r,
    accuracy: r.total > 0 ? r.confirmed / r.total : 0
  }));
}

/**
 * Create auto-generated categorization rule
 */
export function createAutoGeneratedRule(name, pattern, category, matchType = 'regex', confidenceOverride = null, ruleSource = 'ai_learning') {
  const stmt = db.prepare(`
    INSERT INTO category_rules (
      name, pattern, category, match_type, enabled,
      auto_generated, confidence_override, rule_source,
      user_created, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'Yes', 'Yes', ?, ?, 'No', datetime('now'), datetime('now'))
  `);

  return stmt.run(name, pattern, category, matchType, confidenceOverride, ruleSource);
}

/**
 * Get patterns from feedback for rule generation
 */
export function getFeedbackPatternsForRuleGeneration() {
  // Get item patterns that have been corrected multiple times to the same category
  const itemPatterns = db.prepare(`
    SELECT
      f.item_id,
      f.item_type,
      f.actual_category,
      COUNT(*) as correction_count,
      GROUP_CONCAT(f.suggested_category) as suggested_categories
    FROM ai_feedback f
    WHERE f.processed = 'No'
    GROUP BY f.item_id, f.item_type, f.actual_category
    HAVING correction_count >= 2
    ORDER BY correction_count DESC
  `).all();

  return itemPatterns;
}

/**
 * Get Amazon item by ID
 */
export function getAmazonItemById(itemId) {
  return db.prepare('SELECT * FROM amazon_items WHERE id = ?').get(itemId);
}

/**
 * Get transaction by ID
 */
export function getTransactionById(transactionId) {
  return db.prepare('SELECT * FROM transactions WHERE transaction_id = ?').get(transactionId);
}

/**
 * Get multiple transactions by their IDs (optimized for bulk lookups)
 */
export function getTransactionsByIds(transactionIds) {
  if (!transactionIds || transactionIds.length === 0) {
    return [];
  }
  const placeholders = transactionIds.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM transactions WHERE transaction_id IN (${placeholders})`).all(...transactionIds);
}
