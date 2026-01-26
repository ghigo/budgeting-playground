/**
 * Budget Manager Module
 * Handles budget CRUD operations with business logic
 */

import * as database from '../database.js';

/**
 * Create a new budget for a category
 * @param {string} categoryName - Name of the category
 * @param {number} year - Budget year
 * @param {number} annualAmount - Annual budget amount
 * @param {string} notes - Optional notes
 * @returns {Object} Created budget
 */
export function createBudget(categoryName, year, annualAmount, notes = null) {
  // Validate inputs
  if (!categoryName || typeof categoryName !== 'string') {
    throw new Error('Category name is required');
  }
  if (!year || year < 2000 || year > 2100) {
    throw new Error('Valid year is required (2000-2100)');
  }
  if (annualAmount === undefined || annualAmount < 0) {
    throw new Error('Annual amount must be a positive number');
  }

  // Get category ID
  const categoryId = database.getCategoryIdByName(categoryName);
  if (!categoryId) {
    throw new Error(`Category not found: ${categoryName}`);
  }

  return database.createBudget(categoryId, year, annualAmount, notes);
}

/**
 * Get all budgets for a year with category info
 * @param {number} year - Budget year
 * @returns {Array} List of budgets
 */
export function getBudgetsByYear(year) {
  return database.getBudgetsByYear(year);
}

/**
 * Get budget for a specific category and year
 * @param {string} categoryName - Category name
 * @param {number} year - Budget year
 * @returns {Object|null} Budget or null if not found
 */
export function getBudget(categoryName, year) {
  const categoryId = database.getCategoryIdByName(categoryName);
  if (!categoryId) {
    return null;
  }
  return database.getBudget(categoryId, year);
}

/**
 * Update a budget amount
 * @param {string} categoryName - Category name
 * @param {number} year - Budget year
 * @param {number} newAmount - New annual amount
 * @param {string} reason - Reason for adjustment
 * @returns {Object} Updated budget
 */
export function updateBudget(categoryName, year, newAmount, reason = null) {
  const budget = getBudget(categoryName, year);
  if (!budget) {
    throw new Error(`Budget not found for ${categoryName} in ${year}`);
  }

  if (newAmount === undefined || newAmount < 0) {
    throw new Error('New amount must be a positive number');
  }

  return database.updateBudget(budget.id, newAmount, reason);
}

/**
 * Update budget notes
 * @param {string} categoryName - Category name
 * @param {number} year - Budget year
 * @param {string} notes - New notes
 */
export function updateBudgetNotes(categoryName, year, notes) {
  const budget = getBudget(categoryName, year);
  if (!budget) {
    throw new Error(`Budget not found for ${categoryName} in ${year}`);
  }
  database.updateBudgetNotes(budget.id, notes);
}

/**
 * Delete a budget
 * @param {string} categoryName - Category name
 * @param {number} year - Budget year
 * @returns {boolean} Success
 */
export function deleteBudget(categoryName, year) {
  const budget = getBudget(categoryName, year);
  if (!budget) {
    throw new Error(`Budget not found for ${categoryName} in ${year}`);
  }
  return database.deleteBudget(budget.id);
}

/**
 * Clone budgets from one year to another
 * @param {number} fromYear - Source year
 * @param {number} toYear - Target year
 * @param {number} inflationRate - Optional inflation adjustment percentage
 * @returns {Array} List of cloned budgets
 */
export function cloneBudgets(fromYear, toYear, inflationRate = 0) {
  if (fromYear === toYear) {
    throw new Error('Source and target years must be different');
  }

  const sourceBudgets = getBudgetsByYear(fromYear);
  if (sourceBudgets.length === 0) {
    throw new Error(`No budgets found for year ${fromYear}`);
  }

  return database.cloneBudgets(fromYear, toYear, inflationRate);
}

/**
 * Get budget adjustment history
 * @param {string} categoryName - Category name
 * @param {number} year - Budget year
 * @returns {Array} List of adjustments
 */
export function getBudgetAdjustments(categoryName, year) {
  const budget = getBudget(categoryName, year);
  if (!budget) {
    return [];
  }
  return database.getBudgetAdjustments(budget.id);
}

/**
 * Get all adjustments for a year
 * @param {number} year - Budget year
 * @returns {Array} List of adjustments
 */
export function getBudgetAdjustmentsByYear(year) {
  return database.getBudgetAdjustmentsByYear(year);
}

/**
 * Get total budgeted amount for a year
 * @param {number} year - Budget year
 * @returns {number} Total budgeted amount
 */
export function getTotalBudgetedAmount(year) {
  return database.getTotalBudgetedAmount(year);
}

/**
 * Get available budget years
 * @returns {Array} List of years with budgets
 */
export function getBudgetYears() {
  return database.getBudgetYears();
}

/**
 * Get categories without budgets for a year
 * @param {number} year - Budget year
 * @returns {Array} List of categories without budgets
 */
export function getCategoriesWithoutBudgets(year) {
  const categories = database.getCategories();
  const budgets = getBudgetsByYear(year);
  const budgetedCategoryIds = new Set(budgets.map(b => b.category_id));

  return categories.filter(c => !budgetedCategoryIds.has(c.id));
}

/**
 * Get budget summary for a year
 * @param {number} year - Budget year
 * @returns {Object} Summary with totals and counts
 */
export function getBudgetSummary(year) {
  const budgets = getBudgetsByYear(year);
  const categories = database.getCategories();

  const totalBudgeted = budgets.reduce((sum, b) => sum + b.annual_amount, 0);
  const avgBudget = budgets.length > 0 ? totalBudgeted / budgets.length : 0;

  return {
    year,
    totalBudgeted,
    budgetCount: budgets.length,
    categoryCount: categories.length,
    averageBudget: avgBudget,
    categoriesWithBudgets: budgets.length,
    categoriesWithoutBudgets: categories.length - budgets.length,
    budgets: budgets.map(b => ({
      category: b.category_name,
      amount: b.annual_amount,
      monthlyPace: b.annual_amount / 12
    }))
  };
}

/**
 * Suggest budget amounts based on previous year spending
 * @param {number} year - Target year for budgets
 * @param {number} inflationRate - Inflation adjustment percentage (default 3%)
 * @returns {Array} Suggested budgets
 */
export function suggestBudgets(year, inflationRate = 3) {
  const previousYear = year - 1;
  const spending = database.getYTDSpendingByCategory(previousYear);
  const categories = database.getCategories();
  const multiplier = 1 + (inflationRate / 100);

  const suggestions = [];

  for (const category of categories) {
    const categorySpending = spending.find(s => s.category_id === category.id);
    const lastYearSpent = categorySpending ? categorySpending.ytd_spent : 0;
    const suggestedAmount = Math.ceil(lastYearSpent * multiplier);

    suggestions.push({
      category_id: category.id,
      category_name: category.name,
      last_year_spent: lastYearSpent,
      suggested_amount: suggestedAmount,
      transaction_count: categorySpending ? categorySpending.transaction_count : 0
    });
  }

  return suggestions.sort((a, b) => b.suggested_amount - a.suggested_amount);
}

/**
 * Create budgets from suggestions
 * @param {number} year - Budget year
 * @param {Array} suggestions - Array of {category_name, amount} objects
 * @returns {Array} Created budgets
 */
export function createBudgetsFromSuggestions(year, suggestions) {
  const created = [];
  const errors = [];

  for (const suggestion of suggestions) {
    try {
      const budget = createBudget(
        suggestion.category_name,
        year,
        suggestion.amount,
        suggestion.notes || 'Created from suggestions'
      );
      created.push(budget);
    } catch (error) {
      errors.push({ category: suggestion.category_name, error: error.message });
    }
  }

  return { created, errors };
}
