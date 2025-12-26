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

      // Get transactions from the last 90 days (3 months) for regular syncs
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const result = await plaid.getTransactions(item.access_token, startDate, endDate);

      // Update accounts
      for (const account of result.accounts) {
        account.item_id = item.item_id;
        database.saveAccount(account, item.institution_name);
      }
      console.log(`  ✓ Updated ${result.accounts.length} account(s)`);

      // Add account_name to transactions
      for (const transaction of result.transactions) {
        const account = result.accounts.find(acc => acc.account_id === transaction.account_id);
        transaction.account_name = account ? account.name : transaction.account_id;
      }

      // Save transactions
      const count = database.saveTransactions(result.transactions, null);
      totalTransactions += count;
      console.log(`  ✓ Synced ${count} new transaction(s)`);

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
      console.log(`  ✓ Synced ${count} new transaction(s)`);

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

    // Initial transaction sync (last 2 years - Plaid's maximum for most institutions)
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`  📥 Fetching historical transactions (up to 2 years)...`);
    const result = await plaid.getTransactions(accessToken, startDate, endDate);

    // Add account_name to transactions
    for (const transaction of result.transactions) {
      const account = accounts.find(acc => acc.account_id === transaction.account_id);
      transaction.account_name = account ? account.name : transaction.account_id;
    }

    const count = database.saveTransactions(result.transactions, null);
    console.log(`  ✓ Synced ${count} transaction(s)`);

    database.updatePlaidItemLastSynced(itemId);

    console.log('\n✅ Account linked successfully!');

    return { success: true, institution: institution.name, accounts: accounts.length, transactions: count };

  } catch (error) {
    console.error('\n✗ Failed to link account:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Backfill historical transactions (up to 2 years)
 * Useful for accounts that were linked before this feature
 */
export async function backfillHistoricalTransactions() {
  const items = database.getPlaidItems();

  if (items.length === 0) {
    console.log('No bank accounts linked.');
    return { success: false, error: 'No linked accounts' };
  }

  console.log(`\n📜 Backfilling historical transactions (up to 2 years)...`);
  console.log('⚠️  This may take a while for accounts with lots of transactions.\n');

  let totalTransactions = 0;
  const errors = [];

  // Fetch last 2 years (730 days)
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  for (const item of items) {
    try {
      console.log(`📊 Backfilling ${item.institution_name}...`);
      console.log(`   Date range: ${startDate} to ${endDate}`);

      const result = await plaid.getTransactions(item.access_token, startDate, endDate);

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
      console.log(`  ✓ Added ${count} new transaction(s)\n`);

      database.updatePlaidItemLastSynced(item.item_id);

    } catch (error) {
      const errorMsg = `Failed to backfill ${item.institution_name}: ${error.message}`;
      console.error(`  ✗ ${errorMsg}\n`);
      errors.push(errorMsg);
    }
  }

  console.log(`✅ Backfill complete: ${totalTransactions} new transactions added`);

  if (errors.length > 0) {
    console.log('\n⚠️  Some accounts failed:');
    errors.forEach(err => console.log(`  - ${err}`));
  }

  return {
    success: errors.length === 0,
    totalTransactions,
    errors
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
