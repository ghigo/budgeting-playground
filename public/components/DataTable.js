/**
 * DataTable Component
 * Configurable, reusable data table with sorting and actions
 */

import { eventBus } from '../services/eventBus.js';
import { escapeHtml } from '../utils/formatters.js';

export class DataTable {
    /**
     * Create a DataTable
     * @param {Object} config - Configuration object
     * @param {string} config.containerId - ID of container element
     * @param {Array} config.columns - Column definitions
     * @param {Array} config.data - Data array
     * @param {Object} config.options - Display options
     * @param {string} config.emptyMessage - Message when no data
     * @param {string} config.eventPrefix - Prefix for event names
     */
    constructor(config) {
        this.containerId = config.containerId;
        this.columns = config.columns || [];
        this.data = config.data || [];
        this.options = {
            showHeader: true,
            hoverable: true,
            striped: false,
            ...config.options
        };
        this.emptyMessage = config.emptyMessage || 'No data available';
        this.eventPrefix = config.eventPrefix || 'table';
    }

    /**
     * Render the table
     */
    render() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`DataTable: Container #${this.containerId} not found`);
            return;
        }

        if (this.data.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>${escapeHtml(this.emptyMessage)}</p>
                </div>
            `;
            return;
        }

        const tableClass = [
            'data-table',
            this.options.hoverable ? 'hoverable' : '',
            this.options.striped ? 'striped' : ''
        ].filter(Boolean).join(' ');

        const html = `
            <div class="table-container">
                <table class="${tableClass}">
                    ${this.options.showHeader ? this.renderHeader() : ''}
                    <tbody>
                        ${this.data.map((row, index) => this.renderRow(row, index)).join('')}
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
        this.attachEventListeners();
    }

    /**
     * Render table header
     */
    renderHeader() {
        return `
            <thead>
                <tr>
                    ${this.columns.map(col => `
                        <th ${col.width ? `style="width: ${col.width}"` : ''}>
                            ${escapeHtml(col.label)}
                        </th>
                    `).join('')}
                </tr>
            </thead>
        `;
    }

    /**
     * Render a table row
     */
    renderRow(row, index) {
        const rowClass = row._className || '';
        const rowId = row._id || index;

        return `
            <tr class="${rowClass}" data-row-id="${rowId}" data-row-index="${index}">
                ${this.columns.map(col => this.renderCell(row, col)).join('')}
            </tr>
        `;
    }

    /**
     * Render a table cell
     */
    renderCell(row, column) {
        const { key, render, className, align } = column;

        let content;
        if (render) {
            // Custom renderer function
            content = render(row[key], row);
        } else {
            // Default: escape and display value
            content = escapeHtml(String(row[key] || ''));
        }

        const cellClass = className || '';
        const cellAlign = align ? `style="text-align: ${align}"` : '';

        return `<td class="${cellClass}" ${cellAlign}>${content}</td>`;
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        // Delegate click events from table rows
        container.addEventListener('click', (e) => {
            // Handle action buttons
            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                const rowElement = actionBtn.closest('tr');
                if (rowElement) {
                    const rowIndex = parseInt(rowElement.dataset.rowIndex);
                    const rowId = rowElement.dataset.rowId;
                    const rowData = this.data[rowIndex];

                    eventBus.emit(`${this.eventPrefix}:action`, {
                        action,
                        rowData,
                        rowId,
                        rowIndex
                    });

                    // Also emit specific action event
                    eventBus.emit(`${this.eventPrefix}:${action}`, {
                        rowData,
                        rowId,
                        rowIndex
                    });
                }
            }

            // Handle row clicks
            const row = e.target.closest('tr[data-row-id]');
            if (row && !actionBtn) {
                const rowIndex = parseInt(row.dataset.rowIndex);
                const rowId = row.dataset.rowId;
                const rowData = this.data[rowIndex];

                eventBus.emit(`${this.eventPrefix}:row-click`, {
                    rowData,
                    rowId,
                    rowIndex
                });
            }
        });
    }

    /**
     * Update table data and re-render
     */
    setData(data) {
        this.data = data;
        this.render();
    }

    /**
     * Append data to table
     */
    appendData(newData) {
        this.data.push(...newData);
        this.render();
    }

    /**
     * Update a single row
     */
    updateRow(rowId, newData) {
        const index = this.data.findIndex(row =>
            (row._id !== undefined ? row._id === rowId : this.data.indexOf(row) === rowId)
        );

        if (index !== -1) {
            this.data[index] = { ...this.data[index], ...newData };
            this.render();
        }
    }

    /**
     * Remove a row
     */
    removeRow(rowId) {
        const index = this.data.findIndex(row =>
            (row._id !== undefined ? row._id === rowId : this.data.indexOf(row) === rowId)
        );

        if (index !== -1) {
            this.data.splice(index, 1);
            this.render();
        }
    }

    /**
     * Clear all data
     */
    clear() {
        this.data = [];
        this.render();
    }

    /**
     * Get current data
     */
    getData() {
        return this.data;
    }

    /**
     * Destroy the table
     */
    destroy() {
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }
        this.data = [];
    }
}

/**
 * Helper function to create action buttons
 */
export function createActionButton(action, label, className = '') {
    return `
        <button
            class="action-btn ${className}"
            data-action="${escapeHtml(action)}"
            type="button"
        >
            ${escapeHtml(label)}
        </button>
    `;
}

/**
 * Helper function to create multiple action buttons
 */
export function createActionButtons(actions) {
    return `
        <div class="action-buttons">
            ${actions.map(({ action, label, className }) =>
                createActionButton(action, label, className)
            ).join('')}
        </div>
    `;
}

export default DataTable;
