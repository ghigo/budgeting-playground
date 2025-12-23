#!/usr/bin/env node

import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log(chalk.blue.bold('\n🚀 Expense Tracker Setup\n'));

async function main() {
  try {
    // Check for existing config
    const configPath = join(__dirname, '../config.json');
    let config = {};
    
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    console.log(chalk.yellow('This setup will help you configure:'));
    console.log('  1. Google Sheets for data storage');
    console.log('  2. Plaid for bank connections\n');

    // Google Sheets setup
    console.log(chalk.blue.bold('📊 Google Sheets Setup\n'));
    
    const credentialsPath = join(__dirname, '../credentials/google-credentials.json');
    
    if (!fs.existsSync(credentialsPath)) {
      console.log(chalk.yellow('To use Google Sheets, you need a service account:'));
      console.log('\n1. Go to: https://console.cloud.google.com/');
      console.log('2. Create a new project (or select existing)');
      console.log('3. Enable the Google Sheets API');
      console.log('4. Go to: IAM & Admin > Service Accounts');
      console.log('5. Create Service Account');
      console.log('   - Name: "Expense Tracker"');
      console.log('   - Role: None needed');
      console.log('6. Click on the service account > Keys tab');
      console.log('7. Add Key > Create New Key > JSON');
      console.log('8. Download the JSON file\n');

      const { credentialsReady } = await inquirer.prompt([{
        type: 'confirm',
        name: 'credentialsReady',
        message: 'Have you downloaded the credentials JSON file?',
        default: false
      }]);

      if (!credentialsReady) {
        console.log(chalk.yellow('\nPlease complete the steps above and run setup again.\n'));
        process.exit(0);
      }

      const { credentialsFile } = await inquirer.prompt([{
        type: 'input',
        name: 'credentialsFile',
        message: 'Enter the path to your credentials JSON file:',
        validate: (input) => {
          if (!fs.existsSync(input)) {
            return 'File not found. Please enter a valid path.';
          }
          return true;
        }
      }]);

      // Copy credentials file
      const credContent = fs.readFileSync(credentialsFile, 'utf8');
      fs.mkdirSync(join(__dirname, '../credentials'), { recursive: true });
      fs.writeFileSync(credentialsPath, credContent);
      console.log(chalk.green('✓ Credentials saved\n'));
    } else {
      console.log(chalk.green('✓ Google credentials found\n'));
    }

    // Create or use existing spreadsheet
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    
    const { createNew } = await inquirer.prompt([{
      type: 'list',
      name: 'createNew',
      message: 'Do you want to create a new spreadsheet or use an existing one?',
      choices: ['Create new spreadsheet', 'Use existing spreadsheet']
    }]);

    let spreadsheetId;

    if (createNew === 'Create new spreadsheet') {
      // Create new spreadsheet
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const authClient = await auth.getClient();
      const sheets = google.sheets({ version: 'v4', auth: authClient });

      console.log(chalk.yellow('\nCreating new spreadsheet...'));

      const spreadsheet = await sheets.spreadsheets.create({
        resource: {
          properties: {
            title: 'Expense Tracker',
          },
          sheets: [
            { properties: { title: 'Accounts' } },
            { properties: { title: 'Transactions' } },
            { properties: { title: 'Categories' } },
            { properties: { title: 'PlaidItems' } },
          ],
        },
      });

      spreadsheetId = spreadsheet.data.spreadsheetId;
      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      
      console.log(chalk.green('✓ Spreadsheet created!'));
      console.log(chalk.cyan('\n📊 Spreadsheet URL:'), spreadsheetUrl);
      
      console.log(chalk.yellow('\n⚠️  IMPORTANT: You must share this spreadsheet with your service account email!'));
      console.log(chalk.white(`   Email: ${credentials.client_email}`));
      console.log(chalk.white('   1. Open the spreadsheet'));
      console.log(chalk.white('   2. Click "Share" button'));
      console.log(chalk.white('   3. Paste the service account email'));
      console.log(chalk.white('   4. Set permission to "Editor"'));
      console.log(chalk.white('   5. Uncheck "Notify people"\n'));

      const { shared } = await inquirer.prompt([{
        type: 'confirm',
        name: 'shared',
        message: 'Have you shared the spreadsheet with the service account?',
        default: false
      }]);

      if (!shared) {
        console.log(chalk.yellow('\nPlease share the spreadsheet and run setup again.\n'));
        process.exit(0);
      }

    } else {
      const { sheetId } = await inquirer.prompt([{
        type: 'input',
        name: 'sheetId',
        message: 'Enter your Google Sheet ID (from the URL):',
        validate: (input) => input.length > 0 ? true : 'Sheet ID is required'
      }]);

      spreadsheetId = sheetId;
      
      console.log(chalk.yellow('\n⚠️  Make sure this spreadsheet is shared with your service account:'));
      console.log(chalk.white(`   Email: ${credentials.client_email}\n`));
    }

    config.google_sheet_id = spreadsheetId;

    // Plaid setup
    console.log(chalk.blue.bold('\n🏦 Plaid API Setup\n'));
    
    if (!config.plaid_client_id) {
      console.log(chalk.yellow('To connect bank accounts, you need Plaid API credentials:'));
      console.log('\n1. Sign up at: https://dashboard.plaid.com/signup');
      console.log('2. Create a new application');
      console.log('3. Go to: Team Settings > Keys');
      console.log('4. Copy your client_id and sandbox secret\n');

      const { plaidReady } = await inquirer.prompt([{
        type: 'confirm',
        name: 'plaidReady',
        message: 'Do you have your Plaid credentials ready?',
        default: false
      }]);

      if (plaidReady) {
        const plaidAnswers = await inquirer.prompt([
          {
            type: 'input',
            name: 'clientId',
            message: 'Enter your Plaid client_id:',
            validate: (input) => input.length > 0 ? true : 'Client ID is required'
          },
          {
            type: 'input',
            name: 'secret',
            message: 'Enter your Plaid secret (sandbox):',
            validate: (input) => input.length > 0 ? true : 'Secret is required'
          },
          {
            type: 'list',
            name: 'env',
            message: 'Select Plaid environment:',
            choices: ['sandbox', 'development', 'production'],
            default: 'sandbox'
          }
        ]);

        config.plaid_client_id = plaidAnswers.clientId;
        config.plaid_secret = plaidAnswers.secret;
        config.plaid_env = plaidAnswers.env;
      } else {
        console.log(chalk.yellow('\nYou can add Plaid credentials later by editing config.json\n'));
      }
    } else {
      console.log(chalk.green('✓ Plaid credentials found\n'));
    }

    // Save config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(chalk.green('✓ Configuration saved\n'));

    // Initialize spreadsheet structure
    if (createNew === 'Create new spreadsheet') {
      console.log(chalk.yellow('Setting up spreadsheet structure...'));
      
      const { initializeSheets, setupSpreadsheet } = await import('./sheets.js');
      await initializeSheets();
      await setupSpreadsheet();
      
      console.log(chalk.green('✓ Spreadsheet initialized\n'));
    }

    console.log(chalk.green.bold('✅ Setup complete!\n'));
    console.log(chalk.blue('Next steps:'));
    console.log('  1. Link a bank account: npm run link');
    console.log('  2. Sync transactions: npm run sync');
    console.log('  3. View your data: npm run open\n');

  } catch (error) {
    console.error(chalk.red('\n❌ Setup failed:'), error.message);
    process.exit(1);
  }
}

main();
