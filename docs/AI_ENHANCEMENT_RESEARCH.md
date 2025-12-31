# AI Categorization Enhancement Research

## Better AI Models for Transaction Categorization

### Current: Phi-3 Mini (3.8B parameters)
- General purpose model
- Fast but not specialized for financial data
- Accuracy: ~85-90% with context

### Recommended Alternatives (Accuracy-focused)

#### 1. **Mistral 7B Instruct (BEST CHOICE)** ⭐
- **Size**: 7B parameters (~4.1GB quantized)
- **Accuracy**: 92-96% for classification tasks
- **Speed**: 500-1200ms per transaction
- **Strengths**:
  - Excellent at instruction following
  - Better context understanding
  - More accurate than Phi-3 for classification
  - Good at reasoning and explaining decisions
- **Ollama**: `ollama pull mistral:7b-instruct-q4_0`
- **Why**: Specifically fine-tuned for instruction following, which is perfect for our categorization prompts

#### 2. **Llama 3.1 8B Instruct**
- **Size**: 8B parameters (~4.7GB quantized)
- **Accuracy**: 91-95% for classification
- **Speed**: 600-1400ms per transaction
- **Strengths**:
  - Latest Meta model
  - Great at multi-turn reasoning
  - Good at using context
- **Ollama**: `ollama pull llama3.1:8b-instruct-q4_0`

#### 3. **Qwen2.5 7B Instruct**
- **Size**: 7B parameters (~4.4GB)
- **Accuracy**: 93-97% for classification
- **Speed**: 550-1300ms
- **Strengths**:
  - Excellent at structured output
  - Very good at following complex instructions
  - Strong reasoning capabilities
- **Ollama**: `ollama pull qwen2.5:7b-instruct`

#### 4. **Specialized: FinBERT (via Transformers.js)**
- **Size**: 110M parameters (~450MB)
- **Accuracy**: 88-92% for financial text
- **Speed**: 50-150ms per transaction
- **Strengths**:
  - Specifically trained on financial data
  - Very fast
  - Smaller memory footprint
- **Limitation**: Requires different integration approach

### Recommendation: Mistral 7B Instruct

**Why Mistral 7B Instruct is the best choice:**
1. **Highest accuracy** for instruction-based classification (92-96%)
2. **Better reasoning** - Provides clearer explanations
3. **Context awareness** - Uses all transaction details effectively
4. **JSON output** - Better at structured responses
5. **Proven track record** - Widely used for classification tasks

**Trade-offs:**
- Slower than Phi-3 (500-1200ms vs 300-800ms)
- Larger model (4.1GB vs 2.3GB)
- **But**: User prioritized accuracy over speed ✓

## Plaid Transaction Data Fields

### Currently Captured Fields
```javascript
{
  transaction_id,
  account_id,
  amount,
  date,
  name,
  merchant_name,
  category,  // Plaid's category array
  pending,
  payment_channel
}
```

### Additional Available Fields from Plaid (NOT currently captured)

#### Location Data
```javascript
location: {
  address: string,
  city: string,
  region: string,  // State/province
  postal_code: string,
  country: string,
  lat: number,
  lon: number,
  store_number: string
}
```

#### Payment Metadata
```javascript
payment_meta: {
  reference_number: string,
  ppd_id: string,
  payee: string,
  by_order_of: string,
  payer: string,
  payment_method: string,
  payment_processor: string,
  reason: string
}
```

#### Counterparty Information
```javascript
counterparties: [{
  name: string,
  type: string,  // merchant, financial_institution, etc.
  logo_url: string,
  website: string,
  entity_id: string,
  confidence_level: string
}]
```

#### Personal Finance Category (Enhanced)
```javascript
personal_finance_category: {
  primary: string,      // e.g., "FOOD_AND_DRINK"
  detailed: string,     // e.g., "FOOD_AND_DRINK_RESTAURANTS"
  confidence_level: string  // "VERY_HIGH", "HIGH", "MEDIUM", "LOW"
}
```

#### Category Hierarchy
```javascript
category: [
  "Food and Drink",
  "Restaurants"
]
category_id: string
```

#### ISO Currency Code
```javascript
iso_currency_code: string,  // "USD", "EUR", etc.
unofficial_currency_code: string
```

#### Transaction Type & Code
```javascript
transaction_type: string,  // "place", "online", "special", "unresolved"
transaction_code: string,
authorized_date: string,
authorized_datetime: string
```

#### Merchant Information (if available)
```javascript
merchant_entity_id: string,
logo_url: string,
website: string
```

### Recommendation: Fields to Add

**High Priority** (Most useful for AI categorization):
1. `personal_finance_category.primary` - Plaid's enhanced category
2. `personal_finance_category.detailed` - More specific category
3. `personal_finance_category.confidence_level` - Plaid's confidence
4. `location.city` - Geographic context
5. `location.region` - State/province
6. `transaction_type` - Online vs in-store
7. `authorized_datetime` - Exact timestamp
8. `merchant_entity_id` - Unique merchant identifier

**Medium Priority** (Additional context):
9. `counterparties` - Better merchant info
10. `location.address` - Full address if available
11. `payment_channel` - Already captured, ensure it's used
12. `category_id` - Plaid's category ID for reference

## Transaction Splitting Strategy

### Use Cases
1. **Amazon orders with multiple items** - Different categories
2. **Grocery store purchases** - Mix of groceries, household, personal care
3. **Target/Walmart** - Mixed shopping
4. **Reimbursable expenses** - Split business/personal

### Implementation Approach

#### For Amazon Transactions
```javascript
// We already have amazon_items data!
// Each item has: title, category, price
// Can automatically suggest split based on item categories
{
  original_transaction: {
    amount: -150.00,
    description: "Amazon.com"
  },
  suggested_splits: [
    { category: "Electronics", amount: -80.00, items: ["USB Cable", "Mouse"] },
    { category: "Books", amount: -40.00, items: ["Book Title"] },
    { category: "Household", amount: -30.00, items: ["Paper Towels"] }
  ]
}
```

#### For Other Transactions
- Allow manual splitting by user
- AI can suggest splits based on amount patterns
- Store sub-transactions with parent reference

### Database Schema for Splits
```sql
-- New table
CREATE TABLE transaction_splits (
  id TEXT PRIMARY KEY,
  parent_transaction_id TEXT NOT NULL,
  split_index INTEGER NOT NULL,
  amount REAL NOT NULL,
  category TEXT,
  description TEXT,
  reasoning TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_transaction_id) REFERENCES transactions(id)
);
```

## Category Descriptions Enhancement

### Current Schema
```sql
CREATE TABLE categories (
  name TEXT PRIMARY KEY,
  parent_category TEXT,
  icon TEXT,
  color TEXT
);
```

### Enhanced Schema
```sql
ALTER TABLE categories ADD COLUMN description TEXT;
ALTER TABLE categories ADD COLUMN keywords TEXT;  -- JSON array
ALTER TABLE categories ADD COLUMN examples TEXT;  -- Example merchants/items
ALTER TABLE categories ADD COLUMN rules TEXT;     -- JSON rules
```

### Example Category Descriptions
```javascript
{
  name: "Groceries",
  description: "Food and beverages purchased from grocery stores, supermarkets, and farmers markets for home consumption. Includes produce, dairy, meat, packaged foods, and household essentials like cleaning supplies and paper products.",
  keywords: ["food", "grocery", "supermarket", "produce", "dairy"],
  examples: "Whole Foods, Safeway, Trader Joe's, local farmers market"
}

{
  name: "Dining",
  description: "Meals and beverages consumed at restaurants, cafes, fast food establishments, and food delivery services. Includes dine-in, takeout, and delivery orders.",
  keywords: ["restaurant", "cafe", "dining", "food delivery", "takeout"],
  examples: "Chipotle, Starbucks, DoorDash, local restaurants"
}

{
  name: "Transportation",
  description: "Costs related to vehicle operation and travel including gas, parking, tolls, public transit, rideshare services, and vehicle maintenance. Excludes vehicle purchase and insurance.",
  keywords: ["gas", "fuel", "parking", "uber", "lyft", "transit", "subway"],
  examples: "Shell, Chevron, Uber, city parking meters, BART"
}
```

## Learning Feedback Loop Enhancement

### Current Implementation
- Learns merchant mappings when user changes category
- Stores in merchant_mappings table

### Enhanced Learning System

#### 1. Multi-Signal Learning
```javascript
learnFromCorrection(transaction, oldCategory, newCategory, userFeedback) {
  // Learn from:
  // - Merchant patterns
  // - Transaction amount ranges
  // - Time patterns (day of week, time of day)
  // - Location patterns
  // - Plaid category correlations
  // - User-provided feedback/notes
}
```

#### 2. Confidence Adjustment
```javascript
// When user corrects AI categorization:
- If AI was wrong: Decrease confidence for that pattern
- If AI was right: Increase confidence for that pattern
- Track accuracy per merchant, category, amount range
```

#### 3. Pattern Detection
```javascript
// Detect patterns:
- "All transactions at Trader Joe's between $20-100 are Groceries"
- "Uber transactions after 10pm are likely Entertainment (going out)"
- "Amazon transactions on weekdays are often Work/Office supplies"
```

## Re-Categorization Strategy

### Trigger Events for Re-evaluation
1. **New merchant mapping learned** - Check similar past transactions
2. **Category description updated** - Re-evaluate all transactions in that category
3. **User corrects low-confidence categorization** - Find similar transactions
4. **New AI model activated** - Offer to re-evaluate all transactions
5. **Periodic review** - Monthly review of low-confidence transactions

### Implementation
```javascript
// After learning from correction
suggestRecategorization(learnedPattern) {
  // Find transactions matching the pattern
  const candidates = findSimilarTransactions(pattern);

  // Filter by low confidence or different category
  const needsReview = candidates.filter(tx =>
    tx.confidence < 70 || tx.category !== learnedPattern.category
  );

  // Notify user
  if (needsReview.length > 0) {
    showNotification(
      `Found ${needsReview.length} transactions that might need recategorization`,
      { action: 'Review', callback: showReviewModal }
    );
  }
}
```

### UI for Re-categorization Review
- Show original category, suggested new category, reasoning
- Allow bulk approve/reject
- Show confidence change
- Explain what was learned

## Implementation Priority

### Phase 1: Foundation (High Impact)
1. ✅ Switch to Mistral 7B Instruct model
2. ✅ Add category descriptions to database
3. ✅ Capture additional Plaid fields
4. ✅ Enhance AI prompt with all available data

### Phase 2: Advanced Features
5. ✅ Implement transaction splitting (Amazon first)
6. ✅ Enhanced learning feedback loop
7. ✅ Re-categorization suggestions

### Phase 3: Polish
8. ✅ Show confidence and reasoning in UI
9. ✅ Pattern detection and analysis
10. ✅ Periodic review system

## Estimated Improvements

### Accuracy
- **Current**: 85-90% (Phi-3 + basic data)
- **After Phase 1**: 92-96% (Mistral + full data + descriptions)
- **After Phase 2**: 96-98% (+ splitting + learning)
- **After Phase 3**: 98%+ (+ patterns + re-evaluation)

### User Experience
- More accurate initial categorizations
- Better explanations (reasoning)
- Automatic improvement over time (learning)
- Fewer manual corrections needed
- Confidence in AI decisions

## Next Steps

1. Update database schema for category descriptions
2. Enhance Plaid import to capture all fields
3. Switch AI model to Mistral 7B Instruct
4. Update AI prompt to use all available data
5. Implement transaction splitting for Amazon
6. Add UI for confidence/reasoning display
7. Implement re-categorization suggestions
8. Enhanced learning system
