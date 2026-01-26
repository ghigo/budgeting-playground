/**
 * Report CLI Commands
 * Handles budget status, projections, and reporting commands
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import * as budgetCalculations from '../budgets/budgetCalculations.js';
import * as projectionEngine from '../projections/projectionEngine.js';
import * as incomeManager from '../income/incomeManager.js';

/**
 * Register report commands with the CLI program
 * @param {Command} program - Commander program instance
 */
export function registerReportCommands(program) {
  // Report status command
  program
    .command('report:status')
    .description('Show budget compliance status')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .option('--detailed', 'Show detailed breakdown')
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const compliance = budgetCalculations.calculateFullCompliance(year);

        console.log(chalk.blue(`\n📊 Budget Status Report - ${year}\n`));

        // Year progress
        const progress = compliance.yearProgress;
        const progressBar = createProgressBar(progress.percentage, 30);
        console.log(`Year Progress: ${progressBar} ${progress.percentage.toFixed(1)}%`);
        console.log(chalk.gray(`  ${progress.daysElapsed} days elapsed, ${progress.daysRemaining} days remaining\n`));

        // Overall summary
        const overall = compliance.overall;
        const overallStatus = getStatusColor(overall.status);
        console.log(chalk.bold('Overall Status:'));
        console.log(`  Budget:     ${formatCurrency(overall.total_budget)}`);
        console.log(`  Spent:      ${formatCurrency(overall.total_spent)} (${overall.used_percentage.toFixed(1)}%)`);
        console.log(`  On-Pace:    ${formatCurrency(overall.on_pace_amount)}`);
        console.log(`  Variance:   ${formatVariance(overall.variance_amount)}`);
        console.log(`  Status:     ${overallStatus(overall.status_label)}`);

        // Status counts
        console.log(chalk.bold('\nCategory Status Breakdown:'));
        console.log(`  ${chalk.green('Under Budget:')} ${compliance.statusCounts.UNDER}`);
        console.log(`  ${chalk.yellow('Warning:')} ${compliance.statusCounts.WARNING}`);
        console.log(`  ${chalk.red('Critical:')} ${compliance.statusCounts.CRITICAL}`);
        console.log(`  ${chalk.bgRed.white('Over Budget:')} ${compliance.statusCounts.OVER}`);

        // Category table
        if (options.detailed || compliance.categories.length <= 15) {
          console.log(chalk.bold('\nCategory Details:'));
          const table = new Table({
            head: [
              chalk.cyan('Category'),
              chalk.cyan('Budget'),
              chalk.cyan('Spent'),
              chalk.cyan('% Used'),
              chalk.cyan('Variance'),
              chalk.cyan('Status')
            ],
            colWidths: [20, 12, 12, 10, 12, 15]
          });

          for (const cat of compliance.categories) {
            const statusColor = getStatusColor(cat.status);
            table.push([
              cat.category_name.substring(0, 18),
              formatCurrency(cat.annual_budget),
              formatCurrency(cat.ytd_spent),
              `${cat.used_percentage.toFixed(1)}%`,
              formatVariance(cat.variance_amount),
              statusColor(cat.status_label)
            ]);
          }

          console.log(table.toString());
        } else {
          // Show only problem categories
          const problemCategories = compliance.categories.filter(c =>
            c.status !== 'UNDER'
          );

          if (problemCategories.length > 0) {
            console.log(chalk.bold('\nCategories Needing Attention:'));
            for (const cat of problemCategories) {
              const statusColor = getStatusColor(cat.status);
              console.log(`  ${statusColor('●')} ${cat.category_name}: ${cat.used_percentage.toFixed(1)}% used (${cat.status_label})`);
            }
          }

          console.log(chalk.gray(`\nUse --detailed to see all ${compliance.categories.length} categories`));
        }

        // Savings rate
        const savings = budgetCalculations.calculateSavingsRate(year);
        console.log(chalk.bold('\nSavings Summary:'));
        console.log(`  Income:      ${formatCurrency(savings.total_income)}`);
        console.log(`  Expenses:    ${formatCurrency(savings.total_expenses)}`);
        console.log(`  Net Savings: ${savings.is_positive ? chalk.green(formatCurrency(savings.net_savings)) : chalk.red(formatCurrency(savings.net_savings))}`);
        console.log(`  Savings Rate: ${savings.is_positive ? chalk.green(savings.savings_rate.toFixed(1) + '%') : chalk.red(savings.savings_rate.toFixed(1) + '%')}`);

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Report projections command
  program
    .command('report:projections')
    .description('Show year-end spending projections')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .option('--all', 'Show all categories (not just problems)')
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const projections = projectionEngine.generateAllProjections(year);

        console.log(chalk.blue(`\n🔮 Spending Projections - ${year}\n`));

        // Overall projection
        const overall = projections.overall;
        console.log(chalk.bold('Overall Projection:'));
        console.log(`  Annual Budget:     ${formatCurrency(overall.total_budget)}`);
        console.log(`  Current Spent:     ${formatCurrency(overall.current_spent)}`);
        console.log(`  Projected Year-End: ${overall.will_exceed_budget ? chalk.red(formatCurrency(overall.best_estimate)) : chalk.green(formatCurrency(overall.best_estimate))}`);
        console.log(`  Projected Variance: ${formatVariance(overall.projected_variance)} (${overall.projected_variance_percent.toFixed(1)}%)`);

        // Summary
        console.log(chalk.bold('\nSummary:'));
        console.log(`  ${chalk.green('Safe Categories:')} ${projections.summary.safe_categories}`);
        console.log(`  ${chalk.red('Danger Categories:')} ${projections.summary.danger_categories}`);

        // Category projections
        const categoriesToShow = options.all
          ? projections.categories
          : projections.categories.filter(c => c.status === 'DANGER' || c.best_estimate.projected_variance_percent > -5);

        if (categoriesToShow.length > 0) {
          console.log(chalk.bold('\nCategory Projections:'));
          const table = new Table({
            head: [
              chalk.cyan('Category'),
              chalk.cyan('Budget'),
              chalk.cyan('Spent'),
              chalk.cyan('Projected'),
              chalk.cyan('Variance'),
              chalk.cyan('Conf'),
              chalk.cyan('Status')
            ],
            colWidths: [18, 12, 12, 12, 12, 8, 10]
          });

          for (const cat of categoriesToShow) {
            const projected = cat.best_estimate.projected_year_end;
            const variance = cat.best_estimate.projected_variance;
            const confidence = cat.best_estimate.confidence?.score || cat.best_estimate.confidence || 0;
            const statusColor = cat.status === 'DANGER' ? chalk.red : chalk.green;

            table.push([
              cat.category_name.substring(0, 16),
              formatCurrency(cat.annual_budget),
              formatCurrency(cat.current_spent),
              statusColor(formatCurrency(projected)),
              formatVariance(variance),
              `${Math.round(confidence)}%`,
              statusColor(cat.status)
            ]);
          }

          console.log(table.toString());
        }

        // Warnings
        const warnings = projections.categories.filter(c => c.warning_message);
        if (warnings.length > 0) {
          console.log(chalk.bold('\nWarnings:'));
          for (const cat of warnings.slice(0, 5)) {
            const icon = cat.status === 'DANGER' ? chalk.red('⚠') : chalk.yellow('ℹ');
            console.log(`  ${icon} ${cat.warning_message}`);
          }
        }

        if (!options.all && projections.categories.length > categoriesToShow.length) {
          console.log(chalk.gray(`\nUse --all to see all ${projections.categories.length} categories`));
        }

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Report monthly command
  program
    .command('report:monthly')
    .description('Show monthly spending breakdown')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .option('-c, --category <name>', 'Filter by category')
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const breakdown = budgetCalculations.getMonthlyBreakdown(year);

        console.log(chalk.blue(`\n📅 Monthly Spending - ${year}\n`));

        // Build monthly totals table
        const table = new Table({
          head: [
            chalk.cyan('Month'),
            chalk.cyan('Spent'),
            chalk.cyan('Budget'),
            chalk.cyan('Variance'),
            chalk.cyan('Cum. Spent'),
            chalk.cyan('Cum. Budget')
          ],
          colWidths: [10, 12, 12, 12, 14, 14]
        });

        let cumulativeSpent = 0;
        let cumulativeBudget = 0;

        for (const month of breakdown.months) {
          cumulativeSpent += month.total_spent;
          cumulativeBudget += month.total_budget;

          const varianceColor = month.variance > 0 ? chalk.red : chalk.green;

          table.push([
            month.month_name,
            formatCurrency(month.total_spent),
            formatCurrency(month.total_budget),
            varianceColor(formatCurrency(month.variance)),
            formatCurrency(cumulativeSpent),
            formatCurrency(cumulativeBudget)
          ]);
        }

        console.log(table.toString());

        // If category filter, show that category's breakdown
        if (options.category) {
          console.log(chalk.bold(`\n${options.category} Monthly Breakdown:`));
          const catTable = new Table({
            head: [chalk.cyan('Month'), chalk.cyan('Spent'), chalk.cyan('Budget'), chalk.cyan('Variance')],
            colWidths: [10, 12, 12, 12]
          });

          for (const month of breakdown.months) {
            const catData = month.categories.find(c =>
              c.category_name.toLowerCase() === options.category.toLowerCase()
            );

            if (catData) {
              const varianceColor = catData.variance > 0 ? chalk.red : chalk.green;
              catTable.push([
                month.month_name,
                formatCurrency(catData.spent),
                formatCurrency(catData.budget),
                varianceColor(formatCurrency(catData.variance))
              ]);
            }
          }

          console.log(catTable.toString());
        }

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Report compare command (multi-year)
  program
    .command('report:compare')
    .description('Compare spending across multiple years')
    .option('--years <years>', 'Years to compare (comma-separated)', `${new Date().getFullYear() - 1},${new Date().getFullYear()}`)
    .action(async (options) => {
      try {
        const years = options.years.split(',').map(y => parseInt(y.trim()));
        const comparison = budgetCalculations.compareYears(years);

        console.log(chalk.blue(`\n📊 Year-over-Year Comparison: ${years.join(' vs ')}\n`));

        const table = new Table({
          head: [
            chalk.cyan('Category'),
            ...years.map(y => chalk.cyan(String(y))),
            chalk.cyan('Avg'),
            chalk.cyan('Trend')
          ],
          colWidths: [20, ...years.map(() => 12), 12, 12]
        });

        for (const cat of comparison.categories) {
          const row = [cat.category_name.substring(0, 18)];

          for (const year of years) {
            const yearData = cat.years[year];
            row.push(yearData ? formatCurrency(yearData.spent) : '-');
          }

          row.push(formatCurrency(cat.average_spent));

          const trendIcon = cat.trend === 'increasing'
            ? chalk.red('↑')
            : cat.trend === 'decreasing'
              ? chalk.green('↓')
              : chalk.gray('→');
          row.push(trendIcon + ' ' + cat.trend);

          table.push(row);
        }

        console.log(table.toString());

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Report export command
  program
    .command('report:export')
    .description('Export report data to CSV')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .option('-f, --format <format>', 'Format (csv, json)', 'csv')
    .option('-o, --output <file>', 'Output file path')
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const compliance = budgetCalculations.calculateFullCompliance(year);

        let output;
        let filename;

        if (options.format === 'json') {
          output = JSON.stringify(compliance, null, 2);
          filename = options.output || `budget-report-${year}.json`;
        } else {
          // CSV format
          const headers = ['Category', 'Annual Budget', 'YTD Spent', 'Used %', 'On-Pace Amount', 'Variance', 'Status'];
          const rows = compliance.categories.map(c => [
            c.category_name,
            c.annual_budget,
            c.ytd_spent,
            c.used_percentage.toFixed(2),
            c.on_pace_amount.toFixed(2),
            c.variance_amount.toFixed(2),
            c.status_label
          ]);

          output = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
          filename = options.output || `budget-report-${year}.csv`;
        }

        // Write to file
        const fs = await import('fs');
        fs.writeFileSync(filename, output);

        console.log(chalk.green(`\n✓ Report exported to ${filename}`));

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Scenario test command
  program
    .command('scenario:test')
    .description('Test what-if budget scenarios')
    .requiredOption('-c, --category <name>', 'Category to adjust')
    .option('-r, --reduce <percent>', 'Reduce spending by percentage')
    .option('-i, --increase <percent>', 'Increase spending by percentage')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .action(async (options) => {
      try {
        if (!options.reduce && !options.increase) {
          console.error(chalk.red('Error: Specify either --reduce or --increase'));
          process.exit(1);
        }

        const year = parseInt(options.year);
        const adjustmentPercent = options.reduce
          ? parseFloat(options.reduce)
          : -parseFloat(options.increase);

        const scenario = projectionEngine.calculateScenario(year, options.category, adjustmentPercent);

        console.log(chalk.blue(`\n🔮 Scenario Analysis: ${options.category}\n`));

        // Current state
        console.log(chalk.bold('Current State:'));
        console.log(`  YTD Spent:      ${formatCurrency(scenario.current.ytd_spent)}`);
        console.log(`  Projected:      ${formatCurrency(scenario.current.projected_year_end)}`);
        console.log(`  Budget:         ${formatCurrency(scenario.current.budget)}`);
        console.log(`  Variance:       ${formatVariance(scenario.current.variance)}`);

        // Adjusted state
        const adjustDirection = adjustmentPercent > 0 ? 'Reduced' : 'Increased';
        console.log(chalk.bold(`\n${adjustDirection} by ${Math.abs(adjustmentPercent)}%:`));
        console.log(`  Projected:      ${formatCurrency(scenario.adjusted.projected_year_end)}`);
        console.log(`  Variance:       ${formatVariance(scenario.adjusted.variance)}`);
        console.log(`  Under Budget:   ${scenario.adjusted.will_be_under_budget ? chalk.green('Yes') : chalk.red('No')}`);

        // Impact
        console.log(chalk.bold('\nImpact:'));
        console.log(`  Monthly Change: ${formatCurrency(scenario.impact.monthly_reduction)}/month`);
        console.log(`  This Year:      ${formatCurrency(scenario.impact.projected_savings)}`);
        console.log(`  Annualized:     ${formatCurrency(scenario.impact.annualized_savings)}/year`);

        console.log(chalk.cyan(`\n${scenario.message}`));

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Recurring expenses command
  program
    .command('report:recurring')
    .description('Analyze recurring expenses')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .action(async (options) => {
      try {
        const year = parseInt(options.year);
        const analysis = projectionEngine.detectRecurringExpenses(year);

        console.log(chalk.blue(`\n🔄 Recurring Expenses Analysis - ${year}\n`));

        // Summary
        console.log(chalk.bold('Summary:'));
        console.log(`  Fixed Costs:     ${formatCurrency(analysis.recurring.estimated_monthly)}/month (${formatCurrency(analysis.recurring.estimated_annual)}/year)`);
        console.log(`  Variable Costs:  ${formatCurrency(analysis.variable.ytd_spent)} YTD`);
        console.log(`  Fixed %:         ${analysis.summary.fixed_percentage.toFixed(1)}%`);

        // Recurring items
        if (analysis.recurring.items.length > 0) {
          console.log(chalk.bold('\nRecurring (Fixed) Expenses:'));
          const table = new Table({
            head: [
              chalk.cyan('Merchant'),
              chalk.cyan('Frequency'),
              chalk.cyan('Avg Amount'),
              chalk.cyan('Est. Annual'),
              chalk.cyan('Category')
            ],
            colWidths: [25, 12, 12, 12, 15]
          });

          for (const item of analysis.recurring.items.slice(0, 15)) {
            table.push([
              item.merchant.substring(0, 23),
              item.frequency,
              formatCurrency(item.average_amount),
              formatCurrency(item.estimated_annual),
              (item.category || '-').substring(0, 13)
            ]);
          }

          console.log(table.toString());
        }

        // Top variable expenses
        if (analysis.variable.items.length > 0) {
          console.log(chalk.bold('\nTop Variable Expenses:'));
          const table = new Table({
            head: [
              chalk.cyan('Merchant'),
              chalk.cyan('Transactions'),
              chalk.cyan('Total'),
              chalk.cyan('Category')
            ],
            colWidths: [25, 15, 12, 15]
          });

          for (const item of analysis.variable.items.slice(0, 10)) {
            table.push([
              item.merchant.substring(0, 23),
              item.transaction_count,
              formatCurrency(item.total_spent),
              (item.category || '-').substring(0, 13)
            ]);
          }

          console.log(table.toString());
        }

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Zero-based budgeting command
  program
    .command('budget:zero-based')
    .description('Zero-based budgeting helper')
    .requiredOption('-i, --income <amount>', 'Expected annual income')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .option('--apply', 'Apply suggested budgets')
    .action(async (options) => {
      try {
        const income = parseFloat(options.income);
        const year = parseInt(options.year);

        const helper = projectionEngine.zeroBudgetHelper(income, year);

        console.log(chalk.blue(`\n💰 Zero-Based Budget Helper - ${year}\n`));
        console.log(`Expected Income: ${formatCurrency(income)}\n`);

        // Priority breakdown
        for (const [priority, items] of Object.entries(helper.by_priority)) {
          if (items.length === 0) continue;

          const total = helper.priority_totals[priority];
          console.log(chalk.bold(`${priority} (${total.percent.toFixed(1)}% - ${formatCurrency(total.total)}):`));

          for (const item of items) {
            const sourceIcon = item.source === 'guideline' ? '📋' : '📊';
            console.log(`  ${sourceIcon} ${item.category_name}: ${formatCurrency(item.suggested_amount)} (${item.suggested_percent.toFixed(1)}%)`);
          }
          console.log();
        }

        // Summary
        const allocatedColor = helper.balanced ? chalk.green : chalk.yellow;
        console.log(chalk.bold('Summary:'));
        console.log(`  Allocated:   ${allocatedColor(formatCurrency(helper.total_allocated))} (${helper.total_allocated_percent.toFixed(1)}%)`);
        console.log(`  Unallocated: ${formatCurrency(helper.unallocated)} (${helper.unallocated_percent.toFixed(1)}%)`);
        console.log(chalk.cyan(`\n${helper.recommendation}`));

        // Apply option
        if (options.apply) {
          const { confirmed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmed',
            message: 'Apply these suggested budgets?',
            default: false
          }]);

          if (confirmed) {
            const budgetManager = await import('../budgets/budgetManager.js');
            const toApply = helper.suggestions.map(s => ({
              category_name: s.category_name,
              amount: s.suggested_amount,
              notes: `Zero-based budget from ${formatCurrency(income)} income`
            }));

            const result = budgetManager.createBudgetsFromSuggestions(year, toApply);
            console.log(chalk.green(`\n✓ Created ${result.created.length} budgets`));
          }
        }

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });
}

// Helper functions

function formatCurrency(amount) {
  return `$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatVariance(amount) {
  const formatted = formatCurrency(Math.abs(amount));
  return amount >= 0 ? chalk.red(`+${formatted}`) : chalk.green(`-${formatted}`);
}

function getStatusColor(status) {
  switch (status) {
    case 'UNDER': return chalk.green;
    case 'WARNING': return chalk.yellow;
    case 'CRITICAL': return chalk.red;
    case 'OVER': return chalk.bgRed.white;
    default: return chalk.white;
  }
}

function createProgressBar(percentage, width) {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}
