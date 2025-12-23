# Quick Start Guide

## 5-Minute Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Setup Wizard
```bash
npm run setup
```

This will guide you through:
- ✅ Creating Google Sheets service account
- ✅ Setting up your expense spreadsheet
- ✅ Configuring Plaid API credentials

### 3. Link Your First Bank (Sandbox)
```bash
npm run link
# Follow the prompts
# Use test credentials: user_good / pass_good
```

### 4. Sync Transactions
```bash
npm run sync
```

### 5. View Your Data
```bash
npm run open
```

## What You'll See

Your Google Sheet will have:

- **Transactions** - All your expenses and income
- **Accounts** - Bank account balances
- **Categories** - Organize your spending
- **PlaidItems** - Bank connections (internal)

## Next Steps

1. **Categorize Transactions** - Edit the Category column in your sheet
2. **Add Notes** - Add context to specific transactions
3. **Create Charts** - Insert > Chart to visualize spending
4. **Set Up Weekly Sync** - Add to cron for automatic updates

## Common Commands

```bash
npm run sync              # Sync transactions
npm run accounts          # List accounts
npm run transactions      # View recent transactions
npm run open             # Open spreadsheet
npm start stats          # Show statistics
```

## Need Help?

- See `README.md` for full documentation
- Check troubleshooting section for common issues
- Plaid docs: https://plaid.com/docs/

Happy tracking! 💰
