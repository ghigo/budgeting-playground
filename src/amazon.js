import * as database from './database.js';

// ============================================================================
// AMAZON ORDER MATCHING ALGORITHM
// ============================================================================

/**
 * Match Amazon orders to bank transactions
 * Returns array of matches with confidence scores
 */
export function matchAmazonOrdersToTransactions(amazonOrders, transactions) {
  const matches = [];
  const unmatchedOrders = [];

  for (const order of amazonOrders) {
    const match = findBestTransactionMatch(order, transactions);

    if (match) {
      matches.push({
        order_id: order.order_id,
        transaction_id: match.transaction.transaction_id,
        confidence: match.confidence,
        reason: match.reason
      });
    } else {
      unmatchedOrders.push(order);
    }
  }

  return { matches, unmatchedOrders };
}

/**
 * Find the best matching transaction for an Amazon order
 */
function findBestTransactionMatch(order, transactions) {
  let bestMatch = null;
  let highestConfidence = 0;

  const orderDate = new Date(order.order_date);
  const orderAmount = Math.abs(parseFloat(order.total_amount));

  for (const transaction of transactions) {
    const transactionDate = new Date(transaction.date);
    const transactionAmount = Math.abs(parseFloat(transaction.amount));

    // Skip if transaction is too far from order date (within 0-7 days after order)
    const daysDiff = Math.floor((transactionDate - orderDate) / (1000 * 60 * 60 * 24));
    if (daysDiff < 0 || daysDiff > 7) {
      continue;
    }

    // Calculate match confidence
    let confidence = 0;
    const reasons = [];

    // 1. Amount matching (40 points)
    const amountDiff = Math.abs(transactionAmount - orderAmount);
    const amountTolerance = Math.max(0.50, orderAmount * 0.01); // $0.50 or 1% of order

    if (amountDiff === 0) {
      confidence += 40;
      reasons.push('Exact amount match');
    } else if (amountDiff <= amountTolerance) {
      confidence += 35;
      reasons.push('Amount match within tolerance');
    } else if (amountDiff <= orderAmount * 0.05) {
      // Could be partial payment (gift card/points used)
      confidence += 25;
      reasons.push('Partial payment (possible gift card/points)');
    } else {
      // Amount too different, skip
      continue;
    }

    // 2. Merchant name matching (30 points)
    const description = (transaction.description || '').toLowerCase();
    const merchantName = (transaction.merchant_name || '').toLowerCase();

    if (description.includes('amazon') || merchantName.includes('amazon') ||
        description.includes('amzn') || merchantName.includes('amzn')) {
      confidence += 30;
      reasons.push('Merchant name contains Amazon/AMZN');
    } else {
      // No Amazon in description, less confident
      confidence += 5;
    }

    // 3. Date proximity (20 points)
    if (daysDiff === 0) {
      confidence += 20;
      reasons.push('Same day');
    } else if (daysDiff === 1) {
      confidence += 15;
      reasons.push('Next day');
    } else if (daysDiff <= 2) {
      confidence += 10;
      reasons.push(`${daysDiff} days later`);
    } else {
      confidence += 5;
      reasons.push(`${daysDiff} days later`);
    }

    // 4. Not already matched (10 points)
    if (!transaction.amazon_order_id) {
      confidence += 10;
      reasons.push('Transaction not already matched');
    }

    // Update best match if this is better
    if (confidence > highestConfidence && confidence >= 60) {
      highestConfidence = confidence;
      bestMatch = {
        transaction,
        confidence,
        reason: reasons.join('; ')
      };
    }
  }

  return bestMatch;
}

/**
 * Auto-match all unmatched Amazon orders to transactions
 */
export async function autoMatchAmazonOrders() {
  const unmatchedOrders = database.getUnmatchedAmazonOrders();
  const allTransactions = database.getTransactions(10000);

  const { matches, unmatchedOrders: stillUnmatched } = matchAmazonOrdersToTransactions(
    unmatchedOrders,
    allTransactions
  );

  // Apply matches to database
  let matchedCount = 0;
  for (const match of matches) {
    database.linkAmazonOrderToTransaction(
      match.order_id,
      match.transaction_id,
      match.confidence
    );
    matchedCount++;

    // Update transaction category based on Amazon data if confidence is high
    if (match.confidence >= 80) {
      const order = database.getAmazonOrderWithItems(match.order_id);
      if (order && order.items.length > 0) {
        updateTransactionCategoryFromAmazon(match.transaction_id, order);
      }
    }
  }

  return {
    matched: matchedCount,
    unmatched: stillUnmatched.length,
    matches
  };
}

/**
 * Update transaction category based on Amazon order data
 */
function updateTransactionCategoryFromAmazon(transactionId, amazonOrder) {
  // Get the primary category from Amazon items
  const categories = amazonOrder.items.map(item => item.category).filter(Boolean);

  if (categories.length === 0) {
    return;
  }

  // Use the most common category if multiple items
  const categoryCount = {};
  for (const cat of categories) {
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }

  const primaryCategory = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])[0][0];

  // Map Amazon category to our expense category
  const expenseCategory = mapAmazonCategoryToExpenseCategory(primaryCategory);

  if (expenseCategory) {
    // Update transaction with higher confidence since we have Amazon data
    database.updateTransactionCategory(transactionId, expenseCategory, 90);
  }
}

/**
 * Map Amazon product category to expense tracker category
 */
function mapAmazonCategoryToExpenseCategory(amazonCategory) {
  const categoryMap = {
    // Electronics
    'Electronics': 'Shopping > Electronics',
    'Computers': 'Shopping > Electronics',
    'Cell Phones & Accessories': 'Shopping > Electronics',
    'Camera & Photo': 'Shopping > Electronics',

    // Home & Kitchen
    'Home & Kitchen': 'Shopping > Home & Kitchen',
    'Kitchen & Dining': 'Shopping > Home & Kitchen',
    'Furniture': 'Shopping > Home & Kitchen',
    'Home Improvement': 'Shopping > Home & Kitchen',
    'Tools & Home Improvement': 'Shopping > Home & Kitchen',

    // Books & Media
    'Books': 'Shopping > Books',
    'Movies & TV': 'Entertainment',
    'Music': 'Entertainment',
    'Video Games': 'Entertainment',

    // Clothing
    'Clothing, Shoes & Jewelry': 'Shopping > Clothing',
    'Fashion': 'Shopping > Clothing',

    // Health & Beauty
    'Health & Personal Care': 'Healthcare',
    'Beauty & Personal Care': 'Shopping > Beauty',
    'Grocery & Gourmet Food': 'Groceries',

    // Sports & Outdoors
    'Sports & Outdoors': 'Shopping > Sports',
    'Outdoor Recreation': 'Shopping > Sports',

    // Toys & Baby
    'Toys & Games': 'Shopping > Toys',
    'Baby Products': 'Shopping > Baby',

    // Pets
    'Pet Supplies': 'Shopping > Pets',

    // Automotive
    'Automotive': 'Transportation > Auto Parts',

    // Office
    'Office Products': 'Shopping > Office',

    // Garden
    'Patio, Lawn & Garden': 'Shopping > Garden',
  };

  // Try exact match first
  if (categoryMap[amazonCategory]) {
    return categoryMap[amazonCategory];
  }

  // Try partial match
  for (const [key, value] of Object.entries(categoryMap)) {
    if (amazonCategory.includes(key) || key.includes(amazonCategory)) {
      return value;
    }
  }

  // Default to Shopping if no match
  return 'Shopping';
}

/**
 * Ensure expense categories exist for Amazon mappings
 */
export function ensureAmazonCategories() {
  const categories = [
    { name: 'Shopping', parent: null },
    { name: 'Shopping > Electronics', parent: 'Shopping' },
    { name: 'Shopping > Home & Kitchen', parent: 'Shopping' },
    { name: 'Shopping > Books', parent: 'Shopping' },
    { name: 'Shopping > Clothing', parent: 'Shopping' },
    { name: 'Shopping > Beauty', parent: 'Shopping' },
    { name: 'Shopping > Sports', parent: 'Shopping' },
    { name: 'Shopping > Toys', parent: 'Shopping' },
    { name: 'Shopping > Baby', parent: 'Shopping' },
    { name: 'Shopping > Pets', parent: 'Shopping' },
    { name: 'Shopping > Office', parent: 'Shopping' },
    { name: 'Shopping > Garden', parent: 'Shopping' },
    { name: 'Transportation > Auto Parts', parent: 'Transportation' },
  ];

  for (const cat of categories) {
    try {
      database.addCategory(cat.name, cat.parent);
    } catch (error) {
      // Category might already exist, that's fine
    }
  }
}

// ============================================================================
// CSV PARSING
// ============================================================================

/**
 * Parse Amazon order history CSV
 * Amazon provides different CSV formats, so we'll be flexible
 */
export function parseAmazonCSV(csvContent) {
  const lines = csvContent.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('CSV file is empty or has no data rows');
  }

  // Parse header
  const headers = parseCSVLine(lines[0]);

  // Parse rows
  const orders = [];
  const orderMap = new Map(); // Group items by order ID

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);

    if (values.length === 0 || values.length < headers.length - 5) {
      continue; // Skip empty or malformed lines
    }

    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    // Extract order data (flexible field naming)
    const orderId = row['Order ID'] || row['Order Number'] || row['order_id'] || '';
    const orderDate = row['Order Date'] || row['Purchase Date'] || row['order_date'] || '';

    // Handle Amazon's "Total Owed" field and other variations
    const totalOwed = row['Total Owed'] || row['Total'] || row['Order Total'] || row['total'] || '0';
    const totalAmount = parseFloat(totalOwed.toString().replace(/[^0-9.-]/g, '')) || 0;

    // Get item details
    const itemTitle = row['Product Name'] || row['Title'] || row['Item'] || row['title'] || '';

    // Handle Amazon's "Unit Price" field
    const unitPrice = row['Unit Price'] || row['Item Total'] || row['Price'] || row['price'] || '0';
    const itemPrice = parseFloat(unitPrice.toString().replace(/[^0-9.-]/g, '')) || 0;

    const quantity = parseInt(row['Quantity'] || '1') || 1;
    const category = row['Category'] || row['Product Group'] || row['category'] || '';
    const asin = row['ASIN'] || '';
    const seller = row['Seller'] || '';
    const orderStatus = row['Order Status'] || row['Shipment Status'] || '';

    // Validate essential fields
    if (!orderId || !orderDate) {
      console.log(`Skipping row ${i + 1}: Missing order ID or date`);
      continue;
    }

    // Skip if this is a cancelled order with no items
    if (orderStatus.toLowerCase().includes('cancel') && quantity === 0) {
      continue;
    }

    // Parse and validate date
    let parsedDate;
    try {
      parsedDate = standardizeDate(orderDate);
    } catch (error) {
      console.log(`Skipping row ${i + 1}: Invalid date format: ${orderDate}`);
      continue;
    }

    // Group by order ID
    if (!orderMap.has(orderId)) {
      orderMap.set(orderId, {
        order_id: orderId,
        order_date: parsedDate,
        total_amount: totalAmount,
        payment_method: row['Payment Instrument Type'] || '',
        order_status: orderStatus,
        items: []
      });
    }

    // Add item to order (skip if no title)
    if (itemTitle && itemTitle.trim().length > 0 && quantity > 0) {
      orderMap.get(orderId).items.push({
        title: itemTitle,
        price: itemPrice,
        quantity: quantity,
        category: category,
        asin: asin,
        seller: seller
      });
    }
  }

  // Convert map to array
  return Array.from(orderMap.values());
}

/**
 * Parse a CSV line handling quoted values
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

/**
 * Standardize date to YYYY-MM-DD format
 */
function standardizeDate(dateStr) {
  const date = new Date(dateStr);

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateStr}`);
  }

  return date.toISOString().split('T')[0];
}

/**
 * Import Amazon orders from CSV
 */
export function importAmazonOrdersFromCSV(csvContent) {
  const parsedOrders = parseAmazonCSV(csvContent);

  let importedCount = 0;
  let updatedCount = 0;

  for (const order of parsedOrders) {
    try {
      const orderId = database.upsertAmazonOrder(order);

      if (order.items && order.items.length > 0) {
        database.addAmazonItems(orderId, order.items);
      }

      importedCount++;
    } catch (error) {
      console.error(`Error importing order ${order.order_id}:`, error.message);
      updatedCount++;
    }
  }

  return {
    imported: importedCount,
    updated: updatedCount,
    total: parsedOrders.length
  };
}
