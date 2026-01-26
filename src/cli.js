#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import * as sheets from './sheets.js';
import * as sync from './sync.js';
import * as plaid from './plaid.js';
import * as database from './database.js';
import { registerBudgetCommands } from './cli/budgetCommands.js';
import { registerIncomeCommands } from './cli/incomeCommands.js';
import { registerReportCommands } from './cli/reportCommands.js';
import { registerDashboardCommands } from './cli/dashboardCommands.js';

const program = new Command();

program
  .name('expense-tracker')
  .description('Expense tracker with Plaid + Google Sheets + Budgeting')
  .version('1.0.0')
  .hook('preAction', async (thisCommand, actionCommand) => {
    // Initialize database for all commands
    try {
      database.initializeDatabase();
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to initialize database'));
      console.error(chalk.yellow(error.message));
      process.exit(1);
    }

    // Skip Google Sheets initialization for budget/income/report commands that don't need it
    // actionCommand is the actual subcommand being executed
    const commandName = actionCommand.name();

    // Check if this is a local-only command (by prefix or exact match)
    const localOnlyPrefixes = ['budget:', 'income:', 'report:', 'scenario:'];
    const isLocalCommand = localOnlyPrefixes.some(prefix => commandName.startsWith(prefix));

    if (!isLocalCommand) {
      try {
        await sheets.initializeSheets(database);
      } catch (error) {
        console.error(chalk.red('\n❌ Failed to connect to Google Sheets'));
        console.error(chalk.yellow('Run "npm run setup" to configure Google Sheets\n'));
        process.exit(1);
      }
    }
  });

/**
 * Link a new bank account
 */
program
  .command('link')
  .description('Link a new bank account via Plaid')
  .action(async () => {
    try {
      console.log(chalk.blue('\n🔗 Linking Bank Account\n'));
      console.log('To link a bank account, you need a public token from Plaid Link.');
      console.log('\nOptions:');
      console.log('1. Use Plaid Sandbox (for testing): You can generate a test public token');
      console.log('2. Use the Plaid Link web interface to connect a real bank\n');
      
      console.log(chalk.yellow('Visit: https://plaid.com/docs/quickstart/'));
      console.log('Or set up a Plaid developer account and use Link integration\n');
      
      // For sandbox testing, generate a link token
      const linkToken = await plaid.createLinkToken();
      console.log(chalk.green('Link token created:'), linkToken);
      console.log('\nUse this token in Plaid Link to connect an account.');
      console.log('After completing Link, run: npm run exchange -- --token YOUR_PUBLIC_TOKEN\n');
      
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

/**
 * Exchange public token and link account
 */
program
  .command('exchange')
  .description('Exchange a public token to link an account')
  .requiredOption('-t, --token <token>', 'Public token from Plaid Link')
  .action(async (options) => {
    try {
      await sync.linkAccount(options.token);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

/**
 * Sync transactions
 */
program
  .command('sync')
  .description('Sync transactions from all linked accounts')
  .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
  .action(async (options) => {
    try {
      if (options.start && options.end) {
        await sync.syncDateRange(options.start, options.end);
      } else {
        await sync.syncAllAccounts();
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

/**
 * Open Google Sheet in browser
 */
program
  .command('open')
  .description('Open the Google Sheet in your browser')
  .action(async () => {
    try {
      const url = sheets.getSpreadsheetUrl();
      console.log(chalk.blue('\n📊 Your Expense Tracker Spreadsheet:\n'));
      console.log(chalk.cyan(url));
      console.log();
      
      // Try to open in browser (platform-specific)
      const { exec } = await import('child_process');
      const command = process.platform === 'darwin' ? 'open' : 
                     process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${command} "${url}"`);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
    }
  });

/**
 * List accounts
 */
program
  .command('accounts')
  .description('List all linked bank accounts')
  .action(async () => {
    try {
      const summary = await sync.getAccountSummary();
      
      console.log(chalk.blue(`\n💳 Connected Accounts (${summary.accounts} total)\n`));
      
      if (summary.accounts === 0) {
        console.log(chalk.yellow('No accounts linked yet. Run "npm run link" to get started.\n'));
        return;
      }

      const table = new Table({
        head: [
          chalk.cyan('Institution'),
          chalk.cyan('Account'),
          chalk.cyan('Type'),
          chalk.cyan('Balance'),
          chalk.cyan('Last Synced')
        ],
        colWidths: [20, 25, 15, 15, 20]
      });

      // Group by institution
      const byInstitution = {};
      for (const account of summary.accounts_detail) {
        if (!byInstitution[account.institution_name]) {
          byInstitution[account.institution_name] = [];
        }
        byInstitution[account.institution_name].push(account);
      }

      // Add items by institution
      const items = summary.items_detail.reduce((acc, item) => {
        acc[item.institution_name] = item;
        return acc;
      }, {});

      for (const [institution, accounts] of Object.entries(byInstitution)) {
        accounts.forEach((account, idx) => {
          const lastSynced = items[institution]?.last_synced_at 
            ? new Date(items[institution].last_synced_at).toLocaleString()
            : 'Never';

          table.push([
            idx === 0 ? institution : '',
            `${account.name}${account.mask ? ' ****' + account.mask : ''}`,
            account.subtype || account.type,
            account.current_balance 
              ? `$${account.current_balance.toFixed(2)}` 
              : 'N/A',
            idx === 0 ? lastSynced : ''
          ]);
        });
      }

      console.log(table.toString());
      console.log();
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

/**
 * List transactions
 */
program
  .command('transactions')
  .description('List recent transactions')
  .option('-l, --limit <number>', 'Number of transactions to show', '20')
  .action(async (options) => {
    try {
      const limit = parseInt(options.limit);
      const transactions = await sheets.getTransactions(limit);
      
      console.log(chalk.blue(`\n💵 Recent Transactions (${transactions.length})\n`));
      
      if (transactions.length === 0) {
        console.log(chalk.yellow('No transactions found. Run "npm run sync" first.\n'));
        return;
      }

      const table = new Table({
        head: [
          chalk.cyan('Date'),
          chalk.cyan('Description'),
          chalk.cyan('Account'),
          chalk.cyan('Category'),
          chalk.cyan('Amount')
        ],
        colWidths: [12, 35, 20, 15, 12]
      });

      for (const txn of transactions) {
        const amount = txn.amount;
        const formattedAmount = amount > 0 
          ? chalk.green(`+$${Math.abs(amount).toFixed(2)}`)
          : chalk.red(`-$${Math.abs(amount).toFixed(2)}`);

        table.push([
          txn.date,
          txn.merchant_name || txn.name,
          txn.account_name,
          txn.category || '-',
          formattedAmount
        ]);
      }

      console.log(table.toString());
      console.log(`\n📊 View all in spreadsheet: ${sheets.getSpreadsheetUrl()}\n`);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

/**
 * Show statistics
 */
program
  .command('stats')
  .description('Show spending statistics')
  .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
  .action(async (options) => {
    try {
      const stats = await sheets.getTransactionStats(options.start, options.end);
      
      const dateRange = options.start && options.end
        ? `${options.start} to ${options.end}`
        : 'All time';

      console.log(chalk.blue(`\n📊 Statistics (${dateRange})\n`));
      
      console.log(chalk.gray('Total Transactions:'), stats.total_count);
      console.log(chalk.red('Total Spent:       '), `$${Math.abs(stats.total_spent).toFixed(2)}`);
      console.log(chalk.green('Total Income:      '), `$${stats.total_income.toFixed(2)}`);
      console.log(chalk.cyan('Net:               '), `$${stats.net.toFixed(2)}`);
      console.log();
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

/**
 * List categories
 */
program
  .command('categories')
  .description('List all expense categories')
  .action(async () => {
    try {
      const categories = await sheets.getCategories();
      
      console.log(chalk.blue(`\n📁 Categories (${categories.length})\n`));
      
      const table = new Table({
        head: [chalk.cyan('ID'), chalk.cyan('Name')],
        colWidths: [8, 40]
      });

      for (const category of categories) {
        table.push([category.id, category.name]);
      }

      console.log(table.toString());
      console.log();
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Register budget commands
registerBudgetCommands(program);

// Register income commands
registerIncomeCommands(program);

// Register report commands
registerReportCommands(program);

// Register dashboard commands
registerDashboardCommands(program);

// Default action - show help
program.action(() => {
  program.help();
});

program.parse();
