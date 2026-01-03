/**
 * AccountsPage Module
 * Handles accounts and institutions display and management
 */

import { formatCurrency, formatDate, escapeHtml, showLoading, hideLoading } from '../utils/formatters.js';
import { showToast } from '../services/toast.js';
import { eventBus } from '../services/eventBus.js';

// Dependencies that will be passed in
let fetchAPI = null;
let navigateTo = null;
let applyTransactionFilters = null;

export function initializeAccountsPage(deps) {
    fetchAPI = deps.fetchAPI;
    navigateTo = deps.navigateTo;
    applyTransactionFilters = deps.applyTransactionFilters;

    // Make functions globally available for onclick handlers
    window.syncInstitution = syncInstitution;
    window.removeInstitution = removeInstitution;
    window.viewAccountTransactions = viewAccountTransactions;
    window.renameAccount = renameAccount;
}

export async function loadAccounts() {
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

    // Group accounts by type
    const accountsByType = {};
    const typeOrder = ['credit', 'depository', 'loan', 'investment', 'other'];
    const typeLabels = {
        'depository': 'Depository',
        'credit': 'Credit cards',
        'loan': 'Loans',
        'investment': 'Investments',
        'other': 'Other Accounts'
    };

    accounts.forEach(acc => {
        const type = acc.type?.toLowerCase() || 'other';
        if (!accountsByType[type]) {
            accountsByType[type] = [];
        }
        accountsByType[type].push(acc);
    });

    // Make toggleAccountGroup globally available
    window.toggleAccountGroup = (type) => {
        const content = document.getElementById(`account-group-${type}`);
        const arrow = document.getElementById(`arrow-${type}`);
        if (content && arrow) {
            const isCollapsed = content.style.display === 'none';
            content.style.display = isCollapsed ? 'block' : 'none';
            arrow.textContent = isCollapsed ? '▼' : '▶';
        }
    };

    // Render accounts grouped by type
    let html = '';

    typeOrder.forEach(type => {
        if (accountsByType[type] && accountsByType[type].length > 0) {
            const typeAccounts = accountsByType[type];
            const totalBalance = typeAccounts.reduce((sum, acc) => sum + (parseFloat(acc.current_balance) || 0), 0);

            html += `
                <div style="margin-bottom: 1.5rem;">
                    <div
                        onclick="toggleAccountGroup('${type}')"
                        style="
                            display: flex;
                            align-items: center;
                            gap: 0.5rem;
                            padding: 0.75rem 0.5rem;
                            cursor: pointer;
                            user-select: none;
                        ">
                        <span id="arrow-${type}" style="font-size: 0.75rem; color: #666;">▼</span>
                        <h3 style="font-size: 1rem; font-weight: 600; color: var(--text-secondary); margin: 0;">
                            ${typeLabels[type] || type}
                        </h3>
                    </div>
                    <div id="account-group-${type}" style="display: block;">
                        ${typeAccounts.map(acc => {
                            const balance = parseFloat(acc.current_balance) || 0;
                            const updatedAt = acc.updated_at;
                            const timeAgo = getTimeAgo(updatedAt);

                            return `
                                <div
                                    onclick="viewAccountTransactions('${escapeHtml(acc.name)}')"
                                    style="
                                        display: flex;
                                        align-items: center;
                                        gap: 1rem;
                                        padding: 1rem;
                                        background: #f8f9fa;
                                        border-radius: 0.5rem;
                                        margin-bottom: 0.5rem;
                                        cursor: pointer;
                                        transition: background 0.2s;
                                    "
                                    onmouseover="this.style.background='#e9ecef'"
                                    onmouseout="this.style.background='#f8f9fa'">

                                    <div style="
                                        width: 48px;
                                        height: 48px;
                                        border-radius: 50%;
                                        background: #fff;
                                        display: flex;
                                        align-items: center;
                                        justify-content: center;
                                        font-size: 1.5rem;
                                        flex-shrink: 0;
                                    ">🏦</div>

                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-weight: 600; font-size: 0.95rem; color: #1a1a1a;">
                                            ${escapeHtml(acc.name)}
                                        </div>
                                        <div style="font-size: 0.8rem; color: #666; margin-top: 0.125rem;">
                                            ${timeAgo}
                                        </div>
                                    </div>

                                    <div style="text-align: right;">
                                        <div style="font-weight: 600; font-size: 1.1rem; color: #1a1a1a;">
                                            ${formatCurrency(balance)}
                                        </div>
                                    </div>

                                    <button
                                        class="btn-icon"
                                        onclick="event.stopPropagation(); renameAccount('${acc.account_id}', '${escapeHtml(acc.name)}');"
                                        style="flex-shrink: 0;"
                                        title="Rename account">
                                        ✏️
                                    </button>
                                </div>
                            `;
                        }).join('')}

                        <div style="
                            display: flex;
                            justify-content: flex-end;
                            padding: 0.75rem 1rem;
                            font-weight: 600;
                            font-size: 1.1rem;
                            color: #1a1a1a;
                        ">
                            ${formatCurrency(totalBalance)}
                        </div>
                    </div>
                </div>
            `;
        }
    });

    container.innerHTML = html;
}

function getTimeAgo(dateString) {
    if (!dateString) return 'Unknown';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffYears > 0) return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
    if (diffMonths > 0) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffMins > 0) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    return 'Just now';
}

function viewAccountTransactions(accountName) {
    // Navigate to transactions page
    navigateTo('transactions');

    // Wait for the page to load, then apply the filter
    setTimeout(() => {
        const filterAccount = document.getElementById('filterAccount');
        if (filterAccount) {
            filterAccount.value = accountName;
            applyTransactionFilters();
        }
    }, 100);
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
    showLoading();

    try {
        const result = await fetchAPI(`/api/institutions/${itemId}`, {
            method: 'DELETE'
        });

        showToast(`${result.institution} removed! Deleted ${result.accountsRemoved} account(s) and ${result.transactionsRemoved} transaction(s). You can re-link your account anytime.`, 'success');

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

async function renameAccount(accountId, currentName) {
    const Modal = (await import('../components/Modal.js')).default;
    const { eventBus: localEventBus } = await import('../services/eventBus.js');

    const modalId = `rename-account-${Date.now()}`;

    const modal = new Modal({
        id: modalId,
        title: 'Rename Account',
        content: `
            <div style="padding: 1rem 0;">
                <label for="new-account-name" style="display: block; margin-bottom: 0.5rem; font-weight: 500;">
                    New Account Name:
                </label>
                <input
                    type="text"
                    id="new-account-name"
                    class="form-input"
                    value="${escapeHtml(currentName)}"
                    style="width: 100%; padding: 0.75rem; font-size: 1rem;"
                    placeholder="Enter new account name"
                    autofocus
                />
                <small style="color: #666; display: block; margin-top: 0.5rem;">
                    This will update the account name and all ${currentName} transactions.
                </small>
            </div>
        `,
        actions: [
            {
                action: 'cancel',
                label: 'Cancel',
                primary: false
            },
            {
                action: 'save',
                label: 'Rename',
                primary: true
            }
        ],
        options: { size: 'small' }
    });

    // Handle save action
    localEventBus.once(`modal:${modalId}:save`, async () => {
        const input = document.getElementById('new-account-name');
        const newName = input?.value?.trim();

        if (!newName || newName.length === 0) {
            showToast('Account name cannot be empty', 'error');
            return;
        }

        if (newName === currentName) {
            showToast('Please enter a different name', 'error');
            return;
        }

        showLoading();

        try {
            const result = await fetchAPI(`/api/accounts/${accountId}/rename`, {
                method: 'PUT',
                body: JSON.stringify({ newName })
            });

            showToast(`Account renamed from "${result.oldName}" to "${result.newName}". Updated ${result.transactionsUpdated} transaction(s).`, 'success');

            // Emit events to update all views
            eventBus.emit('accountsUpdated');
            eventBus.emit('transactionsUpdated');
        } catch (error) {
            showToast('Failed to rename account: ' + error.message, 'error');
            console.error(error);
        } finally {
            hideLoading();
        }
    });

    modal.show();

    // Focus the input after modal is shown
    setTimeout(() => {
        const input = document.getElementById('new-account-name');
        if (input) {
            input.focus();
            input.select();
        }
    }, 100);
}

export default {
    initializeAccountsPage,
    loadAccounts
};
