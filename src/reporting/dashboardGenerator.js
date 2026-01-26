/**
 * Dashboard Generator Module
 * Creates and updates budget dashboard in Google Sheets
 */

import { google } from 'googleapis';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as budgetManager from '../budgets/budgetManager.js';
import * as budgetCalculations from '../budgets/budgetCalculations.js';
import * as projectionEngine from '../projections/projectionEngine.js';
import * as incomeManager from '../income/incomeManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let sheets = null;
let spreadsheetId = null;

// Budget dashboard sheet names
const BUDGET_SHEETS = {
  BUDGET_SETUP: 'Budget_Setup',
  BUDGET_DASHBOARD: 'Budget_Dashboard',
  MONTHLY_TRACKING: 'Monthly_Tracking',
  PROJECTIONS: 'Projections',
  INCOME_TRACKING: 'Income_Tracking',
  HISTORICAL: 'Historical_Comparison'
};

// Color palette
const COLORS = {
  HEADER_BG: { red: 0.2, green: 0.4, blue: 0.6 },
  HEADER_FG: { red: 1, green: 1, blue: 1 },
  UNDER_BUDGET: { red: 0.2, green: 0.7, blue: 0.3 },
  WARNING: { red: 1, green: 0.8, blue: 0.2 },
  CRITICAL: { red: 1, green: 0.4, blue: 0.2 },
  OVER_BUDGET: { red: 0.8, green: 0.2, blue: 0.2 },
  TOTAL_ROW: { red: 0.9, green: 0.9, blue: 0.9 },
  POSITIVE: { red: 0.2, green: 0.6, blue: 0.2 },
  NEGATIVE: { red: 0.8, green: 0.2, blue: 0.2 }
};

/**
 * Initialize Google Sheets API for dashboard
 */
export async function initializeDashboard() {
  try {
    const credentialsPath = join(__dirname, '../../credentials/google-credentials.json');
    const configPath = join(__dirname, '../../config.json');

    if (!fs.existsSync(credentialsPath)) {
      throw new Error('Google credentials file not found');
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

    // Get sheet ID from config
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

    // Authenticate
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    sheets = google.sheets({ version: 'v4', auth: authClient });

    return true;
  } catch (error) {
    console.error('Failed to initialize dashboard:', error.message);
    throw error;
  }
}

/**
 * Ensure all budget sheets exist
 */
async function ensureBudgetSheets() {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

  const requests = [];
  for (const sheetName of Object.values(BUDGET_SHEETS)) {
    if (!existingSheets.includes(sheetName)) {
      requests.push({
        addSheet: {
          properties: {
            title: sheetName
          }
        }
      });
    }
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests }
    });
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
 * Create conditional formatting rules for status column
 */
function createStatusFormatting(sheetId, statusColumnIndex, startRow, endRow) {
  const rules = [
    // Under Budget - Green
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: statusColumnIndex, endColumnIndex: statusColumnIndex + 1 }],
          booleanRule: {
            condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Under' }] },
            format: { backgroundColor: COLORS.UNDER_BUDGET, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 } } }
          }
        },
        index: 0
      }
    },
    // Warning - Yellow
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: statusColumnIndex, endColumnIndex: statusColumnIndex + 1 }],
          booleanRule: {
            condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Warning' }] },
            format: { backgroundColor: COLORS.WARNING }
          }
        },
        index: 1
      }
    },
    // Critical - Orange
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: statusColumnIndex, endColumnIndex: statusColumnIndex + 1 }],
          booleanRule: {
            condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Critical' }] },
            format: { backgroundColor: COLORS.CRITICAL, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 } } }
          }
        },
        index: 2
      }
    },
    // Over Budget - Red
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: statusColumnIndex, endColumnIndex: statusColumnIndex + 1 }],
          booleanRule: {
            condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Over' }] },
            format: { backgroundColor: COLORS.OVER_BUDGET, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 } } }
          }
        },
        index: 3
      }
    }
  ];

  return rules;
}

/**
 * Format header row
 */
function createHeaderFormatting(sheetId, columnCount) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLORS.HEADER_BG,
          textFormat: { bold: true, foregroundColor: COLORS.HEADER_FG },
          horizontalAlignment: 'CENTER'
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
    }
  };
}

/**
 * Generate Budget_Setup sheet
 */
export async function generateBudgetSetupSheet(year) {
  const budgets = budgetManager.getBudgetsByYear(year);
  const sheetId = await getSheetId(BUDGET_SHEETS.BUDGET_SETUP);

  // Headers
  const headers = [['Category', 'Annual Budget', 'Monthly Pace', 'Notes', 'Last Modified']];

  // Data rows
  const rows = budgets.map(b => [
    b.category_name,
    b.annual_amount,
    b.annual_amount / 12,
    b.notes || '',
    new Date(b.last_modified).toLocaleDateString()
  ]);

  // Total row
  const total = budgets.reduce((sum, b) => sum + b.annual_amount, 0);
  rows.push(['TOTAL', total, total / 12, '', '']);

  // Write data
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${BUDGET_SHEETS.BUDGET_SETUP}!A1:E${rows.length + 1}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [...headers, ...rows] }
  });

  // Format
  const requests = [
    createHeaderFormatting(sheetId, 5),
    // Currency format for budget columns
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: rows.length + 1, startColumnIndex: 1, endColumnIndex: 3 },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Bold total row
    {
      repeatCell: {
        range: { sheetId, startRowIndex: rows.length, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.TOTAL_ROW,
            textFormat: { bold: true }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    }
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests }
  });

  return { sheet: BUDGET_SHEETS.BUDGET_SETUP, rows: rows.length };
}

/**
 * Generate Budget_Dashboard sheet
 */
export async function generateBudgetDashboard(year) {
  const compliance = budgetCalculations.calculateFullCompliance(year);
  const savings = budgetCalculations.calculateSavingsRate(year);
  const sheetId = await getSheetId(BUDGET_SHEETS.BUDGET_DASHBOARD);

  // Clear existing data
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${BUDGET_SHEETS.BUDGET_DASHBOARD}!A1:Z1000`
  });

  // Summary section
  const summaryData = [
    [`Budget Dashboard - ${year}`, '', '', '', '', '', '', '', '', ''],
    [''],
    ['Year Progress:', `${compliance.yearProgress.percentage.toFixed(1)}%`, '', 'Days Elapsed:', compliance.yearProgress.daysElapsed, '', 'Days Remaining:', compliance.yearProgress.daysRemaining, '', ''],
    [''],
    ['OVERALL SUMMARY', '', '', '', '', '', '', '', '', ''],
    ['Total Budget:', compliance.overall.total_budget, '', 'Total Spent:', compliance.overall.total_spent, '', 'Status:', compliance.overall.status_label, '', ''],
    ['On-Pace Amount:', compliance.overall.on_pace_amount, '', 'Variance:', compliance.overall.variance_amount, '', '', '', '', ''],
    [''],
    ['SAVINGS', '', '', '', '', '', '', '', '', ''],
    ['Total Income:', savings.total_income, '', 'Net Savings:', savings.net_savings, '', 'Savings Rate:', `${savings.savings_rate.toFixed(1)}%`, '', ''],
    [''],
    ['CATEGORY DETAILS', '', '', '', '', '', '', '', '', '']
  ];

  // Headers for category table
  const categoryHeaders = ['Category', 'Annual Budget', 'YTD Spent', '% Used', '% Year', 'On-Pace', 'Variance', 'Status', 'Days to Exhaust', 'Daily Rate'];

  // Category rows
  const categoryRows = compliance.categories.map(c => [
    c.category_name,
    c.annual_budget,
    c.ytd_spent,
    c.used_percentage / 100,
    c.year_elapsed_percentage / 100,
    c.on_pace_amount,
    c.variance_amount,
    c.status_label,
    c.days_to_exhaustion === Infinity ? 'N/A' : Math.round(c.days_to_exhaustion),
    c.daily_burn_rate
  ]);

  // Total row
  categoryRows.push([
    'TOTAL',
    compliance.overall.total_budget,
    compliance.overall.total_spent,
    compliance.overall.used_percentage / 100,
    compliance.yearProgress.percentage / 100,
    compliance.overall.on_pace_amount,
    compliance.overall.variance_amount,
    compliance.overall.status_label,
    '',
    ''
  ]);

  // Combine all data
  const allData = [...summaryData, categoryHeaders, ...categoryRows];

  // Write data
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${BUDGET_SHEETS.BUDGET_DASHBOARD}!A1:J${allData.length}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: allData }
  });

  // Formatting requests
  const categoryTableStart = summaryData.length;
  const requests = [
    // Title formatting
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 14 },
            horizontalAlignment: 'LEFT'
          }
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)'
      }
    },
    // Category headers formatting
    createHeaderFormatting(sheetId, 10),
    {
      repeatCell: {
        range: { sheetId, startRowIndex: categoryTableStart, endRowIndex: categoryTableStart + 1, startColumnIndex: 0, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.HEADER_BG,
            textFormat: { bold: true, foregroundColor: COLORS.HEADER_FG }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    // Currency formatting
    {
      repeatCell: {
        range: { sheetId, startRowIndex: categoryTableStart + 1, endRowIndex: allData.length, startColumnIndex: 1, endColumnIndex: 3 },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: categoryTableStart + 1, endRowIndex: allData.length, startColumnIndex: 5, endColumnIndex: 7 },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Percentage formatting
    {
      repeatCell: {
        range: { sheetId, startRowIndex: categoryTableStart + 1, endRowIndex: allData.length, startColumnIndex: 3, endColumnIndex: 5 },
        cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Total row formatting
    {
      repeatCell: {
        range: { sheetId, startRowIndex: allData.length - 1, endRowIndex: allData.length, startColumnIndex: 0, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.TOTAL_ROW,
            textFormat: { bold: true }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    // Freeze header row
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: categoryTableStart + 1 } },
        fields: 'gridProperties.frozenRowCount'
      }
    },
    // Status column conditional formatting
    ...createStatusFormatting(sheetId, 7, categoryTableStart + 1, allData.length)
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests }
  });

  return { sheet: BUDGET_SHEETS.BUDGET_DASHBOARD, rows: categoryRows.length };
}

/**
 * Generate Monthly_Tracking sheet
 */
export async function generateMonthlyTracking(year) {
  const breakdown = budgetCalculations.getMonthlyBreakdown(year);
  const sheetId = await getSheetId(BUDGET_SHEETS.MONTHLY_TRACKING);

  // Headers
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const headers = [['Category', ...months, 'Total', 'Avg', 'Budget', 'Variance']];

  // Build category rows
  const categoryData = {};
  for (const budget of breakdown.budgets) {
    categoryData[budget.category_id] = {
      name: budget.category_name,
      budget: budget.annual_amount,
      months: new Array(12).fill(0)
    };
  }

  for (const month of breakdown.months) {
    for (const cat of month.categories) {
      if (categoryData[cat.category_id]) {
        categoryData[cat.category_id].months[month.month - 1] = cat.spent;
      }
    }
  }

  const rows = Object.values(categoryData).map(cat => {
    const total = cat.months.reduce((sum, m) => sum + m, 0);
    const avg = total / 12;
    const variance = cat.budget - total;

    return [cat.name, ...cat.months, total, avg, cat.budget, variance];
  });

  // Total row
  const monthTotals = new Array(12).fill(0);
  for (const cat of Object.values(categoryData)) {
    cat.months.forEach((m, i) => monthTotals[i] += m);
  }
  const grandTotal = monthTotals.reduce((sum, m) => sum + m, 0);
  const totalBudget = Object.values(categoryData).reduce((sum, c) => sum + c.budget, 0);

  rows.push(['TOTAL', ...monthTotals, grandTotal, grandTotal / 12, totalBudget, totalBudget - grandTotal]);

  // Write data
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${BUDGET_SHEETS.MONTHLY_TRACKING}!A1:Q${rows.length + 1}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [...headers, ...rows] }
  });

  // Formatting
  const requests = [
    createHeaderFormatting(sheetId, 17),
    // Currency format
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: rows.length + 1, startColumnIndex: 1, endColumnIndex: 17 },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Total row
    {
      repeatCell: {
        range: { sheetId, startRowIndex: rows.length, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: 17 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.TOTAL_ROW,
            textFormat: { bold: true }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    // Freeze first column and header
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } },
        fields: 'gridProperties(frozenRowCount,frozenColumnCount)'
      }
    }
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests }
  });

  return { sheet: BUDGET_SHEETS.MONTHLY_TRACKING, rows: rows.length };
}

/**
 * Generate Projections sheet
 */
export async function generateProjectionsSheet(year) {
  const projections = projectionEngine.generateAllProjections(year);
  const sheetId = await getSheetId(BUDGET_SHEETS.PROJECTIONS);

  // Summary section
  const summaryData = [
    [`Spending Projections - ${year}`, '', '', '', '', '', '', ''],
    [''],
    ['Year Progress:', `${projections.year_progress.percentage.toFixed(1)}%`, '', '', '', '', '', ''],
    [''],
    ['OVERALL PROJECTION', '', '', '', '', '', '', ''],
    ['Total Budget:', projections.overall.total_budget, '', 'Current Spent:', projections.overall.current_spent, '', '', ''],
    ['Projected Year-End:', projections.overall.best_estimate, '', 'Projected Variance:', projections.overall.projected_variance, '', '', ''],
    ['Will Exceed Budget:', projections.overall.will_exceed_budget ? 'YES' : 'NO', '', '', '', '', '', ''],
    [''],
    ['CATEGORY PROJECTIONS', '', '', '', '', '', '', '']
  ];

  // Headers
  const headers = ['Category', 'Budget', 'Spent', 'Projected', 'Variance', 'Variance %', 'Confidence', 'Status'];

  // Data rows
  const rows = projections.categories.map(c => [
    c.category_name,
    c.annual_budget,
    c.current_spent,
    c.best_estimate.projected_year_end,
    c.best_estimate.projected_variance,
    c.best_estimate.projected_variance_percent / 100,
    (c.best_estimate.confidence?.score || c.best_estimate.confidence || 0) / 100,
    c.status
  ]);

  // Combine data
  const allData = [...summaryData, headers, ...rows];

  // Write data
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${BUDGET_SHEETS.PROJECTIONS}!A1:H${allData.length}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: allData }
  });

  // Formatting
  const tableStart = summaryData.length;
  const requests = [
    // Title
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } },
        fields: 'userEnteredFormat.textFormat'
      }
    },
    // Headers
    {
      repeatCell: {
        range: { sheetId, startRowIndex: tableStart, endRowIndex: tableStart + 1, startColumnIndex: 0, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.HEADER_BG,
            textFormat: { bold: true, foregroundColor: COLORS.HEADER_FG }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    // Currency
    {
      repeatCell: {
        range: { sheetId, startRowIndex: tableStart + 1, endRowIndex: allData.length, startColumnIndex: 1, endColumnIndex: 5 },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Percentage
    {
      repeatCell: {
        range: { sheetId, startRowIndex: tableStart + 1, endRowIndex: allData.length, startColumnIndex: 5, endColumnIndex: 7 },
        cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    }
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests }
  });

  return { sheet: BUDGET_SHEETS.PROJECTIONS, rows: rows.length };
}

/**
 * Generate Income_Tracking sheet
 */
export async function generateIncomeTracking(year) {
  const transactions = incomeManager.getIncomeTransactions(year);
  const analysis = incomeManager.getIncomeAnalysis(year);
  const sheetId = await getSheetId(BUDGET_SHEETS.INCOME_TRACKING);

  // Summary section
  const summaryData = [
    [`Income Tracking - ${year}`, '', '', '', '', ''],
    [''],
    ['Total Expected:', analysis.expected.total, '', 'Total Actual:', analysis.actual.total, ''],
    ['Variance:', analysis.variance.total, '', 'Variance %:', analysis.variance.percentage / 100, ''],
    ['Year-End Projection:', analysis.projection.yearEnd, '', 'Daily Rate:', analysis.projection.dailyRate, ''],
    [''],
    ['INCOME TRANSACTIONS', '', '', '', '', '']
  ];

  // Headers
  const headers = ['Date', 'Source', 'Type', 'Amount', 'Description', 'Account'];

  // Transaction rows
  const rows = transactions.map(t => [
    t.date,
    t.source,
    t.type,
    t.amount,
    t.description || '',
    t.account_id || ''
  ]);

  // Total row
  const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);
  rows.push(['TOTAL', '', '', totalAmount, '', '']);

  // Combine data
  const allData = [...summaryData, headers, ...rows];

  // Write data
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${BUDGET_SHEETS.INCOME_TRACKING}!A1:F${allData.length}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: allData }
  });

  // Formatting
  const tableStart = summaryData.length;
  const requests = [
    // Title
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } },
        fields: 'userEnteredFormat.textFormat'
      }
    },
    // Headers
    {
      repeatCell: {
        range: { sheetId, startRowIndex: tableStart, endRowIndex: tableStart + 1, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.HEADER_BG,
            textFormat: { bold: true, foregroundColor: COLORS.HEADER_FG }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    // Currency
    {
      repeatCell: {
        range: { sheetId, startRowIndex: tableStart + 1, endRowIndex: allData.length, startColumnIndex: 3, endColumnIndex: 4 },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Total row
    {
      repeatCell: {
        range: { sheetId, startRowIndex: allData.length - 1, endRowIndex: allData.length, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.TOTAL_ROW,
            textFormat: { bold: true }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    }
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests }
  });

  return { sheet: BUDGET_SHEETS.INCOME_TRACKING, rows: rows.length };
}

/**
 * Generate all dashboard sheets
 */
export async function generateFullDashboard(year) {
  console.log(`Generating budget dashboard for ${year}...`);

  // Ensure sheets exist
  await ensureBudgetSheets();

  const results = {};

  // Generate each sheet
  console.log('  Generating Budget_Setup...');
  results.budgetSetup = await generateBudgetSetupSheet(year);

  console.log('  Generating Budget_Dashboard...');
  results.budgetDashboard = await generateBudgetDashboard(year);

  console.log('  Generating Monthly_Tracking...');
  results.monthlyTracking = await generateMonthlyTracking(year);

  console.log('  Generating Projections...');
  results.projections = await generateProjectionsSheet(year);

  console.log('  Generating Income_Tracking...');
  results.incomeTracking = await generateIncomeTracking(year);

  console.log('Dashboard generation complete!');
  return results;
}

/**
 * Get spreadsheet URL
 */
export function getSpreadsheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}
