# How to Get More Historical Transaction Data

## The Problem

You discovered the root cause! Your accounts are currently limited to ~90 days of history because they were linked without the `days_requested` parameter.

**Plaid's Critical Limitation:**
- `days_requested` can **ONLY** be set when first creating an Item (during account linking)
- Once set, it **CANNOT** be changed
- To change it, you **MUST** remove the Item and re-link it

## The Fix

I've updated your code to request **730 days (2 years)** of historical data when linking accounts.

**File Changed:** `src/plaid.js`
```javascript
transactions: {
  days_requested: 730  // Request 2 years instead of default 90 days
}
```

## ⚠️ Important: You Must Re-Link Your Accounts

**This change only affects NEW account links!** Your existing accounts are still stuck at 90 days.

### Step-by-Step Re-Linking Process:

#### Option 1: Via Web UI (Easiest)

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Open in browser:**
   ```
   http://localhost:3000
   ```

3. **For each bank (Chase, AmEx, Wells Fargo):**
   - Click "Remove" next to the institution
   - Confirm removal
   - Click "Link Account"
   - Re-authenticate with your bank
   - ✅ This new link will request 730 days of history

4. **Run backfill:**
   - Click "Backfill All History" button
   - Check if you get more than 90 days of data

#### Option 2: Via Command Line

1. **List your current items:**
   ```bash
   npm run sync
   ```
   Note the item IDs for Chase, AmEx, and Wells Fargo

2. **Remove each institution** (one at a time):
   ```bash
   # Replace ITEM_ID with actual ID from step 1
   node -e "import('./src/sync.js').then(m => m.removeInstitution('ITEM_ID'))"
   ```

3. **Re-link accounts:**
   ```bash
   npm run link
   ```
   Follow the Plaid Link flow for each bank

4. **Run backfill:**
   ```bash
   npm run backfill
   ```

## Expected Results After Re-Linking

### Best Case Scenario:
Some banks will now provide up to 2 years of history:
```
📊 Historical Data Summary:
────────────────────────────────────────────────────────────────────────────────

Chase:
  Date Range: 2024-01-08 to 2026-01-08
  History Available: ~24 months  ✅ Much better!
  Transactions: 8,500 total

American Express:
  Date Range: 2024-01-08 to 2026-01-08
  History Available: ~24 months  ✅ Much better!
  Transactions: 3,200 total
```

### Realistic Scenario:
Banks may still limit you, but you should get MORE than 90 days:
```
Chase:
  Date Range: 2025-04-08 to 2026-01-08
  History Available: ~9 months  ✅ Better than 3!
  Transactions: 2,100 total
```

### Worst Case Scenario:
Some banks stubbornly only provide 90 days no matter what:
```
Wells Fargo:
  Date Range: 2025-10-08 to 2026-01-08
  History Available: ~3 months  ⚠️  Still limited
  Transactions: 81 total
```

## Why This Matters

According to Plaid docs:
- **Minimum recommended:** 180 days for recurring transaction detection
- **Optimal:** 365-730 days for best pattern analysis
- **Your old setting:** 90 days (default, suboptimal)
- **Your new setting:** 730 days (2 years, optimal)

## Important Notes

1. **Re-linking is required** - The existing Items cannot be updated
2. **Transaction history will be lost** when you remove Items (but you can export first if needed)
3. **Some banks will still limit you** to 90 days regardless of `days_requested`
4. **This is a one-time process** - once re-linked with 730 days, future syncs will maintain that history window

## Troubleshooting

If after re-linking you still only get 90 days:
- ✅ Your code is correct (it's now requesting 730 days)
- ❌ Your bank is limiting you (institution policy)
- 💡 Solution: Consider CSV import for historical data from bank website

---

**Bottom Line:** Re-link your accounts now to take advantage of the new 730-day request!
