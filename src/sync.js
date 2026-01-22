import * as plaid from './plaid.js';
import * as database from './database.js';

/**
 * Sync transactions for all connected accounts
 */
export async function syncAllAccounts() {
  const items = database.getPlaidItems();

  if (items.length === 0) {
    console.log('No bank accounts linked. Run "npm run link" first.');
    return { success: false, error: 'No linked accounts' };
  }

  console.log(`\nSyncing ${items.length} account(s)...`);

  let totalTransactions = 0;
  const errors = [];

  for (const item of items) {
    try {
      console.log(`\n📊 Syncing ${item.institution_name}...`);

      // Get transactions from the last 90 days for regular syncs (incremental updates)
      // For full history, use the backfill endpoint
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const result = await plaid.getTransactions(item.access_token, startDate, endDate);

      console.log(`  📥 Received ${result.transactions.length} transaction(s) from Plaid`);

      // Update accounts
      for (const account of result.accounts) {
        account.item_id = item.item_id;
        database.saveAccount(account, item.institution_name);
      }
      console.log(`  ✓ Updated ${result.accounts.length} account(s)`);

      // Add account_name to transactions (optimized: use Map for O(1) lookups)
      const accountMap = new Map();
      result.accounts.forEach(acc => accountMap.set(acc.account_id, acc));

      for (const transaction of result.transactions) {
        const account = accountMap.get(transaction.account_id);
        transaction.account_name = account ? account.name : transaction.account_id;
      }

      // Save transactions
      const count = database.saveTransactions(result.transactions, null);
      totalTransactions += count;

      // Update last sync time
      database.updatePlaidItemLastSynced(item.item_id);

    } catch (error) {
      const errorMsg = `Failed to sync ${item.institution_name}: ${error.message}`;
      console.error(`  ✗ ${errorMsg}`);
      errors.push(errorMsg);
    }
  }

  console.log(`\n✅ Sync complete: ${totalTransactions} new transactions added`);

  if (errors.length > 0) {
    console.log('\n⚠️  Some accounts failed to sync:');
    errors.forEach(err => console.log(`  - ${err}`));
  }

  return {
    success: errors.length === 0,
    totalTransactions,
    errors
  };
}

/**
 * Sync transactions for a single account by item ID
 */
export async function syncSingleAccount(itemId) {
  const items = database.getPlaidItems();
  const item = items.find(i => i.item_id === itemId);

  if (!item) {
    return { success: false, error: 'Account not found' };
  }

  try {
    console.log(`\n📊 Syncing ${item.institution_name}...`);

    // Get transactions from the last 90 days
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await plaid.getTransactions(item.access_token, startDate, endDate);

    console.log(`  📥 Received ${result.transactions.length} transaction(s) from Plaid`);

    // Update accounts
    for (const account of result.accounts) {
      account.item_id = item.item_id;
      database.saveAccount(account, item.institution_name);
    }

    // Add account_name to transactions (optimized: use Map for O(1) lookups)
    const accountMap = new Map();
    result.accounts.forEach(acc => accountMap.set(acc.account_id, acc));

    for (const transaction of result.transactions) {
      const account = accountMap.get(transaction.account_id);
      transaction.account_name = account ? account.name : transaction.account_id;
    }

    // Save transactions
    const count = database.saveTransactions(result.transactions, null);

    // Update last sync time
    database.updatePlaidItemLastSynced(item.item_id);

    return {
      success: true,
      institution: item.institution_name,
      accountsUpdated: result.accounts.length,
      transactionsSynced: count
    };
  } catch (error) {
    console.error(`Error syncing ${item.institution_name}:`, error.message);

    // Check if this is a Plaid API error with error_code
    const errorCode = error.response?.data?.error_code;
    const errorMessage = error.response?.data?.error_message || error.message;

    return {
      success: false,
      error: errorCode ? `${errorCode}: ${errorMessage}` : errorMessage,
      errorCode: errorCode,
      institution: item.institution_name
    };
  }
}

/**
 * Sync a specific time range
 */
export async function syncDateRange(startDate, endDate) {
  const items = database.getPlaidItems();

  if (items.length === 0) {
    console.log('No bank accounts linked.');
    return { success: false, error: 'No linked accounts' };
  }

  console.log(`\nSyncing transactions from ${startDate} to ${endDate}...`);

  let totalTransactions = 0;
  const errors = [];

  for (const item of items) {
    try {
      console.log(`\n📊 Syncing ${item.institution_name}...`);

      const result = await plaid.getTransactions(item.access_token, startDate, endDate);

      console.log(`  📥 Received ${result.transactions.length} transaction(s) from Plaid`);

      // Update accounts
      for (const account of result.accounts) {
        account.item_id = item.item_id;
        database.saveAccount(account, item.institution_name);
      }

      // Add account_name to transactions
      for (const transaction of result.transactions) {
        const account = result.accounts.find(acc => acc.account_id === transaction.account_id);
        transaction.account_name = account ? account.name : transaction.account_id;
      }

      // Save transactions
      const count = database.saveTransactions(result.transactions, null);
      totalTransactions += count;

      database.updatePlaidItemLastSynced(item.item_id);

    } catch (error) {
      const errorMsg = `Failed to sync ${item.institution_name}: ${error.message}`;
      console.error(`  ✗ ${errorMsg}`);
      errors.push(errorMsg);
    }
  }

  console.log(`\n✅ Sync complete: ${totalTransactions} new transactions added`);

  return {
    success: errors.length === 0,
    totalTransactions,
    errors
  };
}

/**
 * Link a new bank account
 */
export async function linkAccount(publicToken) {
  try {
    console.log('\n🔗 Linking new account...');

    // Exchange public token for access token
    const { accessToken, itemId } = await plaid.exchangePublicToken(publicToken);

    // Get item details
    const item = await plaid.getItem(accessToken);
    const institution = await plaid.getInstitution(item.institution_id);

    // Save to database
    database.savePlaidItem(itemId, accessToken, item.institution_id, institution.name);
    console.log(`  ✓ Linked ${institution.name}`);

    // Get and save accounts
    const accounts = await plaid.getAccounts(accessToken);
    for (const account of accounts) {
      account.item_id = itemId;
      database.saveAccount(account, institution.name);
    }
    console.log(`  ✓ Added ${accounts.length} account(s)`);

    // Initial transaction sync - fetch ALL available history from Plaid
    // Plaid automatically limits this to what the institution provides (typically 2-10 years)
    const endDate = new Date().toISOString().split('T')[0];
    // Use a date far in the past to get maximum available history
    // Plaid will automatically limit to institution's available history
    const startDate = '2000-01-01';

    console.log(`  📥 Fetching all available historical transactions...`);

    // Retry logic for PRODUCT_NOT_READY errors (common with newly linked accounts)
    const maxRetries = 4;
    const retryDelays = [5000, 10000, 15000, 20000]; // 5s, 10s, 15s, 20s
    let transactionsFetched = false;
    let count = 0;

    for (let attempt = 0; attempt < maxRetries && !transactionsFetched; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`  ⏳ Waiting before retry... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]));
        }

        const result = await plaid.getTransactions(accessToken, startDate, endDate);

        console.log(`  📥 Received ${result.transactions.length} transaction(s) from Plaid`);

        // Debug: Show transaction date range returned by Plaid
        if (result.transactions.length > 0) {
          const dates = result.transactions.map(t => t.date).sort();
          const oldestDate = dates[0];
          const newestDate = dates[dates.length - 1];
          console.log(`  📅 Transaction date range: ${oldestDate} to ${newestDate}`);
          console.log(`  🔍 Requested range: ${startDate} to ${endDate}`);

          // Calculate how much history we got
          const oldestTransactionDate = new Date(oldestDate);
          const requestedStartDate = new Date(startDate);
          const daysDifference = Math.floor((oldestTransactionDate - requestedStartDate) / (1000 * 60 * 60 * 24));

          if (daysDifference > 365) {
            console.warn(`  ⚠️  Gap detected: Oldest transaction is ${Math.floor(daysDifference / 365)} years newer than requested start date`);
            console.warn(`  ⚠️  Institution may be limiting available history to ${Math.floor(daysDifference / 365)} years`);
          }
        }

        // Debug: Log Plaid response metadata if available
        if (result.total_transactions !== undefined) {
          console.log(`  📊 Plaid metadata - Total available: ${result.total_transactions}`);
        }

        // Add account_name to transactions
        for (const transaction of result.transactions) {
          const account = accounts.find(acc => acc.account_id === transaction.account_id);
          transaction.account_name = account ? account.name : transaction.account_id;
        }

        count = database.saveTransactions(result.transactions, null);
        transactionsFetched = true;

      } catch (error) {
        const errorCode = error.response?.data?.error_code;
        const errorMessage = error.response?.data?.error_message || error.message;

        if (errorCode === 'PRODUCT_NOT_READY' && attempt < maxRetries - 1) {
          console.log(`  ⏳ Transactions not ready yet, will retry...`);
          continue;
        } else {
          // Non-retryable error or max retries reached
          console.warn(`  ⚠️  Could not fetch historical transactions: ${errorMessage}`);
          console.log(`  ℹ️  You can use "Backfill All History" button later to fetch them`);
          break;
        }
      }
    }

    database.updatePlaidItemLastSynced(itemId);

    console.log('\n✅ Account linked successfully!');

    // Trigger historical backfill in the background (non-blocking)
    console.log('  🔄 Starting automatic historical backfill in background...');
    backfillSingleAccount(itemId, institution.name, accessToken).catch(err => {
      console.error(`  ⚠️  Background backfill failed: ${err.message}`);
    });

    return {
      success: true,
      item_id: itemId,
      institution: institution.name,
      accounts: accounts.length,
      transactions: count
    };

  } catch (error) {
    console.error('\n✗ Failed to link account:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Backfill all available historical transactions
 * Fetches maximum available history from Plaid (institution-dependent, typically 2-10 years)
 */
export async function backfillHistoricalTransactions() {
  const items = database.getPlaidItems();

  if (items.length === 0) {
    console.log('No bank accounts linked.');
    return { success: false, error: 'No linked accounts' };
  }

  console.log(`\n📜 Backfilling all available historical transactions...`);
  console.log('⚠️  This may take a while for accounts with lots of transactions.');
  console.log('ℹ️  Note: Each institution limits how much history they provide through Plaid:');
  console.log('   - Some banks: 30-90 days only');
  console.log('   - Most banks: 90 days to 2 years');
  console.log('   - Few banks: 2+ years of history');
  console.log('   Plaid cannot provide more history than the institution allows.\n');

  let totalTransactions = 0;
  const errors = [];
  const institutionSummary = []; // Track what we got from each institution

  // Fetch all available history - Plaid will limit to institution's maximum
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = '2000-01-01'; // Far in the past to get maximum available history

  for (const item of items) {
    let backfillSuccessful = false;
    const maxRetries = 4;
    const retryDelays = [5000, 10000, 15000, 20000]; // 5s, 10s, 15s, 20s

    console.log(`📊 Backfilling ${item.institution_name}...`);
    console.log(`   Date range: ${startDate} to ${endDate}`);

    // First, tell Plaid to refresh data from the institution
    // Note: Requires "transactions_refresh" Plaid product to be enabled
    // Enable at: https://dashboard.plaid.com/settings/team/products
    try {
      await plaid.refreshTransactions(item.access_token);
      console.log('  ✓ Refresh request sent to Plaid (this is an asynchronous background process)');
      console.log('  ℹ️  Full historical data may take 24-48 hours to become available');
      console.log('  ⏳ Waiting 10 seconds before fetching currently available data...');
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
    } catch (refreshError) {
      const refreshErrorCode = refreshError.response?.data?.error_code;
      if (refreshErrorCode === 'INVALID_PRODUCT') {
        console.warn(`  ⚠️  Transactions Refresh not enabled - fetching cached data only`);
        console.warn(`  ℹ️  Enable at: https://dashboard.plaid.com/settings/team/products`);
      } else {
        console.warn(`  ⚠️  Refresh request failed (continuing anyway): ${refreshError.message}`);
      }
    }

    for (let attempt = 0; attempt < maxRetries && !backfillSuccessful; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`   ⏳ Waiting before retry... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]));
        }

        const result = await plaid.getTransactions(item.access_token, startDate, endDate);

        console.log(`  📥 Received ${result.transactions.length} transaction(s) from Plaid`);
        console.log(`  📥 Received ${result.accounts.length} account(s) from Plaid`);

        // Debug: Show transaction date range returned by Plaid
        let oldestDate, newestDate, monthsOfHistory;
        if (result.transactions.length > 0) {
          const dates = result.transactions.map(t => t.date).sort();
          oldestDate = dates[0];
          newestDate = dates[dates.length - 1];
          console.log(`  📅 Transaction date range: ${oldestDate} to ${newestDate}`);
          console.log(`  🔍 Requested range: ${startDate} to ${endDate}`);

          // Calculate how much history we got
          const oldestTransactionDate = new Date(oldestDate);
          const requestedStartDate = new Date(startDate);
          const daysDifference = Math.floor((oldestTransactionDate - requestedStartDate) / (1000 * 60 * 60 * 24));
          monthsOfHistory = Math.round((new Date(newestDate) - oldestTransactionDate) / (1000 * 60 * 60 * 24 * 30));

          if (daysDifference > 365) {
            console.warn(`  ⚠️  Gap detected: Oldest transaction is ${Math.floor(daysDifference / 365)} years newer than requested start date`);
            console.warn(`  ⚠️  This suggests Plaid/institution is limiting available history`);
          }
        }

        // Debug: Log Plaid response metadata if available
        if (result.total_transactions !== undefined) {
          console.log(`  📊 Plaid metadata - Total available: ${result.total_transactions}`);
        }

        // Update accounts
        for (const account of result.accounts) {
          account.item_id = item.item_id;
          database.saveAccount(account, item.institution_name);
        }

        // Add account_name to transactions
        for (const transaction of result.transactions) {
          const account = result.accounts.find(acc => acc.account_id === transaction.account_id);
          transaction.account_name = account ? account.name : transaction.account_id;
        }

        // Save transactions
        const count = database.saveTransactions(result.transactions, null);
        totalTransactions += count;
        console.log(`  ✅ Result: ${count} new transaction(s) added\n`);

        // Track summary for this institution
        institutionSummary.push({
          name: item.institution_name,
          transactions: result.transactions.length,
          newTransactions: count,
          oldestDate: oldestDate || 'N/A',
          newestDate: newestDate || 'N/A',
          monthsOfHistory: monthsOfHistory || 0
        });

        database.updatePlaidItemLastSynced(item.item_id);
        backfillSuccessful = true;

      } catch (error) {
        // Check if this is a PRODUCT_NOT_READY error
        const errorCode = error.response?.data?.error_code;
        const errorMessage = error.response?.data?.error_message || error.message;
        const errorType = error.response?.data?.error_type;

        // Log detailed error information for debugging
        if (errorCode) {
          console.error(`  ❌ Plaid Error Details:`);
          console.error(`     - Error Code: ${errorCode}`);
          console.error(`     - Error Type: ${errorType}`);
          console.error(`     - Message: ${errorMessage}`);

          // Provide helpful guidance for common errors
          if (errorCode === 'INSTITUTION_NOT_AVAILABLE' || errorCode === 'INSTITUTION_NOT_SUPPORTED') {
            console.error(`     ⚠️  This institution may not be enabled in your Plaid account`);
            console.error(`     ℹ️  Check: https://dashboard.plaid.com → Account → Institutions`);
          } else if (errorCode === 'INVALID_CREDENTIALS' || errorCode === 'ITEM_LOGIN_REQUIRED') {
            console.error(`     ⚠️  Account authentication issue - user may need to re-link`);
          } else if (errorCode === 'INSTITUTION_REGISTRATION_REQUIRED') {
            console.error(`     ⚠️  This institution requires additional Plaid approval`);
            console.error(`     ℹ️  Request access in Plaid Dashboard → Institutions`);
          }
        }

        if (errorCode === 'PRODUCT_NOT_READY' && attempt < maxRetries - 1) {
          // Retry for PRODUCT_NOT_READY
          console.log(`  ⏳ ${item.institution_name}: Transactions not ready yet, will retry...`);
          continue;
        } else {
          // Non-retryable error or max retries reached
          const errorMsg = `Failed to backfill ${item.institution_name}: ${errorMessage}`;
          console.error(`  ✗ ${errorMsg}\n`);
          errors.push(errorMsg);
          break; // Stop retrying this item
        }
      }
    }
  }

  console.log(`✅ Backfill complete: ${totalTransactions} new transactions added`);

  // Display summary of historical data received
  if (institutionSummary.length > 0) {
    console.log('\n📊 Historical Data Summary:');
    console.log('─'.repeat(80));
    institutionSummary.forEach(inst => {
      console.log(`\n${inst.name}:`);
      console.log(`  Date Range: ${inst.oldestDate} to ${inst.newestDate}`);
      console.log(`  History Available: ~${inst.monthsOfHistory} months`);
      console.log(`  Transactions: ${inst.transactions} total (${inst.newTransactions} new)`);

      if (inst.monthsOfHistory < 6) {
        console.log(`  ⚠️  Limited history: This institution only provides ${inst.monthsOfHistory} months through Plaid`);
      }
    });
    console.log('\n' + '─'.repeat(80));

    // Check if all institutions have limited history
    const allLimited = institutionSummary.every(inst => inst.monthsOfHistory < 6);
    if (allLimited) {
      console.log('\n⚠️  All institutions are providing limited history (< 6 months).');
      console.log('ℹ️  This is a limitation of Plaid/your financial institutions, not this app.');
      console.log('ℹ️  For older transactions, you may need to:');
      console.log('   1. Export CSV from your bank\'s website and import manually');
      console.log('   2. Contact your bank to see if they offer more history through Plaid');
      console.log('   3. Accept that only recent history is available through automated sync\n');
    }
  }

  if (errors.length > 0) {
    console.log('\n⚠️  Some accounts failed:');
    errors.forEach(err => console.log(`  - ${err}`));
  }

  return {
    success: errors.length === 0,
    totalTransactions,
    errors,
    summary: institutionSummary
  };
}

/**
 * Backfill historical transactions for a single account by item ID
 * This triggers Plaid to fetch the latest historical data from the institution
 * @param {string} itemId - The Plaid item ID
 * @returns {Object} Result with success status and transaction count
 */
export async function backfillSingleAccountById(itemId) {
  const items = database.getPlaidItems();
  const item = items.find(i => i.item_id === itemId);

  if (!item) {
    return { success: false, error: 'Account not found' };
  }

  console.log(`\n📜 Backfilling historical transactions for ${item.institution_name}...`);

  return await backfillSingleAccount(itemId, item.institution_name, item.access_token);
}

/**
 * Backfill historical transactions for a single newly linked account (internal function)
 * This triggers Plaid to fetch the latest historical data from the institution
 * Runs in the background after initial account link (non-blocking)
 */
async function backfillSingleAccount(itemId, institutionName, accessToken) {
  console.log(`\n📜 [Background] Starting historical backfill for ${institutionName}...`);

  const endDate = new Date().toISOString().split('T')[0];
  const startDate = '2000-01-01'; // Request maximum available history

  try {
    // First, tell Plaid to refresh data from the institution
    console.log(`  🔄 Requesting Plaid to refresh historical data...`);
    await plaid.refreshTransactions(accessToken);
    console.log(`  ✓ Refresh request sent to Plaid (async background process)`);
    console.log(`  ⏳ Waiting 10 seconds before fetching currently available data...`);
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
  } catch (refreshError) {
    const refreshErrorCode = refreshError.response?.data?.error_code;
    if (refreshErrorCode === 'INVALID_PRODUCT') {
      console.log(`  ℹ️  Transactions Refresh not enabled - fetching cached data only`);
    } else {
      console.log(`  ⚠️  Refresh request failed (continuing anyway): ${refreshError.message}`);
    }
  }

  // Now fetch the historical transactions
  const maxRetries = 4;
  const retryDelays = [5000, 10000, 15000, 20000];
  let backfillSuccessful = false;
  let transactionCount = 0;
  let oldestDate = null;
  let newestDate = null;
  let monthsOfHistory = 0;

  for (let attempt = 0; attempt < maxRetries && !backfillSuccessful; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`  ⏳ Waiting before retry... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]));
      }

      const result = await plaid.getTransactions(accessToken, startDate, endDate);

      console.log(`  📥 Received ${result.transactions.length} transaction(s) from Plaid`);

      // Show transaction date range
      if (result.transactions.length > 0) {
        const dates = result.transactions.map(t => t.date).sort();
        oldestDate = dates[0];
        newestDate = dates[dates.length - 1];
        console.log(`  📅 Transaction date range: ${oldestDate} to ${newestDate}`);

        monthsOfHistory = Math.round((new Date(newestDate) - new Date(oldestDate)) / (1000 * 60 * 60 * 24 * 30));
        console.log(`  📊 History: ~${monthsOfHistory} months`);
      }

      // Get accounts to add account_name to transactions
      const accounts = await plaid.getAccounts(accessToken);

      // Add account_name to transactions
      for (const transaction of result.transactions) {
        const account = accounts.find(acc => acc.account_id === transaction.account_id);
        transaction.account_name = account ? account.name : transaction.account_id;
      }

      // Save transactions
      transactionCount = database.saveTransactions(result.transactions, null);
      console.log(`  ✅ Background backfill complete: ${transactionCount} new transaction(s) added\n`);

      database.updatePlaidItemLastSynced(itemId);
      backfillSuccessful = true;

    } catch (error) {
      const errorCode = error.response?.data?.error_code;
      const errorMessage = error.response?.data?.error_message || error.message;

      if (errorCode === 'PRODUCT_NOT_READY' && attempt < maxRetries - 1) {
        console.log(`  ⏳ Transactions not ready yet, will retry...`);
        continue;
      } else {
        console.error(`  ✗ Failed to fetch transactions: ${errorMessage}`);
        return {
          success: false,
          error: errorMessage,
          institution: institutionName
        };
      }
    }
  }

  if (!backfillSuccessful) {
    return {
      success: false,
      error: 'Max retries exceeded',
      institution: institutionName
    };
  }

  return {
    success: true,
    institution: institutionName,
    transactionsAdded: transactionCount,
    oldestDate,
    newestDate,
    monthsOfHistory
  };
}

/**
 * Remove an institution and all its accounts and transactions
 */
export async function removeInstitution(itemId) {
  try {
    console.log(`\n🗑️  Removing institution ${itemId}...`);

    // Get item details before removing
    const items = database.getPlaidItems();
    const item = items.find(i => i.item_id === itemId);

    if (!item) {
      throw new Error('Institution not found');
    }

    // Remove from database (cascades to accounts and transactions)
    database.removePlaidItem(itemId);

    console.log(`  ✓ Removed ${item.institution_name}`);
    console.log('\n✅ Institution removed successfully!');

    return {
      success: true,
      institution: item.institution_name
    };
  } catch (error) {
    console.error('\n✗ Failed to remove institution:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get account summary
 */
export async function getAccountSummary() {
  const accounts = database.getAccounts();
  const items = database.getPlaidItems();

  return {
    institutions: items.length,
    accounts: accounts.length,
    accounts_detail: accounts,
    items_detail: items
  };
}
