# Project Context: Expense Tracker with Plaid + Google Sheets

## Original Requirements

**User Goal:** Build a service for tracking expenses that:
- Connects to bank providers automatically
- Downloads transactions
- Saves them to Google Sheets (initially asked about database, then switched to Google Sheets)

**User Preferences:**
- Node.js (not Python)
- Self-hosted solution
- Weekly sync frequency (not daily)
- Plans to expand to budgeting, categorization, and analysis

**User Environment:**
- Home Assistant server at ha.ggg (IP 10.10.1.15)
- Prefers self-hosted solutions
- US-based banks
- Experienced with Node.js, SSH, and command-line tools

## Solution Architecture

### Tech Stack
- **Node.js** - Main runtime
- **Plaid API** - Bank connection and transaction fetching
- **Google Sheets API** - Data storage (acts as database)
- **Commander** - CLI interface
- **Chalk + cli-table3** - Pretty terminal output
- **Inquirer** - Interactive setup wizard

### Why Google Sheets?
- Familiar spreadsheet interface
- Access from anywhere (phone, tablet, computer)
- Built-in charts and pivot tables
- Easy sharing with spouse/accountant
- Version history built-in
- No database server to maintain
- Can manually edit/categorize transactions

### Project Structure
```
expense-tracker/
├── src/
│   ├── sheets.js          # Google Sheets API client & operations
│   ├── plaid.js          # Plaid API client
│   ├── sync.js           # Sync logic (Plaid → Sheets)
│   ├── cli.js            # Command-line interface
│   └── setup-sheets.js   # Interactive setup wizard
├── credentials/          # Google service account JSON
├── config.json          # Plaid + Sheet ID configuration
├── package.json
├── README.md            # Full documentation
├── QUICKSTART.md        # 5-minute setup guide
└── ARCHITECTURE.md      # System diagrams
```

## Key Components

### 1. Google Sheets Client (src/sheets.js)
**Purpose:** Abstracts Google Sheets operations

**Sheet Structure:**
- **Transactions** - Main data (transaction_id, date, description, merchant, account, amount, category, pending, notes)
- **Accounts** - Bank accounts (account_id, institution, name, type, balance)
- **Categories** - Expense categories (name, parent_category)
- **PlaidItems** - Bank connections (item_id, access_token, institution_id, institution_name, last_synced)

**Key Functions:**
- `initializeSheets()` - Connect to Google Sheets API
- `setupSpreadsheet()` - Create headers and default categories
- `savePlaidItem()` - Store bank connection
- `saveAccount()` - Update account info
- `saveTransactions()` - Append new transactions (deduplicates by transaction_id)
- `getTransactions()` - Retrieve and sort transactions
- `getTransactionStats()` - Calculate spending/income totals

**Design Decision:** Transactions are deduplicated by transaction_id, so running sync multiple times won't create duplicates.

### 2. Plaid Client (src/plaid.js)
**Purpose:** Handle bank connections and transaction fetching

**Key Functions:**
- `createLinkToken()` - Generate token for Plaid Link UI
- `exchangePublicToken()` - Convert public token to access token
- `getAccounts()` - Fetch account details
- `getTransactions(startDate, endDate)` - Fetch transactions for date range
  - Handles pagination (500 transactions per request)
  - Fetches all transactions until total_transactions reached

**Configuration:**
- Supports sandbox/development/production environments
- Reads from config.json or environment variables

### 3. Sync Logic (src/sync.js)
**Purpose:** Orchestrate Plaid → Google Sheets data flow

**syncAllAccounts():**
1. Get all linked items from Sheets
2. For each item:
   - Fetch last 30 days of transactions from Plaid
   - Update account balances in Sheets
   - Save new transactions to Sheets (deduplicated)
   - Update last_synced_at timestamp
3. Return summary with error handling

**linkAccount(publicToken):**
1. Exchange public token for access token
2. Get institution details
3. Save to PlaidItems sheet
4. Fetch and save accounts
5. Initial transaction sync (30 days)

**Design Decision:** Default to 30-day sync window, but support custom date ranges for historical imports.

### 4. CLI Interface (src/cli.js)
**Commands:**
- `npm run link` - Generate Plaid Link token
- `npm run exchange -t TOKEN` - Link new bank account
- `npm run sync` - Sync transactions (default 30 days)
- `npm start sync -s START -e END` - Sync date range
- `npm run accounts` - List connected accounts
- `npm run transactions [-l LIMIT]` - Show recent transactions
- `npm run open` - Open Google Sheet in browser
- `npm start stats [-s START -e END]` - Show spending statistics
- `npm start categories` - List categories

**Design Decision:** Uses preAction hook to initialize Sheets connection before any command runs.

### 5. Setup Wizard (src/setup-sheets.js)
**Purpose:** Interactive first-time setup

**Flow:**
1. Check for existing Google credentials
2. If not found:
   - Display instructions for creating service account
   - Prompt for credentials file path
   - Copy to credentials/google-credentials.json
3. Create or connect spreadsheet:
   - Option A: Create new (auto-setup structure)
   - Option B: Use existing (prompt for Sheet ID)
4. Verify spreadsheet is shared with service account
5. Prompt for Plaid credentials
6. Save config.json
7. Initialize spreadsheet structure if new

**Design Decision:** Made setup as user-friendly as possible with step-by-step instructions and confirmations.

## Configuration Files

### config.json
```json
{
  "google_sheet_id": "SPREADSHEET_ID_FROM_URL",
  "plaid_client_id": "YOUR_PLAID_CLIENT_ID",
  "plaid_secret": "YOUR_PLAID_SECRET",
  "plaid_env": "sandbox"  // or "development" or "production"
}
```

### credentials/google-credentials.json
Service account JSON from Google Cloud Console (not committed to git)

## Setup Requirements

### Google Cloud Setup
1. Create project in Google Cloud Console
2. Enable Google Sheets API
3. Create service account (no role needed)
4. Download JSON key file
5. Create Google Sheet
6. Share Sheet with service account email (Editor permission)

### Plaid Setup
1. Sign up at dashboard.plaid.com
2. Create application
3. Get sandbox credentials for testing
4. For production: Get development/production credentials

## Data Flow

### Initial Setup
```
User → npm run setup → Interactive wizard → Creates/connects Sheet → Saves config
```

### Linking Bank Account
```
npm run link → Generate Link token → User completes Plaid Link → Get public_token
→ npm run exchange -t TOKEN → Exchange for access_token → Save to PlaidItems sheet
→ Fetch accounts → Save to Accounts sheet → Initial 30-day transaction sync
```

### Regular Sync
```
npm run sync → Get all PlaidItems from Sheet → For each item:
  → Fetch transactions from Plaid (last 30 days)
  → Update Accounts sheet with latest balances
  → Append new transactions to Transactions sheet (deduplicated)
  → Update last_synced timestamp
```

### Viewing Data
```
npm run open → Opens Google Sheet in browser
OR
npm run transactions → Displays in terminal with formatting
OR
Open Google Sheets app on any device
```

## Deployment Options

### Option 1: Home Assistant Server
```bash
scp expense-tracker-sheets.tar.gz hassio@10.10.1.15:/home/hassio/
ssh hassio@10.10.1.15
cd expense-tracker && npm install && npm run setup

# Weekly cron job
0 8 * * 0 cd /home/hassio/expense-tracker && npm run sync
```

### Option 2: Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["npm", "run", "sync"]
```

### Option 3: Systemd Timer (Linux)
- expense-sync.service (oneshot)
- expense-sync.timer (weekly)

## Future Enhancement Path

### Phase 2: Auto-Categorization
- Add rules engine to database.js
- Match merchants to categories with regex
- Learn from manual categorizations

### Phase 3: Budgeting
- Add Budget sheet to spreadsheet
- Track spending vs budget per category
- Add budget commands to CLI
- Alert when approaching limits

### Phase 4: Web Dashboard
- React/Next.js frontend
- Read from Google Sheets API
- Interactive charts (Chart.js or Recharts)
- Mobile responsive

### Phase 5: Advanced Features
- Recurring transaction detection
- Bill reminders
- Savings goals
- Investment account tracking
- Net worth tracking

## Key Design Decisions

1. **Google Sheets over SQLite**
   - User specifically requested this after seeing initial SQLite version
   - Provides familiar interface for viewing/editing
   - No database backups needed
   - Access from anywhere
   - Trade-off: Slower queries, but fine for personal use

2. **Transaction Deduplication**
   - Use transaction_id as unique key
   - Running sync multiple times won't create duplicates
   - Safe to run sync frequently

3. **30-Day Default Sync Window**
   - Balances freshness vs API calls
   - User can manually sync historical data with date range
   - Plaid has rate limits (100 requests per minute)

4. **Service Account vs OAuth**
   - Service account for automation
   - Simpler than OAuth flow
   - User must share sheet with service account

5. **CLI-First Approach**
   - Fits user's technical comfort level
   - Easy to automate with cron
   - Can build web UI later

6. **Interactive Setup**
   - Reduces friction for first-time setup
   - Step-by-step instructions
   - Validates configuration

## Security Considerations

1. **Never commit sensitive files:**
   - credentials/google-credentials.json
   - config.json (contains Plaid secret)
   - Already in .gitignore

2. **Plaid Access Tokens:**
   - Provide full access to bank data
   - Stored in PlaidItems sheet (consider encrypting in future)
   - User's Google account security is critical

3. **Service Account:**
   - Only has access to sheets explicitly shared with it
   - Can't access other user data
   - JSON key should be protected (600 permissions)

4. **Google Sheet Sharing:**
   - Only share with trusted people
   - Use "Can View" for read-only access
   - Never share publicly

## Testing Approach

### Plaid Sandbox
- Use test institution "Chase"
- Username: user_good
- Password: pass_good
- Generates fake transactions for testing

### Google Sheets
- Test on separate spreadsheet first
- Verify deduplication works
- Check date sorting
- Validate formulas and calculations

## Known Limitations

1. **No Offline Mode:**
   - Requires internet for both Plaid and Sheets
   - Can't sync without connectivity

2. **Google Sheets API Quotas:**
   - 100 requests per 100 seconds per user
   - 500 requests per 100 seconds per project
   - Unlikely to hit with personal use

3. **Transaction History:**
   - Plaid provides 24 months of transactions
   - Some banks provide less
   - Initial sync should cover desired history

4. **Real-Time Updates:**
   - Not real-time (sync-based)
   - Perfect for weekly/daily updates
   - Not suitable for minute-by-minute tracking

## Common Issues & Solutions

### "Failed to initialize Google Sheets"
- Check service account email is shared on spreadsheet
- Verify spreadsheet ID in config.json
- Ensure credentials file exists and is valid JSON

### "Invalid credentials" (Plaid)
- Verify client_id and secret match environment
- Check environment setting (sandbox/development/production)

### "Item login required"
- Bank requires re-authentication
- Use Plaid Link Update Mode to refresh
- May need to relink account

### Duplicate Transactions
- Should not happen (deduplication by transaction_id)
- If occurs, manually delete in Sheet
- Report as bug (check sync logic)

## Package Dependencies

```json
{
  "plaid": "^27.0.0",           // Plaid API client
  "googleapis": "^131.0.0",     // Google Sheets API
  "commander": "^12.0.0",       // CLI framework
  "chalk": "^5.3.0",            // Terminal colors
  "cli-table3": "^0.6.3",       // Terminal tables
  "inquirer": "^9.2.0"          // Interactive prompts
}
```

## Environment Variables (Optional)

Instead of config.json, can use:
```bash
export PLAID_CLIENT_ID="xxx"
export PLAID_SECRET="xxx"
export GOOGLE_SHEET_ID="xxx"
```

## Next Steps for User

1. Extract archive and run npm install
2. Run npm run setup (interactive wizard)
3. Link first bank account (sandbox for testing)
4. Run initial sync
5. Open Google Sheet and verify data
6. Set up weekly cron job on Home Assistant server
7. Customize categories in Categories sheet
8. Start manually categorizing transactions
9. Create budget tracking (Phase 2)
10. Build analysis dashboard (Phase 3)

## Files to Port to Claude Code

All files in the expense-tracker/ directory:
- src/*.js (all 5 source files)
- package.json
- config.json (template)
- README.md
- QUICKSTART.md
- ARCHITECTURE.md
- .gitignore

The project is complete and ready to use after setup.
