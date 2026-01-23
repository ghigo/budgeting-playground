/**
 * SettingsPage Module
 * Handles application settings display and modification
 */

import { showLoading, hideLoading, escapeHtml } from '../utils/formatters.js';
import { showToast } from '../services/toast.js';
import { eventBus } from '../services/eventBus.js';

// Dependencies (injected)
let fetchAPI = null;

let allSettings = {};

export function initializeSettingsPage(deps) {
    fetchAPI = deps.fetchAPI;

    // Expose functions globally
    window.loadSettingsPage = loadSettingsPage;
    window.updateSetting = updateSetting;
    window.resetSetting = resetSetting;
    window.resetAllSettings = resetAllSettings;
    window.exportCategories = exportCategories;
}

export async function loadSettingsPage() {
    showLoading();
    try {
        allSettings = await fetchAPI('/api/settings');
        displaySettings(allSettings);
    } catch (error) {
        showToast('Failed to load settings', 'error');
        console.error('Error loading settings:', error);
    } finally {
        hideLoading();
    }
}

function displaySettings(settings) {
    // Group by category
    const categories = {};
    Object.keys(settings).forEach(key => {
        const setting = settings[key];
        if (!categories[setting.category]) {
            categories[setting.category] = [];
        }
        categories[setting.category].push({ key, ...setting });
    });

    let html = `
        <style>
            .setting-toggle {
                position: relative;
                display: inline-block;
                width: 50px;
                height: 24px;
            }
            .setting-toggle input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            .setting-toggle-slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: #ccc;
                transition: 0.4s;
                border-radius: 24px;
            }
            .setting-toggle-slider:before {
                position: absolute;
                content: "";
                height: 18px;
                width: 18px;
                left: 3px;
                bottom: 3px;
                background-color: white;
                transition: 0.4s;
                border-radius: 50%;
            }
            .setting-toggle input:checked + .setting-toggle-slider {
                background-color: #3b82f6;
            }
            .setting-toggle input:checked + .setting-toggle-slider:before {
                transform: translateX(26px);
            }
        </style>
    `;

    Object.keys(categories).sort().forEach(categoryName => {
        html += `
            <div class="card" style="margin-bottom: 1.5rem;">
                <h3 style="margin-bottom: 1rem; color: #1e40af;">${escapeHtml(categoryName)}</h3>
                <div style="display: flex; flex-direction: column; gap: 1rem;">
        `;

        categories[categoryName].forEach(setting => {
            html += renderSettingControl(setting);
        });

        html += `
                </div>
            </div>
        `;
    });

    // Add export section
    html += `
        <div class="card" style="background: #dbeafe; border: 1px solid #3b82f6;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong style="color: #1e40af;">Export Data</strong>
                    <p style="margin: 0.5rem 0 0 0; color: #666; font-size: 0.9rem;">
                        Export all categories with descriptions and keywords to JSON
                    </p>
                </div>
                <button onclick="exportCategories()" class="btn" style="background: #3b82f6; color: white;">
                    Export Categories
                </button>
            </div>
        </div>
    `;

    // Add reset all button
    html += `
        <div class="card" style="background: #fee2e2; border: 1px solid #dc2626;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong style="color: #dc2626;">Danger Zone</strong>
                    <p style="margin: 0.5rem 0 0 0; color: #666; font-size: 0.9rem;">
                        Reset all settings to their default values
                    </p>
                </div>
                <button onclick="resetAllSettings()" class="btn" style="background: #dc2626; color: white;">
                    Reset All Settings
                </button>
            </div>
        </div>
    `;

    document.getElementById('settingsContainer').innerHTML = html;
}

function renderSettingControl(setting) {
    const { key, value, type, description, default: defaultValue, min, max, step } = setting;
    const isDefault = value === defaultValue;

    let controlHtml = '';

    if (type === 'boolean') {
        controlHtml = `
            <label class="setting-toggle">
                <input type="checkbox" id="setting_${key}" ${value ? 'checked' : ''}
                       onchange="updateSetting('${key}', this.checked)">
                <span class="setting-toggle-slider"></span>
            </label>
        `;
    } else if (type === 'number') {
        const stepAttr = step !== undefined ? `step="${step}"` : '';
        const minAttr = min !== undefined ? `min="${min}"` : '';
        const maxAttr = max !== undefined ? `max="${max}"` : '';

        controlHtml = `
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <input type="number" id="setting_${key}" value="${value}"
                       ${minAttr} ${maxAttr} ${stepAttr}
                       onchange="updateSetting('${key}', parseFloat(this.value))"
                       style="width: 150px; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; font-size: 0.9rem;">
                <span style="color: #666; font-size: 0.85rem;">
                    ${min !== undefined ? `(${min} - ${max})` : ''}
                </span>
            </div>
        `;
    } else {
        controlHtml = `
            <input type="text" id="setting_${key}" value="${escapeHtml(value.toString())}"
                   onchange="updateSetting('${key}', this.value)"
                   style="width: 300px; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; font-size: 0.9rem;">
        `;
    }

    // Helper to format default value display
    const formatDefaultValue = (type, value) => {
        if (type === 'boolean') {
            return value ? 'Enabled' : 'Disabled';
        }
        return value;
    };

    const backgroundColor = isDefault ? 'white' : '#fffbeb';
    const defaultValueText = formatDefaultValue(type, defaultValue);

    return `
        <div style="padding: 1rem; border: 1px solid #e5e7eb; border-radius: 8px; background: ${backgroundColor};">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 600; margin-bottom: 0.25rem;">${escapeHtml(description)}</div>
                    <div style="font-size: 0.85rem; color: #666; font-family: monospace;">${escapeHtml(key)}</div>
                    <div style="font-size: 0.85rem; color: #666; margin-top: 0.25rem;">
                        Default: ${defaultValueText}
                        ${!isDefault ? '<span style="color: #f59e0b; margin-left: 0.5rem;">● Modified</span>' : ''}
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0;">
                    ${controlHtml}
                    ${!isDefault ? `<button onclick="resetSetting('${key}')" class="btn btn-secondary" style="font-size: 0.85rem; padding: 0.4rem 0.75rem; white-space: nowrap;">Reset</button>` : ''}
                </div>
            </div>
        </div>
    `;
}

async function updateSetting(key, value) {
    try {
        await fetchAPI(`/api/settings/${key}`, {
            method: 'PUT',
            body: JSON.stringify({ value })
        });

        showToast('Setting updated successfully', 'success');
        await loadSettingsPage(); // Reload to show updated state
        eventBus.emit('settingsUpdated'); // Notify other pages
    } catch (error) {
        showToast(`Failed to update setting: ${error.message}`, 'error');
        console.error('Error updating setting:', error);
    }
}

async function resetSetting(key) {
    try {
        await fetchAPI(`/api/settings/${key}`, {
            method: 'DELETE'
        });

        showToast('Setting reset to default', 'success');
        await loadSettingsPage(); // Reload to show default value
        eventBus.emit('settingsUpdated'); // Notify other pages
    } catch (error) {
        showToast(`Failed to reset setting: ${error.message}`, 'error');
        console.error('Error resetting setting:', error);
    }
}

async function resetAllSettings() {
    if (!confirm('Are you sure you want to reset ALL settings to defaults? This cannot be undone.')) {
        return;
    }

    try {
        await fetchAPI('/api/settings/reset-all', {
            method: 'POST'
        });

        showToast('All settings reset to defaults', 'success');
        await loadSettingsPage();
        eventBus.emit('settingsUpdated'); // Notify other pages
    } catch (error) {
        showToast(`Failed to reset settings: ${error.message}`, 'error');
        console.error('Error resetting all settings:', error);
    }
}

async function exportCategories() {
    try {
        showLoading();

        // Fetch all categories from the API
        const categories = await fetchAPI('/api/categories');

        // Create a clean export format with only relevant fields
        const exportData = categories.map(cat => ({
            name: cat.name,
            description: cat.description || '',
            keywords: cat.keywords || '',
            icon: cat.icon || '',
            color: cat.color || ''
        }));

        // Convert to JSON with pretty formatting
        const jsonString = JSON.stringify(exportData, null, 2);

        // Create a blob and download link
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        // Generate filename with current date
        const date = new Date().toISOString().split('T')[0];
        link.download = `categories-export-${date}.json`;

        // Trigger download
        document.body.appendChild(link);
        link.click();

        // Cleanup
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast(`Exported ${categories.length} categories to JSON`, 'success');
    } catch (error) {
        showToast(`Failed to export categories: ${error.message}`, 'error');
        console.error('Error exporting categories:', error);
    } finally {
        hideLoading();
    }
}

export default {
    initializeSettingsPage,
    loadSettingsPage
};
