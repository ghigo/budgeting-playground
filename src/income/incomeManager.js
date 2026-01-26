/**
 * Income Manager Module
 * Handles income tracking and budgeting operations
 */

import * as database from '../database.js';

// Valid income types
export const INCOME_TYPES = ['Salary', 'Freelance', 'Investment', 'Other'];

/**
 * Validate income type
 * @param {string} type - Income type
 * @returns {boolean} Valid or not
 */
export function isValidIncomeType(type) {
  return INCOME_TYPES.includes(type);
}

/**
 * Add an income transaction
 * @param {Object} params - Income parameters
 * @returns {Object} Created income transaction
 */
export function addIncome({
  date,
  amount,
  source,
  type,
  description = null,
  accountId = null,
  plaidTransactionId = null
}) {
  // Validate inputs
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Valid date is required (YYYY-MM-DD format)');
  }
  if (amount === undefined || amount <= 0) {
    throw new Error('Amount must be a positive number');
  }
  if (!source || typeof source !== 'string') {
    throw new Error('Source is required');
  }
  if (!type || !isValidIncomeType(type)) {
    throw new Error(`Invalid income type. Must be one of: ${INCOME_TYPES.join(', ')}`);
  }

  return database.addIncomeTransaction(
    date,
    amount,
    source,
    type,
    description,
    accountId,
    plaidTransactionId
  );
}

/**
 * Get income transactions for a year
 * @param {number} year - Year
 * @param {number} month - Optional month (1-12)
 * @returns {Array} Income transactions
 */
export function getIncomeTransactions(year, month = null) {
  return database.getIncomeTransactions(year, month);
}

/**
 * Get income transaction by ID
 * @param {string} id - Transaction ID
 * @returns {Object|null} Income transaction
 */
export function getIncomeById(id) {
  return database.getIncomeTransactionById(id);
}

/**
 * Update an income transaction
 * @param {string} id - Transaction ID
 * @param {Object} updates - Fields to update
 * @returns {boolean} Success
 */
export function updateIncome(id, updates) {
  // Validate updates
  if (updates.date && !/^\d{4}-\d{2}-\d{2}$/.test(updates.date)) {
    throw new Error('Invalid date format. Use YYYY-MM-DD');
  }
  if (updates.amount !== undefined && updates.amount <= 0) {
    throw new Error('Amount must be a positive number');
  }
  if (updates.type && !isValidIncomeType(updates.type)) {
    throw new Error(`Invalid income type. Must be one of: ${INCOME_TYPES.join(', ')}`);
  }

  return database.updateIncomeTransaction(id, updates);
}

/**
 * Delete an income transaction
 * @param {string} id - Transaction ID
 * @returns {boolean} Success
 */
export function deleteIncome(id) {
  return database.deleteIncomeTransaction(id);
}

/**
 * Get income summary for a year
 * @param {number} year - Year
 * @returns {Object} Summary with totals and breakdowns
 */
export function getIncomeSummary(year) {
  return database.getIncomeSummary(year);
}

/**
 * Set expected annual income
 * @param {Object} params - Income budget parameters
 * @returns {Object} Created/updated income budget
 */
export function setExpectedIncome({
  source,
  type,
  year,
  annualExpected,
  notes = null
}) {
  // Validate inputs
  if (!source || typeof source !== 'string') {
    throw new Error('Source is required');
  }
  if (!type || !isValidIncomeType(type)) {
    throw new Error(`Invalid income type. Must be one of: ${INCOME_TYPES.join(', ')}`);
  }
  if (!year || year < 2000 || year > 2100) {
    throw new Error('Valid year is required (2000-2100)');
  }
  if (annualExpected === undefined || annualExpected < 0) {
    throw new Error('Annual expected amount must be a non-negative number');
  }

  return database.setIncomeBudget(source, type, year, annualExpected, notes);
}

/**
 * Get all income budgets for a year
 * @param {number} year - Year
 * @returns {Array} Income budgets
 */
export function getIncomeBudgets(year) {
  return database.getIncomeBudgets(year);
}

/**
 * Get total expected income for a year
 * @param {number} year - Year
 * @returns {number} Total expected income
 */
export function getTotalExpectedIncome(year) {
  return database.getTotalExpectedIncome(year);
}

/**
 * Delete an income budget
 * @param {string} id - Income budget ID
 * @returns {boolean} Success
 */
export function deleteIncomeBudget(id) {
  return database.deleteIncomeBudget(id);
}

/**
 * Get income vs budget comparison
 * @param {number} year - Year
 * @returns {Object} Comparison data
 */
export function getIncomeVsBudget(year) {
  return database.getIncomeVsBudget(year);
}

/**
 * Detect potential income from regular transactions
 * @param {number} year - Year
 * @param {Array} knownSources - Optional additional known income patterns
 * @returns {Array} Potential income transactions
 */
export function detectPotentialIncome(year, knownSources = []) {
  return database.detectPotentialIncome(year, knownSources);
}

/**
 * Import detected income as actual income transactions
 * @param {Array} transactions - Transactions to import
 * @returns {Object} Import results
 */
export function importDetectedIncome(transactions) {
  const imported = [];
  const errors = [];

  for (const txn of transactions) {
    try {
      const income = addIncome({
        date: txn.date,
        amount: txn.amount,
        source: txn.merchant_name || txn.description,
        type: txn.income_type || 'Other',
        description: txn.description,
        accountId: txn.account_name,
        plaidTransactionId: txn.transaction_id
      });
      imported.push(income);
    } catch (error) {
      errors.push({ transaction: txn.transaction_id, error: error.message });
    }
  }

  return { imported, errors };
}

/**
 * Get income summary with comparison to budget
 * @param {number} year - Year
 * @returns {Object} Complete income analysis
 */
export function getIncomeAnalysis(year) {
  const summary = getIncomeSummary(year);
  const comparison = getIncomeVsBudget(year);
  const totalExpected = getTotalExpectedIncome(year);

  // Calculate year progress
  const now = new Date();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const yearProgress = Math.min(1, (now - yearStart) / (yearEnd - yearStart));

  // Calculate on-pace amounts
  const expectedToDate = totalExpected * yearProgress;
  const onPaceVariance = summary.total - expectedToDate;

  // Project year-end
  const daysElapsed = Math.max(1, Math.floor((now - yearStart) / (1000 * 60 * 60 * 24)));
  const dailyIncome = summary.total / daysElapsed;
  const projectedYearEnd = dailyIncome * 365;

  return {
    year,
    yearProgress: yearProgress * 100,
    actual: {
      total: summary.total,
      byType: summary.byType,
      monthly: summary.monthly
    },
    expected: {
      total: totalExpected,
      toDate: expectedToDate
    },
    variance: {
      total: summary.total - totalExpected,
      toDate: onPaceVariance,
      percentage: totalExpected > 0 ? ((summary.total - totalExpected) / totalExpected * 100) : 0
    },
    projection: {
      yearEnd: projectedYearEnd,
      dailyRate: dailyIncome,
      onTrack: projectedYearEnd >= totalExpected * 0.95
    },
    comparison: comparison.comparison
  };
}

/**
 * Get monthly income breakdown
 * @param {number} year - Year
 * @returns {Array} Monthly income data
 */
export function getMonthlyIncome(year) {
  const transactions = getIncomeTransactions(year);
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    monthName: new Date(year, i, 1).toLocaleString('default', { month: 'short' }),
    total: 0,
    byType: {}
  }));

  for (const txn of transactions) {
    const month = parseInt(txn.date.split('-')[1], 10) - 1;
    months[month].total += txn.amount;

    if (!months[month].byType[txn.type]) {
      months[month].byType[txn.type] = 0;
    }
    months[month].byType[txn.type] += txn.amount;
  }

  return months;
}

/**
 * Get income sources list
 * @param {number} year - Optional year filter
 * @returns {Array} Unique sources
 */
export function getIncomeSources(year = null) {
  const transactions = year ? getIncomeTransactions(year) : [];
  const budgets = year ? getIncomeBudgets(year) : [];

  const sources = new Set();

  for (const txn of transactions) {
    sources.add(txn.source);
  }

  for (const budget of budgets) {
    sources.add(budget.source);
  }

  return Array.from(sources).sort();
}
