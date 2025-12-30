/**
 * Centralized State Management Service
 * Provides reactive state management with EventBus integration
 */

import { eventBus } from './eventBus.js';

class StateManager {
    constructor() {
        // Core data
        this.state = {
            // Navigation
            currentPage: 'dashboard',

            // Financial data
            transactions: [],
            accounts: [],
            categories: [],
            amazonOrders: [],

            // Filter states
            currentFilters: {
                search: '',
                account: 'all',
                category: 'all',
                dateRange: 'all',
                startDate: '',
                endDate: ''
            },

            currentTransactionFilters: {
                search: '',
                account: 'all',
                category: 'all',
                dateRange: 'all',
                startDate: '',
                endDate: ''
            },

            amazonFilters: {
                search: '',
                matchStatus: 'all',
                dateRange: 'all',
                startDate: '',
                endDate: ''
            },

            // UI state
            selectedTransaction: null,
            selectedAmazonOrder: null,
            newlyMatchedAmazonOrderIds: new Set(),

            // Chart state
            currentTimeRange: 'all',
            amazonCurrentTimeRange: 'all',

            // Data summaries
            totalExpenses: 0,
            totalIncome: 0,
            netCashFlow: 0
        };
    }

    /**
     * Get a value from state
     * @param {string} key - State key (supports dot notation like 'currentFilters.search')
     */
    get(key) {
        if (key.includes('.')) {
            const parts = key.split('.');
            let value = this.state;
            for (const part of parts) {
                value = value[part];
                if (value === undefined) return undefined;
            }
            return value;
        }
        return this.state[key];
    }

    /**
     * Set a value in state and emit change event
     * @param {string} key - State key (supports dot notation)
     * @param {*} value - New value
     * @param {boolean} silent - If true, don't emit events (default: false)
     */
    set(key, value, silent = false) {
        const oldValue = this.get(key);

        if (key.includes('.')) {
            const parts = key.split('.');
            let obj = this.state;
            for (let i = 0; i < parts.length - 1; i++) {
                obj = obj[parts[i]];
            }
            obj[parts[parts.length - 1]] = value;
        } else {
            this.state[key] = value;
        }

        if (!silent) {
            eventBus.emit(`state:${key}`, { oldValue, newValue: value });
            eventBus.emit('state:changed', { key, oldValue, newValue: value });
        }
    }

    /**
     * Update multiple state values at once
     * @param {Object} updates - Object with key-value pairs to update
     * @param {boolean} silent - If true, don't emit events
     */
    update(updates, silent = false) {
        for (const [key, value] of Object.entries(updates)) {
            this.set(key, value, silent);
        }
    }

    /**
     * Get entire state object (use sparingly)
     */
    getAll() {
        return { ...this.state };
    }

    /**
     * Reset state to initial values
     */
    reset() {
        const currentPage = this.state.currentPage;
        this.state = {
            currentPage,
            transactions: [],
            accounts: [],
            categories: [],
            amazonOrders: [],
            currentFilters: {
                search: '',
                account: 'all',
                category: 'all',
                dateRange: 'all',
                startDate: '',
                endDate: ''
            },
            currentTransactionFilters: {
                search: '',
                account: 'all',
                category: 'all',
                dateRange: 'all',
                startDate: '',
                endDate: ''
            },
            amazonFilters: {
                search: '',
                matchStatus: 'all',
                dateRange: 'all',
                startDate: '',
                endDate: ''
            },
            selectedTransaction: null,
            selectedAmazonOrder: null,
            newlyMatchedAmazonOrderIds: new Set(),
            currentTimeRange: 'all',
            amazonCurrentTimeRange: 'all',
            totalExpenses: 0,
            totalIncome: 0,
            netCashFlow: 0
        };
        eventBus.emit('state:reset');
    }

    /**
     * Subscribe to state changes
     * @param {string} key - State key to watch (or 'changed' for all changes)
     * @param {Function} callback - Callback function
     */
    watch(key, callback) {
        eventBus.on(`state:${key}`, callback);
    }

    /**
     * Unsubscribe from state changes
     * @param {string} key - State key
     * @param {Function} callback - Callback function to remove
     */
    unwatch(key, callback) {
        eventBus.off(`state:${key}`, callback);
    }

    // Convenience methods for common operations

    /**
     * Set current page and emit navigation event
     */
    setPage(page) {
        const oldPage = this.state.currentPage;
        this.state.currentPage = page;
        eventBus.emit('page:changed', { from: oldPage, to: page });
    }

    /**
     * Update transactions and emit event
     */
    setTransactions(transactions) {
        this.state.transactions = transactions;
        eventBus.emit('transactions:updated', transactions);
    }

    /**
     * Update accounts and emit event
     */
    setAccounts(accounts) {
        this.state.accounts = accounts;
        eventBus.emit('accounts:updated', accounts);
    }

    /**
     * Update categories and emit event
     */
    setCategories(categories) {
        this.state.categories = categories;
        eventBus.emit('categories:updated', categories);
    }

    /**
     * Update Amazon orders and emit event
     */
    setAmazonOrders(orders) {
        this.state.amazonOrders = orders;
        eventBus.emit('amazon:updated', orders);
    }

    /**
     * Update filters and emit event
     */
    setFilters(filters) {
        this.state.currentFilters = { ...this.state.currentFilters, ...filters };
        eventBus.emit('filters:updated', this.state.currentFilters);
    }

    /**
     * Update transaction filters and emit event
     */
    setTransactionFilters(filters) {
        this.state.currentTransactionFilters = { ...this.state.currentTransactionFilters, ...filters };
        eventBus.emit('transaction-filters:updated', this.state.currentTransactionFilters);
    }

    /**
     * Update Amazon filters and emit event
     */
    setAmazonFilters(filters) {
        this.state.amazonFilters = { ...this.state.amazonFilters, ...filters };
        eventBus.emit('amazon-filters:updated', this.state.amazonFilters);
    }

    /**
     * Add newly matched Amazon order IDs
     */
    addNewlyMatchedOrderIds(orderIds) {
        orderIds.forEach(id => this.state.newlyMatchedAmazonOrderIds.add(id));
        eventBus.emit('amazon:newly-matched', Array.from(this.state.newlyMatchedAmazonOrderIds));
    }

    /**
     * Clear newly matched Amazon order IDs
     */
    clearNewlyMatchedOrderIds() {
        this.state.newlyMatchedAmazonOrderIds.clear();
        eventBus.emit('amazon:newly-matched-cleared');
    }
}

// Export singleton instance
export const state = new StateManager();
export default state;
