/**
 * AI Categorization Service
 * Provides intelligent transaction categorization using local AI models
 * Falls back to enhanced rule-based categorization when AI is unavailable
 */

import * as database from '../src/database.js';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import http from 'http';

const execAsync = promisify(exec);

// HTTP agent with connection pooling for better resource management
const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 5,          // Limit concurrent connections to Ollama
    maxFreeSockets: 2,      // Keep 2 idle sockets open for reuse
    timeout: 60000,         // Close idle connections after 60s
    keepAliveMsecs: 30000   // Send keep-alive probes every 30s
});

class AICategorization {
    constructor() {
        this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        // Default to Mistral 7B Instruct for better accuracy (92-96% vs 85-90% with Phi-3)
        this.modelName = process.env.OLLAMA_MODEL || 'mistral:7b-instruct-q4_0';
        this.isOllamaAvailable = false;
        this.ollamaProcess = null;
        this.httpAgent = httpAgent;  // Use connection pooling agent
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
    /**
     * Check how many Ollama processes are running
     */
    async checkOllamaProcesses() {
        try {
            const { stdout } = await execAsync('pgrep -c ollama || echo 0');
            const count = parseInt(stdout.trim());
            if (count > 1) {
                console.log(`⚠️  WARNING: ${count} Ollama processes detected (expected 1)`);
            }
            return count;
        } catch (error) {
            return 0;
        }
    }

    async checkOllamaAvailability() {
        // Check for multiple Ollama processes
        await this.checkOllamaProcesses();

        try {
            // Try to connect to Ollama
            const response = await fetch(`${this.ollamaUrl}/api/tags`, {
                signal: AbortSignal.timeout(2000),
                agent: this.httpAgent
            });

            if (response.ok) {
                const data = await response.json();
                // Check for Mistral (preferred) or Phi-3 (fallback)
                const hasMistral = data.models?.some(m => m.name.includes('mistral'));
                const hasPhi3 = data.models?.some(m => m.name.includes('phi3'));
                this.isOllamaAvailable = hasMistral || hasPhi3;

                if (hasMistral) {
                    console.log('✓ Ollama is available with Mistral 7B model (best accuracy)');
                } else if (hasPhi3) {
                    console.log('✓ Ollama is available with Phi-3 model');
                    console.log('  💡 For better accuracy (92-96%), consider upgrading:');
                    console.log('     ollama pull mistral:7b-instruct-q4_0');
                } else {
                    console.log('⚠ Ollama is running but no AI model found.');
                    console.log('  To enable AI categorization, run one of:');
                    console.log('     ollama pull mistral:7b-instruct-q4_0  (recommended, best accuracy)');
                    console.log('     ollama pull phi3:mini                (faster, good accuracy)');
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
                        signal: AbortSignal.timeout(2000),
                        agent: this.httpAgent
                    });

                    if (response.ok) {
                        const data = await response.json();
                        const hasMistral = data.models?.some(m => m.name.includes('mistral'));
                        const hasPhi3 = data.models?.some(m => m.name.includes('phi3'));
                        this.isOllamaAvailable = hasMistral || hasPhi3;

                        if (hasMistral) {
                            console.log('✓ Ollama started successfully with Mistral 7B model');
                        } else if (hasPhi3) {
                            console.log('✓ Ollama started successfully with Phi-3 model');
                            console.log('  💡 For better accuracy, consider: ollama pull mistral:7b-instruct-q4_0');
                        } else {
                            console.log('⚠ Ollama started but no AI model found.');
                            console.log('  To enable AI categorization, run: ollama pull mistral:7b-instruct-q4_0');
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
        const aiStartTime = Date.now();
        const prompt = this.buildPrompt(transaction, categories);

        // Log all transaction data being sent to AI
        console.log('\n========================================');
        console.log('🤖 AI CATEGORIZATION REQUEST');
        console.log('========================================');
        console.log('Transaction ID:', transaction.transaction_id);
        console.log('Description:', transaction.description);
        console.log('Merchant:', transaction.merchant_name || 'N/A');
        console.log('Amount:', transaction.amount);
        console.log('Date:', transaction.date);
        console.log('Account:', transaction.account_name || 'N/A');
        console.log('\nPlaid Data:');
        console.log('  Primary Category:', transaction.plaid_primary_category || 'N/A');
        console.log('  Detailed Category:', transaction.plaid_detailed_category || 'N/A');
        console.log('  Confidence:', transaction.plaid_confidence_level || 'N/A');
        console.log('\nLocation:');
        console.log('  City:', transaction.location_city || 'N/A');
        console.log('  Region:', transaction.location_region || 'N/A');
        console.log('  Address:', transaction.location_address || 'N/A');
        console.log('\nTransaction Details:');
        console.log('  Type:', transaction.transaction_type || 'N/A');
        console.log('  Payment Channel:', transaction.payment_channel || 'N/A');
        console.log('  Merchant Entity ID:', transaction.merchant_entity_id || 'N/A');
        console.log('  Pending:', transaction.pending || 'N/A');
        console.log('  Authorized Date:', transaction.authorized_datetime || 'N/A');
        console.log('\nAmazon Order:');
        if (transaction.amazon_order_id || transaction.amazon_order) {
            const ao = transaction.amazon_order || {
                order_id: transaction.amazon_order_id,
                total_amount: transaction.amazon_total,
                order_date: transaction.amazon_order_date,
                match_confidence: transaction.amazon_match_confidence,
                order_status: transaction.amazon_order_status,
                subtotal: transaction.amazon_subtotal,
                tax: transaction.amazon_tax,
                shipping: transaction.amazon_shipping,
                payment_method: transaction.amazon_payment_method
            };
            console.log('  Order ID:', ao.order_id);
            console.log('  Total Amount:', ao.total_amount);
            console.log('  Subtotal:', ao.subtotal || 'N/A');
            console.log('  Tax:', ao.tax || 'N/A');
            console.log('  Shipping:', ao.shipping || 'N/A');
            console.log('  Order Date:', ao.order_date);
            console.log('  Payment Method:', ao.payment_method || 'N/A');
            console.log('  Match Confidence:', ao.match_confidence);
            console.log('  Status:', ao.order_status);

            if (transaction.amazon_items && transaction.amazon_items.length > 0) {
                console.log('\n  Amazon Items (' + transaction.amazon_items.length + '):');
                transaction.amazon_items.forEach((item, idx) => {
                    console.log(`    ${idx + 1}. ${item.title}`);
                    if (item.category) console.log(`       Category: ${item.category}`);
                    console.log(`       Price: $${item.price}, Quantity: ${item.quantity || 1}`);
                    if (item.seller) console.log(`       Seller: ${item.seller}`);
                    if (item.return_status) console.log(`       ⚠️  RETURNED: ${item.return_status}`);
                });
            }
        } else {
            console.log('  No Amazon order matched');
        }
        console.log('\n--- AI PROMPT ---');
        console.log(prompt);
        console.log('--- END PROMPT ---\n');

        const response = await fetch(`${this.ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.modelName,
                prompt: prompt,
                stream: false,
                keep_alive: "2m",  // Keep model loaded for 2 minutes to serve subsequent requests efficiently
                options: {
                    temperature: 0.1,  // Low for consistency
                    num_predict: 100   // Limit response length
                }
            }),
            signal: AbortSignal.timeout(30000),  // Increased to 30s for Mistral 7B
            agent: this.httpAgent  // Use connection pooling for better resource management
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status}`);
        }

        const result = await response.json();
        const aiTime = Date.now() - aiStartTime;

        console.log('--- AI RESPONSE ---');
        console.log(result.response);
        console.log('--- END RESPONSE ---');
        console.log(`Response time: ${aiTime}ms`);
        console.log('========================================\n');

        return this.parseAIResponse(result.response, categories);
    }

    /**
     * Build AI prompt for categorization
     */
    buildPrompt(transaction, categories) {
        // Build comprehensive category list with descriptions and keywords
        const categoryList = categories
            .map(c => {
                let catInfo = `- ${c.name}`;
                if (c.description) catInfo += `\n  Description: ${c.description}`;
                if (c.keywords) {
                    try {
                        const keywords = JSON.parse(c.keywords);
                        if (keywords.length > 0) {
                            catInfo += `\n  Keywords: ${keywords.join(', ')}`;
                        }
                    } catch (e) { /* ignore parse errors */ }
                }
                if (c.examples) catInfo += `\n  Examples: ${c.examples}`;
                return catInfo;
            })
            .join('\n\n');

        // Get examples from existing mappings
        const examples = this.getExampleMappings();

        // Build comprehensive transaction context
        const txContext = [];
        txContext.push(`- Description: ${transaction.description || 'N/A'}`);
        txContext.push(`- Merchant: ${transaction.merchant_name || 'N/A'}`);
        txContext.push(`- Amount: $${Math.abs(transaction.amount || 0).toFixed(2)}`);
        txContext.push(`- Type: ${transaction.amount < 0 ? 'Expense' : 'Income'}`);

        // Add Plaid enhanced category if available
        if (transaction.plaid_primary_category) {
            txContext.push(`- Plaid Category: ${transaction.plaid_primary_category}`);
            if (transaction.plaid_detailed_category) {
                txContext.push(`  Detailed: ${transaction.plaid_detailed_category}`);
            }
        }

        // Add location data if available
        if (transaction.location_city || transaction.location_region) {
            const location = [
                transaction.location_city,
                transaction.location_region
            ].filter(Boolean).join(', ');
            txContext.push(`- Location: ${location}`);
        }

        // Add transaction type if available
        if (transaction.transaction_type) {
            txContext.push(`- Transaction Type: ${transaction.transaction_type}`);
        }

        // Add payment channel if available
        if (transaction.payment_channel) {
            txContext.push(`- Payment Channel: ${transaction.payment_channel}`);
        }

        // Add Amazon order information if matched
        if (transaction.amazon_order_id || transaction.amazon_order) {
            const amazonOrder = transaction.amazon_order || {
                order_id: transaction.amazon_order_id,
                total_amount: transaction.amazon_total,
                order_date: transaction.amazon_order_date,
                subtotal: transaction.amazon_subtotal,
                tax: transaction.amazon_tax,
                shipping: transaction.amazon_shipping,
                payment_method: transaction.amazon_payment_method,
                order_status: transaction.amazon_order_status
            };
            txContext.push(`- Amazon Order ID: ${amazonOrder.order_id}`);
            txContext.push(`  Order Date: ${amazonOrder.order_date}`);
            txContext.push(`  Total: $${amazonOrder.total_amount}${amazonOrder.subtotal ? ` (Subtotal: $${amazonOrder.subtotal}, Tax: $${amazonOrder.tax || 0}, Shipping: $${amazonOrder.shipping || 0})` : ''}`);
            if (amazonOrder.payment_method) txContext.push(`  Payment: ${amazonOrder.payment_method}`);
            if (amazonOrder.order_status) txContext.push(`  Status: ${amazonOrder.order_status}`);

            // Add Amazon items if available
            if (transaction.amazon_items && transaction.amazon_items.length > 0) {
                txContext.push(`  Items in order (${transaction.amazon_items.length}):`);
                transaction.amazon_items.forEach((item, idx) => {
                    const itemDesc = [
                        item.title,
                        item.category ? `Category: ${item.category}` : null,
                        `Price: $${item.price}`,
                        item.quantity > 1 ? `Qty: ${item.quantity}` : null,
                        item.seller ? `Seller: ${item.seller}` : null,
                        item.return_status ? `RETURNED: ${item.return_status}` : null
                    ].filter(Boolean).join(', ');
                    txContext.push(`    ${idx + 1}. ${itemDesc}`);
                });
            }
        }

        return `You are an expert financial transaction categorizer. Your task is to analyze transaction details and select the MOST appropriate category with high confidence.

TRANSACTION TO CATEGORIZE:
${txContext.join('\n')}

AVAILABLE CATEGORIES:
${categoryList}

${examples ? `EXAMPLES FROM USER'S HISTORY:\n${examples}\n` : ''}

INSTRUCTIONS:
1. Carefully review ALL transaction details: merchant, description, amount, location, payment channel
2. Consider the Plaid category as a strong signal (if provided)
3. If an Amazon order is linked, USE THE AMAZON ITEMS to determine the most appropriate category:
   - Look at item titles and categories (e.g., "Electronics", "Home & Kitchen", "Grocery")
   - If multiple items, categorize based on the highest-value or most significant item
   - Consider if items were returned (may affect categorization)
4. Match against category descriptions and keywords
5. Consider location and transaction type for context
6. Use the user's history to learn their preferences
7. Provide high confidence (0.90+) only when very certain
8. Provide reasoning that explains your decision using the specific details you analyzed (mention Amazon items if present)

RESPONSE FORMAT (JSON only):
{
  "category": "Category Name",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this category was chosen"
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
        // Reduced to 3 for Mistral 7B to prevent memory issues with parallel requests
        const batchSize = options.batchSize || 3;

        console.log(`\n🔄 Starting batch categorization: ${transactions.length} transactions, batch size: ${batchSize}`);
        const startTime = Date.now();
        const memStart = process.memoryUsage();
        console.log(`   Memory at start: ${Math.round(memStart.heapUsed / 1024 / 1024)}MB heap, ${Math.round(memStart.rss / 1024 / 1024)}MB RSS`);

        for (let i = 0; i < transactions.length; i += batchSize) {
            const batch = transactions.slice(i, i + batchSize);
            const batchStartTime = Date.now();

            console.log(`\n   Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(transactions.length / batchSize)} (${batch.length} transactions)...`);

            const batchResults = await Promise.all(
                batch.map(transaction =>
                    this.categorizeTransaction(transaction, categories)
                )
            );

            results.push(...batchResults);

            const batchTime = Date.now() - batchStartTime;
            const methods = batchResults.reduce((acc, r) => {
                acc[r.method] = (acc[r.method] || 0) + 1;
                return acc;
            }, {});

            console.log(`   ✓ Batch completed in ${batchTime}ms`);
            console.log(`   Methods used: ${JSON.stringify(methods)}`);

            const memCurrent = process.memoryUsage();
            console.log(`   Memory: ${Math.round(memCurrent.heapUsed / 1024 / 1024)}MB heap, ${Math.round(memCurrent.rss / 1024 / 1024)}MB RSS`);

            // Add small delay between batches to avoid rate limiting
            if (i + batchSize < transactions.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        const totalTime = Date.now() - startTime;
        const memEnd = process.memoryUsage();
        console.log(`\n✅ Batch categorization complete: ${transactions.length} transactions in ${totalTime}ms (${Math.round(totalTime / transactions.length)}ms/transaction)`);
        console.log(`   Memory at end: ${Math.round(memEnd.heapUsed / 1024 / 1024)}MB heap, ${Math.round(memEnd.rss / 1024 / 1024)}MB RSS`);
        console.log(`   Memory delta: ${Math.round((memEnd.heapUsed - memStart.heapUsed) / 1024 / 1024)}MB\n`);

        // Unload model after batch to free resources
        // The model will auto-reload on next request
        await this.unloadModel().catch(err => console.error('Failed to unload model:', err));

        return results;
    }

    /**
     * Learn from user corrections
     * Updates merchant mappings based on user's category choices
     * Now uses ALL transaction information for better learning
     */
    async learnFromCorrection(transaction, userCategory) {
        if (!transaction.merchant_name) return;

        try {
            // Log comprehensive transaction context for learning
            const learningContext = {
                merchant_name: transaction.merchant_name,
                category: userCategory,
                amount: transaction.amount,
                date: transaction.date,
                account_name: transaction.account_name,
                payment_channel: transaction.payment_channel,
                transaction_type: transaction.transaction_type,
                location: {
                    city: transaction.location_city,
                    region: transaction.location_region,
                    address: transaction.location_address
                },
                plaid: {
                    primary_category: transaction.plaid_primary_category,
                    detailed_category: transaction.plaid_detailed_category,
                    confidence_level: transaction.plaid_confidence_level
                },
                merchant_entity_id: transaction.merchant_entity_id
            };

            console.log('📚 Learning from user correction:');
            console.log(`   Merchant: "${transaction.merchant_name}" → ${userCategory}`);
            console.log(`   Context: ${JSON.stringify(learningContext, null, 2)}`);

            // Save merchant mapping (creates or updates)
            database.saveMerchantMapping(transaction.merchant_name, userCategory);

            // TODO: Future enhancement - store full transaction examples in a separate table
            // This would allow pattern matching on location, amount ranges, payment channels, etc.

            console.log(`✓ Learned: "${transaction.merchant_name}" → ${userCategory}`);
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

    /**
     * Unload Ollama model to free up resources
     * This immediately releases GPU/CPU memory used by the model
     */
    async unloadModel() {
        if (!this.isOllamaAvailable) return;

        try {
            console.log('🧹 Unloading Ollama model to free resources...');

            // Send a generate request with keep_alive: 0 to immediately unload
            await fetch(`${this.ollamaUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.modelName,
                    prompt: '',
                    keep_alive: 0  // Immediately unload the model
                }),
                signal: AbortSignal.timeout(5000),
                agent: this.httpAgent
            });

            console.log('✓ Ollama model unloaded successfully');
        } catch (error) {
            console.error('Failed to unload Ollama model:', error.message);
        }
    }

    /**
     * Generate the best emoji for a category using AI
     * @param {string} categoryName - The name of the category
     * @param {string} description - Optional description of the category
     * @returns {Promise<string>} - A single emoji character
     */
    async suggestEmojiForCategory(categoryName, description = '') {
        const debug = process.env.DEBUG_EMOJI_GENERATION || process.env.DEBUG_CATEGORIZATION;

        console.log(`[Emoji Service] Generating single emoji for category: "${categoryName}"`);
        if (debug) {
            console.log('\n--- EMOJI GENERATION (Single) ---');
            console.log(`Category: "${categoryName}"`);
            if (description) console.log(`Description: "${description}"`);
        }

        console.log(`[Emoji Service] Ollama available: ${this.isOllamaAvailable}`);
        if (!this.isOllamaAvailable) {
            console.log('[Emoji Service] Using fallback emoji generation');
            if (debug) console.log('⚠️  AI not available, using fallback');
            const fallbackEmoji = this.fallbackEmojiForCategory(categoryName);
            console.log(`[Emoji Service] Fallback result: ${fallbackEmoji}`);
            if (debug) {
                console.log(`Fallback emoji: ${fallbackEmoji}`);
                console.log('--- END EMOJI GENERATION ---\n');
            }
            return fallbackEmoji;
        }

        try {
            const prompt = `You are an emoji suggestion assistant. Your PRIMARY focus is the category name. The description is only secondary context.

**Category Name (MOST IMPORTANT):** ${categoryName}
${description ? `Additional context: ${description}` : ''}

Base your emoji suggestion primarily on the category name "${categoryName}".

CRITICAL: Respond with ONLY ONE single simple emoji character. No text, no explanation, no multiple emojis, just ONE emoji.

Examples:
- "Groceries" → 🛒
- "Restaurants" → 🍽️
- "Gas" → ⛽
- "Coffee" → ☕
- "Shopping" → 🛍️
- "Entertainment" → 🎬
- "Healthcare" → 🏥
- "Travel" → ✈️

ONE single emoji for "${categoryName}":`;

            if (debug) {
                console.log('\n--- PROMPT ---');
                console.log(prompt);
                console.log('--- END PROMPT ---\n');
            }

            console.log(`[Emoji Service] Calling Ollama API at ${this.ollamaUrl}...`);
            const startTime = Date.now();
            const response = await fetch(`${this.ollamaUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.modelName,
                    prompt: prompt,
                    stream: false,
                    keep_alive: "2m",
                    options: {
                        temperature: 0.3,  // Slightly higher for creativity
                        num_predict: 10    // Very short response
                    }
                }),
                signal: AbortSignal.timeout(10000),  // 10 second timeout
                agent: this.httpAgent
            });

            if (!response.ok) {
                console.error(`[Emoji Service] Ollama API error: ${response.status}`);
                throw new Error(`Ollama API error: ${response.status}`);
            }

            const result = await response.json();
            const duration = Date.now() - startTime;
            const emojiResponse = result.response?.trim() || '';

            console.log(`[Emoji Service] AI responded in ${duration}ms: "${emojiResponse}"`);
            if (debug) {
                console.log(`AI response (${duration}ms): "${emojiResponse}"`);
            }

            // Extract just the emoji (first character that's an emoji)
            const emojiMatch = emojiResponse.match(/[\p{Emoji}\u200D]+/u);
            if (emojiMatch) {
                console.log(`[Emoji Service] Successfully extracted emoji: ${emojiMatch[0]}`);
                if (debug) {
                    console.log(`✨ Extracted emoji: ${emojiMatch[0]}`);
                    console.log('--- END EMOJI GENERATION ---\n');
                }
                return emojiMatch[0];
            }

            console.warn('[Emoji Service] No valid emoji in AI response, using fallback');
            if (debug) console.log('⚠️  No valid emoji in response, using fallback');
            const fallbackEmoji = this.fallbackEmojiForCategory(categoryName);
            console.log(`[Emoji Service] Fallback result: ${fallbackEmoji}`);
            if (debug) {
                console.log(`Fallback emoji: ${fallbackEmoji}`);
                console.log('--- END EMOJI GENERATION ---\n');
            }
            return fallbackEmoji;
        } catch (error) {
            console.error(`[Emoji Service] Error generating emoji: ${error.message}`);
            if (debug) console.error('Error:', error.message);
            const fallbackEmoji = this.fallbackEmojiForCategory(categoryName);
            console.log(`[Emoji Service] Fallback result: ${fallbackEmoji}`);
            if (debug) {
                console.log(`Fallback emoji: ${fallbackEmoji}`);
                console.log('--- END EMOJI GENERATION ---\n');
            }
            return fallbackEmoji;
        }
    }

    /**
     * Generate multiple emoji suggestions for a category using AI
     * @param {string} categoryName - The name of the category
     * @param {string} description - Optional description of the category
     * @param {number} count - Number of suggestions to generate (default: 3)
     * @returns {Promise<string[]>} - Array of emoji characters
     */
    async suggestMultipleEmojis(categoryName, description = '', count = 3) {
        const debug = process.env.DEBUG_EMOJI_GENERATION || process.env.DEBUG_CATEGORIZATION;

        console.log(`[Emoji Service] Generating ${count} emojis for category: "${categoryName}"`);
        if (debug) {
            console.log('\n--- EMOJI GENERATION (Multiple) ---');
            console.log(`Category: "${categoryName}"`);
            if (description) console.log(`Description: "${description}"`);
            console.log(`Count: ${count}`);
        }

        console.log(`[Emoji Service] Ollama available: ${this.isOllamaAvailable}`);
        if (!this.isOllamaAvailable) {
            console.log('[Emoji Service] Using fallback emoji generation');
            if (debug) console.log('⚠️  AI not available, using fallback');
            const fallbackEmojis = this.fallbackMultipleEmojis(categoryName, count);
            console.log(`[Emoji Service] Fallback result: ${fallbackEmojis.join(' ')}`);
            if (debug) {
                console.log(`Fallback emojis: ${fallbackEmojis.join(' ')}`);
                console.log('--- END EMOJI GENERATION ---\n');
            }
            return fallbackEmojis;
        }

        try {
            const prompt = `You are an emoji suggestion assistant. Your PRIMARY focus is the category name. The description is only secondary context.

**Category Name (MOST IMPORTANT):** ${categoryName}
${description ? `Additional context: ${description}` : ''}

Base your emoji suggestions primarily on the category name "${categoryName}".

CRITICAL INSTRUCTIONS:
- Respond with EXACTLY ${count} different emoji characters separated by spaces
- Use ONLY SIMPLE SINGLE emojis (like 🍎 🚗 ⭐ 🏠 🎨)
- NEVER use family emojis, people combinations, or multi-person emojis
- NEVER use skin tones or gender variants (NO 👨‍👩‍👧, NO 👶🏻, NO 👩‍🦰)
- NEVER use compound emojis with zero-width joiners
- NO text, NO explanation, NO punctuation, NO bullet points, NO dashes, NO newlines
- JUST ${count} simple emojis separated by spaces

Good examples (SIMPLE objects, animals, symbols):
🛒 🍎 🥦
🍽️ 🍕 🍔
☕ 🍵 🥤
🏠 🔑 🚗
🎨 ✏️ 📐

Bad examples (DO NOT USE THESE):
👨‍👩‍👧‍👦 (family - too complex)
👶🏻 (skin tone - not allowed)
👩‍🦰 (person variant - not allowed)
- 🛒 🍎 (formatting - not allowed)

${count} SIMPLE emojis for "${categoryName}":`;

            if (debug) {
                console.log('\n--- PROMPT ---');
                console.log(prompt);
                console.log('--- END PROMPT ---\n');
            }

            console.log(`[Emoji Service] Calling Ollama API at ${this.ollamaUrl}...`);
            const startTime = Date.now();
            const response = await fetch(`${this.ollamaUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.modelName,
                    prompt: prompt,
                    stream: false,
                    keep_alive: "2m",
                    options: {
                        temperature: 0.3,  // Lower for more consistent simple emojis
                        num_predict: 30    // Enough for multiple emojis
                    }
                }),
                signal: AbortSignal.timeout(15000),  // 15 second timeout
                agent: this.httpAgent
            });

            if (!response.ok) {
                console.error(`[Emoji Service] Ollama API error: ${response.status}`);
                throw new Error(`Ollama API error: ${response.status}`);
            }

            const result = await response.json();
            const duration = Date.now() - startTime;
            const emojiResponse = result.response?.trim() || '';

            console.log(`[Emoji Service] AI responded in ${duration}ms: "${emojiResponse}"`);
            if (debug) {
                console.log(`AI response (${duration}ms): "${emojiResponse}"`);
            }

            // Extract all emojis from response, handling various formatting
            // First, remove common formatting characters
            const cleanedResponse = emojiResponse
                .replace(/[-*•\n\r]/g, ' ')  // Remove dashes, bullets, newlines
                .replace(/\d+\./g, ' ')       // Remove numbered lists
                .trim();

            // Split by spaces and extract emojis from each part
            const parts = cleanedResponse.split(/\s+/);
            const emojis = [];

            for (const part of parts) {
                // Match individual emoji characters (not compound sequences)
                // This regex matches base emojis without skin tones/ZWJ sequences
                const emojiMatch = part.match(/\p{Emoji_Presentation}|\p{Emoji}\uFE0F/u);
                if (emojiMatch && emojis.length < count) {
                    // Get just the base emoji (first character)
                    const baseEmoji = emojiMatch[0];
                    // Avoid duplicates
                    if (!emojis.includes(baseEmoji)) {
                        emojis.push(baseEmoji);
                    }
                }
            }

            console.log(`[Emoji Service] Extracted ${emojis.length} emojis from response: ${emojis.join(' ')}`);

            if (emojis.length >= count) {
                const selectedEmojis = emojis.slice(0, count);
                console.log(`[Emoji Service] Successfully selected ${count} emojis: ${selectedEmojis.join(' ')}`);
                if (debug) {
                    console.log(`✨ Selected ${count} emojis: ${selectedEmojis.join(' ')}`);
                    console.log('--- END EMOJI GENERATION ---\n');
                }
                return selectedEmojis;
            }

            console.warn(`[Emoji Service] Only found ${emojis.length} emojis, needed ${count}. Using fallback`);
            if (debug) console.log('⚠️  Not enough valid emojis in response, using fallback');
            const fallbackEmojis = this.fallbackMultipleEmojis(categoryName, count);
            console.log(`[Emoji Service] Fallback result: ${fallbackEmojis.join(' ')}`);
            if (debug) {
                console.log(`Fallback emojis: ${fallbackEmojis.join(' ')}`);
                console.log('--- END EMOJI GENERATION ---\n');
            }
            return fallbackEmojis;
        } catch (error) {
            console.error(`[Emoji Service] Error generating emojis: ${error.message}`);
            if (debug) console.error('Error:', error.message);
            const fallbackEmojis = this.fallbackMultipleEmojis(categoryName, count);
            console.log(`[Emoji Service] Fallback result: ${fallbackEmojis.join(' ')}`);
            if (debug) {
                console.log(`Fallback emojis: ${fallbackEmojis.join(' ')}`);
                console.log('--- END EMOJI GENERATION ---\n');
            }
            return fallbackEmojis;
        }
    }

    /**
     * Fallback method to generate multiple emoji suggestions
     */
    fallbackMultipleEmojis(categoryName, count = 3) {
        const primaryEmoji = this.fallbackEmojiForCategory(categoryName);
        const relatedEmojis = this.getRelatedEmojis(categoryName, primaryEmoji);

        // Combine primary with related, ensure we have enough
        const suggestions = [primaryEmoji, ...relatedEmojis].slice(0, count);

        // Fill with colored circle defaults if not enough (grey first, then colors)
        while (suggestions.length < count) {
            // Grey first, then color circles
            const defaults = ['⚪', '🔵', '🟢', '🟡', '🔴', '🟣', '🟠', '⚫'];
            const index = suggestions.length % defaults.length;
            // Make sure we don't add duplicates
            if (!suggestions.includes(defaults[index])) {
                suggestions.push(defaults[index]);
            } else {
                // If duplicate, try next one
                const nextIndex = (index + 1) % defaults.length;
                suggestions.push(defaults[nextIndex]);
            }
        }

        return suggestions;
    }

    /**
     * Get related emojis based on category
     */
    getRelatedEmojis(categoryName, primaryEmoji) {
        const name = categoryName.toLowerCase();
        const relatedMap = {
            'grocer': ['🍎', '🥦', '🛒'],
            'food': ['🍕', '🍔', '🥗'],
            'restaurant': ['🍽️', '🍕', '🍔'],
            'dining': ['🍽️', '🍕', '🍔'],
            'coffee': ['🍵', '🥤', '☕'],
            'cafe': ['🍵', '☕', '🥐'],
            'gas': ['🚗', '⛽', '🚙'],
            'fuel': ['🚗', '⛽', '🚙'],
            'shop': ['🛒', '💳', '🛍️'],
            'entertain': ['🎮', '🎭', '🎬'],
            'health': ['💊', '🩺', '🏥'],
            'medical': ['💊', '🩺', '🏥'],
            'travel': ['🏖️', '🗺️', '✈️'],
            'vacation': ['🏖️', '🗺️', '✈️'],
            'bill': ['💡', '💸', '📄'],
            'utilit': ['💡', '💸', '📄'],
            'fitness': ['🏋️', '🏃', '💪'],
            'gym': ['🏋️', '🏃', '💪'],
            'workout': ['🏋️', '🏃', '💪'],
            'pet': ['🐶', '🐱', '🐾'],
            'education': ['🎓', '📖', '📚'],
            'school': ['🎓', '📖', '📚'],
            'child': ['🎈', '🎨', '🎪'],
            'kid': ['🎈', '🎨', '🎪'],
            'baby': ['🍼', '👶', '🎈'],
            'toy': ['🎮', '🎨', '🎪'],
            'book': ['📖', '📚', '📰'],
            'music': ['🎵', '🎸', '🎤'],
            'sports': ['⚽', '🏀', '⚾'],
            'outdoor': ['🏕️', '🌲', '⛰️'],
            'garden': ['🌱', '🌻', '🌳'],
            'home': ['🏠', '🛋️', '🔧'],
            'repair': ['🔧', '🔨', '🛠️'],
            'electronics': ['💻', '📱', '⌚'],
            'tech': ['💻', '📱', '⚡'],
            'internet': ['🌐', '📡', '💻'],
            'phone': ['📱', '☎️', '📞'],
            'streaming': ['📺', '🎬', '🎵'],
            'gaming': ['🎮', '🕹️', '👾'],
            'art': ['🎨', '🖼️', '🖌️'],
            'craft': ['🎨', '✂️', '🖌️'],
            'beauty': ['💄', '💅', '💇'],
            'hair': ['💇', '💈', '💅'],
            'spa': ['💆', '🧖', '💅'],
            'drink': ['🍺', '🍷', '🥤'],
            'alcohol': ['🍺', '🍷', '🍸'],
            'bar': ['🍺', '🍷', '🍸'],
            'fast': ['🍔', '🍕', '🌭'],
            'pizza': ['🍕', '🧀', '🍴'],
            'breakfast': ['🍳', '🥐', '🥓'],
            'lunch': ['🍱', '🥗', '🍴'],
            'dinner': ['🍽️', '🍖', '🍴'],
            'snack': ['🍿', '🍪', '🥨'],
            'dessert': ['🍰', '🍨', '🍪'],
            'sweet': ['🍰', '🍭', '🍫']
        };

        for (const [keyword, emojis] of Object.entries(relatedMap)) {
            if (name.includes(keyword)) {
                return emojis.filter(e => e !== primaryEmoji);
            }
        }

        // Grey and color circles as defaults
        return ['🔵', '🟢'];
    }

    /**
     * Fallback emoji suggestion based on category name
     */
    fallbackEmojiForCategory(categoryName) {
        const name = categoryName.toLowerCase();
        const emojiMap = {
            'grocer': '🛒',
            'food': '🍔',
            'restaurant': '🍽️',
            'dining': '🍽️',
            'coffee': '☕',
            'cafe': '☕',
            'gas': '⛽',
            'fuel': '⛽',
            'shop': '🛍️',
            'entertain': '🎬',
            'movie': '🎬',
            'health': '🏥',
            'medical': '🏥',
            'travel': '✈️',
            'vacation': '🏖️',
            'bill': '💡',
            'utilit': '💡',
            'rent': '🏠',
            'housing': '🏠',
            'transport': '🚗',
            'car': '🚗',
            'insurance': '🛡️',
            'fitness': '💪',
            'gym': '🏋️',
            'workout': '💪',
            'education': '📚',
            'school': '🎓',
            'pet': '🐾',
            'subscription': '📺',
            'clothing': '👕',
            'fashion': '👕',
            'gift': '🎁',
            'charity': '❤️',
            'transfer': '🔄',
            'income': '💰',
            'salary': '💵',
            'child': '👶',
            'kid': '🎈',
            'baby': '🍼',
            'toy': '🧸',
            'book': '📚',
            'music': '🎵',
            'sports': '⚽',
            'outdoor': '🏕️',
            'garden': '🌱',
            'home': '🏠',
            'repair': '🔧',
            'electronics': '💻',
            'tech': '💻',
            'internet': '🌐',
            'phone': '📱',
            'streaming': '📺',
            'gaming': '🎮',
            'art': '🎨',
            'craft': '✂️',
            'beauty': '💄',
            'hair': '💇',
            'spa': '💆',
            'drink': '🍷',
            'alcohol': '🍺',
            'bar': '🍸',
            'fast': '🍔',
            'pizza': '🍕',
            'breakfast': '🍳',
            'lunch': '🍱',
            'dinner': '🍽️',
            'snack': '🍿',
            'dessert': '🍰',
            'sweet': '🍭'
        };

        for (const [keyword, emoji] of Object.entries(emojiMap)) {
            if (name.includes(keyword)) {
                return emoji;
            }
        }

        return '⚪';  // Grey circle as default
    }

    /**
     * Cleanup resources - called on server shutdown
     */
    async cleanup() {
        console.log('🧹 Cleaning up AI categorization service...');

        // Unload the model
        await this.unloadModel();

        // Destroy HTTP agent to close all connections
        if (this.httpAgent) {
            console.log('   Closing HTTP connections...');
            this.httpAgent.destroy();
            console.log('   ✓ HTTP connections closed');
        }

        // Kill Ollama process if we started it
        if (this.ollamaProcess) {
            try {
                console.log('   Stopping Ollama process...');
                this.ollamaProcess.kill('SIGTERM');
                this.ollamaProcess = null;
                console.log('   ✓ Ollama process stopped');
            } catch (error) {
                console.error('   Failed to stop Ollama process:', error.message);
            }
        }

        console.log('✓ AI categorization service cleanup complete');
    }
}

// Export singleton instance
const aiCategorization = new AICategorization();
export default aiCategorization;
