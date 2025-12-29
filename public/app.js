// API Base URL
const API_URL = '';

// State
let plaidHandler = null;
let currentPage = 'dashboard';

// ============================================================================
// Event Bus for Reactive State Management
// ============================================================================

class EventBus {
    constructor() {
        this.listeners = {};
    }

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(callback => callback(data));
    }
}

const eventBus = new EventBus();

// Setup automatic view updates
function setupReactiveUpdates() {
    // When accounts change, refresh accounts page and transaction filters
    eventBus.on('accountsUpdated', () => {
        console.log('📡 Accounts updated, refreshing views...');
        if (currentPage === 'accounts') {
            loadAccounts();
        }
        // Refresh transaction filters on all pages
        loadTransactionFilters();
    });

    // When transactions change, refresh transactions and dashboard
    eventBus.on('transactionsUpdated', () => {
        console.log('📡 Transactions updated, refreshing views...');
        if (currentPage === 'transactions') {
            loadTransactions();
        }
        if (currentPage === 'dashboard') {
            loadDashboard();
        }
    });

    // When categories change, refresh categories page and dropdowns
    eventBus.on('categoriesUpdated', () => {
        console.log('📡 Categories updated, refreshing views...');
        if (currentPage === 'categories') {
            loadCategories();
        }
        if (currentPage === 'transactions') {
            loadTransactions(); // Reload to get updated category dropdowns
        }
    });

    // When mappings change, refresh mappings page
    eventBus.on('mappingsUpdated', () => {
        console.log('📡 Mappings updated, refreshing views...');
        if (currentPage === 'mappings') {
            loadMappings();
        }
    });
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    setupEventListeners();
    setupReactiveUpdates();
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
        case 'mappings':
            loadMappings();
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
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn-icon" onclick="syncInstitution('${inst.item_id}', '${escapeHtml(inst.institution_name)}')" title="Sync transactions">
                    🔄
                </button>
                <button class="btn-icon btn-danger" onclick="removeInstitution('${inst.item_id}', '${escapeHtml(inst.institution_name)}')" title="Remove institution">
                    🗑️
                </button>
            </div>
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

async function syncInstitution(itemId, institutionName) {
    showLoading();

    try {
        const result = await fetchAPI(`/api/sync/${itemId}`, {
            method: 'POST'
        });

        if (result.success) {
            showToast(`${result.institution} synced successfully! ${result.transactionsSynced} new transaction(s) added.`, 'success');

            // Emit events to update all views
            eventBus.emit('accountsUpdated');
            if (result.transactionsSynced > 0) {
                eventBus.emit('transactionsUpdated');
            }
        } else {
            showToast(`Failed to sync ${institutionName}: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast('Failed to sync institution: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
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

        // Emit events to update all views
        eventBus.emit('accountsUpdated');
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast('Failed to remove institution: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

// Transactions
let allCategories = [];
let allTransactions = []; // Store all transactions for client-side search/filter
let selectedTransactions = new Set(); // Track selected transaction IDs
let newlyCategorizedTransactionIds = new Set(); // Track newly categorized transaction IDs
let displayedTransactions = []; // Track currently displayed transactions

async function loadTransactions(filters = {}) {
    showLoading();
    try {
        let url = '/api/transactions?limit=500';

        // Add filters to URL if provided
        if (filters.category) url += `&category=${encodeURIComponent(filters.category)}`;
        if (filters.account) url += `&account=${encodeURIComponent(filters.account)}`;
        if (filters.startDate) url += `&startDate=${filters.startDate}`;
        if (filters.endDate) url += `&endDate=${filters.endDate}`;

        const [transactions, categories] = await Promise.all([
            fetchAPI(url),
            fetchAPI('/api/categories')
        ]);

        // Deduplicate categories by name (case-insensitive)
        const uniqueCategories = [];
        const seenNames = new Set();
        categories.forEach(cat => {
            const lowerName = cat.name.toLowerCase();
            if (!seenNames.has(lowerName)) {
                seenNames.add(lowerName);
                uniqueCategories.push(cat);
            }
        });

        allCategories = uniqueCategories;
        allTransactions = transactions; // Store for searching
        displayTransactionsTable(transactions);
        updateTransactionFilters(transactions);
        updateBulkActionsBar();
    } catch (error) {
        showToast('Failed to load transactions', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

function updateTransactionFilters(transactions) {
    // Populate category filter
    const categoryFilter = document.getElementById('filterCategory');
    if (categoryFilter) {
        const categories = [...new Set(transactions.map(t => t.category).filter(Boolean))];
        categoryFilter.innerHTML = '<option value="">All Categories</option>' +
            categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
    }

    // Populate account filter
    const accountFilter = document.getElementById('filterAccount');
    if (accountFilter) {
        const accounts = [...new Set(transactions.map(t => t.account_name).filter(Boolean))];
        accountFilter.innerHTML = '<option value="">All Accounts</option>' +
            accounts.map(acc => `<option value="${escapeHtml(acc)}">${escapeHtml(acc)}</option>`).join('');
    }
}

/**
 * Load fresh transaction filter data (accounts and categories)
 * Used by reactive updates when data changes
 */
async function loadTransactionFilters() {
    try {
        const [accounts, categories] = await Promise.all([
            fetchAPI('/api/accounts'),
            fetchAPI('/api/categories')
        ]);

        // Update account filter dropdown
        const accountFilter = document.getElementById('filterAccount');
        if (accountFilter) {
            const currentValue = accountFilter.value;
            accountFilter.innerHTML = '<option value="">All Accounts</option>' +
                accounts.map(acc => `<option value="${escapeHtml(acc.name)}">${escapeHtml(acc.name)}</option>`).join('');
            // Restore previous selection if still valid
            if (currentValue && Array.from(accountFilter.options).some(opt => opt.value === currentValue)) {
                accountFilter.value = currentValue;
            }
        }

        // Update category filter dropdown
        const categoryFilter = document.getElementById('filterCategory');
        if (categoryFilter) {
            const currentValue = categoryFilter.value;
            categoryFilter.innerHTML = '<option value="">All Categories</option>' +
                categories.map(cat => `<option value="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</option>`).join('');
            // Restore previous selection if still valid
            if (currentValue && Array.from(categoryFilter.options).some(opt => opt.value === currentValue)) {
                categoryFilter.value = currentValue;
            }
        }
    } catch (error) {
        console.error('Error loading transaction filters:', error);
    }
}

function displayTransactionsTable(transactions, sortByConfidence = false) {
    const tbody = document.getElementById('transactionsTableBody');

    if (!transactions || transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No transactions found</td></tr>';
        document.getElementById('approveAllBtn').style.display = 'none';
        return;
    }

    // Sort by confidence if requested (descending order)
    let displayTransactions = [...transactions];
    if (sortByConfidence) {
        displayTransactions.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    }

    // Store displayed transactions
    displayedTransactions = displayTransactions;

    // Show "Approve All Visible" button if:
    // 1. We're viewing a filtered view (not all transactions)
    // 2. There are unverified transactions in the view
    const isFilteredView = displayTransactions.length < allTransactions.length;
    const hasUnverified = displayTransactions.some(tx => !tx.verified);
    const approveAllBtn = document.getElementById('approveAllBtn');

    if (isFilteredView && hasUnverified) {
        approveAllBtn.style.display = 'block';
    } else {
        approveAllBtn.style.display = 'none';
    }

    tbody.innerHTML = displayTransactions.map(tx => {
        const isVerified = tx.verified;
        const hasCategory = tx.category && tx.category.length > 0;
        const confidence = tx.confidence || 0;
        const isSelected = selectedTransactions.has(tx.transaction_id);

        // Determine confidence badge color and style
        let confidenceColor = '#666';
        let confidenceBg = '#eee';
        if (confidence === 100) {
            confidenceColor = '#fff';
            confidenceBg = '#2563eb'; // Blue for manually verified
        } else if (confidence >= 85) {
            confidenceColor = '#fff';
            confidenceBg = '#16a34a'; // Green for high confidence
        } else if (confidence >= 70) {
            confidenceColor = '#fff';
            confidenceBg = '#ca8a04'; // Yellow for medium confidence
        } else if (confidence >= 50) {
            confidenceColor = '#fff';
            confidenceBg = '#ea580c'; // Orange for low confidence
        } else if (confidence > 0) {
            confidenceColor = '#fff';
            confidenceBg = '#dc2626'; // Red for very low confidence
        }

        return `
        <tr>
            <td>
                <input type="checkbox"
                       class="transaction-checkbox"
                       data-transaction-id="${tx.transaction_id}"
                       ${isSelected ? 'checked' : ''}
                       onchange="toggleTransactionSelection('${tx.transaction_id}')">
            </td>
            <td>${formatDate(tx.date)}</td>
            <td>${escapeHtml(tx.description || tx.name)}</td>
            <td>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <div class="searchable-dropdown-container" style="position: relative; flex: 1;">
                        <input type="text"
                               class="category-input ${isVerified ? 'verified' : ''}"
                               data-transaction-id="${tx.transaction_id}"
                               value="${escapeHtml(tx.category || '')}"
                               placeholder="Select category..."
                               readonly
                               onclick="showCategoryDropdown(this)"
                               autocomplete="off">
                    </div>
                    ${hasCategory && confidence > 0 ?
                        `<span style="
                            display: inline-block;
                            padding: 2px 6px;
                            border-radius: 4px;
                            font-size: 0.75rem;
                            font-weight: 600;
                            color: ${confidenceColor};
                            background: ${confidenceBg};
                            white-space: nowrap;
                        " title="Confidence: ${confidence}%">${confidence}%</span>` :
                        ''
                    }
                    ${isVerified ?
                        '<span style="color: var(--success); font-size: 1.2rem;" title="Verified">✓</span>' :
                        (hasCategory ?
                            `<button class="verify-btn" onclick="verifyCategory('${tx.transaction_id}')" title="Verify auto-assigned category">✓</button>` :
                            '')
                    }
                </div>
            </td>
            <td>${escapeHtml(tx.account_name || 'Unknown')}</td>
            <td class="amount-cell ${parseFloat(tx.amount) > 0 ? 'positive' : 'negative'}">
                ${formatCurrency(tx.amount)}
            </td>
        </tr>
        `;
    }).join('');
}

function searchTransactions() {
    const searchInput = document.getElementById('transactionSearch');
    const searchTerm = searchInput?.value?.toLowerCase() || '';

    if (!searchTerm) {
        // No search term - show all transactions
        displayTransactionsTable(allTransactions);
        return;
    }

    // Filter transactions based on search term
    const filtered = allTransactions.filter(tx => {
        const description = (tx.description || tx.name || '').toLowerCase();
        const merchant = (tx.merchant_name || '').toLowerCase();
        const amount = (tx.amount || '').toString();
        const category = (tx.category || '').toLowerCase();
        const account = (tx.account_name || '').toLowerCase();

        return description.includes(searchTerm) ||
               merchant.includes(searchTerm) ||
               amount.includes(searchTerm) ||
               category.includes(searchTerm) ||
               account.includes(searchTerm);
    });

    displayTransactionsTable(filtered);
}

function applyTransactionFilters() {
    const filters = {
        category: document.getElementById('filterCategory')?.value || '',
        account: document.getElementById('filterAccount')?.value || '',
        startDate: document.getElementById('filterStartDate')?.value || '',
        endDate: document.getElementById('filterEndDate')?.value || ''
    };

    // Clear search when applying filters
    const searchInput = document.getElementById('transactionSearch');
    if (searchInput) searchInput.value = '';

    loadTransactions(filters);
}

function clearTransactionFilters() {
    const searchInput = document.getElementById('transactionSearch');
    if (searchInput) searchInput.value = '';
    if (document.getElementById('filterCategory')) document.getElementById('filterCategory').value = '';
    if (document.getElementById('filterAccount')) document.getElementById('filterAccount').value = '';
    if (document.getElementById('filterStartDate')) document.getElementById('filterStartDate').value = '';
    if (document.getElementById('filterEndDate')) document.getElementById('filterEndDate').value = '';

    // Clear newly categorized filter
    document.getElementById('newlyCategorizedBanner').style.display = 'none';
    newlyCategorizedTransactionIds.clear();

    // Reset quick filter buttons to "All"
    document.getElementById('showAllBtn').classList.remove('btn-secondary');
    document.getElementById('showAllBtn').classList.add('btn-primary');
    document.getElementById('showUnverifiedBtn').classList.remove('btn-primary');
    document.getElementById('showUnverifiedBtn').classList.add('btn-secondary');

    loadTransactions();
}

async function verifyCategory(transactionId) {
    try {
        const result = await fetchAPI(`/api/transactions/${transactionId}/verify`, {
            method: 'POST'
        });
        showToast(`Category "${result.category}" verified`, 'success');

        // Emit events to update all views
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast('Failed to verify category: ' + error.message, 'error');
        console.error(error);
    }
}

async function autoCategorizeTransactions() {
    showLoading();
    try {
        const result = await fetchAPI('/api/transactions/recategorize', {
            method: 'POST',
            body: JSON.stringify({ onlyUncategorized: true })
        });

        if (result.success) {
            showToast(
                `✨ Auto-categorization complete!\n` +
                `${result.updated} transactions categorized\n` +
                `${result.skipped} skipped (verified or already categorized)`,
                'success'
            );

            // Store newly categorized transaction IDs
            newlyCategorizedTransactionIds.clear();
            if (result.categorizedTransactions && result.categorizedTransactions.length > 0) {
                result.categorizedTransactions.forEach(tx => {
                    newlyCategorizedTransactionIds.add(tx.transaction_id);
                });
            }

            // Emit events to update all views
            eventBus.emit('transactionsUpdated');
            eventBus.emit('mappingsUpdated');

            // Navigate to transactions page
            navigateTo('transactions');

            // Show newly categorized transactions
            setTimeout(() => {
                showNewlyCategorizedTransactions();
            }, 100);
        }
    } catch (error) {
        showToast('Failed to auto-categorize: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

// ============================================================================
// Searchable Category Dropdown
// ============================================================================

let currentDropdownInput = null;

/**
 * Show searchable category dropdown
 */
function showCategoryDropdown(inputElement) {
    // Close any existing dropdown
    closeAllDropdowns();

    currentDropdownInput = inputElement;
    const container = inputElement.parentElement;
    const transactionId = inputElement.getAttribute('data-transaction-id');

    // Create dropdown element
    const dropdown = document.createElement('div');
    dropdown.className = 'category-dropdown';
    dropdown.id = 'category-dropdown-' + transactionId;

    // Build dropdown HTML
    dropdown.innerHTML = `
        <div class="category-dropdown-search">
            <input type="text"
                   class="category-search-input"
                   placeholder="Search categories..."
                   oninput="filterCategoryDropdown(this.value)"
                   autofocus>
        </div>
        <div class="category-dropdown-list" id="category-list-${transactionId}">
            ${buildCategoryList(allCategories)}
        </div>
    `;

    container.appendChild(dropdown);

    // Position dropdown
    dropdown.style.top = (inputElement.offsetHeight + 2) + 'px';
    dropdown.style.width = inputElement.offsetWidth + 'px';

    // Focus search input
    setTimeout(() => {
        const searchInput = dropdown.querySelector('.category-search-input');
        if (searchInput) searchInput.focus();
    }, 10);
}

/**
 * Build category list HTML
 */
function buildCategoryList(categories, searchTerm = '') {
    const filtered = searchTerm
        ? categories.filter(cat =>
            cat.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (cat.parent_category && cat.parent_category.toLowerCase().includes(searchTerm.toLowerCase()))
          )
        : categories;

    if (filtered.length === 0) {
        return '<div class="category-dropdown-empty">No categories found</div>';
    }

    // Group by parent category
    const topLevel = filtered.filter(cat => !cat.parent_category);
    const withParent = filtered.filter(cat => cat.parent_category);

    const html = [];

    // Top-level categories first
    topLevel.forEach(cat => {
        html.push(`
            <div class="category-dropdown-item" onclick="selectCategory('${escapeHtml(cat.name)}')">
                <span class="category-name">${escapeHtml(cat.name)}</span>
            </div>
        `);
    });

    // Child categories grouped by parent
    const parentGroups = {};
    withParent.forEach(cat => {
        if (!parentGroups[cat.parent_category]) {
            parentGroups[cat.parent_category] = [];
        }
        parentGroups[cat.parent_category].push(cat);
    });

    Object.entries(parentGroups).forEach(([parent, children]) => {
        // Add parent header if parent exists in filtered list
        const parentInList = topLevel.find(c => c.name === parent);
        if (!parentInList && !searchTerm) {
            html.push(`
                <div class="category-dropdown-header">${escapeHtml(parent)}</div>
            `);
        }

        children.forEach(cat => {
            html.push(`
                <div class="category-dropdown-item category-child" onclick="selectCategory('${escapeHtml(cat.name)}')">
                    <span class="category-name">${escapeHtml(cat.name)}</span>
                    <span class="category-parent">${escapeHtml(cat.parent_category)}</span>
                </div>
            `);
        });
    });

    return html.join('');
}

/**
 * Filter category dropdown based on search term
 */
function filterCategoryDropdown(searchTerm) {
    if (!currentDropdownInput) return;

    const transactionId = currentDropdownInput.getAttribute('data-transaction-id');
    const listContainer = document.getElementById('category-list-' + transactionId);

    if (listContainer) {
        listContainer.innerHTML = buildCategoryList(allCategories, searchTerm);
    }
}

/**
 * Select a category from dropdown
 */
async function selectCategory(categoryName) {
    if (!currentDropdownInput) return;

    const transactionId = currentDropdownInput.getAttribute('data-transaction-id');

    // Update input value
    currentDropdownInput.value = categoryName;

    // Close dropdown
    closeAllDropdowns();

    // Update category in backend
    try {
        const result = await fetchAPI(`/api/transactions/${transactionId}/category`, {
            method: 'PATCH',
            body: JSON.stringify({ category: categoryName })
        });

        showToast('Category updated and verified', 'success');

        // Emit events to update all views
        eventBus.emit('transactionsUpdated');
        eventBus.emit('mappingsUpdated');

        // Check if there are similar transactions to suggest updating
        if (result.similarTransactions && result.similarTransactions.length > 0) {
            showSimilarTransactionsModal(result.similarTransactions, result.suggestedCategory);
        }
    } catch (error) {
        showToast('Failed to update category: ' + error.message, 'error');
        console.error(error);
        loadTransactions();
    }
}

/**
 * Close all open category dropdowns
 */
function closeAllDropdowns() {
    document.querySelectorAll('.category-dropdown').forEach(dropdown => {
        dropdown.remove();
    });
    currentDropdownInput = null;
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchable-dropdown-container') &&
        !e.target.closest('.category-dropdown')) {
        closeAllDropdowns();
    }
});

// Close dropdown on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAllDropdowns();
    }
});

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

        // Emit events to update all views
        eventBus.emit('categoriesUpdated');
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

        // Emit events to update all views
        eventBus.emit('categoriesUpdated');
    } catch (error) {
        showToast('Failed to delete category: ' + error.message, 'error');
        console.error(error);
    }
}

// ============================================================================
// AUTO-CATEGORIZATION MAPPINGS
// ============================================================================

async function loadMappings() {
    showLoading();
    try {
        const [merchantMappings, categoryRules, plaidMappings] = await Promise.all([
            fetchAPI('/api/category-mappings/merchant'),
            fetchAPI('/api/category-mappings/rules'),
            fetchAPI('/api/category-mappings/plaid')
        ]);

        displayMerchantMappings(merchantMappings);
        displayCategoryRules(categoryRules);
        displayPlaidMappings(plaidMappings);
    } catch (error) {
        console.error('Error loading mappings:', error);
        showToast('Failed to load mappings', 'error');
    } finally {
        hideLoading();
    }
}

function displayMerchantMappings(mappings) {
    const container = document.getElementById('merchantMappingsList');

    if (!mappings || mappings.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No merchant mappings yet. Sync transactions to build this list automatically.</p>';
        return;
    }

    // Sort by match count (most used first)
    const sortedMappings = [...mappings].sort((a, b) => b.match_count - a.match_count);

    const html = `
        <div class="mappings-table">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="border-bottom: 2px solid var(--border);">
                        <th style="text-align: left; padding: 0.75rem;">Merchant</th>
                        <th style="text-align: left; padding: 0.75rem;">Category</th>
                        <th style="text-align: center; padding: 0.75rem;">Matches</th>
                        <th style="text-align: left; padding: 0.75rem;">Last Used</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedMappings.map(mapping => `
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.75rem; font-weight: 500;">${escapeHtml(mapping.merchant_name)}</td>
                            <td style="padding: 0.75rem;"><span class="category-badge">${escapeHtml(mapping.category)}</span></td>
                            <td style="padding: 0.75rem; text-align: center;">${mapping.match_count}</td>
                            <td style="padding: 0.75rem; color: var(--text-secondary); font-size: 0.9rem;">${formatDate(mapping.last_used)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

function displayCategoryRules(rules) {
    const container = document.getElementById('categoryRulesList');

    if (!rules || rules.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No category rules configured.</p>';
        return;
    }

    const html = `
        <div class="mappings-table">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="border-bottom: 2px solid var(--border);">
                        <th style="text-align: left; padding: 0.75rem;">Rule Name</th>
                        <th style="text-align: left; padding: 0.75rem;">Pattern</th>
                        <th style="text-align: left; padding: 0.75rem;">Category</th>
                        <th style="text-align: center; padding: 0.75rem;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${rules.map(rule => `
                        <tr style="border-bottom: 1px solid var(--border); ${rule.enabled ? '' : 'opacity: 0.5;'}">
                            <td style="padding: 0.75rem; font-weight: 500;">${escapeHtml(rule.name)}</td>
                            <td style="padding: 0.75rem; font-family: monospace; font-size: 0.9rem; color: var(--text-secondary);">${escapeHtml(rule.pattern)}</td>
                            <td style="padding: 0.75rem;"><span class="category-badge">${escapeHtml(rule.category)}</span></td>
                            <td style="padding: 0.75rem; text-align: center;">
                                <span style="padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; ${rule.enabled ? 'background: var(--success-light); color: var(--success);' : 'background: var(--bg-secondary); color: var(--text-secondary);'}">
                                    ${rule.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

function displayPlaidMappings(mappings) {
    const container = document.getElementById('plaidMappingsList');

    if (!mappings || mappings.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No Plaid category mappings yet. These will be created automatically as transactions are synced.</p>';
        return;
    }

    const html = `
        <div class="mappings-table">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="border-bottom: 2px solid var(--border);">
                        <th style="text-align: left; padding: 0.75rem;">Plaid Category</th>
                        <th style="text-align: left; padding: 0.75rem;">Your Category</th>
                        <th style="text-align: center; padding: 0.75rem;">Auto-Created</th>
                    </tr>
                </thead>
                <tbody>
                    ${mappings.map(mapping => `
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 0.75rem; font-weight: 500;">${escapeHtml(mapping.plaid_category)}</td>
                            <td style="padding: 0.75rem;"><span class="category-badge">${escapeHtml(mapping.user_category)}</span></td>
                            <td style="padding: 0.75rem; text-align: center;">
                                ${mapping.auto_created ? '<span style="color: var(--success);">✓</span>' : '<span style="color: var(--text-secondary);">Manual</span>'}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
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

                    // Show results
                    const transactionCount = result.transactions || 0;
                    if (transactionCount > 0) {
                        showToast(`Account linked! Fetched ${transactionCount} transaction(s) from the last 2 years`, 'success');
                        statusEl.textContent = `✓ Account linked! Fetched ${transactionCount} transaction(s). Redirecting...`;
                    } else {
                        showToast('Account linked! Historical transactions may take a moment to sync. Check back shortly.', 'info');
                        statusEl.textContent = '✓ Account linked! You can sync transactions from the Accounts page. Redirecting...';
                    }

                    // Emit events to update all views
                    eventBus.emit('accountsUpdated');
                    if (transactionCount > 0) {
                        eventBus.emit('transactionsUpdated');
                    }

                    setTimeout(() => {
                        navigateTo('accounts');
                    }, 3000);
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

        // Emit events to update all views
        eventBus.emit('accountsUpdated');
        eventBus.emit('transactionsUpdated');
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

        // Emit events to update all views
        eventBus.emit('transactionsUpdated');
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

function showToast(message, type = 'info', options = {}) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // If there's an undo action, create a toast with message and undo button
    if (options.undoAction) {
        toast.style.display = 'flex';
        toast.style.alignItems = 'center';
        toast.style.justifyContent = 'space-between';
        toast.style.gap = '1rem';
        toast.style.cursor = 'default';
        toast.style.padding = '1rem 1.25rem';

        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        messageSpan.style.flex = '1';
        toast.appendChild(messageSpan);

        const undoBtn = document.createElement('button');
        undoBtn.textContent = 'UNDO';
        undoBtn.style.padding = '0.5rem 1rem';
        undoBtn.style.fontSize = '0.875rem';
        undoBtn.style.fontWeight = '600';
        undoBtn.style.background = 'white';
        undoBtn.style.color = '#16a34a';
        undoBtn.style.border = 'none';
        undoBtn.style.borderRadius = '6px';
        undoBtn.style.cursor = 'pointer';
        undoBtn.style.whiteSpace = 'nowrap';
        undoBtn.style.transition = 'all 0.2s ease';
        undoBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';

        // Hover effects
        undoBtn.addEventListener('mouseenter', () => {
            undoBtn.style.background = '#f0f0f0';
            undoBtn.style.transform = 'scale(1.05)';
        });
        undoBtn.addEventListener('mouseleave', () => {
            undoBtn.style.background = 'white';
            undoBtn.style.transform = 'scale(1)';
        });

        undoBtn.addEventListener('click', async () => {
            clearTimeout(timeoutId);
            toast.remove();
            await options.undoAction();
        });

        toast.appendChild(undoBtn);
    } else {
        toast.textContent = message;
        toast.style.cursor = 'pointer';
        toast.title = 'Click to dismiss';

        // Click to dismiss immediately (only for non-undo toasts)
        toast.addEventListener('click', () => {
            clearTimeout(timeoutId);
            toast.remove();
        });
    }

    container.appendChild(toast);

    // Auto-dismiss after 10 seconds
    const timeoutId = setTimeout(() => {
        toast.remove();
    }, 10000);
}

// ============================================================================
// Google Sheets Sync Functions
// ============================================================================

/**
 * Check Google Sheets configuration status and update UI
 */
async function checkSheetsStatus() {
    try {
        const response = await fetchAPI('/api/sheets/status');

        const card = document.getElementById('sheetsSyncCard');
        const syncBtn = document.getElementById('sheetsSyncBtn');
        const configBtn = document.getElementById('sheetsConfigBtn');
        const description = document.getElementById('sheetsSyncDescription');

        if (!card || !syncBtn || !configBtn || !description) {
            return;
        }

        // Show the card
        card.style.display = 'block';

        if (response.configured && response.initialized) {
            // Sheets configured and working - show sync button
            syncBtn.style.display = 'block';
            configBtn.style.display = 'none';
            description.textContent = 'Sync your local SQLite data to Google Sheets for backup and analysis';
        } else {
            // Not configured - show config button
            syncBtn.style.display = 'none';
            configBtn.style.display = 'block';
            description.textContent = 'Link a Google Sheet to backup your data and access it from anywhere';
        }
    } catch (error) {
        console.error('Error checking sheets status:', error);
        // Hide the card on error
        const card = document.getElementById('sheetsSyncCard');
        if (card) {
            card.style.display = 'none';
        }
    }
}

/**
 * Sync data to Google Sheets
 */
async function syncToGoogleSheets() {
    if (!confirm('This will sync all your local data to Google Sheets. This may take a moment. Continue?')) {
        return;
    }

    try {
        showToast('Starting sync to Google Sheets...', 'info');

        const result = await fetchAPI('/api/sheets/sync', {
            method: 'POST'
        });

        if (result.success) {
            const total = Object.values(result.synced || {}).reduce((sum, count) => sum + count, 0);
            showToast(`✓ Successfully synced ${total} records to Google Sheets!\n\n` +
                `Breakdown:\n` +
                `• ${result.synced.transactions || 0} transactions\n` +
                `• ${result.synced.accounts || 0} accounts\n` +
                `• ${result.synced.categories || 0} categories\n` +
                `• ${result.synced.plaidItems || 0} institutions`, 'success');
        } else {
            showToast(`Sync failed: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error syncing to Google Sheets:', error);
        showToast(`Sync error: ${error.message}`, 'error');
    }
}

/**
 * Show Google Sheets configuration modal
 */
function showSheetsConfigModal() {
    const modal = document.getElementById('sheetsConfigModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

/**
 * Close Google Sheets configuration modal
 */
function closeSheetsConfigModal() {
    const modal = document.getElementById('sheetsConfigModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Save Google Sheet configuration
 */
async function saveSheetConfig() {
    const input = document.getElementById('sheetIdInput');
    const sheetId = input?.value?.trim();

    if (!sheetId) {
        showToast('Please enter a valid Google Sheet ID', 'error');
        return;
    }

    try {
        showToast('Saving configuration...', 'info');

        const result = await fetchAPI('/api/sheets/configure', {
            method: 'POST',
            body: JSON.stringify({ sheetId })
        });

        if (result.success) {
            showToast(result.message, 'success');
            closeSheetsConfigModal();

            // Clear input
            if (input) {
                input.value = '';
            }

            // Refresh sheets status
            await checkSheetsStatus();

            // Optionally, ask user if they want to sync now
            if (result.configured && confirm('Configuration saved! Would you like to sync your data to Google Sheets now?')) {
                await syncToGoogleSheets();
            }
        } else {
            showToast(`Configuration failed: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error saving sheet configuration:', error);
        showToast(`Configuration error: ${error.message}`, 'error');
    }
}

// ============================================================================
// Similar Transactions Modal Functions
// ============================================================================

let currentSimilarTransactions = [];
let currentSuggestedCategory = '';

/**
 * Show modal with similar transactions
 */
function showSimilarTransactionsModal(similarTransactions, suggestedCategory) {
    currentSimilarTransactions = similarTransactions;
    currentSuggestedCategory = suggestedCategory;

    const modal = document.getElementById('similarTransactionsModal');
    const countEl = document.getElementById('similarCount');
    const categoryNameEl = document.getElementById('suggestedCategoryName');
    const listEl = document.getElementById('similarTransactionsList');

    countEl.textContent = similarTransactions.length;
    categoryNameEl.textContent = suggestedCategory;

    // Build table rows
    listEl.innerHTML = similarTransactions.map(tx => {
        const formattedAmount = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(Math.abs(tx.amount));

        return `
            <tr>
                <td style="padding: 0.75rem; border-bottom: 1px solid var(--border);">
                    <input type="checkbox" class="similar-tx-checkbox" value="${escapeHtml(tx.transaction_id)}" checked>
                </td>
                <td style="padding: 0.75rem; border-bottom: 1px solid var(--border);">${escapeHtml(tx.date)}</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid var(--border);">${escapeHtml(tx.description)}</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid var(--border);">${formattedAmount}</td>
                <td style="padding: 0.75rem; border-bottom: 1px solid var(--border);">
                    ${tx.category ? escapeHtml(tx.category) : '<em style="color: var(--text-secondary);">Uncategorized</em>'}
                </td>
            </tr>
        `;
    }).join('');

    modal.style.display = 'flex';
}

/**
 * Close similar transactions modal
 */
function closeSimilarTransactionsModal() {
    const modal = document.getElementById('similarTransactionsModal');
    modal.style.display = 'none';
    currentSimilarTransactions = [];
    currentSuggestedCategory = '';
}

/**
 * Toggle all checkboxes in similar transactions list
 */
function toggleAllSimilarTransactions() {
    const selectAll = document.getElementById('selectAllSimilar');
    const checkboxes = document.querySelectorAll('.similar-tx-checkbox');

    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAll.checked;
    });
}

/**
 * Apply category to selected similar transactions
 */
async function applyCategoryToSimilar() {
    const checkboxes = document.querySelectorAll('.similar-tx-checkbox:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);

    if (selectedIds.length === 0) {
        showToast('No transactions selected', 'warning');
        return;
    }

    try {
        const result = await fetchAPI('/api/transactions/bulk/category', {
            method: 'PATCH',
            body: JSON.stringify({
                transactionIds: selectedIds,
                category: currentSuggestedCategory
            })
        });

        if (result.success) {
            showToast(`✓ Updated ${result.updated} transaction(s) to category "${currentSuggestedCategory}"`, 'success');

            // Emit events to update all views
            eventBus.emit('transactionsUpdated');

            closeSimilarTransactionsModal();
        } else {
            showToast('Failed to update transactions', 'error');
        }
    } catch (error) {
        console.error('Error updating similar transactions:', error);
        showToast(`Failed to update: ${error.message}`, 'error');
    }
}

// ============================================================================
// Transaction Selection and Bulk Actions
// ============================================================================

/**
 * Toggle individual transaction selection
 */
function toggleTransactionSelection(transactionId) {
    if (selectedTransactions.has(transactionId)) {
        selectedTransactions.delete(transactionId);
    } else {
        selectedTransactions.add(transactionId);
    }
    updateBulkActionsBar();
    updateSelectAllCheckbox();
}

/**
 * Toggle all transactions selection
 */
function toggleAllTransactionSelection() {
    const selectAllCheckbox = document.getElementById('selectAllTransactions');
    const checkboxes = document.querySelectorAll('.transaction-checkbox');

    if (selectAllCheckbox.checked) {
        // Select all
        checkboxes.forEach(cb => {
            const txId = cb.getAttribute('data-transaction-id');
            selectedTransactions.add(txId);
            cb.checked = true;
        });
    } else {
        // Deselect all
        selectedTransactions.clear();
        checkboxes.forEach(cb => {
            cb.checked = false;
        });
    }
    updateBulkActionsBar();
}

/**
 * Update select all checkbox state based on individual selections
 */
function updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAllTransactions');
    const checkboxes = document.querySelectorAll('.transaction-checkbox');

    if (checkboxes.length === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        return;
    }

    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;

    if (checkedCount === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (checkedCount === checkboxes.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

/**
 * Update bulk actions bar visibility and count
 */
function updateBulkActionsBar() {
    const bulkActionsBar = document.getElementById('bulkActionsBar');
    const selectedCountEl = document.getElementById('selectedCount');

    const count = selectedTransactions.size;

    if (count > 0) {
        bulkActionsBar.style.display = 'block';
        selectedCountEl.textContent = count;
    } else {
        bulkActionsBar.style.display = 'none';
    }
}

/**
 * Clear all selections
 */
function clearSelection() {
    selectedTransactions.clear();
    const checkboxes = document.querySelectorAll('.transaction-checkbox');
    checkboxes.forEach(cb => cb.checked = false);
    updateBulkActionsBar();
    updateSelectAllCheckbox();
}

/**
 * Bulk verify selected transactions
 */
async function bulkVerifyTransactions() {
    if (selectedTransactions.size === 0) {
        showToast('No transactions selected', 'warning');
        return;
    }

    showLoading();
    try {
        let verified = 0;
        for (const txId of selectedTransactions) {
            await fetchAPI(`/api/transactions/${txId}/verify`, {
                method: 'POST'
            });
            verified++;
        }

        showToast(`✓ Verified ${verified} transaction(s)`, 'success');
        clearSelection();

        // Emit events to update all views
        eventBus.emit('transactionsUpdated');
    } catch (error) {
        showToast('Failed to verify transactions: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

/**
 * Show bulk category change modal
 */
function showBulkCategoryModal() {
    if (selectedTransactions.size === 0) {
        showToast('No transactions selected', 'warning');
        return;
    }

    const modal = document.getElementById('bulkCategoryModal');
    const countEl = document.getElementById('bulkSelectedCount');
    const selectEl = document.getElementById('bulkCategorySelect');

    countEl.textContent = selectedTransactions.size;

    // Populate categories
    selectEl.innerHTML = '<option value="">Select category...</option>' +
        allCategories.map(cat => {
            if (cat.parent_category) {
                return `<option value="${escapeHtml(cat.name)}">  ${escapeHtml(cat.name)} (${escapeHtml(cat.parent_category)})</option>`;
            } else {
                return `<option value="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</option>`;
            }
        }).join('');

    modal.style.display = 'flex';
}

/**
 * Close bulk category modal
 */
function closeBulkCategoryModal() {
    const modal = document.getElementById('bulkCategoryModal');
    modal.style.display = 'none';
}

/**
 * Apply category to selected transactions
 */
async function applyBulkCategory() {
    const selectEl = document.getElementById('bulkCategorySelect');
    const category = selectEl.value;

    if (!category) {
        showToast('Please select a category', 'warning');
        return;
    }

    closeBulkCategoryModal();
    showLoading();

    try {
        const result = await fetchAPI('/api/transactions/bulk/category', {
            method: 'PATCH',
            body: JSON.stringify({
                transactionIds: Array.from(selectedTransactions),
                category: category
            })
        });

        if (result.success) {
            showToast(`✓ Updated ${result.updated} transaction(s) to category "${category}"`, 'success');
            clearSelection();

            // Emit events to update all views
            eventBus.emit('transactionsUpdated');
            eventBus.emit('mappingsUpdated');
        }
    } catch (error) {
        showToast('Failed to update categories: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

/**
 * Approve all visible transactions in the current filtered view
 */
async function approveAllVisibleTransactions() {
    // Get unverified transactions from the displayed set
    const unverifiedTransactions = displayedTransactions.filter(tx => !tx.verified);

    if (unverifiedTransactions.length === 0) {
        showToast('No unverified transactions to approve', 'info');
        return;
    }

    showLoading();
    try {
        // Store transaction IDs for undo
        const transactionIds = unverifiedTransactions.map(tx => tx.transaction_id);

        // Approve all transactions
        let approved = 0;
        for (const tx of unverifiedTransactions) {
            await fetchAPI(`/api/transactions/${tx.transaction_id}/verify`, {
                method: 'POST'
            });
            approved++;
        }

        // Emit events to update all views
        eventBus.emit('transactionsUpdated');

        // Show toast with undo action
        showToast(`✓ Approved ${approved} transaction(s)`, 'success', {
            undoAction: async () => {
                showLoading();
                try {
                    for (const txId of transactionIds) {
                        await fetchAPI(`/api/transactions/${txId}/unverify`, {
                            method: 'POST'
                        });
                    }
                    showToast(`↶ Undid approval of ${transactionIds.length} transaction(s)`, 'info');
                    eventBus.emit('transactionsUpdated');
                } catch (error) {
                    showToast('Failed to undo approval: ' + error.message, 'error');
                    console.error(error);
                } finally {
                    hideLoading();
                }
            }
        });
    } catch (error) {
        showToast('Failed to approve transactions: ' + error.message, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

/**
 * Show newly categorized transactions
 */
function showNewlyCategorizedTransactions() {
    if (newlyCategorizedTransactionIds.size === 0) {
        showToast('No newly categorized transactions to show', 'info');
        return;
    }

    // Filter for newly categorized transactions
    const newlyCategorized = allTransactions.filter(tx =>
        newlyCategorizedTransactionIds.has(tx.transaction_id)
    );

    // Update banner
    const banner = document.getElementById('newlyCategorizedBanner');
    const countEl = document.getElementById('newlyCategorizedCount');
    banner.style.display = 'block';
    countEl.textContent = newlyCategorized.length;

    // Clear quick filter highlights
    document.getElementById('showAllBtn').classList.remove('btn-primary');
    document.getElementById('showAllBtn').classList.add('btn-secondary');
    document.getElementById('showUnverifiedBtn').classList.remove('btn-primary');
    document.getElementById('showUnverifiedBtn').classList.add('btn-secondary');

    // Display sorted by confidence (descending)
    displayTransactionsTable(newlyCategorized, true);
}

/**
 * Clear newly categorized filter
 */
function clearNewlyCategorizedFilter() {
    // Hide banner
    document.getElementById('newlyCategorizedBanner').style.display = 'none';

    // Clear the stored IDs
    newlyCategorizedTransactionIds.clear();

    // Show all transactions
    showAllTransactions();
}

/**
 * Apply unverified filter (show unverified transactions sorted by confidence)
 */
function applyUnverifiedFilter() {
    // Hide newly categorized banner
    document.getElementById('newlyCategorizedBanner').style.display = 'none';

    // Filter for unverified transactions
    const unverified = allTransactions.filter(tx => !tx.verified);

    // Highlight the Unverified button
    document.getElementById('showAllBtn').classList.remove('btn-primary');
    document.getElementById('showAllBtn').classList.add('btn-secondary');
    document.getElementById('showUnverifiedBtn').classList.remove('btn-secondary');
    document.getElementById('showUnverifiedBtn').classList.add('btn-primary');

    // Display sorted by confidence (descending)
    displayTransactionsTable(unverified, true);

    if (unverified.length > 0) {
        showToast(`Showing ${unverified.length} unverified transaction(s), sorted by confidence`, 'info');
    } else {
        showToast('All transactions are verified!', 'success');
    }
}

/**
 * Show all transactions
 */
function showAllTransactions() {
    // Hide newly categorized banner
    document.getElementById('newlyCategorizedBanner').style.display = 'none';

    // Clear newly categorized IDs
    newlyCategorizedTransactionIds.clear();

    // Highlight the All button
    document.getElementById('showAllBtn').classList.remove('btn-secondary');
    document.getElementById('showAllBtn').classList.add('btn-primary');
    document.getElementById('showUnverifiedBtn').classList.remove('btn-primary');
    document.getElementById('showUnverifiedBtn').classList.add('btn-secondary');

    // Clear filters and show all
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterAccount').value = '';
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    document.getElementById('transactionSearch').value = '';

    displayTransactionsTable(allTransactions, false);
}

// Check sheets status when dashboard loads
document.addEventListener('DOMContentLoaded', () => {
    checkSheetsStatus();

    // Add ESC key listener to clear filters
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            // Check if we're on the transactions page
            const transactionsSection = document.getElementById('transactions-section');
            const isVisible = transactionsSection &&
                (transactionsSection.style.display === '' ||
                 transactionsSection.style.display === 'block' ||
                 window.getComputedStyle(transactionsSection).display !== 'none');

            if (isVisible) {
                // Clear all filters and reload all transactions from server
                clearTransactionFilters();
            }
        }
    });
});
