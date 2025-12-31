#!/usr/bin/env node

import chalk from 'chalk';
import { initializeSheets, setupSpreadsheet } from './sheets.js';

const environment = (process.env.MODE || process.env.NODE_ENV || 'sandbox').toLowerCase();
console.log(chalk.blue.bold(`\n📊 Initializing Spreadsheet Structure (${environment} environment)\n`));

async function main() {
  try {
    // Connect to Google Sheets
    await initializeSheets();

    console.log(chalk.yellow('Creating sheets and headers...\n'));

    // Set up the spreadsheet structure
    await setupSpreadsheet();

    console.log(chalk.green.bold('\n✅ Spreadsheet initialized successfully!\n'));
    console.log(chalk.blue('Your spreadsheet now has these sheets:'));
    console.log('  - Accounts                (for bank account information)');
    console.log('  - Transactions            (for all your transactions)');
    console.log('  - Categories              (for expense categories)');
    console.log('  - PlaidItems              (for bank connections)');
    console.log('  - PlaidCategoryMappings   (for auto-categorization)');
    console.log('  - MerchantMappings        (for auto-categorization)');
    console.log('  - CategoryRules           (for auto-categorization)\n');
    console.log(chalk.blue('Next steps:'));
    console.log('  1. Link your bank: npm run exchange -- --token YOUR_TOKEN');
    console.log('  2. Sync transactions: npm run sync');
    console.log('  3. View your data: npm run open\n');

  } catch (error) {
    console.error(chalk.red('\n❌ Failed to initialize:'), error.message);
    console.error(chalk.yellow('\nTroubleshooting:'));
    console.error('  1. Make sure you shared the spreadsheet with your service account email');
    console.error('  2. Check that the spreadsheet ID in config.json is correct');
    console.error('  3. Verify your Google credentials are valid\n');
    process.exit(1);
  }
}

main();
