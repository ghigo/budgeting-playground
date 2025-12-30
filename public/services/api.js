/**
 * API Service Layer
 * Provides standardized API communication with automatic loading states,
 * error handling, and toast notifications
 */

import { showLoading, hideLoading } from '../utils/formatters.js';
import { showToast } from './toast.js';

const API_URL = '';

/**
 * Base fetch wrapper with error handling
 * @private
 */
async function baseFetch(endpoint, options = {}) {
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

/**
 * API Service Class
 */
class ApiService {
    /**
     * Make an API request with automatic loading and error handling
     * @param {string} endpoint - API endpoint
     * @param {Object} options - Fetch options
     * @param {Object} config - Request configuration
     * @param {boolean} config.showLoading - Show loading overlay (default: true)
     * @param {boolean} config.showSuccess - Show success toast (default: false)
     * @param {string} config.successMessage - Success toast message
     * @param {string} config.errorPrefix - Error message prefix (default: 'Failed')
     * @returns {Promise<*>} Response data
     */
    async request(endpoint, options = {}, config = {}) {
        const {
            showLoading: shouldShowLoading = false,
            showSuccess = false,
            successMessage = 'Success',
            errorPrefix = 'Failed'
        } = config;

        if (shouldShowLoading) showLoading();

        try {
            const data = await baseFetch(endpoint, options);

            if (showSuccess) {
                showToast(successMessage, 'success');
            }

            return data;
        } catch (error) {
            showToast(`${errorPrefix}: ${error.message}`, 'error');
            throw error;
        } finally {
            if (shouldShowLoading) hideLoading();
        }
    }

    /**
     * GET request
     */
    async get(endpoint, config = {}) {
        return this.request(endpoint, { method: 'GET' }, config);
    }

    /**
     * POST request
     */
    async post(endpoint, data, config = {}) {
        return this.request(
            endpoint,
            {
                method: 'POST',
                body: JSON.stringify(data)
            },
            config
        );
    }

    /**
     * PUT request
     */
    async put(endpoint, data, config = {}) {
        return this.request(
            endpoint,
            {
                method: 'PUT',
                body: JSON.stringify(data)
            },
            config
        );
    }

    /**
     * PATCH request
     */
    async patch(endpoint, data, config = {}) {
        return this.request(
            endpoint,
            {
                method: 'PATCH',
                body: JSON.stringify(data)
            },
            config
        );
    }

    /**
     * DELETE request
     */
    async delete(endpoint, config = {}) {
        return this.request(endpoint, { method: 'DELETE' }, config);
    }
}

// Export singleton instance
export const api = new ApiService();
export default api;

// Legacy compatibility - export fetchAPI for gradual migration
export async function fetchAPI(endpoint, options = {}) {
    return baseFetch(endpoint, options);
}
