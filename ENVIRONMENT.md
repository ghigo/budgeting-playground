# Environment Configuration Guide

This guide explains how to configure and switch between Sandbox and Production environments.

## 📝 Configuration File Structure

Your `config.json` stores credentials for both environments:

```json
{
  "google_sheet_id": "your-spreadsheet-id",
  "plaid": {
    "client_id": "your-plaid-client-id",
    "sandbox": {
      "secret": "your-sandbox-secret"
    },
    "production": {
      "secret": "your-production-secret"
    }
  }
}
```

## 🔑 Setting Up Credentials

### 1. Get Your Plaid Credentials

**Sandbox (for testing):**
1. Go to https://dashboard.plaid.com
2. Navigate to: **Team Settings** → **Keys**
3. Copy your `client_id` and `sandbox` secret

**Production (for real bank accounts):**
1. Request production access from Plaid (see PRODUCTION.md)
2. Once approved, go to **Team Settings** → **Keys**
3. Copy your `production` secret

### 2. Update config.json

Create `config.json` from the example:

```bash
cp config.json.example config.json
```

Edit `config.json` and fill in your credentials:

```json
{
  "google_sheet_id": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  "plaid": {
    "client_id": "60a1234567890abcdef12345",
    "sandbox": {
      "secret": "a1b2c3d4e5f6sandbox1234567890"
    },
    "production": {
      "secret": "x9y8z7w6v5u4production1234567890"
    }
  }
}
```

**Note:** Both secrets are stored in the same file - no more editing config when switching!

## 🚀 Running the Server

### Sandbox Mode (Default - Test Data)

```bash
npm start
# or explicitly
npm run start:sandbox
```

**What you'll see:**
```
🚀 Expense Tracker running at http://localhost:3000

🟡 Environment: SANDBOX
📊 Dashboard: http://localhost:3000
🔗 Link Account: http://localhost:3000/link
```

### Production Mode (Real Bank Data)

```bash
npm run start:prod
```

**What you'll see:**
```
🚀 Expense Tracker running at http://localhost:3000

🟢 Environment: PRODUCTION
📊 Dashboard: http://localhost:3000
🔗 Link Account: http://localhost:3000/link
```

### Development Mode with Auto-Reload

For development with hot reload:

```bash
# Sandbox with auto-reload
npm run dev

# Production with auto-reload
npm run dev:prod
```

## 🔍 Verifying Your Environment

### In the Terminal
When you start the server, look for the environment indicator:
- 🟡 **SANDBOX** = Test data, fake banks
- 🟢 **PRODUCTION** = Real banks, real transactions

### In the Web UI
1. Open http://localhost:3000
2. Look at the sidebar footer
3. You'll see either:
   - **Yellow badge: "SANDBOX"**
   - **Green badge: "PRODUCTION"**

## 🔄 Switching Environments

**No config editing needed!** Just use the right npm command:

```bash
# Switch to sandbox
npm run start:sandbox

# Switch to production
npm run start:prod
```

The server automatically:
- Reads the right credentials from config.json
- Connects to the correct Plaid environment
- Shows the environment in terminal and UI

## 🌍 Using Environment Variables

You can also use environment variables instead of config.json:

```bash
# Sandbox
export PLAID_CLIENT_ID="your-client-id"
export PLAID_SECRET="your-sandbox-secret"
npm start

# Production
export PLAID_CLIENT_ID="your-client-id"
export PLAID_SECRET="your-production-secret"
npm run start:prod
```

**Priority:** Environment variables override config.json values.

## 📊 Quick Reference

| Command | Environment | Auto-Reload | Use Case |
|---------|-------------|-------------|----------|
| `npm start` | Sandbox | No | Default, quick testing |
| `npm run start:sandbox` | Sandbox | No | Explicit sandbox mode |
| `npm run start:prod` | Production | No | Real bank data |
| `npm run dev` | Sandbox | Yes | Development |
| `npm run dev:prod` | Production | Yes | Production development |

## ⚠️ Important Notes

### Security
- ✅ `config.json` is in `.gitignore` - safe to store credentials
- ❌ Never commit `config.json` to version control
- ✅ Both credentials can coexist safely in the same file

### Separate Data
Each environment is completely separate:
- Sandbox accounts ≠ Production accounts
- Sandbox transactions ≠ Production transactions
- They use different API endpoints and credentials

### Google Sheets
Both environments share the **same Google Sheet** by default. If you want separate sheets:

```json
{
  "google_sheet_id_sandbox": "spreadsheet-for-testing",
  "google_sheet_id_production": "spreadsheet-for-real-data",
  "plaid": { ... }
}
```

(You'll need to update the code to support this)

## 🐛 Troubleshooting

### "Invalid credentials" error

**Problem:** Wrong secret for the environment

**Solution:**
1. Check which environment you're running (look for 🟡 or 🟢 in terminal)
2. Verify the secret in `config.json` matches that environment
3. Sandbox secret ≠ Production secret!

### Environment shows wrong in UI

**Problem:** Cached frontend or server not restarted

**Solution:**
1. Stop the server (Ctrl+C)
2. Clear browser cache or hard refresh (Cmd+Shift+R / Ctrl+Shift+R)
3. Restart server with the correct command

### Both secrets are the same

**Problem:** You copied the same secret to both fields

**Solution:**
- Sandbox and production have **different secrets**
- Go to Plaid Dashboard → Team Settings → Keys
- Copy the correct secret for each environment

## 🎯 Best Practices

1. **Develop in Sandbox** - Always test in sandbox first
2. **Test with Real Data Carefully** - Use production mode only when ready
3. **Keep Credentials Updated** - If you rotate secrets, update config.json
4. **Use Descriptive Testing** - In sandbox, link test banks like "Chase" with test credentials
5. **Monitor Production Usage** - Check Plaid Dashboard for API usage and costs

## 📚 Next Steps

- See **PRODUCTION.md** for requesting Plaid production access
- See **SECURITY.md** for security best practices
- See **README.md** for full application documentation
