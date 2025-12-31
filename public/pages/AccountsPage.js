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

    container.innerHTML = accounts.map(acc => `
        <div class="account-card" style="position: relative;">
            <button class="btn-icon"
                    onclick="event.stopPropagation(); renameAccount('${acc.account_id}', '${escapeHtml(acc.name)}');"
                    style="position: absolute; top: 0.5rem; right: 0.5rem; z-index: 10;"
                    title="Rename account">
                ✏️
            </button>
            <div onclick="viewAccountTransactions('${escapeHtml(acc.name)}')" style="cursor: pointer;">
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
        </div>
    `).join('');
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
