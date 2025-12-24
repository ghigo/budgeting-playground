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

// Determine environment: use MODE env var, fallback to NODE_ENV, default to sandbox
const environment = (process.env.MODE || process.env.NODE_ENV || 'sandbox').toLowerCase();
const isProduction = environment === 'production';

// Get credentials based on environment
let clientId, secret;

// Support both old and new config formats
if (config.plaid) {
  // New format: separate credentials per environment
  clientId = config.plaid.client_id || process.env.PLAID_CLIENT_ID;
  if (isProduction && config.plaid.production) {
    secret = config.plaid.production.secret || process.env.PLAID_SECRET;
  } else if (config.plaid.sandbox) {
    secret = config.plaid.sandbox.secret || process.env.PLAID_SECRET;
  }
} else {
  // Old format: backward compatibility
  clientId = config.plaid_client_id || process.env.PLAID_CLIENT_ID;
  secret = config.plaid_secret || process.env.PLAID_SECRET;
}

// Initialize Plaid client
const configuration = new Configuration({
  basePath: PlaidEnvironments[isProduction ? 'production' : 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': clientId,
      'PLAID-SECRET': secret,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

// Export environment info
export const plaidEnvironment = isProduction ? 'production' : 'sandbox';

/**
 * Create a Link token for connecting a bank account
 */
export async function createLinkToken(userId = 'user-1') {
  try {
    console.log(`Creating link token for environment: ${plaidEnvironment}`);
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: 'Expense Tracker',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });
    return response.data.link_token;
  } catch (error) {
    const errorData = error.response?.data || {};
    console.error('❌ Error creating link token:');
    console.error('   Status:', error.response?.status);
    console.error('   Error Code:', errorData.error_code);
    console.error('   Error Type:', errorData.error_type);
    console.error('   Error Message:', errorData.error_message);
    console.error('   Display Message:', errorData.display_message);
    console.error('   Environment:', plaidEnvironment);

    // Throw more descriptive error
    const message = errorData.error_message || errorData.display_message || error.message;
    throw new Error(`Plaid error (${plaidEnvironment}): ${message}`);
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
