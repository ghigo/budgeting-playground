/**
 * MappingsPage Module
 * Handles all auto-categorization mappings page functionality
 */

import { formatDate, escapeHtml } from '../utils/formatters.js';
import { showToast } from '../services/toast.js';
import { withLoadingState, renderTable } from '../utils/helpers.js';

// Dependencies (injected)
let fetchAPI = null;

export function initializeMappingsPage(deps) {
    fetchAPI = deps.fetchAPI;
}

export async function loadMappings() {
    return withLoadingState(async () => {
        const [merchantMappings, categoryRules, plaidMappings] = await Promise.all([
            fetchAPI('/api/category-mappings/merchant'),
            fetchAPI('/api/category-mappings/rules'),
            fetchAPI('/api/category-mappings/plaid')
        ]);

        displayMerchantMappings(merchantMappings);
        displayCategoryRules(categoryRules);
        displayPlaidMappings(plaidMappings);
    }, 'Failed to load mappings');
}

function displayMerchantMappings(mappings) {
    renderTable('merchantMappingsList', mappings, [
        {
            key: 'merchant_name',
            label: 'Merchant',
            render: (m) => `<span style="font-weight: 500;">${escapeHtml(m.merchant_name)}</span>`
        },
        {
            key: 'category',
            label: 'Category',
            render: (m) => `<span class="category-badge">${escapeHtml(m.category)}</span>`
        },
        {
            key: 'match_count',
            label: 'Matches',
            align: 'center'
        },
        {
            key: 'last_used',
            label: 'Last Used',
            render: (m) => `<span style="color: var(--text-secondary); font-size: 0.9rem;">${formatDate(m.last_used)}</span>`
        }
    ], {
        sortKey: 'match_count',
        sortOrder: 'desc',
        emptyMessage: 'No merchant mappings yet. Sync transactions to build this list automatically.'
    });
}

function displayCategoryRules(rules) {
    renderTable('categoryRulesList', rules, [
        {
            key: 'name',
            label: 'Rule Name',
            render: (r) => `<span style="font-weight: 500;">${escapeHtml(r.name)}</span>`
        },
        {
            key: 'pattern',
            label: 'Pattern',
            render: (r) => `<span style="font-family: monospace; font-size: 0.9rem; color: var(--text-secondary);">${escapeHtml(r.pattern)}</span>`
        },
        {
            key: 'category',
            label: 'Category',
            render: (r) => `<span class="category-badge">${escapeHtml(r.category)}</span>`
        },
        {
            key: 'enabled',
            label: 'Status',
            align: 'center',
            render: (r) => {
                const style = r.enabled
                    ? 'background: var(--success-light); color: var(--success);'
                    : 'background: var(--bg-secondary); color: var(--text-secondary);';
                return `<span style="padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; ${style}">
                    ${r.enabled ? 'Enabled' : 'Disabled'}
                </span>`;
            }
        }
    ], {
        emptyMessage: 'No category rules configured.',
        rowClass: (rule) => rule.enabled ? '' : 'opacity: 0.5;'
    });
}

function displayPlaidMappings(mappings) {
    renderTable('plaidMappingsList', mappings, [
        {
            key: 'plaid_category',
            label: 'Plaid Category',
            render: (m) => `<span style="font-weight: 500;">${escapeHtml(m.plaid_category)}</span>`
        },
        {
            key: 'user_category',
            label: 'Your Category',
            render: (m) => `<span class="category-badge">${escapeHtml(m.user_category)}</span>`
        },
        {
            key: 'auto_created',
            label: 'Auto-Created',
            align: 'center',
            render: (m) => m.auto_created
                ? '<span style="color: var(--success);">✓</span>'
                : '<span style="color: var(--text-secondary);">Manual</span>'
        }
    ], {
        emptyMessage: 'No Plaid category mappings yet. These will be created automatically as transactions are synced.'
    });
}

export default {
    initializeMappingsPage,
    loadMappings
};
