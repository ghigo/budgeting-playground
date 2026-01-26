/**
 * BudgetingPage Module
 * Handles budget management, income tracking, compliance monitoring, and projections
 */

import { formatCurrency, formatDate, escapeHtml } from '../utils/formatters.js';
import { showToast } from '../services/toast.js';
import { withLoadingState } from '../utils/helpers.js';

// Dependencies passed in from app.js
let fetchAPI = null;
let navigateTo = null;

// Current state
let currentYear = new Date().getFullYear();
let currentTab = 'overview';
let budgetChartInstance = null;
let complianceChartInstance = null;
let incomeChartInstance = null;

// Income types
const INCOME_TYPES = ['Salary', 'Freelance', 'Investment', 'Other'];

/**
 * Initialize the budgeting page module
 */
export function initializeBudgetingPage(deps) {
    fetchAPI = deps.fetchAPI;
    navigateTo = deps.navigateTo;
}

/**
 * Load the budgeting page
 */
export async function loadBudgetingPage() {
    return withLoadingState(async () => {
        // Set up year selector
        setupYearSelector();

        // Set up tab navigation
        setupTabNavigation();

        // Load the active tab content
        await loadTabContent(currentTab);
    }, 'Failed to load budgeting page');
}

/**
 * Set up year selector
 */
function setupYearSelector() {
    const selector = document.getElementById('budgetYearSelector');
    if (!selector) return;

    // Generate years (current year ± 2)
    const years = [];
    for (let y = currentYear - 2; y <= currentYear + 1; y++) {
        years.push(y);
    }

    selector.innerHTML = years.map(y =>
        `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`
    ).join('');

    selector.onchange = async (e) => {
        currentYear = parseInt(e.target.value);
        await loadTabContent(currentTab);
    };
}

/**
 * Set up tab navigation
 */
function setupTabNavigation() {
    const tabs = document.querySelectorAll('.budget-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', async (e) => {
            e.preventDefault();
            const tabName = tab.dataset.tab;

            // Update active state
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Load tab content
            currentTab = tabName;
            await loadTabContent(tabName);
        });
    });
}

/**
 * Load tab content
 */
async function loadTabContent(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.budget-tab-content').forEach(content => {
        content.style.display = 'none';
    });

    // Show active tab content
    const activeContent = document.getElementById(`budget-${tabName}`);
    if (activeContent) {
        activeContent.style.display = 'block';
    }

    // Load data based on tab
    switch (tabName) {
        case 'overview':
            await loadOverview();
            break;
        case 'budgets':
            await loadBudgets();
            break;
        case 'income':
            await loadIncome();
            break;
        case 'projections':
            await loadProjections();
            break;
    }
}

/**
 * Load overview tab
 */
async function loadOverview() {
    try {
        const [compliance, savings, alerts] = await Promise.all([
            fetchAPI(`/api/budgets/compliance?year=${currentYear}`),
            fetchAPI(`/api/budgets/savings?year=${currentYear}`),
            fetchAPI(`/api/budgets/alerts?year=${currentYear}`)
        ]);

        // Update summary stats
        updateOverviewStats(compliance, savings);

        // Update alerts
        displayAlerts(alerts);

        // Update compliance chart
        updateComplianceChart(compliance);

    } catch (error) {
        console.error('Error loading overview:', error);
        showToast('Failed to load budget overview', 'error');
    }
}

/**
 * Update overview stats display
 */
function updateOverviewStats(compliance, savings) {
    const overall = compliance.overall;

    // Total budget
    const totalBudgetEl = document.getElementById('totalBudget');
    if (totalBudgetEl) {
        totalBudgetEl.textContent = formatCurrency(overall.total_budget);
    }

    // Total spent
    const totalSpentEl = document.getElementById('totalSpentBudget');
    if (totalSpentEl) {
        totalSpentEl.textContent = formatCurrency(overall.total_spent);
    }

    // Remaining
    const remainingEl = document.getElementById('remainingBudget');
    if (remainingEl) {
        remainingEl.textContent = formatCurrency(overall.remaining);
        remainingEl.className = 'stat-value ' + (overall.remaining >= 0 ? 'positive' : 'negative');
    }

    // Savings rate
    const savingsRateEl = document.getElementById('savingsRate');
    if (savingsRateEl) {
        savingsRateEl.textContent = savings.savings_rate.toFixed(1) + '%';
        savingsRateEl.className = 'stat-value ' + (savings.is_positive ? 'positive' : 'negative');
    }

    // Progress bar
    const progressEl = document.getElementById('budgetProgress');
    if (progressEl) {
        const usedPct = Math.min(100, overall.used_percentage);
        progressEl.style.width = usedPct + '%';
        progressEl.className = 'progress-bar ' + getStatusColor(overall.status);
    }

    const progressText = document.getElementById('budgetProgressText');
    if (progressText) {
        progressText.textContent = `${overall.used_percentage.toFixed(1)}% of budget used (${compliance.yearProgress.percentage.toFixed(1)}% of year elapsed)`;
    }
}

/**
 * Get status color class
 */
function getStatusColor(status) {
    switch (status) {
        case 'UNDER': return 'status-under';
        case 'WARNING': return 'status-warning';
        case 'CRITICAL': return 'status-critical';
        case 'OVER': return 'status-over';
        default: return '';
    }
}

/**
 * Display budget alerts
 */
function displayAlerts(alerts) {
    const container = document.getElementById('budgetAlerts');
    if (!container) return;

    if (!alerts || alerts.length === 0) {
        container.innerHTML = `
            <div class="alert-item alert-success">
                <span class="alert-icon">✓</span>
                <span>All categories are within budget!</span>
            </div>
        `;
        return;
    }

    container.innerHTML = alerts.map(alert => `
        <div class="alert-item alert-${alert.status.toLowerCase()}">
            <span class="alert-icon">${getStatusIcon(alert.status)}</span>
            <span>${escapeHtml(alert.message)}</span>
        </div>
    `).join('');
}

/**
 * Get status icon
 */
function getStatusIcon(status) {
    switch (status) {
        case 'WARNING': return '⚠️';
        case 'CRITICAL': return '🔴';
        case 'OVER': return '❌';
        default: return '✓';
    }
}

/**
 * Update compliance chart
 */
function updateComplianceChart(compliance) {
    const ctx = document.getElementById('complianceChart');
    if (!ctx) return;

    // Destroy existing chart
    if (complianceChartInstance) {
        complianceChartInstance.destroy();
    }

    const categories = compliance.categories.slice(0, 10); // Top 10

    complianceChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: categories.map(c => c.category_name),
            datasets: [
                {
                    label: 'Spent',
                    data: categories.map(c => c.ytd_spent),
                    backgroundColor: categories.map(c => getStatusChartColor(c.status)),
                    borderRadius: 4
                },
                {
                    label: 'Budget',
                    data: categories.map(c => c.annual_budget),
                    backgroundColor: 'rgba(156, 163, 175, 0.3)',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: 'y',
            plugins: {
                legend: {
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + formatCurrency(context.parsed.x);
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                }
            }
        }
    });
}

/**
 * Get chart color for status
 */
function getStatusChartColor(status) {
    switch (status) {
        case 'UNDER': return '#22c55e';
        case 'WARNING': return '#f59e0b';
        case 'CRITICAL': return '#ef4444';
        case 'OVER': return '#dc2626';
        default: return '#6b7280';
    }
}

/**
 * Load budgets tab
 */
async function loadBudgets() {
    try {
        const [budgets, categories, suggestions] = await Promise.all([
            fetchAPI(`/api/budgets?year=${currentYear}`),
            fetchAPI('/api/categories'),
            fetchAPI(`/api/budgets/suggest?year=${currentYear}`)
        ]);

        // Populate category dropdown
        populateCategoryDropdown(categories, budgets);

        // Display budgets
        displayBudgets(budgets);

        // Display suggestions if no budgets
        if (budgets.length === 0 && suggestions.length > 0) {
            displayBudgetSuggestions(suggestions);
        }

    } catch (error) {
        console.error('Error loading budgets:', error);
        showToast('Failed to load budgets', 'error');
    }
}

/**
 * Populate category dropdown
 */
function populateCategoryDropdown(categories, existingBudgets) {
    const select = document.getElementById('budgetCategorySelect');
    if (!select) return;

    // Get IDs of categories that already have budgets
    const budgetedCategoryIds = new Set(existingBudgets.map(b => b.category_id));

    // Filter to categories without budgets
    const availableCategories = categories.filter(c => !budgetedCategoryIds.has(c.id));

    select.innerHTML = `
        <option value="">Select a category...</option>
        ${availableCategories.map(c =>
            `<option value="${c.id}">${escapeHtml(c.name)}</option>`
        ).join('')}
    `;
}

/**
 * Display budgets list
 */
function displayBudgets(budgets) {
    const container = document.getElementById('budgetsList');
    if (!container) return;

    if (budgets.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No budgets set for ${currentYear}.</p>
                <p>Add budgets using the form above, or use suggestions based on last year's spending.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <table class="budgets-table">
            <thead>
                <tr>
                    <th>Category</th>
                    <th>Annual Budget</th>
                    <th>Monthly</th>
                    <th>Notes</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${budgets.map(budget => `
                    <tr>
                        <td>${escapeHtml(budget.category_name)}</td>
                        <td>
                            <input type="number"
                                   class="budget-amount-input"
                                   value="${budget.annual_amount}"
                                   data-budget-id="${budget.id}"
                                   data-original="${budget.annual_amount}"
                                   onchange="handleBudgetAmountChange(this)">
                        </td>
                        <td class="text-muted">${formatCurrency(budget.annual_amount / 12)}/mo</td>
                        <td>
                            <input type="text"
                                   class="budget-notes-input"
                                   value="${escapeHtml(budget.notes || '')}"
                                   placeholder="Add notes..."
                                   data-budget-id="${budget.id}"
                                   onchange="handleBudgetNotesChange(this)">
                        </td>
                        <td>
                            <button class="btn btn-small btn-secondary" onclick="showBudgetHistory('${budget.id}')">History</button>
                            <button class="btn btn-small btn-danger" onclick="deleteBudget('${budget.id}')">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

/**
 * Display budget suggestions
 */
function displayBudgetSuggestions(suggestions) {
    const container = document.getElementById('budgetSuggestions');
    if (!container) return;

    container.style.display = 'block';
    container.innerHTML = `
        <h4>Budget Suggestions Based on Last Year's Spending</h4>
        <div class="suggestions-list">
            ${suggestions.map(s => `
                <div class="suggestion-item">
                    <span class="suggestion-category">${escapeHtml(s.category_name)}</span>
                    <span class="suggestion-amount">${formatCurrency(s.suggested_amount)}/year</span>
                    <button class="btn btn-small btn-primary" onclick="applySuggestion(${s.category_id}, ${s.suggested_amount})">
                        Add Budget
                    </button>
                </div>
            `).join('')}
        </div>
        <button class="btn btn-primary" onclick="applyAllSuggestions()" style="margin-top: 1rem;">
            Apply All Suggestions
        </button>
    `;
}

/**
 * Add a new budget
 */
async function addBudget() {
    const categoryId = document.getElementById('budgetCategorySelect').value;
    const amount = parseFloat(document.getElementById('budgetAmountInput').value);
    const notes = document.getElementById('budgetNotesInput').value;

    if (!categoryId || !amount) {
        showToast('Please select a category and enter an amount', 'error');
        return;
    }

    try {
        await fetchAPI('/api/budgets', {
            method: 'POST',
            body: JSON.stringify({
                category_id: parseInt(categoryId),
                year: currentYear,
                annual_amount: amount,
                notes
            })
        });

        showToast('Budget added successfully', 'success');

        // Clear form
        document.getElementById('budgetCategorySelect').value = '';
        document.getElementById('budgetAmountInput').value = '';
        document.getElementById('budgetNotesInput').value = '';

        // Reload budgets
        await loadBudgets();

    } catch (error) {
        console.error('Error adding budget:', error);
        showToast('Failed to add budget: ' + error.message, 'error');
    }
}

/**
 * Handle budget amount change
 */
async function handleBudgetAmountChange(input) {
    const budgetId = input.dataset.budgetId;
    const newAmount = parseFloat(input.value);
    const originalAmount = parseFloat(input.dataset.original);

    if (newAmount === originalAmount) return;

    const reason = prompt('Reason for budget change (optional):');

    try {
        await fetchAPI(`/api/budgets/${budgetId}`, {
            method: 'PUT',
            body: JSON.stringify({
                annual_amount: newAmount,
                reason
            })
        });

        input.dataset.original = newAmount;
        showToast('Budget updated', 'success');

    } catch (error) {
        console.error('Error updating budget:', error);
        input.value = originalAmount;
        showToast('Failed to update budget', 'error');
    }
}

/**
 * Handle budget notes change
 */
async function handleBudgetNotesChange(input) {
    const budgetId = input.dataset.budgetId;
    const notes = input.value;

    try {
        await fetchAPI(`/api/budgets/${budgetId}`, {
            method: 'PUT',
            body: JSON.stringify({ notes })
        });

        showToast('Notes updated', 'success');

    } catch (error) {
        console.error('Error updating notes:', error);
        showToast('Failed to update notes', 'error');
    }
}

/**
 * Delete a budget
 */
async function deleteBudget(budgetId) {
    if (!confirm('Are you sure you want to delete this budget?')) return;

    try {
        await fetchAPI(`/api/budgets/${budgetId}`, { method: 'DELETE' });
        showToast('Budget deleted', 'success');
        await loadBudgets();

    } catch (error) {
        console.error('Error deleting budget:', error);
        showToast('Failed to delete budget', 'error');
    }
}

/**
 * Show budget history modal
 */
async function showBudgetHistory(budgetId) {
    try {
        const history = await fetchAPI(`/api/budgets/${budgetId}/history`);

        const modal = document.getElementById('budgetHistoryModal');
        const content = document.getElementById('budgetHistoryContent');

        if (history.length === 0) {
            content.innerHTML = '<p>No adjustments recorded for this budget.</p>';
        } else {
            content.innerHTML = `
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Previous</th>
                            <th>New</th>
                            <th>Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${history.map(h => `
                            <tr>
                                <td>${formatDate(h.adjusted_at)}</td>
                                <td>${formatCurrency(h.previous_amount)}</td>
                                <td>${formatCurrency(h.new_amount)}</td>
                                <td>${escapeHtml(h.reason || '-')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        modal.style.display = 'flex';

    } catch (error) {
        console.error('Error fetching budget history:', error);
        showToast('Failed to load budget history', 'error');
    }
}

/**
 * Close budget history modal
 */
function closeBudgetHistoryModal() {
    const modal = document.getElementById('budgetHistoryModal');
    if (modal) modal.style.display = 'none';
}

/**
 * Apply a single budget suggestion
 */
async function applySuggestion(categoryId, amount) {
    try {
        await fetchAPI('/api/budgets', {
            method: 'POST',
            body: JSON.stringify({
                category_id: categoryId,
                year: currentYear,
                annual_amount: amount,
                notes: 'Based on previous year spending'
            })
        });

        showToast('Budget added', 'success');
        await loadBudgets();

    } catch (error) {
        console.error('Error applying suggestion:', error);
        showToast('Failed to add budget', 'error');
    }
}

/**
 * Apply all budget suggestions
 */
async function applyAllSuggestions() {
    try {
        const suggestions = await fetchAPI(`/api/budgets/suggest?year=${currentYear}`);

        for (const suggestion of suggestions) {
            await fetchAPI('/api/budgets', {
                method: 'POST',
                body: JSON.stringify({
                    category_id: suggestion.category_id,
                    year: currentYear,
                    annual_amount: suggestion.suggested_amount,
                    notes: 'Based on previous year spending'
                })
            });
        }

        showToast(`Added ${suggestions.length} budgets`, 'success');
        await loadBudgets();

    } catch (error) {
        console.error('Error applying suggestions:', error);
        showToast('Failed to apply suggestions', 'error');
    }
}

/**
 * Clone budgets from another year
 */
async function cloneBudgets() {
    const sourceYear = parseInt(document.getElementById('cloneSourceYear').value);
    const adjustmentPct = parseFloat(document.getElementById('cloneAdjustment').value) || 0;

    if (!sourceYear) {
        showToast('Please select a source year', 'error');
        return;
    }

    try {
        const result = await fetchAPI('/api/budgets/clone', {
            method: 'POST',
            body: JSON.stringify({
                source_year: sourceYear,
                target_year: currentYear,
                adjustment_percent: adjustmentPct
            })
        });

        showToast(`Cloned ${result.created} budgets from ${sourceYear}`, 'success');
        await loadBudgets();

    } catch (error) {
        console.error('Error cloning budgets:', error);
        showToast('Failed to clone budgets: ' + error.message, 'error');
    }
}

/**
 * Load income tab
 */
async function loadIncome() {
    try {
        const [transactions, analysis, budgets] = await Promise.all([
            fetchAPI(`/api/income?year=${currentYear}`),
            fetchAPI(`/api/income/analysis?year=${currentYear}`),
            fetchAPI(`/api/income/budgets?year=${currentYear}`)
        ]);

        // Update income stats
        updateIncomeStats(analysis);

        // Display income transactions
        displayIncomeTransactions(transactions);

        // Display expected income budgets
        displayIncomeBudgets(budgets);

        // Update income chart
        updateIncomeChart(analysis);

    } catch (error) {
        console.error('Error loading income:', error);
        showToast('Failed to load income data', 'error');
    }
}

/**
 * Update income stats
 */
function updateIncomeStats(analysis) {
    const actualEl = document.getElementById('actualIncome');
    if (actualEl) {
        actualEl.textContent = formatCurrency(analysis.actual.total);
    }

    const expectedEl = document.getElementById('expectedIncome');
    if (expectedEl) {
        expectedEl.textContent = formatCurrency(analysis.expected.total);
    }

    const varianceEl = document.getElementById('incomeVariance');
    if (varianceEl) {
        varianceEl.textContent = formatCurrency(analysis.variance.toDate);
        varianceEl.className = 'stat-value ' + (analysis.variance.toDate >= 0 ? 'positive' : 'negative');
    }

    const projectionEl = document.getElementById('incomeProjection');
    if (projectionEl) {
        projectionEl.textContent = formatCurrency(analysis.projection.yearEnd);
    }
}

/**
 * Display income transactions
 */
function displayIncomeTransactions(transactions) {
    const container = document.getElementById('incomeTransactions');
    if (!container) return;

    if (transactions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No income recorded for ${currentYear}.</p>
                <p>Add income transactions using the form above.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <table class="income-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Source</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Description</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${transactions.map(txn => `
                    <tr>
                        <td>${formatDate(txn.date)}</td>
                        <td>${escapeHtml(txn.source)}</td>
                        <td><span class="badge badge-${txn.type.toLowerCase()}">${txn.type}</span></td>
                        <td class="positive">${formatCurrency(txn.amount)}</td>
                        <td>${escapeHtml(txn.description || '-')}</td>
                        <td>
                            <button class="btn btn-small btn-danger" onclick="deleteIncome('${txn.id}')">Delete</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

/**
 * Display expected income budgets
 */
function displayIncomeBudgets(budgets) {
    const container = document.getElementById('expectedIncomeBudgets');
    if (!container) return;

    if (budgets.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No expected income set for ${currentYear}.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <table class="income-budgets-table">
            <thead>
                <tr>
                    <th>Source</th>
                    <th>Type</th>
                    <th>Annual Expected</th>
                    <th>Monthly</th>
                    <th>Notes</th>
                </tr>
            </thead>
            <tbody>
                ${budgets.map(b => `
                    <tr>
                        <td>${escapeHtml(b.source)}</td>
                        <td><span class="badge badge-${b.type.toLowerCase()}">${b.type}</span></td>
                        <td>${formatCurrency(b.annual_expected)}</td>
                        <td class="text-muted">${formatCurrency(b.annual_expected / 12)}/mo</td>
                        <td>${escapeHtml(b.notes || '-')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

/**
 * Update income chart
 */
function updateIncomeChart(analysis) {
    const ctx = document.getElementById('incomeChart');
    if (!ctx) return;

    if (incomeChartInstance) {
        incomeChartInstance.destroy();
    }

    const monthlyData = analysis.actual.monthly || [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Fill in missing months with 0
    const incomeByMonth = {};
    monthlyData.forEach(m => {
        incomeByMonth[parseInt(m.month)] = m.total;
    });

    const data = months.map((_, i) => incomeByMonth[i + 1] || 0);

    incomeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [{
                label: 'Income',
                data: data,
                backgroundColor: '#22c55e',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => formatCurrency(ctx.parsed.y)
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: value => formatCurrency(value)
                    }
                }
            }
        }
    });
}

/**
 * Add income transaction
 */
async function addIncome() {
    const date = document.getElementById('incomeDate').value;
    const amount = parseFloat(document.getElementById('incomeAmount').value);
    const source = document.getElementById('incomeSource').value;
    const type = document.getElementById('incomeType').value;
    const description = document.getElementById('incomeDescription').value;

    if (!date || !amount || !source || !type) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        await fetchAPI('/api/income', {
            method: 'POST',
            body: JSON.stringify({ date, amount, source, type, description })
        });

        showToast('Income added successfully', 'success');

        // Clear form
        document.getElementById('incomeDate').value = '';
        document.getElementById('incomeAmount').value = '';
        document.getElementById('incomeSource').value = '';
        document.getElementById('incomeDescription').value = '';

        // Reload income
        await loadIncome();

    } catch (error) {
        console.error('Error adding income:', error);
        showToast('Failed to add income: ' + error.message, 'error');
    }
}

/**
 * Delete income transaction
 */
async function deleteIncome(incomeId) {
    if (!confirm('Are you sure you want to delete this income record?')) return;

    try {
        await fetchAPI(`/api/income/${incomeId}`, { method: 'DELETE' });
        showToast('Income deleted', 'success');
        await loadIncome();

    } catch (error) {
        console.error('Error deleting income:', error);
        showToast('Failed to delete income', 'error');
    }
}

/**
 * Set expected income
 */
async function setExpectedIncome() {
    const source = document.getElementById('expectedSource').value;
    const type = document.getElementById('expectedType').value;
    const amount = parseFloat(document.getElementById('expectedAmount').value);
    const notes = document.getElementById('expectedNotes').value;

    if (!source || !type || !amount) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        await fetchAPI('/api/income/budgets', {
            method: 'POST',
            body: JSON.stringify({
                source,
                type,
                year: currentYear,
                annual_expected: amount,
                notes
            })
        });

        showToast('Expected income set', 'success');

        // Clear form
        document.getElementById('expectedSource').value = '';
        document.getElementById('expectedAmount').value = '';
        document.getElementById('expectedNotes').value = '';

        // Reload income
        await loadIncome();

    } catch (error) {
        console.error('Error setting expected income:', error);
        showToast('Failed to set expected income: ' + error.message, 'error');
    }
}

/**
 * Load projections tab
 */
async function loadProjections() {
    try {
        const [projections, recurring] = await Promise.all([
            fetchAPI(`/api/projections?year=${currentYear}`),
            fetchAPI(`/api/projections/recurring?year=${currentYear}`)
        ]);

        // Display projections
        displayProjections(projections);

        // Display recurring expenses
        displayRecurringExpenses(recurring);

    } catch (error) {
        console.error('Error loading projections:', error);
        showToast('Failed to load projections', 'error');
    }
}

/**
 * Display projections
 */
function displayProjections(projections) {
    const container = document.getElementById('projectionsTable');
    if (!container) return;

    if (!projections.projections || projections.projections.length === 0) {
        container.innerHTML = '<p>No projection data available.</p>';
        return;
    }

    container.innerHTML = `
        <table class="projections-table">
            <thead>
                <tr>
                    <th>Category</th>
                    <th>Current Spending</th>
                    <th>Linear Projection</th>
                    <th>Trend Projection</th>
                    <th>Budget</th>
                    <th>Projected Variance</th>
                    <th>Confidence</th>
                </tr>
            </thead>
            <tbody>
                ${projections.projections.map(p => {
                    const variance = p.linear_projection - (p.annual_budget || 0);
                    const varianceClass = variance > 0 ? 'negative' : 'positive';
                    return `
                        <tr>
                            <td>${escapeHtml(p.category_name)}</td>
                            <td>${formatCurrency(p.ytd_spent)}</td>
                            <td>${formatCurrency(p.linear_projection)}</td>
                            <td>${formatCurrency(p.trend_projection)}</td>
                            <td>${p.annual_budget ? formatCurrency(p.annual_budget) : '-'}</td>
                            <td class="${varianceClass}">${p.annual_budget ? formatCurrency(variance) : '-'}</td>
                            <td>
                                <div class="confidence-bar">
                                    <div class="confidence-fill" style="width: ${p.confidence * 100}%"></div>
                                </div>
                                <span class="confidence-text">${(p.confidence * 100).toFixed(0)}%</span>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

/**
 * Display recurring expenses
 */
function displayRecurringExpenses(recurring) {
    const container = document.getElementById('recurringExpenses');
    if (!container) return;

    if (!recurring.fixed || recurring.fixed.length === 0) {
        container.innerHTML = '<p>No recurring expenses detected.</p>';
        return;
    }

    container.innerHTML = `
        <h4>Fixed Costs (Subscriptions & Regular Bills)</h4>
        <div class="recurring-list">
            ${recurring.fixed.slice(0, 10).map(item => `
                <div class="recurring-item">
                    <span class="recurring-name">${escapeHtml(item.merchant_name || item.description)}</span>
                    <span class="recurring-amount">${formatCurrency(item.avg_amount)}/mo</span>
                    <span class="recurring-frequency">${item.occurrences}x in ${currentYear}</span>
                </div>
            `).join('')}
        </div>

        <div class="recurring-summary">
            <p>Total Monthly Fixed Costs: <strong>${formatCurrency(recurring.fixed.reduce((sum, i) => sum + i.avg_amount, 0))}</strong></p>
            <p>Annualized: <strong>${formatCurrency(recurring.fixed.reduce((sum, i) => sum + i.avg_amount * 12, 0))}</strong></p>
        </div>
    `;
}

/**
 * Run scenario test
 */
async function runScenario() {
    const adjustmentsText = document.getElementById('scenarioAdjustments').value;

    let adjustments = {};
    try {
        adjustments = JSON.parse(adjustmentsText || '{}');
    } catch (e) {
        showToast('Invalid JSON format for adjustments', 'error');
        return;
    }

    try {
        const result = await fetchAPI('/api/projections/scenario', {
            method: 'POST',
            body: JSON.stringify({
                year: currentYear,
                adjustments
            })
        });

        // Display scenario results
        const container = document.getElementById('scenarioResults');
        container.innerHTML = `
            <div class="scenario-result">
                <h4>Scenario Results</h4>
                <p>Original Total: ${formatCurrency(result.original.total)}</p>
                <p>Adjusted Total: ${formatCurrency(result.adjusted.total)}</p>
                <p>Savings: ${formatCurrency(result.savings)}</p>
            </div>
        `;

    } catch (error) {
        console.error('Error running scenario:', error);
        showToast('Failed to run scenario', 'error');
    }
}

// Export functions for global access
export default {
    initializeBudgetingPage,
    loadBudgetingPage
};

// Expose functions to window for onclick handlers
window.addBudget = addBudget;
window.handleBudgetAmountChange = handleBudgetAmountChange;
window.handleBudgetNotesChange = handleBudgetNotesChange;
window.deleteBudget = deleteBudget;
window.showBudgetHistory = showBudgetHistory;
window.closeBudgetHistoryModal = closeBudgetHistoryModal;
window.applySuggestion = applySuggestion;
window.applyAllSuggestions = applyAllSuggestions;
window.cloneBudgets = cloneBudgets;
window.addIncome = addIncome;
window.deleteIncome = deleteIncome;
window.setExpectedIncome = setExpectedIncome;
window.runScenario = runScenario;
