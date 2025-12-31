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
  const usedTransactionIds = new Set();

  for (const order of amazonOrders) {
    // Skip orders with $0 total - these are typically cancelled/refunded items
    const orderAmount = Math.abs(parseFloat(order.total_amount) || 0);
    if (orderAmount === 0) {
      continue; // Don't add to matches or unmatchedOrders
    }

    const match = findBestTransactionMatch(order, transactions, usedTransactionIds);

    if (match) {
      matches.push({
        order_id: order.order_id,
        transaction_id: match.transaction.transaction_id,
        confidence: match.confidence,
        reason: match.reason
      });
      // Mark this transaction as used so no other order can match it
      usedTransactionIds.add(match.transaction.transaction_id);
    } else {
      unmatchedOrders.push(order);
    }
  }

  return { matches, unmatchedOrders };
}

/**
 * Find the best matching transaction for an Amazon order
 */
function findBestTransactionMatch(order, transactions, usedTransactionIds = new Set()) {
  let bestMatch = null;
  let highestConfidence = 0;

  const orderDate = new Date(order.order_date);
  const orderAmount = Math.abs(parseFloat(order.total_amount));

  for (const transaction of transactions) {
    // Skip if this transaction is already matched to another order
    if (usedTransactionIds.has(transaction.transaction_id)) {
      continue;
    }

    const transactionDate = new Date(transaction.date);
    const transactionAmount = Math.abs(parseFloat(transaction.amount));

    // CRITICAL: Only match transactions that have Amazon in description/merchant name
    const description = (transaction.description || '').toLowerCase();
    const merchantName = (transaction.merchant_name || '').toLowerCase();
    const hasAmazon = description.includes('amazon') || merchantName.includes('amazon') ||
                      description.includes('amzn') || merchantName.includes('amzn');

    if (!hasAmazon) {
      // Skip non-Amazon transactions entirely
      continue;
    }

    // Skip if transaction is too far from order date (within 0-7 days after order)
    const daysDiff = Math.floor((transactionDate - orderDate) / (1000 * 60 * 60 * 24));
    if (daysDiff < 0 || daysDiff > 7) {
      continue;
    }

    // Calculate match confidence
    let confidence = 0;
    const reasons = [];

    // 1. Amount matching (50 points) - STRICT matching required
    const amountDiff = Math.abs(transactionAmount - orderAmount);
    const amountTolerance = Math.max(0.50, orderAmount * 0.01); // $0.50 or 1% of order

    if (amountDiff === 0) {
      confidence += 50;
      reasons.push('Exact amount match');
    } else if (amountDiff <= amountTolerance) {
      confidence += 45;
      reasons.push('Amount match within tolerance');
    } else {
      // Amount doesn't match closely enough - skip this transaction
      // Even a small mismatch drops confidence too low to match
      continue;
    }

    // 2. Merchant name matching (30 points)
    // We already confirmed Amazon is in the name above, so always give full points
    confidence += 30;
    reasons.push('Merchant name contains Amazon/AMZN');

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

    // Update best match if this is better
    // Maximum possible score: 100 (50 amount + 30 merchant + 20 date)
    // Minimum threshold: 60% (requires good amount + merchant + reasonable date)
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

    // Get item details
    const itemTitle = row['Product Name'] || row['Title'] || row['Item'] || row['title'] || '';

    // Parse item's "Total Owed" (used for calculating order total later)
    const itemTotalOwed = row['Total Owed'] || row['Total'] || '0';
    const itemTotal = parseFloat(itemTotalOwed.toString().replace(/[^0-9.-]/g, '')) || 0;

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

    // Parse order-level fields from this row
    const website = row['Website'] || '';
    const purchaseOrderNumber = row['Purchase Order Number'] || '';
    const currency = row['Currency'] || '';

    // Parse total discounts (handle negative values in quotes like '-14.89')
    const totalDiscountsStr = row['Total Discounts'] || '0';
    const totalDiscounts = parseFloat(totalDiscountsStr.toString().replace(/[^0-9.-]/g, '')) || 0;

    // Parse shipping charge
    const shippingChargeStr = row['Shipping Charge'] || '0';
    const shippingCharge = parseFloat(shippingChargeStr.toString().replace(/[^0-9.-]/g, '')) || 0;

    // Parse subtotal (use Shipment Item Subtotal as this is order total before tax/shipping)
    const subtotalStr = row['Shipment Item Subtotal'] || '0';
    const subtotal = parseFloat(subtotalStr.toString().replace(/[^0-9.-]/g, '')) || 0;

    // Parse tax (use Shipment Item Subtotal Tax)
    const taxStr = row['Shipment Item Subtotal Tax'] || row['Unit Price Tax'] || '0';
    const tax = parseFloat(taxStr.toString().replace(/[^0-9.-]/g, '')) || 0;

    // Parse bag fee (some localities charge bag fees)
    const bagFeeStr = row['Bag Fee'] || '0';
    const bagFee = parseFloat(bagFeeStr.toString().replace(/[^0-9.-]/g, '')) || 0;

    // Debug logging for specific order
    if (orderId === '113-5656786-6886605') {
      console.log(`\n[CSV ROW DEBUG] Order ${orderId}, Item: ${itemTitle.substring(0, 40)}...`);
      console.log(`  Total Discounts field: "${totalDiscountsStr}" → parsed: ${totalDiscounts}`);
      console.log(`  Shipment Item Subtotal: "${subtotalStr}" → parsed: ${subtotal}`);
      console.log(`  Shipment Item Subtotal Tax: "${taxStr}" → parsed: ${tax}`);
      console.log(`  Bag Fee: "${bagFeeStr}" → parsed: ${bagFee}`);
      console.log(`  Shipping Charge: "${shippingChargeStr}" → parsed: ${shippingCharge}`);
    }

    const shippingAddress = row['Shipping Address'] || '';
    const billingAddress = row['Billing Address'] || '';
    const shipDate = row['Ship Date'] || '';
    const shippingOption = row['Shipping Option'] || '';

    // Group by order ID
    if (!orderMap.has(orderId)) {
      // Calculate order total using Amazon's formula:
      // Grand Total = Item Subtotal - Total Savings + Tax + Bag Fee + Shipping
      // Note: Total Discounts in CSV is Amazon's "Total Savings"
      const calculatedTotal = subtotal - Math.abs(totalDiscounts) + tax + bagFee + shippingCharge;

      orderMap.set(orderId, {
        order_id: orderId,
        order_date: parsedDate,
        total_amount: 0, // Will be calculated using Amazon's formula
        subtotal: null, // Will be set to Item Subtotal
        tax: null, // Will be set to tax + bag fee
        shipping: null, // Will be set to shipping charge
        payment_method: row['Payment Instrument Type'] || '',
        order_status: orderStatus,
        website: website,
        purchase_order_number: purchaseOrderNumber !== 'Not Applicable' ? purchaseOrderNumber : null,
        currency: currency,
        total_discounts: totalDiscounts !== 0 ? totalDiscounts : null,
        shipping_address: shippingAddress !== 'Not Available' ? shippingAddress : null,
        billing_address: billingAddress !== 'Not Available' ? billingAddress : null,
        ship_date: safeDateParse(shipDate),
        shipping_option: shippingOption !== 'Not Available' ? shippingOption : null,
        items: [],
        _itemTotals: [], // Track individual item totals for validation
        _orderLevelFields: { // Store order-level fields temporarily
          subtotal: subtotal > 0 ? subtotal : null,
          tax: tax > 0 ? tax : null,
          bagFee: bagFee > 0 ? bagFee : null,
          shipping: shippingCharge > 0 ? shippingCharge : null,
          totalDiscounts: totalDiscounts !== 0 ? totalDiscounts : null,
          calculatedTotal: calculatedTotal
        }
      });
    } else {
      // Order already exists - update fields if we find better values
      const order = orderMap.get(orderId);
      const fields = order._orderLevelFields;

      // Update subtotal if this row has a non-zero value
      if (subtotal > 0 && !fields.subtotal) {
        fields.subtotal = subtotal;
      }

      // Update tax if this row has a non-zero value
      if (tax > 0 && !fields.tax) {
        fields.tax = tax;
      }

      // Update bag fee if this row has a non-zero value
      if (bagFee > 0 && !fields.bagFee) {
        fields.bagFee = bagFee;
      }

      // Update shipping if this row has a non-zero value
      if (shippingCharge > 0 && !fields.shipping) {
        fields.shipping = shippingCharge;
      }

      // Update total discounts if this row has a non-zero value
      if (totalDiscounts !== 0 && !fields.totalDiscounts) {
        fields.totalDiscounts = totalDiscounts;
      }

      // Recalculate total with updated fields
      const sub = fields.subtotal || 0;
      const tx = fields.tax || 0;
      const bf = fields.bagFee || 0;
      const sh = fields.shipping || 0;
      const disc = fields.totalDiscounts || 0;
      fields.calculatedTotal = sub - Math.abs(disc) + tx + bf + sh;
    }

    // Track this item's total for the order (including $0 items with discounts)
    orderMap.get(orderId)._itemTotals.push(itemTotal);

    // Add item to order (skip if no title)
    if (itemTitle && itemTitle.trim().length > 0 && quantity > 0) {
      // Extract all item-level fields from CSV
      const productCondition = row['Product Condition'] || '';

      // Parse unit price tax
      const unitPriceTaxStr = row['Unit Price Tax'] || '0';
      const unitPriceTax = parseFloat(unitPriceTaxStr.toString().replace(/[^0-9.-]/g, '')) || 0;

      // Parse shipment item subtotal
      const shipmentSubtotalStr = row['Shipment Item Subtotal'] || '0';
      const shipmentSubtotal = parseFloat(shipmentSubtotalStr.toString().replace(/[^0-9.-]/g, '')) || 0;

      // Parse shipment item subtotal tax
      const shipmentSubtotalTaxStr = row['Shipment Item Subtotal Tax'] || '0';
      const shipmentSubtotalTax = parseFloat(shipmentSubtotalTaxStr.toString().replace(/[^0-9.-]/g, '')) || 0;

      const shipmentStatus = row['Shipment Status'] || '';
      const itemShipDate = row['Ship Date'] || '';
      const carrierTracking = row['Carrier Name & Tracking Number'] || '';
      const giftMessage = row['Gift Message'] || '';
      const giftSenderName = row['Gift Sender Name'] || '';
      const giftRecipientContact = row['Gift Recipient Contact Details'] || '';
      const itemSerialNumber = row['Item Serial Number'] || '';

      orderMap.get(orderId).items.push({
        title: itemTitle,
        price: itemPrice,
        quantity: quantity,
        category: category,
        asin: asin,
        seller: seller !== 'Not Available' ? seller : null,
        product_condition: productCondition,
        unit_price_tax: unitPriceTax > 0 ? unitPriceTax : null,
        shipment_item_subtotal: shipmentSubtotal > 0 ? shipmentSubtotal : null,
        shipment_item_subtotal_tax: shipmentSubtotalTax > 0 ? shipmentSubtotalTax : null,
        shipment_status: shipmentStatus !== 'Not Available' ? shipmentStatus : null,
        ship_date: safeDateParse(itemShipDate),
        carrier_tracking: carrierTracking !== 'Not Available' ? carrierTracking : null,
        gift_message: giftMessage !== 'Not Available' ? giftMessage : null,
        gift_sender_name: giftSenderName !== 'Not Available' ? giftSenderName : null,
        gift_recipient_contact: giftRecipientContact !== 'Not Available' ? giftRecipientContact : null,
        item_serial_number: itemSerialNumber !== 'Not Available' ? itemSerialNumber : null
      });
    }
  }

  // Validate and finalize order totals
  const orders = Array.from(orderMap.values());
  console.log(`\n========================================`);
  console.log(`FINALIZING ORDER TOTALS`);
  console.log(`========================================`);

  for (const order of orders) {
    // Use Amazon's calculation method: Grand Total = Item Subtotal - Total Savings + Tax + Bag Fee + Shipping
    if (order._itemTotals && order._itemTotals.length > 0) {
      const sumOfItems = order._itemTotals.reduce((sum, itemTotal) => sum + itemTotal, 0);
      const orderFields = order._orderLevelFields || {};
      const calculatedTotal = orderFields.calculatedTotal || 0;

      console.log(`\nOrder ${order.order_id}:`);
      console.log(`  Item "Total Owed" values: [${order._itemTotals.join(', ')}]`);
      console.log(`  Sum of "Total Owed": $${sumOfItems.toFixed(2)}`);
      console.log(`  Amazon's calculation:`);
      console.log(`    - Item Subtotal: $${orderFields.subtotal?.toFixed(2) || '0.00'}`);
      console.log(`    - Total Savings: -$${Math.abs(orderFields.totalDiscounts || 0).toFixed(2)}`);
      console.log(`    - Tax: $${orderFields.tax?.toFixed(2) || '0.00'}`);
      console.log(`    - Bag Fee: $${orderFields.bagFee?.toFixed(2) || '0.00'}`);
      console.log(`    - Shipping: $${orderFields.shipping?.toFixed(2) || '0.00'}`);
      console.log(`    - Grand Total: $${calculatedTotal.toFixed(2)}`);

      // Use Amazon's formula for total_amount
      order.total_amount = calculatedTotal;

      // Set breakdown fields to match Amazon's display
      order.subtotal = orderFields.subtotal; // Item Subtotal
      // Combine tax + bag fee into tax field (matching "Tax and Fees" on Amazon)
      const taxAndFees = (orderFields.tax || 0) + (orderFields.bagFee || 0);
      order.tax = taxAndFees > 0 ? taxAndFees : null;
      order.shipping = orderFields.shipping;

      console.log(`  ✓ Setting order fields:`);
      console.log(`    total_amount: $${order.total_amount.toFixed(2)}`);
      console.log(`    subtotal: $${order.subtotal?.toFixed(2) || 'null'}`);
      console.log(`    tax (includes bag fee): $${order.tax?.toFixed(2) || 'null'}`);
      console.log(`    shipping: $${order.shipping?.toFixed(2) || 'null'}`);
      console.log(`    total_discounts: $${order.total_discounts?.toFixed(2) || 'null'}`);

      // Mark that we used item totals (so we don't use fallback)
      order._usedItemTotals = true;
      // Remove temporary tracking fields
      delete order._itemTotals;
      delete order._orderLevelFields;
    }

    // Fallback: Only use item prices if we didn't have "Total Owed" data
    // This prevents overriding legitimate $0 totals (discounted/refunded orders)
    if (!order._usedItemTotals && order.items.length > 0) {
      // Sum item prices as last resort
      const itemSum = order.items.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0);
      if (itemSum > 0 && order.total_amount === 0) {
        console.log(`Order ${order.order_id}: Using sum of item prices ($${itemSum.toFixed(2)}) as fallback`);
        order.total_amount = itemSum;
      }
    }

    // Clean up tracking flag
    delete order._usedItemTotals;
  }

  return orders;
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
 * Handles multiple date formats and extracts first valid date if multiple are present
 */
function standardizeDate(dateStr) {
  // If the date string contains "and" or multiple dates, take the first one
  if (dateStr.includes(' and ')) {
    dateStr = dateStr.split(' and ')[0].trim();
  }

  // If already in YYYY-MM-DD format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  const date = new Date(dateStr);

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateStr}`);
  }

  return date.toISOString().split('T')[0];
}

/**
 * Safely parse a date field, returning null if invalid
 */
function safeDateParse(dateStr) {
  if (!dateStr || dateStr === 'Not Available' || dateStr === 'Not Applicable') {
    return null;
  }

  try {
    return standardizeDate(dateStr);
  } catch (error) {
    console.warn(`Could not parse date "${dateStr}": ${error.message}`);
    return null;
  }
}

/**
 * Import Amazon orders from CSV
 */
export function importAmazonOrdersFromCSV(csvContent, accountName = 'Primary') {
  const parsedOrders = parseAmazonCSV(csvContent);

  let importedCount = 0;
  let updatedCount = 0;

  for (const order of parsedOrders) {
    try {
      // Add account_name to each order
      order.account_name = accountName;

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
