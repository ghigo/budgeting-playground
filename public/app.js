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
    }
}

// Event Listeners
function setupEventListeners() {
    document.getElementById('linkAccountBtn').addEventListener('click', initiatePlaidLink);
    document.getElementById('syncBtn').addEventListener('click', syncTransactions);
}

// Dashboard
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

    new Chart(ctx, {
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

// Accounts
async function loadAccounts() {
    showLoading();
    try {
        const accounts = await fetchAPI('/api/accounts');
        displayAccounts(accounts);
    } catch (error) {
        showToast('Failed to load accounts', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
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
                ${escapeHtml(acc.institution)} ${acc.mask ? `••${acc.mask}` : ''}
            </div>
        </div>
    `).join('');
}

// Transactions
async function loadTransactions() {
    showLoading();
    try {
        const transactions = await fetchAPI('/api/transactions?limit=100');
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
            <td><span class="category-badge">${escapeHtml(tx.category || 'Uncategorized')}</span></td>
            <td>${escapeHtml(tx.account_name || 'Unknown')}</td>
            <td class="amount-cell ${parseFloat(tx.amount) > 0 ? 'positive' : 'negative'}">
                ${formatCurrency(tx.amount)}
            </td>
        </tr>
    `).join('');
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
