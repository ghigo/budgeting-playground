/**
 * Income CLI Commands
 * Handles all income-related CLI operations
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import * as incomeManager from '../income/incomeManager.js';

/**
 * Register income commands with the CLI program
 * @param {Command} program - Commander program instance
 */
export function registerIncomeCommands(program) {
  // Income add command
  program
    .command('income:add')
    .description('Add an income transaction')
    .requiredOption('-d, --date <date>', 'Date (YYYY-MM-DD)')
    .requiredOption('-a, --amount <number>', 'Amount')
    .requiredOption('-s, --source <name>', 'Income source (e.g., Employer, Client)')
    .requiredOption('-t, --type <type>', `Income type: ${incomeManager.INCOME_TYPES.join(', ')}`)
    .option('--description <text>', 'Description')
    .option('--account <name>', 'Account that received the income')
    .action(async (options) => {
      try {
        const income = incomeManager.addIncome({
          date: options.date,
          amount: parseFloat(options.amount),
          source: options.source,
          type: options.type,
          description: options.description,
          accountId: options.account
        });

        console.log(chalk.green('\n✓ Income recorded successfully'));
        console.log(`  Date: ${income.date}`);
        console.log(`  Amount: ${formatCurrency(income.amount)}`);
        console.log(`  Source: ${income.source}`);
        console.log(`  Type: ${income.type}`);
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Income edit command
  program
    .command('income:edit')
    .description('Edit an income transaction')
    .requiredOption('--id <id>', 'Income transaction ID')
    .option('-d, --date <date>', 'New date (YYYY-MM-DD)')
    .option('-a, --amount <number>', 'New amount')
    .option('-s, --source <name>', 'New source')
    .option('-t, --type <type>', `New type: ${incomeManager.INCOME_TYPES.join(', ')}`)
    .option('--description <text>', 'New description')
    .action(async (options) => {
      try {
        const updates = {};
        if (options.date) updates.date = options.date;
        if (options.amount) updates.amount = parseFloat(options.amount);
        if (options.source) updates.source = options.source;
        if (options.type) updates.type = options.type;
        if (options.description) updates.description = options.description;

        if (Object.keys(updates).length === 0) {
          console.error(chalk.red('Error: No updates provided'));
          process.exit(1);
        }

        const success = incomeManager.updateIncome(options.id, updates);

        if (success) {
          console.log(chalk.green('\n✓ Income updated successfully'));
        } else {
          console.log(chalk.yellow('No changes made'));
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Income delete command
  program
    .command('income:delete')
    .description('Delete an income transaction')
    .requiredOption('--id <id>', 'Income transaction ID')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (options) => {
      try {
        const income = incomeManager.getIncomeById(options.id);

        if (!income) {
          console.error(chalk.red('Income transaction not found'));
          process.exit(1);
        }

        if (!options.confirm) {
          const { confirmed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmed',
            message: `Delete income: ${formatCurrency(income.amount)} from ${income.source} on ${income.date}?`,
            default: false
          }]);

          if (!confirmed) {
            console.log(chalk.yellow('Cancelled'));
            return;
          }
        }

        incomeManager.deleteIncome(options.id);
        console.log(chalk.green('\n✓ Income deleted'));
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Income list command
  program
    .command('income:list')
    .description('List income transactions')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .option('-m, --month <number>', 'Month (1-12)')
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const month = options.month ? parseInt(options.month) : null;

        const transactions = incomeManager.getIncomeTransactions(year, month);

        const periodDesc = month ? `${getMonthName(month)} ${year}` : `${year}`;
        console.log(chalk.blue(`\n💰 Income Transactions for ${periodDesc}\n`));

        if (transactions.length === 0) {
          console.log(chalk.yellow('No income transactions found.'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Date'),
            chalk.cyan('Source'),
            chalk.cyan('Type'),
            chalk.cyan('Amount'),
            chalk.cyan('Description'),
            chalk.cyan('ID')
          ],
          colWidths: [12, 20, 12, 14, 25, 20]
        });

        let total = 0;
        for (const txn of transactions) {
          total += txn.amount;
          table.push([
            txn.date,
            txn.source.substring(0, 18),
            txn.type,
            chalk.green(formatCurrency(txn.amount)),
            (txn.description || '-').substring(0, 22),
            txn.id.substring(0, 18)
          ]);
        }

        console.log(table.toString());
        console.log(chalk.bold(`\nTotal: ${formatCurrency(total)}`));
        console.log(chalk.gray(`${transactions.length} transaction(s)`));
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Income set-expected command
  program
    .command('income:set-expected')
    .description('Set expected annual income')
    .requiredOption('-s, --source <name>', 'Income source')
    .requiredOption('-t, --type <type>', `Income type: ${incomeManager.INCOME_TYPES.join(', ')}`)
    .requiredOption('-a, --amount <number>', 'Annual expected amount')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .option('-n, --notes <text>', 'Notes')
    .action(async (options) => {
      try {
        const result = incomeManager.setExpectedIncome({
          source: options.source,
          type: options.type,
          year: parseInt(options.year),
          annualExpected: parseFloat(options.amount),
          notes: options.notes
        });

        const action = result.updated ? 'updated' : 'created';
        console.log(chalk.green(`\n✓ Expected income ${action}`));
        console.log(`  Source: ${result.source}`);
        console.log(`  Type: ${result.type}`);
        console.log(`  Year: ${result.year}`);
        console.log(`  Expected: ${formatCurrency(result.annual_expected)}/year (${formatCurrency(result.annual_expected / 12)}/month)`);
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Income expected list command
  program
    .command('income:expected')
    .description('List expected income budgets')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const budgets = incomeManager.getIncomeBudgets(year);

        console.log(chalk.blue(`\n💵 Expected Income for ${year}\n`));

        if (budgets.length === 0) {
          console.log(chalk.yellow('No expected income set. Use "income:set-expected" to set expectations.'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Source'),
            chalk.cyan('Type'),
            chalk.cyan('Annual'),
            chalk.cyan('Monthly'),
            chalk.cyan('Notes')
          ],
          colWidths: [25, 12, 15, 15, 25]
        });

        let total = 0;
        for (const budget of budgets) {
          total += budget.annual_expected;
          table.push([
            budget.source.substring(0, 23),
            budget.type,
            formatCurrency(budget.annual_expected),
            formatCurrency(budget.annual_expected / 12),
            (budget.notes || '-').substring(0, 22)
          ]);
        }

        table.push([
          chalk.bold('TOTAL'),
          '',
          chalk.bold(formatCurrency(total)),
          chalk.bold(formatCurrency(total / 12)),
          ''
        ]);

        console.log(table.toString());
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Income summary command
  program
    .command('income:summary')
    .description('Show income summary and analysis')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const analysis = incomeManager.getIncomeAnalysis(year);

        console.log(chalk.blue(`\n📊 Income Summary for ${year}\n`));

        // Overall stats
        console.log(chalk.bold('Overview:'));
        console.log(`  Year Progress:     ${analysis.yearProgress.toFixed(1)}%`);
        console.log(`  Actual Income:     ${formatCurrency(analysis.actual.total)}`);
        console.log(`  Expected Income:   ${formatCurrency(analysis.expected.total)}`);
        console.log(`  Expected to Date:  ${formatCurrency(analysis.expected.toDate)}`);

        // Variance
        const varianceColor = analysis.variance.toDate >= 0 ? chalk.green : chalk.red;
        console.log(`\n${chalk.bold('Variance:')}`);
        console.log(`  Year-to-Date:      ${varianceColor(formatCurrency(analysis.variance.toDate))}`);
        console.log(`  Full Year:         ${varianceColor(formatCurrency(analysis.variance.total))} (${analysis.variance.percentage.toFixed(1)}%)`);

        // Projection
        const projectionColor = analysis.projection.onTrack ? chalk.green : chalk.yellow;
        console.log(`\n${chalk.bold('Projection:')}`);
        console.log(`  Daily Rate:        ${formatCurrency(analysis.projection.dailyRate)}/day`);
        console.log(`  Year-End Forecast: ${projectionColor(formatCurrency(analysis.projection.yearEnd))}`);
        console.log(`  Status:            ${analysis.projection.onTrack ? chalk.green('On Track') : chalk.yellow('Below Target')}`);

        // By type breakdown
        if (analysis.actual.byType.length > 0) {
          console.log(`\n${chalk.bold('Income by Type:')}`);
          const typeTable = new Table({
            head: [chalk.cyan('Type'), chalk.cyan('Source'), chalk.cyan('Amount'), chalk.cyan('Count')],
            colWidths: [12, 25, 15, 10]
          });

          for (const item of analysis.actual.byType) {
            typeTable.push([item.type, item.source, formatCurrency(item.total), item.count]);
          }

          console.log(typeTable.toString());
        }

        // Monthly breakdown
        if (analysis.actual.monthly.length > 0) {
          console.log(`\n${chalk.bold('Monthly Breakdown:')}`);
          const monthlyTable = new Table({
            head: [chalk.cyan('Month'), chalk.cyan('Amount')],
            colWidths: [15, 15]
          });

          for (const item of analysis.actual.monthly) {
            monthlyTable.push([getMonthName(parseInt(item.month)), formatCurrency(item.total)]);
          }

          console.log(monthlyTable.toString());
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Income detect command
  program
    .command('income:detect')
    .description('Detect potential income from transactions')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .option('--import', 'Import detected income transactions')
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const detected = incomeManager.detectPotentialIncome(year);

        console.log(chalk.blue(`\n🔍 Potential Income Detected for ${year}\n`));

        if (detected.length === 0) {
          console.log(chalk.yellow('No potential income transactions detected.'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Date'),
            chalk.cyan('Description'),
            chalk.cyan('Amount'),
            chalk.cyan('Detected Type'),
            chalk.cyan('Transaction ID')
          ],
          colWidths: [12, 30, 14, 14, 25]
        });

        for (const txn of detected.slice(0, 20)) {
          table.push([
            txn.date,
            (txn.merchant_name || txn.description).substring(0, 28),
            chalk.green(formatCurrency(txn.amount)),
            txn.income_type,
            txn.transaction_id.substring(0, 23)
          ]);
        }

        console.log(table.toString());

        if (detected.length > 20) {
          console.log(chalk.gray(`... and ${detected.length - 20} more`));
        }

        const total = detected.reduce((sum, t) => sum + t.amount, 0);
        console.log(chalk.bold(`\nTotal Detected: ${formatCurrency(total)}`));
        console.log(chalk.gray(`${detected.length} transaction(s)`));

        if (options.import) {
          const { confirmed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmed',
            message: `Import ${detected.length} transactions as income?`,
            default: false
          }]);

          if (confirmed) {
            const result = incomeManager.importDetectedIncome(detected);
            console.log(chalk.green(`\n✓ Imported ${result.imported.length} income transactions`));
            if (result.errors.length > 0) {
              console.log(chalk.yellow(`⚠ ${result.errors.length} errors occurred`));
            }
          }
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Income vs expenses command
  program
    .command('income:compare')
    .description('Compare income vs expected')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const comparison = incomeManager.getIncomeVsBudget(year);

        console.log(chalk.blue(`\n📊 Income vs Expected for ${year}\n`));

        if (comparison.comparison.length === 0) {
          console.log(chalk.yellow('No income data to compare.'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Source'),
            chalk.cyan('Type'),
            chalk.cyan('Expected'),
            chalk.cyan('Actual'),
            chalk.cyan('Variance'),
            chalk.cyan('%')
          ],
          colWidths: [20, 12, 14, 14, 14, 10]
        });

        for (const item of comparison.comparison) {
          const varianceColor = item.variance >= 0 ? chalk.green : chalk.red;
          table.push([
            item.source.substring(0, 18) + (item.unbudgeted ? ' *' : ''),
            item.type,
            formatCurrency(item.expected),
            formatCurrency(item.actual),
            varianceColor(formatCurrency(item.variance)),
            varianceColor(`${item.variance_pct.toFixed(1)}%`)
          ]);
        }

        // Total row
        const totalVariance = comparison.totalVariance;
        const totalVarianceColor = totalVariance >= 0 ? chalk.green : chalk.red;
        table.push([
          chalk.bold('TOTAL'),
          '',
          chalk.bold(formatCurrency(comparison.totalExpected)),
          chalk.bold(formatCurrency(comparison.totalActual)),
          chalk.bold(totalVarianceColor(formatCurrency(totalVariance))),
          ''
        ]);

        console.log(table.toString());

        if (comparison.comparison.some(c => c.unbudgeted)) {
          console.log(chalk.gray('\n* Unbudgeted income source'));
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });
}

/**
 * Format a number as currency
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Get month name from number
 * @param {number} month - Month number (1-12)
 * @returns {string} Month name
 */
function getMonthName(month) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[month - 1] || 'Unknown';
}
