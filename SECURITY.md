# Security Best Practices

## 🔒 Protecting Your Credentials

This application handles sensitive financial data and API credentials. Follow these guidelines to keep your data secure.

## Files That Should NEVER Be Committed

The following files contain sensitive information and are automatically ignored by git:

### ❌ DO NOT COMMIT:
- `config.json` - Contains Plaid API credentials and Google Sheet ID
- `credentials/google-credentials.json` - Google service account private key
- `.env` and any `.env.*` files - Environment variables with secrets

### ✅ SAFE TO COMMIT:
- `config.json.example` - Template with no real credentials
- Documentation files (README.md, etc.)
- Source code in `src/`

## Setting Up Configuration

### First Time Setup

1. **Copy the example config:**
   ```bash
   cp config.json.example config.json
   ```

   Or run the setup wizard which does this automatically:
   ```bash
   npm run setup
   ```

2. **Edit config.json** with your real credentials:
   ```json
   {
     "google_sheet_id": "your-actual-sheet-id",
     "plaid_client_id": "your-plaid-client-id",
     "plaid_secret": "your-plaid-secret",
     "plaid_env": "sandbox"
   }
   ```

3. **Never commit config.json** - it's already in `.gitignore`

## Credential Security

### Google Service Account

**Location:** `credentials/google-credentials.json`

**Security Tips:**
- This file contains a private key that grants access to your Google Sheets
- Set file permissions to 600 (read/write for owner only):
  ```bash
  chmod 600 credentials/google-credentials.json
  ```
- Only share spreadsheets with the service account email (found in the JSON file)
- Don't share this file or commit it to version control

### Plaid API Credentials

**Location:** `config.json`

**Security Tips:**
- These credentials provide access to bank account data
- Use **sandbox** environment for testing (no real bank data)
- Use **development** environment for testing with real banks (limited to 100 Items)
- Use **production** environment only after Plaid approval
- Rotate secrets if compromised
- Never share secrets in chat, email, or public forums

### Google Sheet ID

**Location:** `config.json`

**Security Tips:**
- While not as sensitive as API keys, the Sheet ID reveals your spreadsheet
- Use Google Sheets sharing settings to control access
- Share with specific people, not "anyone with the link"
- Use "Can View" permission for read-only access

## Environment Variables (Alternative)

Instead of `config.json`, you can use environment variables:

```bash
export GOOGLE_SHEET_ID="your-sheet-id"
export PLAID_CLIENT_ID="your-client-id"
export PLAID_SECRET="your-secret"
export PLAID_ENV="sandbox"
```

**Benefits:**
- Credentials not stored in files
- Better for Docker/container deployments
- Easier to manage in CI/CD pipelines

**To use environment variables:**
- The application reads from `config.json` first
- If `config.json` values are empty, it falls back to environment variables
- You can delete `config.json` entirely if using env vars

## Git Security Checks

### Before Committing

Always check what you're about to commit:

```bash
git status
git diff
```

### If You Accidentally Committed Secrets

**⚠️ IMPORTANT:** If you committed `config.json` or `credentials/` with real secrets:

1. **Rotate all credentials immediately:**
   - Revoke the Google service account key
   - Rotate Plaid API secrets
   - Create new credentials

2. **Remove from git history:**
   ```bash
   # Remove the file from git but keep it locally
   git rm --cached config.json
   git commit -m "Remove config.json from tracking"
   git push
   ```

3. **For files already pushed:** You may need to rewrite git history (complex - seek help)

## Production Deployment

### Self-Hosted Server

When deploying to production (e.g., Home Assistant server):

1. **Use SSH for file transfer:**
   ```bash
   scp config.json user@server:/path/to/app/
   scp credentials/google-credentials.json user@server:/path/to/app/credentials/
   ```

2. **Set proper file permissions:**
   ```bash
   chmod 600 config.json
   chmod 600 credentials/google-credentials.json
   chmod 700 credentials/
   ```

3. **Use environment variables in cron jobs:**
   ```bash
   0 8 * * 0 cd /path/to/app && PLAID_SECRET=$PLAID_SECRET npm run sync
   ```

### Docker Deployment

Use secrets management:

```yaml
# docker-compose.yml
services:
  expense-tracker:
    build: .
    environment:
      - GOOGLE_SHEET_ID=${GOOGLE_SHEET_ID}
      - PLAID_CLIENT_ID=${PLAID_CLIENT_ID}
      - PLAID_SECRET=${PLAID_SECRET}
    secrets:
      - google_credentials

secrets:
  google_credentials:
    file: ./credentials/google-credentials.json
```

## Monitoring & Auditing

### Regular Security Checks

1. **Review Google Sheets sharing settings monthly**
2. **Check Plaid connected items:** https://dashboard.plaid.com
3. **Review service account keys:** https://console.cloud.google.com
4. **Monitor spreadsheet access logs** in Google Drive

### Signs of Compromise

Watch for:
- Unexpected transactions in your sheet
- Unknown users with access to your spreadsheet
- Unfamiliar Plaid items or connections
- Unusual API activity in Plaid/Google dashboards

### If Compromised

1. **Immediately revoke all credentials**
2. **Review spreadsheet edit history**
3. **Check for data exfiltration**
4. **Generate new credentials**
5. **Review recent account activity**

## Data Privacy

### What Data is Stored

**In Google Sheets:**
- Bank account names and types
- Transaction descriptions and amounts
- Merchant names
- Account balances

**In config.json:**
- Plaid API credentials
- Google Sheet ID

**In credentials/google-credentials.json:**
- Google service account private key
- Service account email
- Project ID

### Data Retention

- **Transactions:** Stored permanently in your Google Sheet (you control retention)
- **Plaid access tokens:** Stored in PlaidItems sheet (required for sync)
- **Credentials:** Stored locally until manually deleted

### Data Sharing

- **With Google:** Service account has Editor access to your designated spreadsheet only
- **With Plaid:** Access tokens provide read-only access to connected bank accounts
- **With Third Parties:** None - all data stays between you, Google, and Plaid

## Questions?

If you have security concerns or questions:
- Review Plaid's security documentation: https://plaid.com/security/
- Review Google's service account security: https://cloud.google.com/iam/docs/service-accounts
- Check this project's GitHub issues for security discussions

## Reporting Security Issues

If you discover a security vulnerability in this application:
- **DO NOT** post it publicly
- Contact the maintainer privately
- Provide details to reproduce the issue
- Allow time for a fix before public disclosure
