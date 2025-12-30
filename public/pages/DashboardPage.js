/**
 * DashboardPage Module
 * Handles all dashboard page functionality including stats, charts, and recent transactions
 */

import { formatCurrency, formatDate, escapeHtml, showLoading, hideLoading } from '../utils/formatters.js';
import { showToast } from '../services/toast.js';
import { createCategoryChart, createLineChart, createBarChart, currencyTooltipFormatter } from '../utils/charts.js';

// Chart instances
let netWorthChartInstance = null;
let dailySpendingChartInstance = null;
let categoryChartInstance = null;
let currentTimeRange = '1w';

// Fetch API helper (will be passed in)
let fetchAPI = null;

export function initializeDashboardPage(fetchFunction) {
    fetchAPI = fetchFunction;
}

export async function loadDashboard() {
    showLoading();
    try {
        const [accounts, transactions, stats] = await Promise.all([
            fetchAPI('/api/accounts'),
            fetchAPI('/api/transactions?limit=10'),
            fetchAPI('/api/stats')
        ]);

        updateDashboardStats(accounts, stats);
        displayRecentTransactions(transactions);
        updateCategoryChart(stats);

        // Load new charts
        await loadNetWorthChart(currentTimeRange);
        await loadDailySpendingChart();

        // Set up time range selector listeners
        setupTimeRangeSelector();
    } catch (error) {
        showToast('Failed to load dashboard', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

function updateDashboardStats(accounts, stats) {
    // Calculate total balance
    const totalBalance = accounts.reduce((sum, acc) => {
        const balance = parseFloat(acc.current_balance) || 0;
        return sum + balance;
    }, 0);

    document.getElementById('totalBalance').textContent = formatCurrency(totalBalance);
    document.getElementById('totalIncome').textContent = formatCurrency(stats.income || 0);
    document.getElementById('totalExpenses').textContent = formatCurrency(Math.abs(stats.expenses || 0));

    const net = (stats.income || 0) + (stats.expenses || 0);
    const netEl = document.getElementById('netIncome');
    netEl.textContent = formatCurrency(net);
    netEl.className = 'stat-value ' + (net >= 0 ? 'positive' : 'negative');
}

function displayRecentTransactions(transactions) {
    const container = document.getElementById('recentTransactions');

    if (!transactions || transactions.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">No transactions yet. Link an account to get started!</p>';
        return;
    }

    container.innerHTML = transactions.slice(0, 5).map(tx => `
        <div class="transaction-item">
            <div class="transaction-info">
                <div class="transaction-name">${escapeHtml(tx.description || tx.name)}</div>
                <div class="transaction-meta">${formatDate(tx.date)} • ${escapeHtml(tx.category || 'Uncategorized')}</div>
            </div>
            <div class="transaction-amount ${parseFloat(tx.amount) > 0 ? 'positive' : 'negative'}">
                ${formatCurrency(tx.amount)}
            </div>
        </div>
    `).join('');
}

function updateCategoryChart(stats) {
    const ctx = document.getElementById('categoryChart');
    if (!ctx || !stats.byCategory || Object.keys(stats.byCategory).length === 0) {
        return;
    }

    const categories = Object.keys(stats.byCategory);
    const amounts = Object.values(stats.byCategory).map(Math.abs);

    // Destroy existing chart if it exists
    if (categoryChartInstance) {
        categoryChartInstance.destroy();
    }

    categoryChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: categories,
            datasets: [{
                data: amounts,
                backgroundColor: [
                    '#4CAF50', '#2196F3', '#FFC107', '#FF5722', '#9C27B0',
                    '#00BCD4', '#FF9800', '#E91E63', '#3F51B5', '#8BC34A'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

async function loadNetWorthChart(timeRange = '1w') {
    try {
        const data = await fetchAPI(`/api/charts/net-worth?range=${timeRange}`);

        if (!data || data.length === 0) {
            return;
        }

        const ctx = document.getElementById('netWorthChart');
        if (!ctx) return;

        // Destroy existing chart
        if (netWorthChartInstance) {
            netWorthChartInstance.destroy();
        }

        const labels = data.map(d => formatDate(d.date));
        const balances = data.map(d => d.balance);

        netWorthChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Net Worth',
                    data: balances,
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'Net Worth: ' + formatCurrency(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: {
                            callback: function(value) {
                                return formatCurrency(value);
                            }
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error loading net worth chart:', error);
    }
}

async function loadDailySpendingChart() {
    try {
        const data = await fetchAPI('/api/charts/daily-spending-income?days=30');

        if (!data || data.length === 0) {
            return;
        }

        const ctx = document.getElementById('dailySpendingChart');
        if (!ctx) return;

        // Destroy existing chart
        if (dailySpendingChartInstance) {
            dailySpendingChartInstance.destroy();
        }

        const labels = data.map(d => formatDate(d.date));
        const income = data.map(d => d.income);
        const expenses = data.map(d => d.expenses);

        dailySpendingChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Income',
                        data: income,
                        backgroundColor: '#4CAF50',
                        borderRadius: 4
                    },
                    {
                        label: 'Expenses',
                        data: expenses,
                        backgroundColor: '#FF5722',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'top'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return formatCurrency(value);
                            }
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error loading daily spending chart:', error);
    }
}

function setupTimeRangeSelector() {
    const buttons = document.querySelectorAll('.time-range-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', async function() {
            // Remove active class from all buttons
            buttons.forEach(b => b.classList.remove('active'));

            // Add active class to clicked button
            this.classList.add('active');

            // Get the time range
            const range = this.getAttribute('data-range');
            currentTimeRange = range;

            // Reload the net worth chart
            await loadNetWorthChart(range);
        });
    });
}

export default {
    initializeDashboardPage,
    loadDashboard
};
