/**
 * FilterPanel Component
 * Configurable, reusable filter panel for data tables
 */

import { eventBus } from '../services/eventBus.js';

export class FilterPanel {
    /**
     * Create a FilterPanel
     * @param {Object} config - Configuration object
     * @param {string} config.containerId - ID of container element
     * @param {Array} config.filters - Array of filter configurations
     * @param {Function} config.onChange - Callback when filters change
     * @param {string} config.eventPrefix - Prefix for event names (optional)
     */
    constructor(config) {
        this.containerId = config.containerId;
        this.filters = config.filters || [];
        this.onChange = config.onChange;
        this.eventPrefix = config.eventPrefix || 'filter';
        this.values = {};

        // Initialize default values
        this.filters.forEach(filter => {
            this.values[filter.name] = filter.defaultValue || '';
        });
    }

    /**
     * Render the filter panel
     */
    render() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`FilterPanel: Container #${this.containerId} not found`);
            return;
        }

        const html = `
            <div class="filter-panel">
                <div class="filter-grid">
                    ${this.filters.map(filter => this.renderFilter(filter)).join('')}
                </div>
                <div class="filter-actions">
                    <button class="clear-filters-btn" id="${this.containerId}-clear">
                        Clear Filters
                    </button>
                </div>
            </div>
        `;

        container.innerHTML = html;
        this.attachEventListeners();
    }

    /**
     * Render a single filter control
     */
    renderFilter(filter) {
        const { type, name, label, placeholder, options } = filter;

        switch (type) {
            case 'search':
                return `
                    <div class="filter-item">
                        <label for="${this.containerId}-${name}">${label}</label>
                        <input
                            type="text"
                            id="${this.containerId}-${name}"
                            name="${name}"
                            placeholder="${placeholder || ''}"
                            value="${this.values[name] || ''}"
                        />
                    </div>
                `;

            case 'select':
                return `
                    <div class="filter-item">
                        <label for="${this.containerId}-${name}">${label}</label>
                        <select id="${this.containerId}-${name}" name="${name}">
                            ${options.map(opt => `
                                <option value="${opt.value}" ${this.values[name] === opt.value ? 'selected' : ''}>
                                    ${opt.label}
                                </option>
                            `).join('')}
                        </select>
                    </div>
                `;

            case 'dateRange':
                return `
                    <div class="filter-item">
                        <label for="${this.containerId}-${name}">${label}</label>
                        <select id="${this.containerId}-${name}" name="${name}">
                            ${options.map(opt => `
                                <option value="${opt.value}" ${this.values[name] === opt.value ? 'selected' : ''}>
                                    ${opt.label}
                                </option>
                            `).join('')}
                        </select>
                    </div>
                `;

            case 'date':
                return `
                    <div class="filter-item">
                        <label for="${this.containerId}-${name}">${label}</label>
                        <input
                            type="date"
                            id="${this.containerId}-${name}"
                            name="${name}"
                            value="${this.values[name] || ''}"
                        />
                    </div>
                `;

            default:
                console.warn(`FilterPanel: Unknown filter type "${type}"`);
                return '';
        }
    }

    /**
     * Attach event listeners to filter controls
     */
    attachEventListeners() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        // Listen to all input/select changes
        this.filters.forEach(filter => {
            const element = document.getElementById(`${this.containerId}-${filter.name}`);
            if (!element) return;

            const eventType = filter.type === 'search' ? 'input' : 'change';
            element.addEventListener(eventType, (e) => {
                this.values[filter.name] = e.target.value;
                this.handleChange(filter.name, e.target.value);
            });
        });

        // Clear filters button
        const clearBtn = document.getElementById(`${this.containerId}-clear`);
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clear());
        }
    }

    /**
     * Handle filter value change
     */
    handleChange(filterName, value) {
        // Update custom date inputs visibility if dateRange changed
        const dateRangeFilter = this.filters.find(f => f.type === 'dateRange');
        if (dateRangeFilter && filterName === dateRangeFilter.name) {
            this.updateCustomDateVisibility(value);
        }

        // Emit event
        eventBus.emit(`${this.eventPrefix}:changed`, {
            filterName,
            value,
            allValues: this.getValues()
        });

        // Call onChange callback
        if (this.onChange) {
            this.onChange(this.getValues());
        }
    }

    /**
     * Update visibility of custom date inputs based on dateRange value
     */
    updateCustomDateVisibility(dateRangeValue) {
        const startDateElement = document.getElementById(`${this.containerId}-startDate`);
        const endDateElement = document.getElementById(`${this.containerId}-endDate`);

        if (startDateElement && endDateElement) {
            const isCustom = dateRangeValue === 'custom';
            startDateElement.closest('.filter-item').style.display = isCustom ? 'block' : 'none';
            endDateElement.closest('.filter-item').style.display = isCustom ? 'block' : 'none';
        }
    }

    /**
     * Get all filter values
     */
    getValues() {
        return { ...this.values };
    }

    /**
     * Set filter values
     */
    setValues(values) {
        Object.entries(values).forEach(([name, value]) => {
            this.values[name] = value;
            const element = document.getElementById(`${this.containerId}-${name}`);
            if (element) {
                element.value = value;
            }
        });

        // Update custom date visibility
        const dateRangeFilter = this.filters.find(f => f.type === 'dateRange');
        if (dateRangeFilter) {
            this.updateCustomDateVisibility(this.values[dateRangeFilter.name]);
        }
    }

    /**
     * Clear all filters
     */
    clear() {
        this.filters.forEach(filter => {
            this.values[filter.name] = filter.defaultValue || '';
        });

        // Reset all input/select elements
        this.filters.forEach(filter => {
            const element = document.getElementById(`${this.containerId}-${filter.name}`);
            if (element) {
                element.value = filter.defaultValue || '';
            }
        });

        // Update custom date visibility
        const dateRangeFilter = this.filters.find(f => f.type === 'dateRange');
        if (dateRangeFilter) {
            this.updateCustomDateVisibility(this.values[dateRangeFilter.name]);
        }

        // Emit event
        eventBus.emit(`${this.eventPrefix}:cleared`, this.getValues());

        // Call onChange callback
        if (this.onChange) {
            this.onChange(this.getValues());
        }
    }

    /**
     * Update filter options (for dynamic filters like account/category)
     */
    updateOptions(filterName, options) {
        const filter = this.filters.find(f => f.name === filterName);
        if (!filter) return;

        filter.options = options;

        // Re-render just this filter
        const element = document.getElementById(`${this.containerId}-${filterName}`);
        if (element && filter.type === 'select') {
            const currentValue = element.value;
            element.innerHTML = options.map(opt => `
                <option value="${opt.value}" ${currentValue === opt.value ? 'selected' : ''}>
                    ${opt.label}
                </option>
            `).join('');
        }
    }

    /**
     * Destroy the filter panel
     */
    destroy() {
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }
        this.values = {};
    }
}

export default FilterPanel;
