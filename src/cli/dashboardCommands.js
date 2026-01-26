/**
 * Dashboard CLI Commands
 * Handles Google Sheets dashboard generation and chart commands
 */

import chalk from 'chalk';
import * as dashboardGenerator from '../reporting/dashboardGenerator.js';
import * as chartBuilder from '../reporting/chartBuilder.js';

/**
 * Register dashboard commands with the CLI program
 * @param {Command} program - Commander program instance
 */
export function registerDashboardCommands(program) {
  // Dashboard refresh command
  program
    .command('dashboard:refresh')
    .description('Refresh all budget dashboard sheets in Google Sheets')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .action(async (options) => {
      try {
        const year = parseInt(options.year);

        console.log(chalk.blue(`\n📊 Refreshing Budget Dashboard for ${year}\n`));

        // Initialize dashboard connection
        await dashboardGenerator.initializeDashboard();

        // Generate all sheets
        const results = await dashboardGenerator.generateFullDashboard(year);

        console.log(chalk.green('\n✓ Dashboard refresh complete!'));
        console.log('\nSheets updated:');
        for (const [name, result] of Object.entries(results)) {
          console.log(`  - ${result.sheet}: ${result.rows} rows`);
        }

        console.log(chalk.cyan(`\n📎 View at: ${dashboardGenerator.getSpreadsheetUrl()}`));

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Dashboard charts command
  program
    .command('dashboard:charts')
    .description('Generate or regenerate all charts in Google Sheets')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .action(async (options) => {
      try {
        const year = parseInt(options.year);

        console.log(chalk.blue(`\n📈 Generating Charts for ${year}\n`));

        // Initialize chart builder
        await chartBuilder.initializeChartBuilder();

        // Generate all charts
        const results = await chartBuilder.generateAllCharts(year);

        console.log(chalk.green('\n✓ Chart generation complete!'));
        console.log('\nCharts created:');
        for (const result of results) {
          console.log(`  - ${result.chart} in ${result.location}`);
        }

        console.log(chalk.cyan(`\n📎 View at: ${dashboardGenerator.getSpreadsheetUrl()}`));

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Dashboard full update (sheets + charts)
  program
    .command('dashboard:update')
    .description('Full dashboard update: refresh sheets and regenerate charts')
    .option('-y, --year <number>', 'Year', String(new Date().getFullYear()))
    .action(async (options) => {
      try {
        const year = parseInt(options.year);

        console.log(chalk.blue(`\n🔄 Full Dashboard Update for ${year}\n`));

        // Initialize
        await dashboardGenerator.initializeDashboard();
        await chartBuilder.initializeChartBuilder();

        // Generate sheets
        console.log(chalk.bold('Step 1: Refreshing sheets...'));
        const sheetResults = await dashboardGenerator.generateFullDashboard(year);

        // Generate charts
        console.log(chalk.bold('\nStep 2: Generating charts...'));
        const chartResults = await chartBuilder.generateAllCharts(year);

        console.log(chalk.green('\n✓ Full dashboard update complete!'));
        console.log(`\n  Sheets updated: ${Object.keys(sheetResults).length}`);
        console.log(`  Charts created: ${chartResults.length}`);

        console.log(chalk.cyan(`\n📎 View at: ${dashboardGenerator.getSpreadsheetUrl()}`));

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Dashboard open command
  program
    .command('dashboard:open')
    .description('Open the budget dashboard in your browser')
    .action(async () => {
      try {
        await dashboardGenerator.initializeDashboard();
        const url = dashboardGenerator.getSpreadsheetUrl();

        console.log(chalk.blue('\n📊 Budget Dashboard\n'));
        console.log(chalk.cyan(url));

        // Try to open in browser
        const { exec } = await import('child_process');
        const command = process.platform === 'darwin' ? 'open' :
                       process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${command} "${url}"`);

        console.log(chalk.gray('\nOpening in browser...'));

      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });
}
