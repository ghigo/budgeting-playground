# Expense Tracker Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Your Computer / Server                        │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  Expense Tracker (Node.js)                │   │
│  │                                                            │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │   CLI Tool   │  │  Plaid API   │  │  Sheets API  │  │   │
│  │  │   (commands) │→ │   (client)   │  │   (client)   │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │   │
│  │                           ↓                   ↓           │   │
│  └───────────────────────────┼───────────────────┼──────────┘   │
└────────────────────────────┼───────────────────┼───────────────┘
                               │                   │
                               ↓                   ↓
                    ┌─────────────────┐  ┌──────────────────┐
                    │   Plaid API     │  │  Google Sheets   │
                    │   (Cloud)       │  │  API (Cloud)     │
                    └─────────────────┘  └──────────────────┘
                               ↓                   ↓
                    ┌─────────────────┐  ┌──────────────────┐
                    │  Your Banks     │  │  Your Spreadsheet│
                    │  • Chase        │  │  ┌────────────┐  │
                    │  • BofA         │  │  │Transactions│  │
                    │  • Wells Fargo  │  │  ├────────────┤  │
                    │  • etc.         │  │  │Accounts    │  │
                    └─────────────────┘  │  ├────────────┤  │
                                          │  │Categories  │  │
                                          └──┴────────────┴──┘
```

## Data Flow

### 1. Bank Connection (One-time)
```
You → npm run link → Plaid Link UI → Enter bank credentials → Get access token → Saved to Google Sheet
```

### 2. Transaction Sync (Weekly or manual)
```
npm run sync → 
  ↓
Request transactions from Plaid → 
  ↓
Plaid fetches from your banks → 
  ↓
Transactions returned to app → 
  ↓
Written to Google Sheet → 
  ↓
You view/edit in Sheets
```

### 3. Viewing Data
```
npm run open → Opens Google Sheet in browser
OR
npm run transactions → Shows in terminal
OR
Open Sheets app on phone → View anywhere
```

## Components

### Node.js Application (Self-hosted)
- **CLI** - Command-line interface
- **Plaid Client** - Handles bank API calls
- **Sheets Client** - Writes to Google Sheets
- **Sync Logic** - Orchestrates data flow

### Plaid (Cloud Service)
- Connects to 10,000+ banks
- Handles authentication
- Fetches transactions securely
- Industry-standard security

### Google Sheets (Cloud Storage)
- Stores all your data
- Provides familiar interface
- Accessible from anywhere
- Built-in charts and analysis

## Security

```
Your Banks ←─[Encrypted]─→ Plaid ←─[API]─→ Your Server
                                              ↓
                                          [API Key]
                                              ↓
                                     Google Sheets API
                                              ↓
                                     Your Private Sheet
```

- Bank credentials NEVER stored locally
- Plaid uses OAuth tokens
- Google service account for automation
- All API calls over HTTPS
- Your data stays in your Google account

## Deployment Options

### Option 1: Local Computer
```
Your Laptop
  └── Run npm run sync manually
      └── Or set up cron job for automatic sync
```

### Option 2: Home Server (e.g., Home Assistant)
```
Home Server (10.10.1.15)
  └── Install Node.js
      └── Run as systemd service
          └── Automatic weekly sync
```

### Option 3: Cloud Server
```
AWS/DigitalOcean/etc
  └── Docker container
      └── Cron job for automatic sync
          └── Always online
```

### Option 4: Raspberry Pi
```
Raspberry Pi
  └── Low power, always on
      └── Perfect for weekly sync job
          └── Runs in the background
```
