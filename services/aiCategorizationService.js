/**
 * AI Categorization Service
 * Provides intelligent transaction categorization using local AI models
 * Falls back to enhanced rule-based categorization when AI is unavailable
 */

import * as database from '../src/database.js';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

class AICategorization {
    constructor() {
        this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        this.modelName = process.env.OLLAMA_MODEL || 'phi3:mini';
        this.isOllamaAvailable = false;
        this.ollamaProcess = null;
        this.checkOllamaAvailability();
    }

    /**
     * Check if Ollama is installed on the system
     */
    async isOllamaInstalled() {
        try {
            await execAsync('which ollama');
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Start Ollama server
     */
    async startOllama() {
        if (this.ollamaProcess) {
            console.log('ℹ Ollama process already started');
            return;
        }

        try {
            console.log('🚀 Starting Ollama server...');

            // Spawn ollama serve in background
            this.ollamaProcess = spawn('ollama', ['serve'], {
                detached: true,
                stdio: 'ignore'
            });

            // Don't keep parent process waiting for child
            this.ollamaProcess.unref();

            // Wait a bit for Ollama to start
            await new Promise(resolve => setTimeout(resolve, 3000));

            console.log('✓ Ollama server started');
        } catch (error) {
            console.error('Failed to start Ollama:', error.message);
            this.ollamaProcess = null;
        }
    }

    /**
     * Check if Ollama is available and start it if needed
     */
    async checkOllamaAvailability() {
        try {
            // Try to connect to Ollama
            const response = await fetch(`${this.ollamaUrl}/api/tags`, {
                signal: AbortSignal.timeout(2000)
            });

            if (response.ok) {
                const data = await response.json();
                this.isOllamaAvailable = data.models?.some(m => m.name.includes('phi3'));

                if (this.isOllamaAvailable) {
                    console.log('✓ Ollama is available with Phi-3 model');
                } else {
                    console.log('⚠ Ollama is running but Phi-3 model not found.');
                    console.log('  To enable AI categorization, run: ollama pull phi3:mini');
                }
                return;
            }
        } catch (error) {
            // Ollama is not responding - try to start it
            console.log('ℹ Ollama not responding - checking if installed...');

            const isInstalled = await this.isOllamaInstalled();

            if (isInstalled) {
                console.log('✓ Ollama is installed - attempting to start...');
                await this.startOllama();

                // Check again after starting
                try {
                    const response = await fetch(`${this.ollamaUrl}/api/tags`, {
                        signal: AbortSignal.timeout(2000)
                    });

                    if (response.ok) {
                        const data = await response.json();
                        this.isOllamaAvailable = data.models?.some(m => m.name.includes('phi3'));

                        if (this.isOllamaAvailable) {
                            console.log('✓ Ollama started successfully with Phi-3 model');
                        } else {
                            console.log('⚠ Ollama started but Phi-3 model not found.');
                            console.log('  To enable AI categorization, run: ollama pull phi3:mini');
                        }
                        return;
                    }
                } catch (retryError) {
                    console.log('⚠ Failed to start Ollama automatically');
                }
            } else {
                console.log('ℹ Ollama not installed. Install it to enable AI categorization:');
                console.log('  Mac: brew install ollama');
                console.log('  Linux: curl -fsSL https://ollama.com/install.sh | sh');
                console.log('  Windows: https://ollama.com/download');
            }

            this.isOllamaAvailable = false;
            console.log('ℹ Using enhanced rule-based categorization');
        }
    }

    /**
     * Categorize a transaction using AI or fallback methods
     * @param {Object} transaction - Transaction to categorize
     * @param {Array} categories - Available categories
     * @returns {Object} { category, confidence, reasoning, method }
     */
    async categorizeTransaction(transaction, categories = null) {
        // Get categories if not provided
        if (!categories) {
            categories = database.getCategories();
        }

        // Try AI categorization if available
        if (this.isOllamaAvailable) {
            try {
                const aiResult = await this.categorizeWithAI(transaction, categories);
                if (aiResult.confidence > 0.5) {
                    return { ...aiResult, method: 'ai' };
                }
            } catch (error) {
                console.error('AI categorization failed:', error.message);
            }
        }

        // Fallback to enhanced rule-based categorization
        return this.categorizeWithRules(transaction, categories);
    }

    /**
     * Categorize using Ollama AI
     */
    async categorizeWithAI(transaction, categories) {
        const prompt = this.buildPrompt(transaction, categories);

        const response = await fetch(`${this.ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.modelName,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.1,  // Low for consistency
                    num_predict: 100   // Limit response length
                }
            }),
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status}`);
        }

        const result = await response.json();
        return this.parseAIResponse(result.response, categories);
    }

    /**
     * Build AI prompt for categorization
     */
    buildPrompt(transaction, categories) {
        const categoryList = categories
            .map(c => `- ${c.name}${c.description ? ` (${c.description})` : ''}`)
            .join('\n');

        // Get examples from existing mappings
        const examples = this.getExampleMappings();

        return `You are a financial transaction categorizer. Analyze the transaction and select the MOST appropriate category.

Transaction Details:
- Description: ${transaction.description || 'N/A'}
- Merchant: ${transaction.merchant_name || 'N/A'}
- Amount: $${Math.abs(transaction.amount || 0).toFixed(2)}
- Type: ${transaction.amount < 0 ? 'Expense' : 'Income'}

Available Categories:
${categoryList}

${examples ? `Examples from user's history:\n${examples}\n` : ''}

Respond in JSON format:
{
  "category": "Category Name",
  "confidence": 0.95,
  "reasoning": "Brief explanation"
}`;
    }

    /**
     * Get example mappings for few-shot learning
     */
    getExampleMappings() {
        try {
            const mappings = database.getMerchantMappings();

            if (!mappings || mappings.length === 0) return '';

            // Get top 5 by usage
            const topMappings = mappings
                .sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
                .slice(0, 5);

            return topMappings
                .map(m => `- "${m.merchant_pattern}" → ${m.category}`)
                .join('\n');
        } catch (error) {
            return '';
        }
    }

    /**
     * Parse AI response
     */
    parseAIResponse(response, categories) {
        try {
            // Try to extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);

                // Validate category exists
                const category = categories.find(c =>
                    c.name.toLowerCase() === parsed.category.toLowerCase()
                );

                if (category) {
                    return {
                        category: category.name,
                        confidence: parsed.confidence || 0.7,
                        reasoning: parsed.reasoning || 'AI categorization'
                    };
                }
            }

            // If JSON parsing fails, try to find category name in response
            for (const cat of categories) {
                if (response.toLowerCase().includes(cat.name.toLowerCase())) {
                    return {
                        category: cat.name,
                        confidence: 0.6,
                        reasoning: 'Category mentioned in AI response'
                    };
                }
            }

            throw new Error('Could not parse AI response');
        } catch (error) {
            throw new Error(`Failed to parse AI response: ${error.message}`);
        }
    }

    /**
     * Enhanced rule-based categorization (fallback)
     */
    categorizeWithRules(transaction, categories) {
        const description = (transaction.description || '').toLowerCase();
        const merchant = (transaction.merchant_name || '').toLowerCase();
        const amount = Math.abs(transaction.amount || 0);
        const isIncome = transaction.amount > 0;

        // 1. Check existing merchant mappings
        const merchantMapping = this.checkMerchantMapping(merchant);
        if (merchantMapping) {
            return {
                category: merchantMapping.category,
                confidence: 0.95,
                reasoning: `Matched merchant mapping for "${merchantMapping.pattern}"`,
                method: 'merchant-mapping'
            };
        }

        // 2. Check rule-based mappings
        const ruleMapping = this.checkRuleMappings(description, merchant);
        if (ruleMapping) {
            return {
                category: ruleMapping.category,
                confidence: 0.90,
                reasoning: `Matched rule: ${ruleMapping.rule}`,
                method: 'rule-based'
            };
        }

        // 3. Pattern matching with common merchants/keywords
        const patternMatch = this.patternMatching(description, merchant, amount, categories);
        if (patternMatch) {
            return {
                ...patternMatch,
                method: 'pattern-matching'
            };
        }

        // 4. Default to Uncategorized
        const uncategorized = categories.find(c =>
            c.name.toLowerCase() === 'uncategorized'
        );

        return {
            category: uncategorized?.name || 'Uncategorized',
            confidence: 0.1,
            reasoning: 'No matching patterns found',
            method: 'fallback'
        };
    }

    /**
     * Check merchant mappings
     */
    checkMerchantMapping(merchant) {
        try {
            const mappings = database.getMerchantMappings();
            if (!mappings) return null;

            // Find mappings that match the merchant
            const matches = mappings
                .filter(m => merchant.toLowerCase().includes(m.merchant_pattern.toLowerCase()))
                .sort((a, b) => b.merchant_pattern.length - a.merchant_pattern.length);

            if (matches.length > 0) {
                return {
                    category: matches[0].category,
                    pattern: matches[0].merchant_pattern
                };
            }

            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Check rule-based mappings
     */
    checkRuleMappings(description, merchant) {
        try {
            const text = `${description} ${merchant}`.toLowerCase();
            const rules = database.getCategoryRules();

            if (!rules) return null;

            // Find rules that match
            const matches = rules
                .filter(r => text.includes(r.pattern.toLowerCase()))
                .sort((a, b) => b.pattern.length - a.pattern.length);

            if (matches.length > 0) {
                return {
                    category: matches[0].category,
                    rule: matches[0].pattern
                };
            }

            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Pattern matching with common keywords
     */
    patternMatching(description, merchant, amount, categories) {
        const text = `${description} ${merchant}`;

        // Define common patterns
        const patterns = [
            // Groceries
            { keywords: ['grocery', 'supermarket', 'whole foods', 'trader joe', 'safeway', 'kroger', 'wegmans', 'publix', 'food lion'], category: 'Groceries', confidence: 0.85 },

            // Restaurants
            { keywords: ['restaurant', 'cafe', 'coffee', 'starbucks', 'dunkin', 'pizza', 'burger', 'mcdonald', 'chipotle', 'subway'], category: 'Dining', confidence: 0.85 },

            // Gas/Transportation
            { keywords: ['shell', 'exxon', 'chevron', 'bp gas', 'mobil', 'gas station', 'fuel', 'parking'], category: 'Transportation', confidence: 0.85 },

            // Shopping
            { keywords: ['amazon', 'target', 'walmart', 'costco', 'best buy', 'home depot', 'lowes', 'ikea'], category: 'Shopping', confidence: 0.80 },

            // Utilities
            { keywords: ['electric', 'water', 'gas company', 'utility', 'internet', 'phone bill', 'cable'], category: 'Utilities', confidence: 0.90 },

            // Entertainment
            { keywords: ['netflix', 'spotify', 'hulu', 'disney', 'movie', 'theater', 'cinema', 'concert'], category: 'Entertainment', confidence: 0.85 },

            // Healthcare
            { keywords: ['pharmacy', 'cvs', 'walgreens', 'hospital', 'medical', 'doctor', 'clinic', 'healthcare'], category: 'Healthcare', confidence: 0.85 },

            // Income
            { keywords: ['payroll', 'salary', 'deposit', 'direct dep', 'payment received'], category: 'Income', confidence: 0.90 }
        ];

        // Check each pattern
        for (const pattern of patterns) {
            for (const keyword of pattern.keywords) {
                if (text.includes(keyword)) {
                    // Verify category exists
                    const category = categories.find(c =>
                        c.name.toLowerCase() === pattern.category.toLowerCase()
                    );

                    if (category) {
                        return {
                            category: category.name,
                            confidence: pattern.confidence,
                            reasoning: `Matched keyword "${keyword}"`
                        };
                    }
                }
            }
        }

        return null;
    }

    /**
     * Batch categorize multiple transactions
     */
    async batchCategorize(transactions, options = {}) {
        const categories = database.getCategories();
        const results = [];

        // Categorize in batches to avoid overwhelming the AI
        const batchSize = options.batchSize || 10;

        for (let i = 0; i < transactions.length; i += batchSize) {
            const batch = transactions.slice(i, i + batchSize);

            const batchResults = await Promise.all(
                batch.map(transaction =>
                    this.categorizeTransaction(transaction, categories)
                )
            );

            results.push(...batchResults);

            // Add small delay between batches to avoid rate limiting
            if (i + batchSize < transactions.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        return results;
    }

    /**
     * Learn from user corrections
     * Updates merchant mappings based on user's category choices
     */
    async learnFromCorrection(transaction, userCategory) {
        if (!transaction.merchant_name) return;

        try {
            // Save merchant mapping (creates or updates)
            database.saveMerchantMapping(transaction.merchant_name, userCategory);
            console.log(`Learned: "${transaction.merchant_name}" → ${userCategory}`);
        } catch (error) {
            console.error('Failed to learn from correction:', error);
        }
    }

    /**
     * Get AI service status
     */
    async getStatus() {
        await this.checkOllamaAvailability();

        return {
            aiAvailable: this.isOllamaAvailable,
            ollamaUrl: this.ollamaUrl,
            modelName: this.modelName,
            fallbackMethod: 'Enhanced rule-based categorization'
        };
    }
}

// Export singleton instance
const aiCategorization = new AICategorization();
export default aiCategorization;
