# Expense Tracker (Google Sheets Edition)

A self-hosted expense tracking system that automatically syncs transactions from your bank accounts using Plaid API and stores them in Google Sheets.

## ✨ Why Google Sheets?

- ✅ **Familiar Interface** - View and edit in a spreadsheet you already know
- ✅ **Access Anywhere** - Phone, tablet, computer - works everywhere
- ✅ **Built-in Charts** - Create pivot tables and visualizations instantly
- ✅ **Easy Sharing** - Share with spouse, accountant, or financial advisor
- ✅ **Version History** - Never lose data, every change is tracked
- ✅ **No Database** - No server maintenance or backups needed
- ✅ **Manual Editing** - Easily add notes, fix errors, or categorize transactions

## 📊 Features

**Current (Phase 1)**
- Connect multiple bank accounts via Plaid
- Automatic transaction syncing (weekly or on-demand)
- All data stored in your Google Sheet
- Command-line interface for syncing and viewing
- Pre-loaded expense categories
- Basic spending statistics

**Planned (Future Phases)**
- Auto-categorization with custom rules
- Monthly budgeting and tracking
- Spending analysis dashboard
- Recurring transaction detection
- Budget alerts

## Prerequisites

- Node.js 18+ (check with `node --version`)
- Google account
- Plaid developer account (free at https://plaid.com)

## 📦 Installation

```bash
# Extract the archive
tar -xzf expense-tracker.tar.gz
cd expense-tracker

# Install dependencies
npm install
```

## ⚙️ Setup

### Quick Setup (Interactive)

```bash
npm run setup
```

This will guide you through:
1. Creating Google Sheets service account
2. Creating/connecting a spreadsheet
3. Adding Plaid API credentials

### Manual Setup

<details>
<summary>Click to expand manual setup instructions</summary>

#### 1. Google Sheets Setup

**Create Service Account:**

1. Go to https://console.cloud.google.com/
2. Create a new project or select existing
3. Enable **Google Sheets API**
   - Go to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"
4. Create Service Account
   - Go to "IAM & Admin" > "Service Accounts"
   - Click "Create Service Account"
   - Name: "Expense Tracker"
   - No role needed
5. Create Key
   - Click on the service account
   - Go to "Keys" tab
   - "Add Key" > "Create New Key" > "JSON"
   - Download the JSON file
6. Save credentials
   - Create `credentials/` folder
   - Save the JSON file as `credentials/google-credentials.json`

**Create Spreadsheet:**

1. Go to https://sheets.google.com
2. Create new spreadsheet named "Expense Tracker"
3. Copy the **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
   ```
4. **IMPORTANT:** Share the spreadsheet
   - Click "Share" button
   - Add the service account email (from the JSON file: `client_email`)
   - Set permission to **Editor**
   - Uncheck "Notify people"

**Update config.json:**
```json
{
  "google_sheet_id": "YOUR_SPREADSHEET_ID",
  "plaid_client_id": "YOUR_PLAID_CLIENT_ID",
  "plaid_secret": "YOUR_PLAID_SECRET",
  "plaid_env": "sandbox"
}
```

#### 2. Plaid API Setup

1. Sign up at https://dashboard.plaid.com/signup
2. Create a new application
3. Go to **Team Settings** → **Keys**
4. Copy `client_id` and `sandbox secret`
5. Add to `config.json`

</details>

## 🚀 Usage

### Link Your First Bank Account

**For Testing (Sandbox):**

```bash
# Step 1: Generate link token
npm run link

# Step 2: In sandbox mode, test credentials:
# - Institution: "Chase" (or any)
# - Username: user_good
# - Password: pass_good
# Complete OAuth and get public_token

# Step 3: Exchange token
npm start exchange -- --token public-sandbox-xxxxx
```

**For Real Banks:**

You'll need to integrate Plaid Link (web frontend) to connect real banks. See: https://plaid.com/docs/link/

### Sync Transactions

```bash
# Sync last 30 days
npm run sync

# Sync specific date range
npm start sync --start 2024-01-01 --end 2024-12-31
```

### View Your Data

```bash
# Open spreadsheet in browser
npm run open

# List accounts in terminal
npm run accounts

# Show recent transactions
npm run transactions

# Show statistics
npm start stats
```

### Example Output

**Accounts:**
```
💳 Connected Accounts (3 total)

┌─────────┬──────────────────┬──────────┬──────────┬────────────────┐
│ Bank    │ Account          │ Type     │ Balance  │ Last Synced    │
├─────────┼──────────────────┼──────────┼──────────┼────────────────┤
│ Chase   │ Checking ****1234│ checking │ $5,432.10│ 12/19/24 3:45pm│
│         │ Savings ****5678 │ savings  │ $12,000  │                │
└─────────┴──────────────────┴──────────┴──────────┴────────────────┘
```

**Transactions:**
```
💵 Recent Transactions (20)

┌───────────┬────────────────────────┬─────────┬──────────┬──────────┐
│ Date      │ Description            │ Account │ Category │ Amount   │
├───────────┼────────────────────────┼─────────┼──────────┼──────────┤
│ 2024-12-19│ Whole Foods            │ Checking│ Groceries│ -$87.32  │
│ 2024-12-18│ Shell Gas              │ Checking│ Gas      │ -$45.00  │
│ 2024-12-18│ Paycheck Deposit       │ Checking│ Income   │ +$2,500  │
└───────────┴────────────────────────┴─────────┴──────────┴──────────┘
```

## 📊 Google Sheets Structure

Your spreadsheet will have 4 sheets:

### 1. Transactions (Main Sheet)
| Transaction ID | Date | Description | Merchant | Account | Amount | Category | Pending | Notes |
|---|---|---|---|---|---|---|---|---|
| txn_xxx | 2024-12-19 | Whole Foods | Whole Foods | Checking | -87.32 | Groceries | No | |

**Tips:**
- Add categories manually or use dropdown
- Add notes for specific transactions
- Create pivot tables to analyze spending
- Use filters to find specific transactions

### 2. Accounts
| Account ID | Institution | Account Name | Type | Balance | Last Updated |
|---|---|---|---|---|---|
| acc_xxx | Chase | Checking ****1234 | checking | 5432.10 | 2024-12-19 |

### 3. Categories
| Category | Parent Category |
|---|---|
| Groceries | |
| Restaurants | |
| Gas | Transportation |

**Customize:** Add your own categories here!

### 4. PlaidItems (Internal)
Stores bank connection details. Don't edit manually.

## 📈 Advanced Google Sheets Usage

### Create a Monthly Budget Tracker

1. Add a new sheet named "Budget"
2. Create columns: `Category`, `Budget`, `Spent`, `Remaining`
3. Use formulas to sum from Transactions:
   ```
   =SUMIF(Transactions!G:G, "Groceries", Transactions!F:F)
   ```

### Create Spending Charts

1. Select data in Transactions sheet
2. Insert > Chart
3. Choose chart type (pie, line, column)
4. Customize as needed

### Monthly Spending Summary

1. Insert > Pivot table
2. Rows: Category
3. Values: SUM of Amount
4. Filter: Date range

### Track Net Worth

1. Create "Net Worth" sheet
2. Use `SUMIF` to total all account balances
3. Create line chart over time

## 🤖 Automation

### Weekly Sync with Cron

```bash
# Edit crontab
crontab -e

# Add line for weekly Sunday sync at 8am
0 8 * * 0 cd /path/to/expense-tracker && npm run sync >> logs/sync.log 2>&1
```

### Using systemd Timer (Linux)

Create `/etc/systemd/system/expense-sync.service`:
```ini
[Unit]
Description=Expense Tracker Sync

[Service]
Type=oneshot
User=your-user
WorkingDirectory=/path/to/expense-tracker
ExecStart=/usr/bin/npm run sync
```

Create `/etc/systemd/system/expense-sync.timer`:
```ini
[Unit]
Description=Run Expense Sync Weekly

[Timer]
OnCalendar=weekly

[Install]
WantedBy=timers.target
```

Enable:
```bash
sudo systemctl enable expense-sync.timer
sudo systemctl start expense-sync.timer
```

## 🐳 Docker Deployment

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

CMD ["npm", "run", "sync"]
```

Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  expense-sync:
    build: .
    environment:
      - TZ=America/New_York
    volumes:
      - ./config.json:/app/config.json:ro
      - ./credentials:/app/credentials:ro
```

Run:
```bash
docker-compose up
```

## 🚀 Future Enhancements

### Phase 2: Auto-Categorization
- Machine learning on merchant names
- Custom rules (regex matching)
- Learn from manual categorizations

### Phase 3: Budgeting
- Monthly budget tracking per category
- Over-budget alerts
- Budget vs actual comparison charts

### Phase 4: Web Dashboard
- React/Next.js frontend
- Interactive charts with Chart.js
- Mobile-responsive design

### Phase 5: Advanced Features
- Recurring transaction detection
- Bill payment reminders
- Savings goals tracking
- Investment account integration
- Net worth tracking over time
- Tax category mapping

## 🔒 Security & Privacy

### Best Practices

1. **Protect Access Tokens**
   - Never commit `config.json` to git
   - Plaid access tokens provide full bank access
   - Service account credentials are sensitive

2. **Share Spreadsheet Carefully**
   - Only share with trusted people
   - Use "Can View" for read-only access
   - Use "Can Edit" for collaboration

3. **Use Environment Variables in Production**
   ```bash
   export PLAID_CLIENT_ID="xxx"
   export PLAID_SECRET="xxx"
   export GOOGLE_SHEET_ID="xxx"
   ```

4. **Regular Audits**
   - Review Plaid connected apps regularly
   - Check Google Sheet sharing settings
   - Monitor for unauthorized access

### Data Privacy

- All data stays in **your** Google account
- Plaid uses bank-level encryption
- Service account only accesses your spreadsheet
- No data sent to third parties

## 🐛 Troubleshooting

### "Failed to initialize Google Sheets"

**Problem:** Can't connect to spreadsheet

**Solutions:**
1. Check service account email is shared on spreadsheet
2. Verify spreadsheet ID in `config.json`
3. Ensure `credentials/google-credentials.json` exists
4. Check service account has Editor permission

### "Invalid credentials" (Plaid)

**Problem:** Plaid authentication fails

**Solutions:**
1. Verify `client_id` and `secret` in config
2. Check you're using correct environment (sandbox/development/production)
3. Ensure Plaid account is active

### "Item login required"

**Problem:** Bank requires re-authentication

**Solutions:**
1. Bank password changed - relink account
2. Bank security update - relink account
3. Use Plaid Link Update Mode to refresh

### Transactions not syncing

**Possible causes:**
1. Network connectivity issues
2. Plaid API rate limits
3. Bank temporarily unavailable
4. Account not properly linked

**Debug:**
```bash
# Run sync with verbose output
npm run sync 2>&1 | tee sync-debug.log
```

### Duplicate transactions

**Problem:** Same transaction appears multiple times

**Cause:** Running sync multiple times with overlapping dates

**Solution:** Transactions have unique IDs and won't duplicate - check your Sheet for duplicates manually and delete them.

## 📝 Command Reference

```bash
# Setup and configuration
npm run setup              # Interactive setup wizard

# Account management
npm run link               # Generate link token
npm start exchange -t TOKEN # Link bank account

# Data syncing
npm run sync               # Sync last 30 days
npm start sync --start DATE --end DATE  # Sync date range

# Viewing data
npm run open               # Open Google Sheet in browser
npm run accounts           # List accounts
npm run transactions       # Show recent transactions
npm run transactions -l 50 # Show 50 transactions
npm start stats            # Show statistics
npm start stats -s START -e END  # Stats for date range
npm start categories       # List categories
```

## 💡 Tips & Tricks

1. **Add Custom Formulas** - Google Sheets supports any formula
2. **Conditional Formatting** - Highlight overspending in red
3. **Data Validation** - Create dropdown for categories
4. **Apps Script** - Automate with JavaScript
5. **Import/Export** - Export to Excel, CSV anytime
6. **Mobile App** - Use Google Sheets app for on-the-go access
7. **Sharing** - Share read-only with family members

## 📚 Resources

- [Plaid Documentation](https://plaid.com/docs/)
- [Google Sheets API](https://developers.google.com/sheets/api)
- [Google Apps Script](https://developers.google.com/apps-script)

## 📄 License

MIT

## 🤝 Contributing

This is a personal project template. Feel free to fork and customize for your needs!

---

**Happy Tracking! 💰📊**
