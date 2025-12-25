// API Base URL
const API_URL = '';

// State
let plaidHandler = null;
let currentPage = 'dashboard';

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupEventListeners();
    checkEnvironment();
    loadDashboard();
});

// Navigation
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            navigateTo(page);
        });
    });
}

function navigateTo(page) {
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === page) {
            item.classList.add('active');
        }
    });

    // Update page display
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
    });
    document.getElementById(`${page}-page`).classList.add('active');

    currentPage = page;

    // Load page data
    switch(page) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'accounts':
            loadAccounts();
            break;
        case 'transactions':
            loadTransactions();
            break;
        case 'categories':
            loadCategories();
            break;
    }
}

// Event Listeners
function setupEventListeners() {
    document.getElementById('linkAccountBtn').addEventListener('click', initiatePlaidLink);
    document.getElementById('syncBtn').addEventListener('click', syncTransactions);
    document.getElementById('backfillBtn').addEventListener('click', backfillHistoricalTransactions);
    document.getElementById('addCategoryBtn').addEventListener('click', addCategory);
}

// Dashboard
let netWorthChartInstance = null;
let dailySpendingChartInstance = null;
let categoryChartInstance = null;
let currentTimeRange = '1w';

async function loadDashboard() {
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

// Accounts
async function loadAccounts() {
    showLoading();
    try {
        const [accounts, institutions] = await Promise.all([
            fetchAPI('/api/accounts'),
            fetchAPI('/api/institutions')
        ]);
        displayInstitutions(institutions);
        displayAccounts(accounts);
    } catch (error) {
        showToast('Failed to load accounts', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

function displayInstitutions(institutions) {
    const container = document.getElementById('institutionsList');

    if (!institutions || institutions.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">No institutions connected yet.</p>';
        return;
    }

    container.innerHTML = institutions.map(inst => `
        <div class="institution-item">
            <div class="institution-info">
                <div class="institution-name">🏦 ${escapeHtml(inst.institution_name)}</div>
                <div class="institution-meta">Last synced: ${inst.last_synced_at ? formatDate(inst.last_synced_at) : 'Never'}</div>
            </div>
            <button class="btn-icon btn-danger" onclick="removeInstitution('${inst.item_id}', '${escapeHtml(inst.institution_name)}')" title="Remove institution">
                🗑️
            </button>
        </div>
    `).join('');
}

function displayAccounts(accounts) {
    const container = document.getElementById('accountsList');

    if (!accounts || accounts.length === 0) {
        container.innerHTML = `
            <div class="card centered">
                <p>No accounts connected yet.</p>
                <button onclick="navigateTo('link')" class="btn btn-primary" style="margin-top: 1rem;">Link Your First Account</button>
            </div>
        `;
        return;
    }

    container.innerHTML = accounts.map(acc => `
        <div class="account-card">
            <div class="account-header">
                <div>
                    <div class="account-name">${escapeHtml(acc.name)}</div>
                    <div class="account-type">${escapeHtml(acc.type)}</div>
                </div>
                <div style="font-size: 2rem;">🏦</div>
            </div>
            <div class="account-balance">${formatCurrency(acc.current_balance || 0)}</div>
            <div class="account-institution">
                ${escapeHtml(acc.institution_name || acc.institution)} ${acc.mask ? `••${acc.mask}` : ''}
            </div>
        </div>
    `).join('');
}

async function removeInstitution(itemId, institutionName) {
    if (!confirm(`Are you sure you want to remove ${institutionName}?\n\nThis will permanently delete:\n• The institution\n• All associated accounts\n• All associated transactions\n\nThis action cannot be undone.`)) {
        return;
    }

    showLoading();

    try {
        const result = await fetchAPI(`/api/institutions/${itemId}`, {
            method: 'DELETE'
        });

        showToast(`${result.institution} removed successfully! Deleted ${result.accountsRemoved} account(s) and ${result.transactionsRemoved} transaction(s).`, 'success');

        // Reload the accounts page
        loadAccounts();
    } catch (error) {
        showToast('Failed to remove institution: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

// Transactions
let allCategories = [];

async function loadTransactions() {
    showLoading();
    try {
        const [transactions, categories] = await Promise.all([
            fetchAPI('/api/transactions?limit=100'),
            fetchAPI('/api/categories')
        ]);
        allCategories = categories;
        displayTransactionsTable(transactions);
    } catch (error) {
        showToast('Failed to load transactions', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

function displayTransactionsTable(transactions) {
    const tbody = document.getElementById('transactionsTableBody');

    if (!transactions || transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No transactions found</td></tr>';
        return;
    }

    tbody.innerHTML = transactions.map(tx => `
        <tr>
            <td>${formatDate(tx.date)}</td>
            <td>${escapeHtml(tx.description || tx.name)}</td>
            <td>
                <select class="category-select" data-transaction-id="${tx.transaction_id}" onchange="updateTransactionCategory(this)">
                    <option value="">Uncategorized</option>
                    ${allCategories.map(cat => `
                        <option value="${escapeHtml(cat.name)}" ${cat.name === tx.category ? 'selected' : ''}>
                            ${escapeHtml(cat.name)}${cat.parent_category ? ` (${cat.parent_category})` : ''}
                        </option>
                    `).join('')}
                </select>
            </td>
            <td>${escapeHtml(tx.account_name || 'Unknown')}</td>
            <td class="amount-cell ${parseFloat(tx.amount) > 0 ? 'positive' : 'negative'}">
                ${formatCurrency(tx.amount)}
            </td>
        </tr>
    `).join('');
}

async function updateTransactionCategory(selectElement) {
    const transactionId = selectElement.getAttribute('data-transaction-id');
    const newCategory = selectElement.value;

    try {
        await fetchAPI(`/api/transactions/${transactionId}/category`, {
            method: 'PATCH',
            body: JSON.stringify({ category: newCategory })
        });
        showToast('Category updated successfully', 'success');
    } catch (error) {
        showToast('Failed to update category: ' + error.message, 'error');
        console.error(error);
        // Revert the select on error
        loadTransactions();
    }
}

// Categories
let categorySpendingChartInstance = null;

async function loadCategories() {
    showLoading();
    try {
        const [categories, spending] = await Promise.all([
            fetchAPI('/api/categories'),
            fetchAPI('/api/categories/spending')
        ]);

        populateCategoryParentDropdown(categories);
        displayCategories(categories, spending);
        displayCategorySpendingChart(spending);
    } catch (error) {
        showToast('Failed to load categories', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

function populateCategoryParentDropdown(categories) {
    const select = document.getElementById('newCategoryParent');
    const topLevelCategories = categories.filter(cat => !cat.parent_category);

    select.innerHTML = '<option value="">No parent (top-level category)</option>' +
        topLevelCategories.map(cat => `
            <option value="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</option>
        `).join('');
}

function displayCategories(categories, spending) {
    const container = document.getElementById('categoriesList');

    if (!categories || categories.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">No categories yet. Add one above!</p>';
        return;
    }

    // Group by parent category
    const topLevel = categories.filter(cat => !cat.parent_category);
    const children = categories.filter(cat => cat.parent_category);

    const spendingMap = {};
    spending.categories.forEach(cat => {
        spendingMap[cat.name] = cat;
    });

    let html = '<div class="categories-tree">';

    topLevel.forEach(cat => {
        const catSpending = spendingMap[cat.name] || { total: 0, count: 0 };
        const childCats = children.filter(c => c.parent_category === cat.name);

        html += `
            <div class="category-item ${childCats.length > 0 ? 'has-children' : ''}">
                <div class="category-row">
                    <div class="category-info">
                        <span class="category-name">${escapeHtml(cat.name)}</span>
                        <span class="category-stats">${catSpending.count} transactions · ${formatCurrency(catSpending.total)}</span>
                    </div>
                    <button class="btn-icon btn-danger" onclick="deleteCategory('${escapeHtml(cat.name)}')" title="Delete category">🗑️</button>
                </div>
        `;

        if (childCats.length > 0) {
            html += '<div class="category-children">';
            childCats.forEach(child => {
                const childSpending = spendingMap[child.name] || { total: 0, count: 0 };
                html += `
                    <div class="category-item child">
                        <div class="category-row">
                            <div class="category-info">
                                <span class="category-name">↳ ${escapeHtml(child.name)}</span>
                                <span class="category-stats">${childSpending.count} transactions · ${formatCurrency(childSpending.total)}</span>
                            </div>
                            <button class="btn-icon btn-danger" onclick="deleteCategory('${escapeHtml(child.name)}')" title="Delete category">🗑️</button>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        }

        html += '</div>';
    });

    // Show orphaned children (those whose parent doesn't exist)
    const orphans = children.filter(c => !topLevel.some(p => p.name === c.parent_category));
    if (orphans.length > 0) {
        orphans.forEach(orphan => {
            const orphanSpending = spendingMap[orphan.name] || { total: 0, count: 0 };
            html += `
                <div class="category-item">
                    <div class="category-row">
                        <div class="category-info">
                            <span class="category-name">${escapeHtml(orphan.name)} <span style="color: var(--text-secondary); font-size: 0.875rem;">(orphaned)</span></span>
                            <span class="category-stats">${orphanSpending.count} transactions · ${formatCurrency(orphanSpending.total)}</span>
                        </div>
                        <button class="btn-icon btn-danger" onclick="deleteCategory('${escapeHtml(orphan.name)}')" title="Delete category">🗑️</button>
                    </div>
                </div>
            `;
        });
    }

    html += '</div>';
    container.innerHTML = html;
}

function displayCategorySpendingChart(spending) {
    const ctx = document.getElementById('categorySpendingCanvas');
    if (!ctx) return;

    // Destroy existing chart
    if (categorySpendingChartInstance) {
        categorySpendingChartInstance.destroy();
    }

    // Get top 10 categories by spending
    const sortedCategories = spending.categories
        .filter(cat => cat.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

    if (sortedCategories.length === 0) {
        ctx.parentElement.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem; text-align: center;">No spending data yet</p>';
        return;
    }

    const labels = sortedCategories.map(cat => cat.name);
    const data = sortedCategories.map(cat => cat.total);

    categorySpendingChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Spending',
                data: data,
                backgroundColor: '#FF5722',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return 'Spending: ' + formatCurrency(context.parsed.x);
                        }
                    }
                }
            },
            scales: {
                x: {
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
}

async function addCategory() {
    const nameInput = document.getElementById('newCategoryName');
    const parentSelect = document.getElementById('newCategoryParent');

    const name = nameInput.value.trim();
    const parent = parentSelect.value;

    if (!name) {
        showToast('Please enter a category name', 'error');
        return;
    }

    try {
        await fetchAPI('/api/categories', {
            method: 'POST',
            body: JSON.stringify({
                name: name,
                parent_category: parent || null
            })
        });

        showToast('Category added successfully', 'success');
        nameInput.value = '';
        parentSelect.value = '';
        loadCategories();
    } catch (error) {
        showToast('Failed to add category: ' + error.message, 'error');
        console.error(error);
    }
}

async function deleteCategory(categoryName) {
    if (!confirm(`Are you sure you want to delete the category "${categoryName}"?\n\nThis will fail if any transactions are using this category.`)) {
        return;
    }

    try {
        await fetchAPI(`/api/categories/${encodeURIComponent(categoryName)}`, {
            method: 'DELETE'
        });

        showToast('Category deleted successfully', 'success');
        loadCategories();
    } catch (error) {
        showToast('Failed to delete category: ' + error.message, 'error');
        console.error(error);
    }
}

// Plaid Link
async function initiatePlaidLink() {
    const btn = document.getElementById('linkAccountBtn');
    const statusEl = document.getElementById('linkStatus');

    btn.disabled = true;
    btn.textContent = 'Loading...';
    statusEl.textContent = '';
    statusEl.className = 'status-message';

    try {
        const { link_token } = await fetchAPI('/api/plaid/create-link-token', { method: 'POST' });

        plaidHandler = Plaid.create({
            token: link_token,
            onSuccess: async (public_token, metadata) => {
                console.log('✅ Plaid Link success!', { public_token, metadata });
                statusEl.textContent = 'Connecting account...';
                statusEl.className = 'status-message success';

                try {
                    const result = await fetchAPI('/api/plaid/exchange-token', {
                        method: 'POST',
                        body: JSON.stringify({ public_token })
                    });

                    console.log('✅ Account linked!', result);
                    showToast('Account linked successfully!', 'success');
                    statusEl.textContent = '✓ Account linked successfully! Redirecting to dashboard...';

                    setTimeout(() => {
                        navigateTo('dashboard');
                    }, 2000);
                } catch (error) {
                    console.error('❌ Exchange failed:', error);
                    statusEl.textContent = '✗ Failed to link account: ' + error.message;
                    statusEl.className = 'status-message error';
                    showToast('Failed to link account', 'error');
                }
            },
            onExit: (err, metadata) => {
                console.log('Plaid Link exit', { err, metadata });
                if (err) {
                    const errorMessage = err.display_message || err.error_message || err.message || JSON.stringify(err);
                    console.error('❌ Plaid Link error:', err);
                    statusEl.textContent = 'Error: ' + errorMessage;
                    statusEl.className = 'status-message error';
                    showToast('Link error: ' + errorMessage, 'error');
                } else {
                    statusEl.textContent = 'Link process cancelled';
                    statusEl.className = 'status-message';
                }
                btn.disabled = false;
                btn.innerHTML = '<span class="icon">🔗</span> Link Bank Account';
            },
            onEvent: (eventName, metadata) => {
                console.log('Plaid Link event:', eventName, metadata);
            }
        });

        plaidHandler.open();
        btn.disabled = false;
        btn.innerHTML = '<span class="icon">🔗</span> Link Bank Account';
    } catch (error) {
        console.error('Error creating link token:', error);
        statusEl.textContent = 'Failed to initialize Plaid Link: ' + error.message;
        statusEl.className = 'status-message error';
        btn.disabled = false;
        btn.innerHTML = '<span class="icon">🔗</span> Link Bank Account';
        showToast('Failed to initialize link', 'error');
    }
}

// Sync
async function syncTransactions() {
    const btn = document.getElementById('syncBtn');
    const originalHTML = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<span class="icon">⏳</span> Syncing...';

    try {
        const result = await fetchAPI('/api/sync', { method: 'POST' });
        showToast(`Synced successfully! ${result.newTransactions || 0} new transactions`, 'success');

        // Reload current page data
        if (currentPage === 'dashboard') {
            loadDashboard();
        } else if (currentPage === 'transactions') {
            loadTransactions();
        } else if (currentPage === 'accounts') {
            loadAccounts();
        }
    } catch (error) {
        showToast('Sync failed: ' + error.message, 'error');
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

async function backfillHistoricalTransactions() {
    const btn = document.getElementById('backfillBtn');
    const originalHTML = btn.innerHTML;

    // Confirm before starting (this can take a while)
    if (!confirm('This will fetch up to 2 years of historical transactions for all linked accounts. This may take several minutes. Continue?')) {
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="icon">⏳</span> Backfilling...';

    showToast('Starting historical backfill... This may take a few minutes.', 'info');

    try {
        const result = await fetchAPI('/api/backfill', { method: 'POST' });
        showToast(`Backfill complete! ${result.totalTransactions || 0} new transactions added`, 'success');

        // Reload current page data
        if (currentPage === 'dashboard') {
            loadDashboard();
        } else if (currentPage === 'transactions') {
            loadTransactions();
        } else if (currentPage === 'accounts') {
            loadAccounts();
        }
    } catch (error) {
        showToast('Backfill failed: ' + error.message, 'error');
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

// Utility Functions
async function fetchAPI(endpoint, options = {}) {
    const response = await fetch(API_URL + endpoint, {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        ...options
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
}

function formatCurrency(amount) {
    const num = parseFloat(amount);
    if (isNaN(num)) return '$0.00';

    const formatted = Math.abs(num).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD'
    });

    return num < 0 ? `-${formatted}` : formatted;
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoading() {
    document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

// Check and display environment
async function checkEnvironment() {
    try {
        const envInfo = await fetchAPI('/api/environment');
        const envBadge = document.getElementById('envBadge');

        if (envBadge) {
            const envName = envInfo.environment.toUpperCase();
            const badgeClass = envInfo.isProduction ? 'env-production' : 'env-sandbox';
            envBadge.textContent = envName;
            envBadge.className = `env-badge ${badgeClass}`;
        }
    } catch (error) {
        console.error('Failed to check environment:', error);
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000);
}
