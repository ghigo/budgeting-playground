/**
 * Budget CLI Commands
 * Handles all budget-related CLI operations
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import * as budgetManager from '../budgets/budgetManager.js';
import * as database from '../database.js';

/**
 * Register budget commands with the CLI program
 * @param {Command} program - Commander program instance
 */
export function registerBudgetCommands(program) {
  // Budget create command
  program
    .command('budget:create')
    .description('Create a new budget for a category')
    .option('-c, --category <name>', 'Category name')
    .option('-a, --amount <number>', 'Annual budget amount')
    .option('-y, --year <number>', 'Budget year', String(new Date().getFullYear()))
    .option('-n, --notes <text>', 'Budget notes')
    .option('-i, --interactive', 'Interactive mode - walk through all categories')
    .action(async (options) => {
      try {
        if (options.interactive) {
          await interactiveBudgetSetup(parseInt(options.year));
        } else {
          if (!options.category || !options.amount) {
            console.error(chalk.red('Error: --category and --amount are required (or use --interactive)'));
            process.exit(1);
          }

          const budget = budgetManager.createBudget(
            options.category,
            parseInt(options.year),
            parseFloat(options.amount),
            options.notes
          );

          console.log(chalk.green('\n✓ Budget created successfully'));
          console.log(`  Category: ${budget.category_name || options.category}`);
          console.log(`  Year: ${budget.year}`);
          console.log(`  Amount: ${formatCurrency(budget.annual_amount)}/year (${formatCurrency(budget.annual_amount / 12)}/month)`);
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Budget update command
  program
    .command('budget:update')
    .description('Update an existing budget')
    .requiredOption('-c, --category <name>', 'Category name')
    .requiredOption('-a, --amount <number>', 'New annual budget amount')
    .option('-y, --year <number>', 'Budget year', String(new Date().getFullYear()))
    .option('-r, --reason <text>', 'Reason for adjustment')
    .action(async (options) => {
      try {
        const budget = budgetManager.updateBudget(
          options.category,
          parseInt(options.year),
          parseFloat(options.amount),
          options.reason
        );

        console.log(chalk.green('\n✓ Budget updated successfully'));
        console.log(`  Category: ${budget.category_name}`);
        console.log(`  New Amount: ${formatCurrency(budget.annual_amount)}/year`);
        if (options.reason) {
          console.log(`  Reason: ${options.reason}`);
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Budget clone command
  program
    .command('budget:clone')
    .description('Clone budgets from one year to another')
    .requiredOption('-f, --from <year>', 'Source year')
    .requiredOption('-t, --to <year>', 'Target year')
    .option('-i, --inflation <percent>', 'Inflation adjustment percentage', '0')
    .action(async (options) => {
      try {
        const cloned = budgetManager.cloneBudgets(
          parseInt(options.from),
          parseInt(options.to),
          parseFloat(options.inflation)
        );

        console.log(chalk.green(`\n✓ Cloned ${cloned.length} budgets from ${options.from} to ${options.to}`));

        if (parseFloat(options.inflation) > 0) {
          console.log(chalk.gray(`  Applied ${options.inflation}% inflation adjustment`));
        }

        const table = new Table({
          head: [chalk.cyan('Category'), chalk.cyan('Original'), chalk.cyan('New Amount')],
          colWidths: [30, 15, 15]
        });

        for (const budget of cloned) {
          table.push([
            budget.category_name,
            formatCurrency(budget.original_amount),
            formatCurrency(budget.annual_amount)
          ]);
        }

        console.log(table.toString());
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Budget delete command
  program
    .command('budget:delete')
    .description('Delete a budget')
    .requiredOption('-c, --category <name>', 'Category name')
    .option('-y, --year <number>', 'Budget year', String(new Date().getFullYear()))
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const budget = budgetManager.getBudget(options.category, year);

        if (!budget) {
          console.error(chalk.red(`Budget not found for ${options.category} in ${year}`));
          process.exit(1);
        }

        if (!options.confirm) {
          const { confirmed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmed',
            message: `Delete budget for ${options.category} (${formatCurrency(budget.annual_amount)}) in ${year}?`,
            default: false
          }]);

          if (!confirmed) {
            console.log(chalk.yellow('Cancelled'));
            return;
          }
        }

        budgetManager.deleteBudget(options.category, year);
        console.log(chalk.green(`\n✓ Budget deleted for ${options.category} in ${year}`));
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Budget list command
  program
    .command('budget:list')
    .description('List all budgets for a year')
    .option('-y, --year <number>', 'Budget year', String(new Date().getFullYear()))
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const budgets = budgetManager.getBudgetsByYear(year);

        console.log(chalk.blue(`\n📊 Budgets for ${year}\n`));

        if (budgets.length === 0) {
          console.log(chalk.yellow('No budgets found. Use "budget:create" to create budgets.'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Category'),
            chalk.cyan('Annual'),
            chalk.cyan('Monthly'),
            chalk.cyan('Notes'),
            chalk.cyan('Last Modified')
          ],
          colWidths: [25, 15, 15, 25, 15]
        });

        let total = 0;
        for (const budget of budgets) {
          total += budget.annual_amount;
          table.push([
            budget.category_name,
            formatCurrency(budget.annual_amount),
            formatCurrency(budget.annual_amount / 12),
            (budget.notes || '-').substring(0, 22),
            new Date(budget.last_modified).toLocaleDateString()
          ]);
        }

        // Add total row
        table.push([
          chalk.bold('TOTAL'),
          chalk.bold(formatCurrency(total)),
          chalk.bold(formatCurrency(total / 12)),
          '',
          ''
        ]);

        console.log(table.toString());
        console.log(chalk.gray(`\n${budgets.length} budget(s) found`));
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Budget summary command
  program
    .command('budget:summary')
    .description('Show budget summary and statistics')
    .option('-y, --year <number>', 'Budget year', String(new Date().getFullYear()))
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const summary = budgetManager.getBudgetSummary(year);

        console.log(chalk.blue(`\n📊 Budget Summary for ${year}\n`));

        console.log(`Total Budgeted:              ${formatCurrency(summary.totalBudgeted)}`);
        console.log(`Monthly Pace:                ${formatCurrency(summary.totalBudgeted / 12)}`);
        console.log(`Categories with Budgets:     ${summary.categoriesWithBudgets}`);
        console.log(`Categories without Budgets:  ${summary.categoriesWithoutBudgets}`);
        console.log(`Average Budget per Category: ${formatCurrency(summary.averageBudget)}`);

        // Show categories without budgets
        const unbudgeted = budgetManager.getCategoriesWithoutBudgets(year);
        if (unbudgeted.length > 0) {
          console.log(chalk.yellow(`\n⚠ Categories without budgets:`));
          for (const cat of unbudgeted.slice(0, 10)) {
            console.log(`  - ${cat.name}`);
          }
          if (unbudgeted.length > 10) {
            console.log(chalk.gray(`  ... and ${unbudgeted.length - 10} more`));
          }
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Budget suggest command
  program
    .command('budget:suggest')
    .description('Get budget suggestions based on previous year spending')
    .option('-y, --year <number>', 'Target budget year', String(new Date().getFullYear()))
    .option('-i, --inflation <percent>', 'Inflation adjustment percentage', '3')
    .option('--apply', 'Apply suggested budgets')
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const inflation = parseFloat(options.inflation);
        const suggestions = budgetManager.suggestBudgets(year, inflation);

        console.log(chalk.blue(`\n📊 Budget Suggestions for ${year} (based on ${year - 1} spending + ${inflation}% inflation)\n`));

        if (suggestions.length === 0) {
          console.log(chalk.yellow('No spending data found from previous year.'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Category'),
            chalk.cyan(`${year - 1} Spent`),
            chalk.cyan('Suggested'),
            chalk.cyan('Transactions')
          ],
          colWidths: [25, 15, 15, 15]
        });

        const nonZeroSuggestions = suggestions.filter(s => s.suggested_amount > 0);

        for (const suggestion of nonZeroSuggestions) {
          table.push([
            suggestion.category_name,
            formatCurrency(suggestion.last_year_spent),
            formatCurrency(suggestion.suggested_amount),
            suggestion.transaction_count
          ]);
        }

        console.log(table.toString());
        console.log(chalk.gray(`\n${nonZeroSuggestions.length} categories with spending data`));

        if (options.apply) {
          const { confirmed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmed',
            message: `Apply these ${nonZeroSuggestions.length} suggested budgets?`,
            default: false
          }]);

          if (confirmed) {
            const toApply = nonZeroSuggestions.map(s => ({
              category_name: s.category_name,
              amount: s.suggested_amount,
              notes: `Based on ${year - 1} spending + ${inflation}% inflation`
            }));

            const result = budgetManager.createBudgetsFromSuggestions(year, toApply);
            console.log(chalk.green(`\n✓ Created ${result.created.length} budgets`));

            if (result.errors.length > 0) {
              console.log(chalk.yellow(`⚠ ${result.errors.length} skipped (already exist)`));
            }
          }
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Budget history command (shows adjustments)
  program
    .command('budget:history')
    .description('Show budget adjustment history')
    .option('-c, --category <name>', 'Category name (optional, shows all if omitted)')
    .option('-y, --year <number>', 'Budget year', String(new Date().getFullYear()))
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        let adjustments;

        if (options.category) {
          adjustments = budgetManager.getBudgetAdjustments(options.category, year);
          console.log(chalk.blue(`\n📜 Budget History for ${options.category} (${year})\n`));
        } else {
          adjustments = budgetManager.getBudgetAdjustmentsByYear(year);
          console.log(chalk.blue(`\n📜 All Budget Adjustments for ${year}\n`));
        }

        if (adjustments.length === 0) {
          console.log(chalk.gray('No adjustments found.'));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Date'),
            chalk.cyan('Category'),
            chalk.cyan('Old Amount'),
            chalk.cyan('New Amount'),
            chalk.cyan('Change'),
            chalk.cyan('Reason')
          ],
          colWidths: [12, 20, 12, 12, 12, 25]
        });

        for (const adj of adjustments) {
          const change = adj.new_amount - adj.old_amount;
          const changeStr = change >= 0 ? chalk.green(`+${formatCurrency(change)}`) : chalk.red(formatCurrency(change));

          table.push([
            new Date(adj.adjustment_date).toLocaleDateString(),
            adj.category_name || '-',
            formatCurrency(adj.old_amount),
            formatCurrency(adj.new_amount),
            changeStr,
            (adj.reason || '-').substring(0, 22)
          ]);
        }

        console.log(table.toString());
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });
}

/**
 * Interactive budget setup wizard
 * @param {number} year - Budget year
 */
async function interactiveBudgetSetup(year) {
  console.log(chalk.blue(`\n🧙 Interactive Budget Setup for ${year}\n`));

  // Get suggestions based on previous year
  const suggestions = budgetManager.suggestBudgets(year, 3);
  const categories = database.getCategories();
  const existingBudgets = budgetManager.getBudgetsByYear(year);
  const existingCategoryIds = new Set(existingBudgets.map(b => b.category_id));

  // Filter to categories without budgets
  const categoriesToSetup = categories.filter(c => !existingCategoryIds.has(c.id));

  if (categoriesToSetup.length === 0) {
    console.log(chalk.green('All categories already have budgets for this year!'));
    return;
  }

  console.log(chalk.gray(`Setting up budgets for ${categoriesToSetup.length} categories...\n`));

  const budgetsToCreate = [];

  for (const category of categoriesToSetup) {
    const suggestion = suggestions.find(s => s.category_id === category.id);
    const suggestedAmount = suggestion ? suggestion.suggested_amount : 0;
    const lastYearSpent = suggestion ? suggestion.last_year_spent : 0;

    console.log(chalk.cyan(`\n${category.name}`));
    if (lastYearSpent > 0) {
      console.log(chalk.gray(`  Last year spent: ${formatCurrency(lastYearSpent)}`));
      console.log(chalk.gray(`  Suggested (with 3% inflation): ${formatCurrency(suggestedAmount)}`));
    }

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: `Accept suggested: ${formatCurrency(suggestedAmount)}`, value: 'accept' },
        { name: 'Enter custom amount', value: 'custom' },
        { name: 'Skip this category', value: 'skip' },
        { name: 'Finish setup', value: 'finish' }
      ]
    }]);

    if (action === 'finish') {
      break;
    }

    if (action === 'skip') {
      continue;
    }

    let amount = suggestedAmount;

    if (action === 'custom') {
      const { customAmount } = await inquirer.prompt([{
        type: 'input',
        name: 'customAmount',
        message: 'Enter annual budget amount:',
        default: String(suggestedAmount),
        validate: (input) => {
          const num = parseFloat(input);
          if (isNaN(num) || num < 0) {
            return 'Please enter a valid positive number';
          }
          return true;
        }
      }]);
      amount = parseFloat(customAmount);
    }

    if (amount > 0) {
      budgetsToCreate.push({
        category_name: category.name,
        amount,
        notes: `Set via interactive setup`
      });
    }
  }

  // Create budgets
  if (budgetsToCreate.length > 0) {
    console.log(chalk.blue(`\n📝 Creating ${budgetsToCreate.length} budgets...\n`));

    const result = budgetManager.createBudgetsFromSuggestions(year, budgetsToCreate);

    console.log(chalk.green(`✓ Created ${result.created.length} budgets`));

    if (result.errors.length > 0) {
      console.log(chalk.yellow(`⚠ ${result.errors.length} errors:`));
      for (const err of result.errors) {
        console.log(chalk.red(`  - ${err.category}: ${err.error}`));
      }
    }

    // Show summary
    const total = budgetsToCreate.reduce((sum, b) => sum + b.amount, 0);
    console.log(`\nTotal budgeted: ${formatCurrency(total)}/year (${formatCurrency(total / 12)}/month)`);
  } else {
    console.log(chalk.yellow('\nNo budgets created.'));
  }
}

/**
 * Format a number as currency
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
