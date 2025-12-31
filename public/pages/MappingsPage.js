/**
 * MappingsPage Module
 * Handles all auto-categorization mappings page functionality
 */

import { formatDate, escapeHtml, showLoading, hideLoading } from '../utils/formatters.js';
import { showToast } from '../services/toast.js';

// Dependencies (injected)
let fetchAPI = null;

export function initializeMappingsPage(deps) {
    fetchAPI = deps.fetchAPI;
}

export async function loadMappings() {
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

export default {
    initializeMappingsPage,
    loadMappings
};
