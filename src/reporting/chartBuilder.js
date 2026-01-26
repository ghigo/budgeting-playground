/**
 * Chart Builder Module
 * Creates charts in Google Sheets for budget visualization
 */

import { google } from 'googleapis';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as budgetCalculations from '../budgets/budgetCalculations.js';
import * as projectionEngine from '../projections/projectionEngine.js';
import * as incomeManager from '../income/incomeManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let sheets = null;
let spreadsheetId = null;

// Chart colors
const CHART_COLORS = {
  BUDGET: { red: 0.26, green: 0.52, blue: 0.96 },      // Blue
  ACTUAL_UNDER: { red: 0.2, green: 0.66, blue: 0.33 }, // Green
  ACTUAL_OVER: { red: 0.92, green: 0.27, blue: 0.21 }, // Red
  PROJECTED: { red: 1, green: 0.76, blue: 0.03 },       // Yellow
  INCOME: { red: 0.2, green: 0.66, blue: 0.33 },       // Green
  EXPENSES: { red: 0.92, green: 0.27, blue: 0.21 }     // Red
};

/**
 * Initialize Sheets API for chart building
 */
export async function initializeChartBuilder() {
  try {
    const credentialsPath = join(__dirname, '../../credentials/google-credentials.json');
    const configPath = join(__dirname, '../../config.json');

    if (!fs.existsSync(credentialsPath)) {
      throw new Error('Google credentials file not found');
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

    // Get sheet ID
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const environment = (process.env.MODE || 'sandbox').toLowerCase();
      const isProduction = environment === 'production';

      if (config.google_sheets) {
        if (isProduction && config.google_sheets.production) {
          spreadsheetId = config.google_sheets.production.sheet_id;
        } else if (config.google_sheets.sandbox) {
          spreadsheetId = config.google_sheets.sandbox.sheet_id;
        }
      } else if (config.google_sheet_id) {
        spreadsheetId = config.google_sheet_id;
      }
    }

    if (!spreadsheetId) {
      throw new Error('Google Sheet ID not configured');
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    sheets = google.sheets({ version: 'v4', auth: authClient });

    return true;
  } catch (error) {
    console.error('Failed to initialize chart builder:', error.message);
    throw error;
  }
}

/**
 * Get sheet ID by name
 */
async function getSheetId(sheetName) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
  return sheet ? sheet.properties.sheetId : null;
}

/**
 * Delete all charts from a sheet
 */
async function clearChartsFromSheet(sheetId) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = spreadsheet.data.sheets.find(s => s.properties.sheetId === sheetId);

  if (sheet && sheet.charts && sheet.charts.length > 0) {
    const requests = sheet.charts.map(chart => ({
      deleteEmbeddedObject: { objectId: chart.chartId }
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests }
    });
  }
}

/**
 * Create a Budget vs Actual bar chart
 */
export async function createBudgetVsActualChart(year, targetSheetName = 'Budget_Dashboard') {
  const sheetId = await getSheetId(targetSheetName);
  if (!sheetId) {
    throw new Error(`Sheet ${targetSheetName} not found`);
  }

  const compliance = budgetCalculations.calculateFullCompliance(year);

  // Prepare data for chart
  const chartData = [['Category', 'Budget', 'Actual']];
  for (const cat of compliance.categories.slice(0, 10)) { // Top 10 categories
    chartData.push([
      cat.category_name,
      cat.annual_budget,
      cat.ytd_spent
    ]);
  }

  // Write chart data to a temporary range
  const dataRange = `${targetSheetName}!M1:O${chartData.length}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: dataRange,
    valueInputOption: 'USER_ENTERED',
    resource: { values: chartData }
  });

  // Create chart request
  const chartRequest = {
    addChart: {
      chart: {
        spec: {
          title: `Budget vs Actual - ${year}`,
          basicChart: {
            chartType: 'COLUMN',
            legendPosition: 'BOTTOM_LEGEND',
            axis: [
              { position: 'BOTTOM_AXIS', title: 'Category' },
              { position: 'LEFT_AXIS', title: 'Amount ($)' }
            ],
            domains: [{
              domain: {
                sourceRange: {
                  sources: [{
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: chartData.length,
                    startColumnIndex: 12, // Column M
                    endColumnIndex: 13
                  }]
                }
              }
            }],
            series: [
              {
                series: {
                  sourceRange: {
                    sources: [{
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: chartData.length,
                      startColumnIndex: 13, // Column N (Budget)
                      endColumnIndex: 14
                    }]
                  }
                },
                targetAxis: 'LEFT_AXIS',
                color: CHART_COLORS.BUDGET
              },
              {
                series: {
                  sourceRange: {
                    sources: [{
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: chartData.length,
                      startColumnIndex: 14, // Column O (Actual)
                      endColumnIndex: 15
                    }]
                  }
                },
                targetAxis: 'LEFT_AXIS',
                color: CHART_COLORS.ACTUAL_UNDER
              }
            ],
            headerCount: 1
          }
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId, rowIndex: 15, columnIndex: 0 },
            widthPixels: 600,
            heightPixels: 400
          }
        }
      }
    }
  };

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: [chartRequest] }
  });

  return { chart: 'Budget vs Actual', location: targetSheetName };
}

/**
 * Create a cumulative spending line chart
 */
export async function createCumulativeChart(year, targetSheetName = 'Monthly_Tracking') {
  const sheetId = await getSheetId(targetSheetName);
  if (!sheetId) {
    throw new Error(`Sheet ${targetSheetName} not found`);
  }

  const cumulative = budgetCalculations.getCumulativeComparison(year);

  // Prepare data
  const chartData = [['Month', 'Budget Pace', 'Actual Spending', 'Projected']];
  const projections = projectionEngine.generateAllProjections(year);

  for (const month of cumulative.data) {
    const projectedCumulative = month.month <= new Date().getMonth() + 1
      ? month.cumulative_spent
      : month.cumulative_spent + (projections.overall.best_estimate - projections.overall.current_spent) * (month.month / 12);

    chartData.push([
      month.month_name,
      month.cumulative_budget,
      month.cumulative_spent,
      projectedCumulative
    ]);
  }

  // Write data
  const dataRange = `${targetSheetName}!T1:W${chartData.length}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: dataRange,
    valueInputOption: 'USER_ENTERED',
    resource: { values: chartData }
  });

  // Create line chart
  const chartRequest = {
    addChart: {
      chart: {
        spec: {
          title: `Cumulative Spending - ${year}`,
          basicChart: {
            chartType: 'LINE',
            legendPosition: 'BOTTOM_LEGEND',
            axis: [
              { position: 'BOTTOM_AXIS', title: 'Month' },
              { position: 'LEFT_AXIS', title: 'Cumulative Amount ($)' }
            ],
            domains: [{
              domain: {
                sourceRange: {
                  sources: [{
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: chartData.length,
                    startColumnIndex: 19, // Column T
                    endColumnIndex: 20
                  }]
                }
              }
            }],
            series: [
              {
                series: {
                  sourceRange: {
                    sources: [{
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: chartData.length,
                      startColumnIndex: 20, // Budget Pace
                      endColumnIndex: 21
                    }]
                  }
                },
                targetAxis: 'LEFT_AXIS',
                color: CHART_COLORS.BUDGET
              },
              {
                series: {
                  sourceRange: {
                    sources: [{
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: chartData.length,
                      startColumnIndex: 21, // Actual
                      endColumnIndex: 22
                    }]
                  }
                },
                targetAxis: 'LEFT_AXIS',
                color: CHART_COLORS.ACTUAL_UNDER
              },
              {
                series: {
                  sourceRange: {
                    sources: [{
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: chartData.length,
                      startColumnIndex: 22, // Projected
                      endColumnIndex: 23
                    }]
                  }
                },
                targetAxis: 'LEFT_AXIS',
                color: CHART_COLORS.PROJECTED,
                lineStyle: { type: 'MEDIUM_DASHED' }
              }
            ],
            headerCount: 1
          }
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId, rowIndex: 20, columnIndex: 0 },
            widthPixels: 700,
            heightPixels: 400
          }
        }
      }
    }
  };

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: [chartRequest] }
  });

  return { chart: 'Cumulative Spending', location: targetSheetName };
}

/**
 * Create a category breakdown pie chart
 */
export async function createCategoryPieChart(year, targetSheetName = 'Budget_Dashboard') {
  const sheetId = await getSheetId(targetSheetName);
  if (!sheetId) {
    throw new Error(`Sheet ${targetSheetName} not found`);
  }

  const compliance = budgetCalculations.calculateFullCompliance(year);

  // Prepare data - top 8 categories by spending
  const sortedCategories = [...compliance.categories]
    .sort((a, b) => b.ytd_spent - a.ytd_spent)
    .slice(0, 8);

  const chartData = [['Category', 'Spending']];
  for (const cat of sortedCategories) {
    chartData.push([cat.category_name, cat.ytd_spent]);
  }

  // Write data
  const dataRange = `${targetSheetName}!R1:S${chartData.length}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: dataRange,
    valueInputOption: 'USER_ENTERED',
    resource: { values: chartData }
  });

  // Create pie chart
  const chartRequest = {
    addChart: {
      chart: {
        spec: {
          title: `Spending by Category - ${year}`,
          pieChart: {
            legendPosition: 'RIGHT_LEGEND',
            domain: {
              sourceRange: {
                sources: [{
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: chartData.length,
                  startColumnIndex: 17, // Column R
                  endColumnIndex: 18
                }]
              }
            },
            series: {
              sourceRange: {
                sources: [{
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: chartData.length,
                  startColumnIndex: 18, // Column S
                  endColumnIndex: 19
                }]
              }
            }
          }
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId, rowIndex: 15, columnIndex: 7 },
            widthPixels: 450,
            heightPixels: 350
          }
        }
      }
    }
  };

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: [chartRequest] }
  });

  return { chart: 'Category Breakdown', location: targetSheetName };
}

/**
 * Create an income vs expenses chart
 */
export async function createIncomeExpensesChart(year, targetSheetName = 'Income_Tracking') {
  const sheetId = await getSheetId(targetSheetName);
  if (!sheetId) {
    throw new Error(`Sheet ${targetSheetName} not found`);
  }

  const monthlyIncome = incomeManager.getMonthlyIncome(year);
  const monthlyBreakdown = budgetCalculations.getMonthlyBreakdown(year);

  // Prepare data
  const chartData = [['Month', 'Income', 'Expenses', 'Net']];
  for (let i = 0; i < 12; i++) {
    const income = monthlyIncome[i].total;
    const expenses = monthlyBreakdown.months[i].total_spent;
    const net = income - expenses;

    chartData.push([
      monthlyIncome[i].monthName,
      income,
      expenses,
      net
    ]);
  }

  // Write data
  const dataRange = `${targetSheetName}!H1:K${chartData.length}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: dataRange,
    valueInputOption: 'USER_ENTERED',
    resource: { values: chartData }
  });

  // Create combo chart (bars for income/expenses, line for net)
  const chartRequest = {
    addChart: {
      chart: {
        spec: {
          title: `Income vs Expenses - ${year}`,
          basicChart: {
            chartType: 'COMBO',
            legendPosition: 'BOTTOM_LEGEND',
            axis: [
              { position: 'BOTTOM_AXIS', title: 'Month' },
              { position: 'LEFT_AXIS', title: 'Amount ($)' }
            ],
            domains: [{
              domain: {
                sourceRange: {
                  sources: [{
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: chartData.length,
                    startColumnIndex: 7, // Column H
                    endColumnIndex: 8
                  }]
                }
              }
            }],
            series: [
              {
                series: {
                  sourceRange: {
                    sources: [{
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: chartData.length,
                      startColumnIndex: 8, // Income
                      endColumnIndex: 9
                    }]
                  }
                },
                targetAxis: 'LEFT_AXIS',
                type: 'COLUMN',
                color: CHART_COLORS.INCOME
              },
              {
                series: {
                  sourceRange: {
                    sources: [{
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: chartData.length,
                      startColumnIndex: 9, // Expenses
                      endColumnIndex: 10
                    }]
                  }
                },
                targetAxis: 'LEFT_AXIS',
                type: 'COLUMN',
                color: CHART_COLORS.EXPENSES
              },
              {
                series: {
                  sourceRange: {
                    sources: [{
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: chartData.length,
                      startColumnIndex: 10, // Net
                      endColumnIndex: 11
                    }]
                  }
                },
                targetAxis: 'LEFT_AXIS',
                type: 'LINE',
                color: CHART_COLORS.BUDGET
              }
            ],
            headerCount: 1
          }
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId, rowIndex: 15, columnIndex: 0 },
            widthPixels: 650,
            heightPixels: 400
          }
        }
      }
    }
  };

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: [chartRequest] }
  });

  return { chart: 'Income vs Expenses', location: targetSheetName };
}

/**
 * Create a burn rate trend chart
 */
export async function createBurnRateChart(year, targetSheetName = 'Projections') {
  const sheetId = await getSheetId(targetSheetName);
  if (!sheetId) {
    throw new Error(`Sheet ${targetSheetName} not found`);
  }

  const monthlyBreakdown = budgetCalculations.getMonthlyBreakdown(year);

  // Calculate daily burn rate per month
  const chartData = [['Month', 'Daily Burn Rate']];
  for (const month of monthlyBreakdown.months) {
    const daysInMonth = new Date(year, month.month, 0).getDate();
    const dailyRate = month.total_spent / daysInMonth;
    chartData.push([month.month_name, dailyRate]);
  }

  // Write data
  const dataRange = `${targetSheetName}!J1:K${chartData.length}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: dataRange,
    valueInputOption: 'USER_ENTERED',
    resource: { values: chartData }
  });

  // Create line chart
  const chartRequest = {
    addChart: {
      chart: {
        spec: {
          title: `Daily Burn Rate Trend - ${year}`,
          basicChart: {
            chartType: 'LINE',
            legendPosition: 'NONE',
            axis: [
              { position: 'BOTTOM_AXIS', title: 'Month' },
              { position: 'LEFT_AXIS', title: 'Daily Spending ($)' }
            ],
            domains: [{
              domain: {
                sourceRange: {
                  sources: [{
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: chartData.length,
                    startColumnIndex: 9, // Column J
                    endColumnIndex: 10
                  }]
                }
              }
            }],
            series: [{
              series: {
                sourceRange: {
                  sources: [{
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: chartData.length,
                    startColumnIndex: 10, // Column K
                    endColumnIndex: 11
                  }]
                }
              },
              targetAxis: 'LEFT_AXIS',
              color: CHART_COLORS.ACTUAL_UNDER
            }],
            headerCount: 1
          }
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId, rowIndex: 20, columnIndex: 0 },
            widthPixels: 600,
            heightPixels: 350
          }
        }
      }
    }
  };

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: [chartRequest] }
  });

  return { chart: 'Burn Rate Trend', location: targetSheetName };
}

/**
 * Generate all charts for the dashboard
 */
export async function generateAllCharts(year) {
  console.log(`Generating charts for ${year}...`);

  const results = [];

  try {
    console.log('  Creating Budget vs Actual chart...');
    results.push(await createBudgetVsActualChart(year));
  } catch (error) {
    console.error('  Failed to create Budget vs Actual chart:', error.message);
  }

  try {
    console.log('  Creating Cumulative Spending chart...');
    results.push(await createCumulativeChart(year));
  } catch (error) {
    console.error('  Failed to create Cumulative chart:', error.message);
  }

  try {
    console.log('  Creating Category Pie chart...');
    results.push(await createCategoryPieChart(year));
  } catch (error) {
    console.error('  Failed to create Pie chart:', error.message);
  }

  try {
    console.log('  Creating Income vs Expenses chart...');
    results.push(await createIncomeExpensesChart(year));
  } catch (error) {
    console.error('  Failed to create Income/Expenses chart:', error.message);
  }

  try {
    console.log('  Creating Burn Rate chart...');
    results.push(await createBurnRateChart(year));
  } catch (error) {
    console.error('  Failed to create Burn Rate chart:', error.message);
  }

  console.log(`Chart generation complete! Created ${results.length} charts.`);
  return results;
}
