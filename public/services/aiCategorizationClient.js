/**
 * AI Categorization Client Service
 * Frontend client for AI-powered transaction categorization
 */

import { fetchAPI } from './api.js';
import { showToast } from './toast.js';

class AICategorization {
    constructor() {
        this.status = null;
        this.checkStatus();
    }

    /**
     * Check AI service status
     */
    async checkStatus() {
        try {
            this.status = await fetchAPI('/api/ai/status');
            return this.status;
        } catch (error) {
            console.error('Failed to check AI status:', error);
            this.status = { aiAvailable: false, error: error.message };
            return this.status;
        }
    }

    /**
     * Check if AI is available
     */
    isAvailable() {
        return this.status?.aiAvailable === true;
    }

    /**
     * Get status message for display
     */
    getStatusMessage() {
        if (!this.status) return 'Checking AI service...';

        if (this.status.aiAvailable) {
            return `✓ AI Ready (${this.status.modelName})`;
        }

        return `Using ${this.status.fallbackMethod || 'Rule-based categorization'}`;
    }

    /**
     * Categorize a single transaction
     * @param {Object} transaction - Transaction to categorize
     * @returns {Object} { category, confidence, reasoning, method }
     */
    async categorizeOne(transaction) {
        try {
            const result = await fetchAPI('/api/ai/categorize', {
                method: 'POST',
                body: JSON.stringify({ transaction })
            });

            return result;
        } catch (error) {
            console.error('AI categorization failed:', error);
            showToast('Categorization failed: ' + error.message, 'error');
            throw error;
        }
    }

    /**
     * Categorize multiple transactions
     * @param {Array} transactions - Array of transactions
     * @param {Object} options - Batch options
     * @returns {Object} { results, count }
     */
    async categorizeBatch(transactions, options = {}) {
        try {
            const result = await fetchAPI('/api/ai/categorize/batch', {
                method: 'POST',
                body: JSON.stringify({ transactions, options })
            });

            return result;
        } catch (error) {
            console.error('Batch categorization failed:', error);
            showToast('Batch categorization failed: ' + error.message, 'error');
            throw error;
        }
    }

    /**
     * Auto-categorize all uncategorized transactions
     * @param {Object} options - Options
     * @returns {Object} { total, categorized, updated, results }
     */
    async autoCategorize(options = {}) {
        try {
            const result = await fetchAPI('/api/ai/auto-categorize', {
                method: 'POST',
                body: JSON.stringify(options)
            });

            return result;
        } catch (error) {
            console.error('Auto-categorization failed:', error);
            showToast('Auto-categorization failed: ' + error.message, 'error');
            throw error;
        }
    }

    /**
     * Suggest category for a transaction (with UI feedback)
     * @param {Object} transaction - Transaction to categorize
     * @param {Function} onSuggestion - Callback with suggestion
     */
    async suggestCategory(transaction, onSuggestion) {
        try {
            // Show loading state
            showToast('AI is analyzing transaction...', 'info', 2000);

            const result = await this.categorizeOne(transaction);

            // Call callback with suggestion
            if (onSuggestion) {
                onSuggestion(result);
            }

            // Show result
            const confidencePercent = Math.round(result.confidence * 100);
            const methodBadge = result.method === 'ai' ? '🤖' : '📋';

            showToast(
                `${methodBadge} Suggested: ${result.category} (${confidencePercent}% confident)`,
                result.confidence >= 0.7 ? 'success' : 'warning',
                4000
            );

            return result;
        } catch (error) {
            console.error('Failed to suggest category:', error);
            return null;
        }
    }

    /**
     * Learn from user's category choice
     * @param {Object} transaction - Transaction
     * @param {string} userCategory - User's chosen category
     */
    async learn(transaction, userCategory) {
        try {
            await fetchAPI('/api/ai/learn', {
                method: 'POST',
                body: JSON.stringify({ transaction, userCategory })
            });

            console.log(`AI learned: "${transaction.merchant_name}" → ${userCategory}`);
        } catch (error) {
            console.error('Failed to learn from correction:', error);
        }
    }

    /**
     * Show AI categorization modal for a transaction
     * @param {Object} transaction - Transaction to categorize
     * @param {Function} onApply - Callback when category is applied
     */
    async showSuggestionModal(transaction, onApply) {
        const { Modal } = await import('../components/Modal.js');
        const { escapeHtml } = await import('../utils/formatters.js');

        // Create modal with loading state
        const modal = new Modal({
            id: 'ai-categorization-modal',
            title: 'AI Category Suggestion',
            content: `
                <div class="ai-suggestion-loading">
                    <div class="spinner"></div>
                    <p>AI is analyzing this transaction...</p>
                </div>
            `,
            actions: [
                { action: 'cancel', label: 'Cancel', primary: false }
            ],
            options: { size: 'medium' }
        });

        modal.show();

        // Get AI suggestion
        try {
            const result = await this.categorizeOne(transaction);

            // Update modal with result
            const confidencePercent = Math.round(result.confidence * 100);

            // Method metadata mapping
            const METHOD_INFO = {
                'ai': { icon: '🤖', label: 'AI Model' },
                'merchant-mapping': { icon: '📋', label: 'Merchant Pattern' }
            };
            const methodInfo = METHOD_INFO[result.method] || { icon: '📋', label: 'Rule-based' };
            const methodIcon = methodInfo.icon;
            const methodLabel = methodInfo.label;

            modal.setContent(`
                <div class="ai-suggestion-result">
                    <div class="suggestion-header">
                        <div class="transaction-info">
                            <strong>${escapeHtml(transaction.description || 'Unknown')}</strong>
                            <div class="merchant">${escapeHtml(transaction.merchant_name || 'N/A')}</div>
                            <div class="amount">$${Math.abs(transaction.amount || 0).toFixed(2)}</div>
                        </div>
                    </div>

                    <div class="suggestion-category">
                        <label>Suggested Category:</label>
                        <div class="category-badge">
                            ${escapeHtml(result.category)}
                        </div>
                    </div>

                    <div class="suggestion-confidence">
                        <label>Confidence:</label>
                        <div class="confidence-bar">
                            <div class="confidence-fill" style="width: ${confidencePercent}%"></div>
                            <span class="confidence-text">${confidencePercent}%</span>
                        </div>
                    </div>

                    <div class="suggestion-method">
                        <label>Method:</label>
                        <span class="method-badge">${methodIcon} ${methodLabel}</span>
                    </div>

                    ${result.reasoning ? `
                        <div class="suggestion-reasoning">
                            <label>Reasoning:</label>
                            <p>${escapeHtml(result.reasoning)}</p>
                        </div>
                    ` : ''}
                </div>

                <style>
                    .ai-suggestion-loading {
                        text-align: center;
                        padding: 2rem;
                    }

                    .spinner {
                        border: 3px solid #f3f3f3;
                        border-top: 3px solid #3498db;
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        animation: spin 1s linear infinite;
                        margin: 0 auto 1rem;
                    }

                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }

                    .ai-suggestion-result > div {
                        margin-bottom: 1rem;
                    }

                    .transaction-info {
                        background: #f5f5f5;
                        padding: 1rem;
                        border-radius: 4px;
                        margin-bottom: 1.5rem;
                    }

                    .transaction-info strong {
                        display: block;
                        margin-bottom: 0.5rem;
                    }

                    .merchant, .amount {
                        color: #666;
                        font-size: 0.9em;
                    }

                    .category-badge {
                        display: inline-block;
                        background: #3498db;
                        color: white;
                        padding: 0.5rem 1rem;
                        border-radius: 4px;
                        font-weight: 500;
                        margin-top: 0.5rem;
                    }

                    .confidence-bar {
                        position: relative;
                        width: 100%;
                        height: 30px;
                        background: #f0f0f0;
                        border-radius: 4px;
                        overflow: hidden;
                        margin-top: 0.5rem;
                    }

                    .confidence-fill {
                        height: 100%;
                        background: linear-gradient(90deg, #e74c3c 0%, #f39c12 50%, #27ae60 100%);
                        transition: width 0.3s ease;
                    }

                    .confidence-text {
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        font-weight: 600;
                        color: #333;
                    }

                    .method-badge {
                        display: inline-block;
                        background: #ecf0f1;
                        padding: 0.25rem 0.75rem;
                        border-radius: 4px;
                        font-size: 0.9em;
                        margin-top: 0.5rem;
                    }

                    .suggestion-reasoning p {
                        color: #666;
                        font-style: italic;
                        margin-top: 0.5rem;
                    }

                    label {
                        font-weight: 600;
                        color: #555;
                        display: block;
                    }
                </style>
            `);

            // Update actions to include Apply button
            modal.actions = [
                { action: 'cancel', label: 'Ignore', primary: false },
                { action: 'apply', label: 'Apply Category', primary: true }
            ];

            // Re-render footer
            const footer = modal.modalElement.querySelector('.modal-footer');
            if (footer) {
                footer.innerHTML = modal.renderActions();

                // Re-attach action handlers
                footer.querySelectorAll('[data-action]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const action = btn.dataset.action;
                        if (action === 'apply' && onApply) {
                            onApply(result);
                        }
                        modal.close();
                    });
                });
            }

        } catch (error) {
            modal.setContent(`
                <div class="ai-suggestion-error">
                    <p style="color: #e74c3c;">❌ Failed to get AI suggestion</p>
                    <p style="color: #666; font-size: 0.9em;">${escapeHtml(error.message)}</p>
                </div>
            `);
        }
    }
}

// Export singleton instance
export const aiCategorization = new AICategorization();
export default aiCategorization;
