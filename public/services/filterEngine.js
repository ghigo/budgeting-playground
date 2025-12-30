/**
 * FilterEngine Service
 * Provides unified filtering logic for transactions, Amazon orders, and other data
 */

export class FilterEngine {
    /**
     * Filter data based on filter configuration
     * @param {Array} data - Array of data to filter
     * @param {Object} filters - Filter values
     * @param {Object} schema - Filter schema defining how to apply filters
     * @returns {Array} Filtered data
     */
    static filter(data, filters, schema) {
        if (!data || data.length === 0) return data;

        return data.filter(item => {
            // Apply each filter
            for (const [filterKey, filterValue] of Object.entries(filters)) {
                const filterConfig = schema[filterKey];

                // Skip if no config or filter is not active
                if (!filterConfig || !this.isFilterActive(filterValue)) {
                    continue;
                }

                // Apply filter based on type
                if (!this.applyFilter(item, filterKey, filterValue, filterConfig)) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * Check if a filter value is active (not default/empty)
     */
    static isFilterActive(value) {
        if (value === null || value === undefined || value === '') return false;
        if (value === 'all') return false;
        return true;
    }

    /**
     * Apply a single filter to an item
     */
    static applyFilter(item, filterKey, filterValue, config) {
        const { type, field, customMatcher } = config;

        // Use custom matcher if provided
        if (customMatcher) {
            return customMatcher(item, filterValue);
        }

        // Get the field value from item
        const itemValue = this.getFieldValue(item, field || filterKey);

        // Apply filter based on type
        switch (type) {
            case 'search':
                return this.matchSearch(itemValue, filterValue);

            case 'exact':
                return this.matchExact(itemValue, filterValue);

            case 'dateRange':
                return this.matchDateRange(item, filterValue, config);

            case 'number':
                return this.matchNumber(itemValue, filterValue, config);

            case 'boolean':
                return this.matchBoolean(itemValue, filterValue);

            default:
                console.warn(`Unknown filter type: ${type}`);
                return true;
        }
    }

    /**
     * Get field value from item (supports nested fields with dot notation)
     */
    static getFieldValue(item, field) {
        if (!field) return item;

        if (field.includes('.')) {
            const parts = field.split('.');
            let value = item;
            for (const part of parts) {
                value = value[part];
                if (value === undefined) return undefined;
            }
            return value;
        }

        return item[field];
    }

    /**
     * Match search filter (case-insensitive substring match)
     */
    static matchSearch(itemValue, searchValue) {
        if (!searchValue) return true;
        if (!itemValue) return false;

        const searchLower = String(searchValue).toLowerCase();
        const itemLower = String(itemValue).toLowerCase();

        return itemLower.includes(searchLower);
    }

    /**
     * Match exact filter
     */
    static matchExact(itemValue, filterValue) {
        return itemValue === filterValue;
    }

    /**
     * Match date range filter
     */
    static matchDateRange(item, rangeValue, config) {
        const { dateField, startDateField, endDateField } = config;
        const itemDate = new Date(item[dateField || 'date']);

        if (rangeValue === 'custom') {
            const startDate = item[startDateField] ? new Date(item[startDateField]) : null;
            const endDate = item[endDateField] ? new Date(item[endDateField]) : null;

            if (startDate && itemDate < startDate) return false;
            if (endDate && itemDate > endDate) return false;
            return true;
        }

        // Predefined ranges
        const now = new Date();
        let startDate;

        switch (rangeValue) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;

            case 'thisWeek':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - now.getDay());
                startDate.setHours(0, 0, 0, 0);
                break;

            case 'thisMonth':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;

            case 'last30':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 30);
                break;

            case 'last90':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 90);
                break;

            case 'thisYear':
                startDate = new Date(now.getFullYear(), 0, 1);
                break;

            case 'lastYear':
                startDate = new Date(now.getFullYear() - 1, 0, 1);
                const endDate = new Date(now.getFullYear() - 1, 11, 31);
                return itemDate >= startDate && itemDate <= endDate;

            default:
                return true;
        }

        return itemDate >= startDate;
    }

    /**
     * Match number filter
     */
    static matchNumber(itemValue, filterValue, config) {
        const { operator = '=' } = config;
        const itemNum = parseFloat(itemValue);
        const filterNum = parseFloat(filterValue);

        if (isNaN(itemNum) || isNaN(filterNum)) return true;

        switch (operator) {
            case '=':
                return itemNum === filterNum;
            case '>':
                return itemNum > filterNum;
            case '>=':
                return itemNum >= filterNum;
            case '<':
                return itemNum < filterNum;
            case '<=':
                return itemNum <= filterNum;
            default:
                return true;
        }
    }

    /**
     * Match boolean filter
     */
    static matchBoolean(itemValue, filterValue) {
        return Boolean(itemValue) === Boolean(filterValue);
    }

    /**
     * Calculate date ranges for filtering
     */
    static getDateRange(rangeType) {
        const now = new Date();
        let startDate, endDate;

        switch (rangeType) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
                break;

            case 'thisWeek':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - now.getDay());
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(now);
                endDate.setDate(startDate.getDate() + 6);
                endDate.setHours(23, 59, 59);
                break;

            case 'thisMonth':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
                break;

            case 'last30':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 30);
                startDate.setHours(0, 0, 0, 0);
                endDate = now;
                break;

            case 'last90':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 90);
                startDate.setHours(0, 0, 0, 0);
                endDate = now;
                break;

            case 'thisYear':
                startDate = new Date(now.getFullYear(), 0, 1);
                endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
                break;

            case 'lastYear':
                startDate = new Date(now.getFullYear() - 1, 0, 1);
                endDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
                break;

            case 'all':
            default:
                return { startDate: null, endDate: null };
        }

        return { startDate, endDate };
    }

    /**
     * Sort data by field
     */
    static sort(data, sortField, sortDirection = 'asc') {
        if (!data || data.length === 0) return data;
        if (!sortField) return data;

        return [...data].sort((a, b) => {
            const aValue = this.getFieldValue(a, sortField);
            const bValue = this.getFieldValue(b, sortField);

            // Handle null/undefined
            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;

            // Compare values
            let comparison = 0;
            if (typeof aValue === 'string' && typeof bValue === 'string') {
                comparison = aValue.localeCompare(bValue);
            } else {
                comparison = aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
            }

            return sortDirection === 'asc' ? comparison : -comparison;
        });
    }

    /**
     * Group data by field
     */
    static groupBy(data, field) {
        if (!data || data.length === 0) return {};

        return data.reduce((groups, item) => {
            const key = this.getFieldValue(item, field);
            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(item);
            return groups;
        }, {});
    }

    /**
     * Aggregate data (sum, count, avg, etc.)
     */
    static aggregate(data, field, operation = 'sum') {
        if (!data || data.length === 0) return 0;

        const values = data.map(item => this.getFieldValue(item, field)).filter(v => v !== null && v !== undefined);

        switch (operation) {
            case 'sum':
                return values.reduce((sum, val) => sum + parseFloat(val), 0);

            case 'avg':
                return values.reduce((sum, val) => sum + parseFloat(val), 0) / values.length;

            case 'count':
                return values.length;

            case 'min':
                return Math.min(...values.map(v => parseFloat(v)));

            case 'max':
                return Math.max(...values.map(v => parseFloat(v)));

            default:
                return 0;
        }
    }
}

export default FilterEngine;
