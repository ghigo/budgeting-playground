/**
 * Projection Engine Module
 * Handles linear and trend-based spending projections
 */

import * as database from '../database.js';
import * as budgetManager from '../budgets/budgetManager.js';
import * as budgetCalculations from '../budgets/budgetCalculations.js';

/**
 * Calculate simple linear regression
 * @param {Array} data - Array of {x, y} points
 * @returns {Object} Regression parameters (slope, intercept, r2)
 */
function linearRegression(data) {
  if (data.length < 2) {
    return { slope: 0, intercept: 0, r2: 0 };
  }

  const n = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

  for (const point of data) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumX2 += point.x * point.x;
    sumY2 += point.y * point.y;
  }

  const denominator = (n * sumX2 - sumX * sumX);
  if (denominator === 0) {
    return { slope: 0, intercept: sumY / n, r2: 0 };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-squared
  const meanY = sumY / n;
  let ssTotal = 0, ssResidual = 0;

  for (const point of data) {
    const predicted = slope * point.x + intercept;
    ssTotal += Math.pow(point.y - meanY, 2);
    ssResidual += Math.pow(point.y - predicted, 2);
  }

  const r2 = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;

  return { slope, intercept, r2: Math.max(0, r2) };
}

/**
 * Calculate standard deviation
 * @param {Array} values - Array of numbers
 * @returns {number} Standard deviation
 */
function standardDeviation(values) {
  if (values.length === 0) return 0;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;

  return Math.sqrt(avgSquaredDiff);
}

/**
 * Calculate coefficient of variation (relative variability)
 * @param {Array} values - Array of numbers
 * @returns {number} CV (0-1, lower is more consistent)
 */
function coefficientOfVariation(values) {
  if (values.length === 0) return 1;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (mean === 0) return 1;

  const stdDev = standardDeviation(values);
  return Math.min(1, stdDev / mean);
}

/**
 * Calculate projection confidence based on data consistency
 * @param {Array} monthlyValues - Monthly spending values
 * @param {number} r2 - R-squared from regression
 * @param {number} monthsOfData - Number of months with data
 * @returns {Object} Confidence metrics
 */
function calculateConfidence(monthlyValues, r2 = 0, monthsOfData = 0) {
  // Base confidence on coefficient of variation (lower CV = higher confidence)
  const cv = coefficientOfVariation(monthlyValues);
  const variabilityScore = Math.max(0, 1 - cv) * 40; // 0-40 points

  // R-squared contribution (better fit = higher confidence)
  const fitScore = r2 * 30; // 0-30 points

  // Data quantity contribution (more months = higher confidence)
  const dataScore = Math.min(30, monthsOfData * 2.5); // 0-30 points (max at 12 months)

  const totalScore = variabilityScore + fitScore + dataScore;

  let level;
  if (totalScore >= 70) level = 'High';
  else if (totalScore >= 50) level = 'Medium';
  else if (totalScore >= 30) level = 'Low';
  else level = 'Very Low';

  return {
    score: Math.round(totalScore),
    level,
    variability_factor: cv,
    fit_factor: r2,
    data_months: monthsOfData
  };
}

/**
 * Calculate linear projection for a category
 * @param {Object} compliance - Category compliance data
 * @param {Object} yearProgress - Year progress data
 * @returns {Object} Linear projection
 */
export function linearProjection(compliance, yearProgress) {
  const { ytd_spent, daily_burn_rate, annual_budget } = compliance;

  // Project year-end spending based on daily burn rate
  const daysInYear = 365;
  const projectedYearEnd = daily_burn_rate * daysInYear;

  // Calculate variance from budget
  const projectedVariance = projectedYearEnd - annual_budget;
  const projectedVariancePercent = annual_budget > 0
    ? (projectedVariance / annual_budget) * 100
    : 0;

  // Simple confidence based on days of data
  const daysOfData = yearProgress.daysElapsed;
  const simpleConfidence = Math.min(100, daysOfData / 3.65); // 100% at full year

  return {
    method: 'linear',
    projected_year_end: projectedYearEnd,
    projected_variance: projectedVariance,
    projected_variance_percent: projectedVariancePercent,
    daily_rate: daily_burn_rate,
    will_exceed_budget: projectedYearEnd > annual_budget,
    confidence: simpleConfidence
  };
}

/**
 * Calculate trend-based projection using linear regression
 * @param {number} year - Year
 * @param {number} categoryId - Category ID
 * @param {Object} budget - Budget data
 * @returns {Object} Trend projection
 */
export function trendProjection(year, categoryId, budget) {
  const breakdown = budgetCalculations.getMonthlyBreakdown(year, categoryId);
  const currentMonth = new Date().getMonth() + 1;

  // Get monthly spending data for completed months
  const monthlySpending = breakdown.months
    .filter((m, i) => i < currentMonth - 1 || (i === currentMonth - 1 && new Date().getDate() > 15))
    .map((m, i) => {
      const catData = m.categories.find(c => c.category_id === categoryId);
      return {
        x: i + 1,
        y: catData ? catData.spent : 0
      };
    });

  // Need at least 3 months for meaningful trend
  if (monthlySpending.length < 3) {
    return null;
  }

  const monthlyValues = monthlySpending.map(m => m.y);
  const regression = linearRegression(monthlySpending);

  // Project for remaining months
  let projectedTotal = monthlyValues.reduce((sum, v) => sum + v, 0);
  for (let month = monthlySpending.length + 1; month <= 12; month++) {
    const projectedMonth = Math.max(0, regression.slope * month + regression.intercept);
    projectedTotal += projectedMonth;
  }

  const confidence = calculateConfidence(monthlyValues, regression.r2, monthlySpending.length);

  // Determine trend direction
  let trendDirection = 'stable';
  if (regression.slope > budget.annual_amount * 0.005) {
    trendDirection = 'increasing';
  } else if (regression.slope < -budget.annual_amount * 0.005) {
    trendDirection = 'decreasing';
  }

  return {
    method: 'trend',
    projected_year_end: projectedTotal,
    projected_variance: projectedTotal - budget.annual_amount,
    projected_variance_percent: budget.annual_amount > 0
      ? ((projectedTotal - budget.annual_amount) / budget.annual_amount) * 100
      : 0,
    will_exceed_budget: projectedTotal > budget.annual_amount,
    trend_direction: trendDirection,
    monthly_change: regression.slope,
    r_squared: regression.r2,
    confidence: confidence,
    months_analyzed: monthlySpending.length
  };
}

/**
 * Generate full projection for a category
 * @param {number} year - Year
 * @param {Object} compliance - Category compliance data
 * @param {Object} budget - Budget data
 * @returns {Object} Combined projections
 */
export function generateCategoryProjection(year, compliance, budget) {
  const yearProgress = budgetCalculations.getYearProgress(year);
  const linear = linearProjection(compliance, yearProgress);
  const trend = trendProjection(year, compliance.category_id, budget);

  // Determine best estimate (use trend if available and confident, otherwise linear)
  let bestEstimate = linear;
  if (trend && trend.confidence.score >= 50) {
    bestEstimate = trend;
  }

  // Generate warning message
  let warningMessage = null;
  if (bestEstimate.will_exceed_budget) {
    const overBy = Math.abs(bestEstimate.projected_variance);
    const overPercent = Math.abs(bestEstimate.projected_variance_percent);
    warningMessage = `Projected to exceed budget by $${overBy.toFixed(0)} (${overPercent.toFixed(0)}%)`;
  } else if (bestEstimate.projected_variance_percent < -15) {
    warningMessage = `Tracking ${Math.abs(bestEstimate.projected_variance_percent).toFixed(0)}% under budget - Safe`;
  }

  return {
    category_id: compliance.category_id,
    category_name: compliance.category_name,
    annual_budget: budget.annual_amount,
    current_spent: compliance.ytd_spent,
    linear_projection: linear,
    trend_projection: trend,
    best_estimate: bestEstimate,
    warning_message: warningMessage,
    status: bestEstimate.will_exceed_budget ? 'DANGER' : 'SAFE'
  };
}

/**
 * Generate projections for all budgeted categories
 * @param {number} year - Year
 * @returns {Object} Full projection report
 */
export function generateAllProjections(year) {
  const compliance = budgetCalculations.calculateFullCompliance(year);
  const budgets = budgetManager.getBudgetsByYear(year);

  const budgetByCategory = {};
  for (const budget of budgets) {
    budgetByCategory[budget.category_id] = budget;
  }

  const projections = [];

  for (const category of compliance.categories) {
    const budget = budgetByCategory[category.category_id];
    if (budget) {
      const projection = generateCategoryProjection(year, category, budget);
      projections.push(projection);
    }
  }

  // Calculate overall projection
  const totalLinearProjection = projections.reduce(
    (sum, p) => sum + p.linear_projection.projected_year_end, 0
  );
  const totalBestEstimate = projections.reduce(
    (sum, p) => sum + p.best_estimate.projected_year_end, 0
  );
  const totalBudget = compliance.overall.total_budget;

  // Count danger categories
  const dangerCategories = projections.filter(p => p.status === 'DANGER').length;
  const safeCategories = projections.filter(p => p.status === 'SAFE').length;

  // Sort by projected variance (worst first)
  projections.sort((a, b) =>
    b.best_estimate.projected_variance_percent - a.best_estimate.projected_variance_percent
  );

  return {
    year,
    year_progress: compliance.yearProgress,
    overall: {
      total_budget: totalBudget,
      current_spent: compliance.overall.total_spent,
      linear_projection: totalLinearProjection,
      best_estimate: totalBestEstimate,
      projected_variance: totalBestEstimate - totalBudget,
      projected_variance_percent: totalBudget > 0
        ? ((totalBestEstimate - totalBudget) / totalBudget) * 100
        : 0,
      will_exceed_budget: totalBestEstimate > totalBudget
    },
    summary: {
      total_categories: projections.length,
      danger_categories: dangerCategories,
      safe_categories: safeCategories
    },
    categories: projections
  };
}

/**
 * Calculate what-if scenario
 * @param {number} year - Year
 * @param {string} categoryName - Category to adjust
 * @param {number} adjustmentPercent - Percentage to reduce (positive) or increase (negative)
 * @returns {Object} Scenario analysis
 */
export function calculateScenario(year, categoryName, adjustmentPercent) {
  const compliance = budgetCalculations.calculateFullCompliance(year);
  const category = compliance.categories.find(c =>
    c.category_name.toLowerCase() === categoryName.toLowerCase()
  );

  if (!category) {
    throw new Error(`Category not found: ${categoryName}`);
  }

  const budget = budgetManager.getBudget(categoryName, year);
  if (!budget) {
    throw new Error(`No budget found for ${categoryName} in ${year}`);
  }

  // Calculate current projection
  const projection = generateCategoryProjection(year, category, budget);
  const currentProjection = projection.best_estimate.projected_year_end;

  // Calculate adjusted projection
  const adjustmentFactor = 1 - (adjustmentPercent / 100);
  const remainingMonths = 12 - (new Date().getMonth() + 1);
  const remainingProjection = currentProjection - category.ytd_spent;
  const adjustedRemainingProjection = remainingProjection * adjustmentFactor;
  const adjustedYearEnd = category.ytd_spent + adjustedRemainingProjection;

  // Calculate savings
  const projectedSavings = currentProjection - adjustedYearEnd;
  const annualizedSavings = (projectedSavings / (12 - remainingMonths)) * 12;

  return {
    category: categoryName,
    adjustment_percent: adjustmentPercent,
    current: {
      ytd_spent: category.ytd_spent,
      projected_year_end: currentProjection,
      budget: budget.annual_amount,
      variance: currentProjection - budget.annual_amount
    },
    adjusted: {
      projected_year_end: adjustedYearEnd,
      variance: adjustedYearEnd - budget.annual_amount,
      will_be_under_budget: adjustedYearEnd <= budget.annual_amount
    },
    impact: {
      monthly_reduction: remainingMonths > 0 ? projectedSavings / remainingMonths : 0,
      projected_savings: projectedSavings,
      annualized_savings: annualizedSavings
    },
    message: adjustmentPercent > 0
      ? `Reducing ${categoryName} by ${adjustmentPercent}% would save $${projectedSavings.toFixed(0)} this year`
      : `Increasing ${categoryName} by ${Math.abs(adjustmentPercent)}% would cost an additional $${Math.abs(projectedSavings).toFixed(0)} this year`
  };
}

/**
 * Detect recurring expenses
 * @param {number} year - Year
 * @returns {Object} Recurring expense analysis
 */
export function detectRecurringExpenses(year) {
  const transactions = database.getTransactions(10000, {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`
  });

  // Group by merchant/description
  const merchantGroups = {};

  for (const txn of transactions) {
    if (txn.amount <= 0) continue; // Skip credits

    const key = (txn.merchant_name || txn.description).toLowerCase().trim();
    if (!merchantGroups[key]) {
      merchantGroups[key] = {
        merchant: txn.merchant_name || txn.description,
        transactions: [],
        amounts: [],
        dates: []
      };
    }

    merchantGroups[key].transactions.push(txn);
    merchantGroups[key].amounts.push(txn.amount);
    merchantGroups[key].dates.push(new Date(txn.date));
  }

  // Analyze each merchant for recurring patterns
  const recurring = [];
  const variable = [];

  for (const [key, group] of Object.entries(merchantGroups)) {
    if (group.transactions.length < 2) continue;

    const amounts = group.amounts;
    const avgAmount = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    const amountCV = coefficientOfVariation(amounts);

    // Calculate average days between transactions
    const dates = group.dates.sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < dates.length; i++) {
      intervals.push((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24));
    }
    const avgInterval = intervals.length > 0
      ? intervals.reduce((sum, i) => sum + i, 0) / intervals.length
      : 0;

    // Determine if recurring (similar amounts, regular intervals)
    const isRecurring = amountCV < 0.3 && avgInterval > 20 && avgInterval < 45;
    const isMonthly = avgInterval >= 25 && avgInterval <= 35;
    const isWeekly = avgInterval >= 5 && avgInterval <= 9;

    const entry = {
      merchant: group.merchant,
      transaction_count: group.transactions.length,
      average_amount: avgAmount,
      total_spent: amounts.reduce((sum, a) => sum + a, 0),
      amount_consistency: (1 - amountCV) * 100,
      average_interval_days: avgInterval,
      frequency: isWeekly ? 'Weekly' : isMonthly ? 'Monthly' : 'Variable',
      is_recurring: isRecurring,
      estimated_annual: isMonthly ? avgAmount * 12 : isWeekly ? avgAmount * 52 : avgAmount * (365 / avgInterval),
      category: group.transactions[0].category
    };

    if (isRecurring) {
      recurring.push(entry);
    } else if (group.transactions.length >= 3) {
      variable.push(entry);
    }
  }

  // Sort by estimated annual cost
  recurring.sort((a, b) => b.estimated_annual - a.estimated_annual);
  variable.sort((a, b) => b.total_spent - a.total_spent);

  const totalRecurring = recurring.reduce((sum, r) => sum + r.estimated_annual, 0);
  const totalVariable = variable.reduce((sum, v) => sum + v.total_spent, 0);

  return {
    year,
    recurring: {
      items: recurring,
      count: recurring.length,
      estimated_annual: totalRecurring,
      estimated_monthly: totalRecurring / 12
    },
    variable: {
      items: variable.slice(0, 20), // Top 20
      count: variable.length,
      ytd_spent: totalVariable
    },
    summary: {
      fixed_percentage: totalRecurring > 0 && totalVariable > 0
        ? (totalRecurring / (totalRecurring + totalVariable)) * 100
        : 0
    }
  };
}

/**
 * Zero-based budgeting helper
 * @param {number} expectedIncome - Total expected annual income
 * @param {number} year - Year
 * @returns {Object} Budget allocation suggestions
 */
export function zeroBudgetHelper(expectedIncome, year) {
  // Standard budget allocation percentages (50/30/20 rule as base)
  const allocationRules = {
    // Needs (50%)
    'Housing': { max_percent: 30, priority: 'Needs' },
    'Utilities': { max_percent: 10, priority: 'Needs' },
    'Groceries': { max_percent: 12, priority: 'Needs' },
    'Transportation': { max_percent: 10, priority: 'Needs' },
    'Healthcare': { max_percent: 5, priority: 'Needs' },
    'Insurance': { max_percent: 5, priority: 'Needs' },

    // Wants (30%)
    'Restaurants': { max_percent: 5, priority: 'Wants' },
    'Entertainment': { max_percent: 5, priority: 'Wants' },
    'Shopping': { max_percent: 5, priority: 'Wants' },
    'Subscriptions': { max_percent: 3, priority: 'Wants' },
    'Travel': { max_percent: 5, priority: 'Wants' },
    'Personal': { max_percent: 5, priority: 'Wants' },

    // Savings (20%)
    'Savings': { max_percent: 10, priority: 'Savings' },
    'Investments': { max_percent: 10, priority: 'Savings' }
  };

  // Get existing categories and spending
  const categories = database.getCategories();
  const spending = database.getYTDSpendingByCategory(year - 1); // Previous year

  const spendingByName = {};
  for (const s of spending) {
    spendingByName[s.category_name] = s.ytd_spent;
  }

  // Build suggestions
  const suggestions = [];
  let totalAllocated = 0;

  for (const category of categories) {
    const rule = allocationRules[category.name];
    const lastYearSpent = spendingByName[category.name] || 0;

    let suggestedAmount;
    let suggestedPercent;
    let source;

    if (rule) {
      // Use rule-based allocation
      suggestedPercent = Math.min(rule.max_percent, (lastYearSpent / expectedIncome) * 100 * 1.1);
      suggestedAmount = (suggestedPercent / 100) * expectedIncome;
      source = 'guideline';
    } else if (lastYearSpent > 0) {
      // Use previous year + 3% inflation
      suggestedAmount = lastYearSpent * 1.03;
      suggestedPercent = (suggestedAmount / expectedIncome) * 100;
      source = 'historical';
    } else {
      continue; // Skip categories with no data
    }

    totalAllocated += suggestedAmount;

    suggestions.push({
      category_id: category.id,
      category_name: category.name,
      priority: rule?.priority || 'Other',
      last_year_spent: lastYearSpent,
      suggested_amount: Math.round(suggestedAmount),
      suggested_percent: suggestedPercent,
      source
    });
  }

  // Calculate unallocated amount
  const unallocated = expectedIncome - totalAllocated;
  const unallocatedPercent = (unallocated / expectedIncome) * 100;

  // Group by priority
  const byPriority = {
    Needs: suggestions.filter(s => s.priority === 'Needs'),
    Wants: suggestions.filter(s => s.priority === 'Wants'),
    Savings: suggestions.filter(s => s.priority === 'Savings'),
    Other: suggestions.filter(s => s.priority === 'Other')
  };

  const priorityTotals = {};
  for (const [priority, items] of Object.entries(byPriority)) {
    priorityTotals[priority] = {
      total: items.reduce((sum, i) => sum + i.suggested_amount, 0),
      percent: items.reduce((sum, i) => sum + i.suggested_percent, 0)
    };
  }

  return {
    expected_income: expectedIncome,
    year,
    suggestions: suggestions.sort((a, b) => b.suggested_amount - a.suggested_amount),
    by_priority: byPriority,
    priority_totals: priorityTotals,
    total_allocated: totalAllocated,
    total_allocated_percent: (totalAllocated / expectedIncome) * 100,
    unallocated: unallocated,
    unallocated_percent: unallocatedPercent,
    balanced: Math.abs(unallocatedPercent) < 5,
    recommendation: unallocated > 0
      ? `You have $${unallocated.toFixed(0)} (${unallocatedPercent.toFixed(1)}%) unallocated. Consider adding to Savings.`
      : unallocated < 0
        ? `You are ${Math.abs(unallocatedPercent).toFixed(1)}% over budget. Consider reducing some categories.`
        : 'Your budget is perfectly balanced!'
  };
}
