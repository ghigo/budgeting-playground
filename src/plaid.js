import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load configuration
const configPath = join(__dirname, '../config.json');
let config = {};

if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// Initialize Plaid client
const configuration = new Configuration({
  basePath: PlaidEnvironments[config.plaid_env || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': config.plaid_client_id || process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': config.plaid_secret || process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

/**
 * Create a Link token for connecting a bank account
 */
export async function createLinkToken(userId = 'user-1') {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: 'Expense Tracker',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });
    return response.data.link_token;
  } catch (error) {
    console.error('Error creating link token:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Exchange public token for access token
 */
export async function exchangePublicToken(publicToken) {
  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });
    return {
      accessToken: response.data.access_token,
      itemId: response.data.item_id,
    };
  } catch (error) {
    console.error('Error exchanging public token:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get institution details
 */
export async function getInstitution(institutionId) {
  try {
    const response = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: ['US'],
    });
    return response.data.institution;
  } catch (error) {
    console.error('Error getting institution:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get item (bank connection) details
 */
export async function getItem(accessToken) {
  try {
    const response = await plaidClient.itemGet({
      access_token: accessToken,
    });
    return response.data.item;
  } catch (error) {
    console.error('Error getting item:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get accounts for an item
 */
export async function getAccounts(accessToken) {
  try {
    const response = await plaidClient.accountsGet({
      access_token: accessToken,
    });
    return response.data.accounts;
  } catch (error) {
    console.error('Error getting accounts:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get transactions for a date range
 */
export async function getTransactions(accessToken, startDate, endDate) {
  try {
    const response = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: {
        count: 500,
        offset: 0,
      },
    });

    let transactions = response.data.transactions;
    const totalTransactions = response.data.total_transactions;

    // Fetch additional transactions if there are more than 500
    while (transactions.length < totalTransactions) {
      const paginatedResponse = await plaidClient.transactionsGet({
        access_token: accessToken,
        start_date: startDate,
        end_date: endDate,
        options: {
          count: 500,
          offset: transactions.length,
        },
      });
      transactions = transactions.concat(paginatedResponse.data.transactions);
    }

    return {
      transactions,
      accounts: response.data.accounts,
    };
  } catch (error) {
    console.error('Error getting transactions:', error.response?.data || error.message);
    throw error;
  }
}

export { plaidClient };
