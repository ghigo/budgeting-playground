/**
 * Budget Calculations Module
 * Handles all budget compliance metrics and calculations
 */

import * as database from '../database.js';
import * as budgetManager from './budgetManager.js';

// Budget status thresholds
export const STATUS_THRESHOLDS = {
  UNDER: 75,      // < 75% used
  WARNING: 95,    // >= 75% and < 95%
  CRITICAL: 100,  // >= 95% and < 100%
  OVER: 100       // >= 100%
};

export const STATUS_LABELS = {
  UNDER: 'Under Budget',
  WARNING: 'Warning',
  CRITICAL: 'Critical',
  OVER: 'Over Budget'
};

/**
 * Calculate year progress percentage
 * @param {number} year - Year to calculate for
 * @returns {Object} Year progress data
 */
export function getYearProgress(year) {
  const now = new Date();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);

  // If in the future year, return 0%
  if (now < yearStart) {
    return {
      percentage: 0,
      daysElapsed: 0,
      daysRemaining: 365,
      isComplete: false
    };
  }

  // If past year, return 100%
  if (now > yearEnd) {
    return {
      percentage: 100,
      daysElapsed: 365,
      daysRemaining: 0,
      isComplete: true
    };
  }

  const totalDays = (yearEnd - yearStart) / (1000 * 60 * 60 * 24);
  const daysElapsed = (now - yearStart) / (1000 * 60 * 60 * 24);
  const percentage = (daysElapsed / totalDays) * 100;

  return {
    percentage: Math.min(100, percentage),
    daysElapsed: Math.floor(daysElapsed),
    daysRemaining: Math.ceil(totalDays - daysElapsed),
    isComplete: false
  };
}

/**
 * Determine budget status based on usage percentage
 * @param {number} usedPercentage - Percentage of budget used
 * @returns {string} Status label
 */
export function getBudgetStatus(usedPercentage) {
  if (usedPercentage >= STATUS_THRESHOLDS.OVER) {
    return 'OVER';
  } else if (usedPercentage >= STATUS_THRESHOLDS.CRITICAL) {
    return 'CRITICAL';
  } else if (usedPercentage >= STATUS_THRESHOLDS.WARNING) {
    return 'WARNING';
  }
  return 'UNDER';
}

/**
 * Calculate budget compliance for a single category
 * @param {Object} budget - Budget object
 * @param {number} spent - Amount spent YTD
 * @param {Object} yearProgress - Year progress data
 * @returns {Object} Compliance metrics
 */
export function calculateCategoryCompliance(budget, spent, yearProgress) {
  const annualBudget = budget.annual_amount;
  const monthlyPace = annualBudget / 12;

  // Calculate usage percentage
  const usedPercentage = annualBudget > 0 ? (spent / annualBudget) * 100 : 0;

  // Calculate on-pace amount (what should have been spent by now)
  const onPaceAmount = (annualBudget * yearProgress.percentage) / 100;

  // Calculate variance (positive = over budget pace, negative = under)
  const varianceAmount = spent - onPaceAmount;
  const variancePercentage = onPaceAmount > 0 ? (varianceAmount / onPaceAmount) * 100 : 0;

  // Calculate remaining budget
  const remaining = annualBudget - spent;
  const remainingMonths = Math.max(0, 12 - Math.floor(yearProgress.daysElapsed / 30.44));
  const remainingPerMonth = remainingMonths > 0 ? remaining / remainingMonths : 0;

  // Calculate daily burn rate and days to exhaustion
  const dailyBurnRate = yearProgress.daysElapsed > 0 ? spent / yearProgress.daysElapsed : 0;
  const daysToExhaustion = dailyBurnRate > 0 ? remaining / dailyBurnRate : Infinity;

  // Determine status
  const status = getBudgetStatus(usedPercentage);

  return {
    category_id: budget.category_id,
    category_name: budget.category_name,
    annual_budget: annualBudget,
    monthly_pace: monthlyPace,
    ytd_spent: spent,
    used_percentage: usedPercentage,
    year_elapsed_percentage: yearProgress.percentage,
    on_pace_amount: onPaceAmount,
    variance_amount: varianceAmount,
    variance_percentage: variancePercentage,
    remaining: remaining,
    remaining_per_month: remainingPerMonth,
    daily_burn_rate: dailyBurnRate,
    days_to_exhaustion: Math.min(daysToExhaustion, yearProgress.daysRemaining + 1),
    status: status,
    status_label: STATUS_LABELS[status]
  };
}

/**
 * Calculate budget compliance for all categories in a year
 * @param {number} year - Budget year
 * @returns {Object} Full compliance report
 */
export function calculateFullCompliance(year) {
  const budgets = budgetManager.getBudgetsByYear(year);
  const spending = database.getYTDSpendingByCategory(year);
  const yearProgress = getYearProgress(year);

  // Index spending by category_id
  const spendingByCategory = {};
  for (const item of spending) {
    spendingByCategory[item.category_id] = item.ytd_spent;
  }

  // Calculate compliance for each budgeted category
  const categoryCompliance = [];
  let totalBudget = 0;
  let totalSpent = 0;

  for (const budget of budgets) {
    const spent = spendingByCategory[budget.category_id] || 0;
    totalBudget += budget.annual_amount;
    totalSpent += spent;

    const compliance = calculateCategoryCompliance(budget, spent, yearProgress);
    categoryCompliance.push(compliance);
  }

  // Calculate overall metrics
  const overallUsedPercentage = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const overallOnPace = (totalBudget * yearProgress.percentage) / 100;
  const overallVariance = totalSpent - overallOnPace;

  // Count by status
  const statusCounts = {
    UNDER: 0,
    WARNING: 0,
    CRITICAL: 0,
    OVER: 0
  };

  for (const item of categoryCompliance) {
    statusCounts[item.status]++;
  }

  // Sort by variance (most over-budget first)
  categoryCompliance.sort((a, b) => b.variance_percentage - a.variance_percentage);

  return {
    year,
    yearProgress,
    overall: {
      total_budget: totalBudget,
      total_spent: totalSpent,
      used_percentage: overallUsedPercentage,
      on_pace_amount: overallOnPace,
      variance_amount: overallVariance,
      variance_percentage: overallOnPace > 0 ? (overallVariance / overallOnPace) * 100 : 0,
      remaining: totalBudget - totalSpent,
      status: getBudgetStatus(overallUsedPercentage),
      status_label: STATUS_LABELS[getBudgetStatus(overallUsedPercentage)]
    },
    statusCounts,
    categories: categoryCompliance
  };
}

/**
 * Get monthly spending breakdown for a category
 * @param {number} year - Year
 * @param {number} categoryId - Optional category ID
 * @returns {Object} Monthly breakdown
 */
export function getMonthlyBreakdown(year, categoryId = null) {
  const spending = database.getSpendingByCategory(year, categoryId);

  // Initialize months
  const months = {};
  for (let m = 1; m <= 12; m++) {
    const monthKey = String(m).padStart(2, '0');
    months[monthKey] = {};
  }

  // Group spending by category and month
  for (const item of spending) {
    const monthKey = item.month;
    if (!months[monthKey][item.category_id]) {
      months[monthKey][item.category_id] = {
        category_id: item.category_id,
        category_name: item.category_name,
        spent: 0
      };
    }
    months[monthKey][item.category_id].spent += item.spent;
  }

  // Get budgets for comparison
  const budgets = budgetManager.getBudgetsByYear(year);
  const budgetByCategory = {};
  for (const budget of budgets) {
    budgetByCategory[budget.category_id] = budget;
  }

  // Build monthly data with budget comparison
  const monthlyData = [];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  for (let m = 1; m <= 12; m++) {
    const monthKey = String(m).padStart(2, '0');
    const monthSpending = months[monthKey];
    const categories = [];
    let monthTotal = 0;
    let monthBudget = 0;

    for (const budget of budgets) {
      const catSpending = monthSpending[budget.category_id];
      const spent = catSpending ? catSpending.spent : 0;
      const monthlyBudget = budget.annual_amount / 12;
      monthTotal += spent;
      monthBudget += monthlyBudget;

      categories.push({
        category_id: budget.category_id,
        category_name: budget.category_name,
        spent: spent,
        budget: monthlyBudget,
        variance: spent - monthlyBudget,
        over_budget: spent > monthlyBudget
      });
    }

    monthlyData.push({
      month: m,
      month_name: monthNames[m - 1],
      total_spent: monthTotal,
      total_budget: monthBudget,
      variance: monthTotal - monthBudget,
      categories
    });
  }

  return {
    year,
    months: monthlyData,
    budgets
  };
}

/**
 * Calculate cumulative spending vs budget pace
 * @param {number} year - Year
 * @returns {Object} Cumulative data for charting
 */
export function getCumulativeComparison(year) {
  const breakdown = getMonthlyBreakdown(year);
  const budgets = budgetManager.getBudgetsByYear(year);
  const totalAnnualBudget = budgets.reduce((sum, b) => sum + b.annual_amount, 0);

  let cumulativeSpent = 0;
  let cumulativeBudget = 0;
  const monthlyBudget = totalAnnualBudget / 12;

  const data = [];

  for (const month of breakdown.months) {
    cumulativeSpent += month.total_spent;
    cumulativeBudget += monthlyBudget;

    data.push({
      month: month.month,
      month_name: month.month_name,
      monthly_spent: month.total_spent,
      monthly_budget: monthlyBudget,
      cumulative_spent: cumulativeSpent,
      cumulative_budget: cumulativeBudget,
      cumulative_variance: cumulativeSpent - cumulativeBudget
    });
  }

  return {
    year,
    total_annual_budget: totalAnnualBudget,
    data
  };
}

/**
 * Get categories that need attention (warning or worse)
 * @param {number} year - Year
 * @returns {Array} Categories needing attention
 */
export function getCategoriesNeedingAttention(year) {
  const compliance = calculateFullCompliance(year);

  return compliance.categories.filter(c =>
    c.status === 'WARNING' || c.status === 'CRITICAL' || c.status === 'OVER'
  ).map(c => ({
    ...c,
    message: generateWarningMessage(c)
  }));
}

/**
 * Generate warning message for a category
 * @param {Object} compliance - Category compliance data
 * @returns {string} Warning message
 */
function generateWarningMessage(compliance) {
  const { category_name, used_percentage, variance_amount, days_to_exhaustion, status } = compliance;

  if (status === 'OVER') {
    return `${category_name} is over budget by $${Math.abs(variance_amount).toFixed(0)}`;
  }

  if (days_to_exhaustion < 30) {
    return `${category_name} will exhaust budget in ${Math.round(days_to_exhaustion)} days at current rate`;
  }

  if (status === 'CRITICAL') {
    return `${category_name} is at ${used_percentage.toFixed(0)}% of annual budget - critical`;
  }

  return `${category_name} is at ${used_percentage.toFixed(0)}% - approaching budget limit`;
}

/**
 * Calculate savings rate
 * @param {number} year - Year
 * @returns {Object} Savings analysis
 */
export function calculateSavingsRate(year) {
  const incomeSummary = database.getIncomeSummary(year);
  const compliance = calculateFullCompliance(year);

  const totalIncome = incomeSummary.total;
  const totalExpenses = compliance.overall.total_spent;
  const netSavings = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? (netSavings / totalIncome) * 100 : 0;

  return {
    year,
    total_income: totalIncome,
    total_expenses: totalExpenses,
    net_savings: netSavings,
    savings_rate: savingsRate,
    is_positive: netSavings >= 0
  };
}

/**
 * Compare spending across multiple years
 * @param {Array} years - Array of years to compare
 * @returns {Object} Multi-year comparison
 */
export function compareYears(years) {
  const comparison = {};
  const categories = database.getCategories();

  // Initialize comparison structure
  for (const category of categories) {
    comparison[category.id] = {
      category_id: category.id,
      category_name: category.name,
      years: {}
    };
  }

  // Get data for each year
  for (const year of years) {
    const spending = database.getYTDSpendingByCategory(year);
    const budgets = budgetManager.getBudgetsByYear(year);

    const budgetByCategory = {};
    for (const budget of budgets) {
      budgetByCategory[budget.category_id] = budget.annual_amount;
    }

    for (const item of spending) {
      if (comparison[item.category_id]) {
        comparison[item.category_id].years[year] = {
          spent: item.ytd_spent,
          budget: budgetByCategory[item.category_id] || 0,
          transaction_count: item.transaction_count
        };
      }
    }
  }

  // Calculate trends
  const results = Object.values(comparison).map(cat => {
    const yearValues = Object.entries(cat.years).sort((a, b) => a[0] - b[0]);
    let trend = 'stable';

    if (yearValues.length >= 2) {
      const firstYear = yearValues[0][1].spent || 0;
      const lastYear = yearValues[yearValues.length - 1][1].spent || 0;

      if (lastYear > firstYear * 1.1) {
        trend = 'increasing';
      } else if (lastYear < firstYear * 0.9) {
        trend = 'decreasing';
      }
    }

    const avgSpent = yearValues.length > 0
      ? yearValues.reduce((sum, [, data]) => sum + (data.spent || 0), 0) / yearValues.length
      : 0;

    return {
      ...cat,
      trend,
      average_spent: avgSpent
    };
  });

  return {
    years,
    categories: results.filter(c => Object.keys(c.years).length > 0)
  };
}
