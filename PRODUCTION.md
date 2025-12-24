# Switching to Production Mode

This guide explains how to switch from Plaid's **Sandbox** (test data) to **Production** (real bank accounts).

## 📋 Prerequisites

Before switching to production, you need:

1. ✅ A Plaid account with **Production Access** approved
2. ✅ Production API credentials from Plaid
3. ✅ Your application tested thoroughly in Sandbox mode

---

## 🚦 Understanding Plaid Environments

Plaid has three environments:

### 1. **Sandbox** (Testing)
- ✅ Free, unlimited usage
- ✅ Fake banks and test credentials
- ✅ Instant setup, no approval needed
- ❌ No real bank connections
- **Best for:** Development and testing

### 2. **Development** (Limited Real Data)
- ✅ Connect real bank accounts
- ✅ Real transaction data
- ❌ Limited to 100 Items (bank connections)
- ❌ Requires Plaid approval
- **Best for:** Testing with real accounts before production

### 3. **Production** (Full Real Data)
- ✅ Unlimited real bank connections
- ✅ Full production features
- ❌ Requires Plaid compliance approval
- ❌ May have costs depending on usage
- **Best for:** Live application with real users

---

## 🔑 Step 1: Request Production Access from Plaid

### A. Go to Plaid Dashboard

1. Log in to https://dashboard.plaid.com
2. Go to **Team Settings** → **Keys**

### B. Request Production Access

1. You'll see a "Request Production Access" section at the top
2. Click **"Start Application"** or **"Request Production Access"**

### C. Complete the Application

You'll need to provide:

- **Company Information:**
  - Company name and website
  - Business description
  - Expected user volume

- **Use Case Details:**
  - How you'll use Plaid (expense tracking)
  - Which Plaid products (Transactions)
  - User consent and privacy policy

- **Security & Compliance:**
  - Data security measures
  - How you protect user data
  - Compliance with regulations

- **Technical Details:**
  - Your application URL (e.g., http://ha.ggg:3000)
  - OAuth redirect URIs
  - Webhook endpoints (optional)

### D. Wait for Approval

- ⏱️ Review typically takes **1-2 business days**
- 📧 You'll receive an email when approved
- ✅ Production credentials will appear in your dashboard

---

## 🔑 Step 2: Get Production Credentials

Once approved:

1. Go to **Team Settings** → **Keys** in Plaid Dashboard
2. You'll now see **three sets** of credentials:
   - Sandbox (yellow)
   - Development (blue)
   - Production (green) ✅

3. Copy your **Production** credentials:
   - `client_id` (same for all environments)
   - `production` secret (different from sandbox secret)

---

## ⚙️ Step 3: Update Your Configuration

### Option A: Update config.json (Recommended)

Edit your `config.json` file:

```json
{
  "google_sheet_id": "your-sheet-id",
  "plaid_client_id": "your-plaid-client-id",
  "plaid_secret": "your-PRODUCTION-secret-here",
  "plaid_env": "production"
}
```

**Important Changes:**
- Change `plaid_secret` to your **production** secret
- Change `plaid_env` from `"sandbox"` to `"production"`

### Option B: Use Environment Variables

Set these environment variables:

```bash
export PLAID_CLIENT_ID="your-plaid-client-id"
export PLAID_SECRET="your-production-secret"
export PLAID_ENV="production"
```

---

## 🔄 Step 4: Restart the Server

After updating the configuration:

```bash
# Stop the current server (Ctrl+C)

# Start it again
npm start
```

The server will now use **production** mode!

---

## ✅ Step 5: Verify Production Mode

### In the Web UI:

1. Open http://localhost:3000
2. Look at the sidebar footer
3. You should see: **Environment: PRODUCTION** (green badge)
4. If you see **SANDBOX** (yellow badge), check your config

### Test a Real Bank Connection:

1. Click **"Link Account"** in the UI
2. Click **"Link Bank Account"**
3. Search for **your real bank** (e.g., "Chase", "Bank of America")
4. Use your **real online banking credentials**
5. Complete the authentication flow

✅ Your real account should now be connected!

---

## 🧪 Step 6: Test Production Sync

### Sync Transactions:

1. In the dashboard, click **"Sync Transactions"** button
2. Wait for the sync to complete
3. You should see **real transactions** from your bank account

### Verify Data:

1. Go to **Transactions** page
2. You should see your real purchases, income, etc.
3. Check **Accounts** page for accurate balances
4. Open your Google Sheet to verify data is saved

---

## 🔒 Security Best Practices for Production

### 1. Protect Your Secrets

❌ **NEVER** commit `config.json` to git (already in `.gitignore`)

```bash
# Verify it's ignored:
git status

# Should NOT show config.json
```

### 2. Use HTTPS in Production

When deploying to a server (not localhost):

- Use HTTPS (not HTTP)
- Get SSL certificate (Let's Encrypt is free)
- Update Plaid redirect URIs to https://

### 3. Set Up Webhooks (Optional but Recommended)

Plaid can notify you when:
- A user needs to re-authenticate
- An account has errors
- New transactions are available

Set up in: **Plaid Dashboard** → **Webhooks**

### 4. Monitor API Usage

- Check **Plaid Dashboard** → **Activity** regularly
- Set up usage alerts
- Review API errors and fix issues

### 5. Handle Re-authentication

Banks sometimes require users to re-login. Implement:
- Error handling for `ITEM_LOGIN_REQUIRED`
- UI to prompt users to re-link
- Use Plaid Link in "update mode"

---

## 🔄 Switching Back to Sandbox

To switch back to testing mode:

### Edit config.json:

```json
{
  "plaid_env": "sandbox",
  "plaid_secret": "your-sandbox-secret"
}
```

### Restart server:

```bash
npm start
```

---

## 🆘 Troubleshooting Production Issues

### "Invalid credentials" error

**Cause:** Using sandbox secret in production mode

**Fix:**
- Copy the **production** secret from Plaid Dashboard
- Update `config.json` with production secret
- Restart server

### "Item login required" error

**Cause:** Bank requires re-authentication

**Fix:**
- Ask user to re-link their account
- Use Plaid Link in update mode (advanced)

### "Institution not available" error

**Cause:** Bank not supported in production

**Fix:**
- Check Plaid's supported institutions: https://plaid.com/institutions/
- Some sandbox banks don't exist in production

### Transactions not syncing

**Cause:** API rate limits or bank issues

**Fix:**
- Wait a few minutes and try again
- Check Plaid Dashboard for errors
- Verify bank is online and accessible

---

## 💰 Plaid Pricing

### Free Tier:
- First 100 users: **Free**
- Great for personal use or small apps

### Paid Tiers:
- Starts at $0.50/user for Transactions API
- Volume discounts available
- Check current pricing: https://plaid.com/pricing/

### For Personal Use:
- You're likely within the free tier
- Track a few accounts for yourself = free
- Only pay if you exceed 100 connected items

---

## 📚 Additional Resources

- [Plaid Production Guide](https://plaid.com/docs/production/)
- [Plaid Institutions](https://plaid.com/institutions/)
- [Plaid Support](https://support.plaid.com/)

---

## ✨ Summary Checklist

Before going to production:

- [ ] Request production access from Plaid
- [ ] Wait for approval email
- [ ] Copy production credentials from dashboard
- [ ] Update `config.json` with production secret and env
- [ ] Restart the server
- [ ] Verify green "PRODUCTION" badge in UI
- [ ] Test linking a real bank account
- [ ] Sync and verify real transactions appear
- [ ] Set up HTTPS if deploying to internet
- [ ] Monitor API usage in Plaid Dashboard

---

**You're ready for production!** 🎉

Your expense tracker will now work with real bank accounts and real transaction data.
