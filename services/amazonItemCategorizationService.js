/**
 * Amazon Item Categorization Service
 * Provides intelligent Amazon item categorization using hybrid approach:
 * 1. Rule-based (ASIN, title patterns)
 * 2. AI-powered (using Ollama)
 */

import * as database from '../src/database.js';
import http from 'http';

// HTTP agent with connection pooling
const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 5,
    maxFreeSockets: 2,
    timeout: 60000,
    keepAliveMsecs: 30000
});

class AmazonItemCategorization {
    constructor() {
        this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        this.modelName = process.env.OLLAMA_MODEL || 'mistral:7b-instruct-q4_0';
        this.httpAgent = httpAgent;
    }

    /**
     * Check if Ollama AI is available
     */
    async checkOllamaAvailability() {
        try {
            const response = await fetch(`${this.ollamaUrl}/api/tags`, {
                signal: AbortSignal.timeout(2000),
                agent: this.httpAgent
            });

            if (response.ok) {
                const data = await response.json();
                const hasMistral = data.models?.some(m => m.name.includes('mistral'));
                const hasPhi3 = data.models?.some(m => m.name.includes('phi3'));
                return hasMistral || hasPhi3;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * Categorize single Amazon item using hybrid approach
     * @param {Object} item - Amazon item with title, asin, category, price, etc.
     * @returns {Object} { category, confidence, reasoning, method, ruleId }
     */
    async categorizeItem(item) {
        const categories = database.getCategories();

        // Method 1: Check ASIN-based rules (highest priority, exact match)
        if (item.asin) {
            const asinRule = database.findAmazonItemRuleByASIN(item.asin);
            if (asinRule) {
                console.log(`[Amazon Item] ASIN rule matched: ${item.asin} -> ${asinRule.category}`);
                return {
                    category: asinRule.category,
                    confidence: 95,
                    reasoning: `Matched by ASIN rule: ${asinRule.name}`,
                    method: 'asin-rule',
                    ruleId: asinRule.id
                };
            }
        }

        // Method 2: Check title pattern rules
        if (item.title) {
            const titleRule = database.findAmazonItemRuleByTitle(item.title);
            if (titleRule) {
                console.log(`[Amazon Item] Title rule matched: ${item.title} -> ${titleRule.category}`);
                return {
                    category: titleRule.category,
                    confidence: 90,
                    reasoning: `Matched by title pattern: ${titleRule.pattern}`,
                    method: 'title-rule',
                    ruleId: titleRule.id
                };
            }
        }

        // Method 3: Try AI categorization
        const aiAvailable = await this.checkOllamaAvailability();
        if (aiAvailable) {
            try {
                const aiResult = await this.categorizeWithAI(item, categories);
                if (aiResult && aiResult.confidence >= 50) {
                    console.log(`[Amazon Item] AI categorization: ${item.title} -> ${aiResult.category} (${aiResult.confidence}%)`);
                    return {
                        ...aiResult,
                        method: 'ai'
                    };
                }
            } catch (error) {
                console.error('[Amazon Item] AI categorization failed:', error.message);
            }
        }

        // Method 4: Map Amazon's category to user category (basic heuristics)
        if (item.category) {
            const mappedCategory = this.mapAmazonCategoryToUserCategory(item.category, categories);
            if (mappedCategory) {
                return {
                    category: mappedCategory,
                    confidence: 70,
                    reasoning: `Mapped from Amazon category: ${item.category}`,
                    method: 'amazon-category-mapping'
                };
            }
        }

        // Method 5: Fallback - categorize as "Shopping" or "Uncategorized"
        const shoppingCategory = categories.find(c => c.name === 'Shopping' || c.name === 'Online Shopping');
        if (shoppingCategory) {
            return {
                category: shoppingCategory.name,
                confidence: 40,
                reasoning: 'Default categorization for Amazon purchases',
                method: 'fallback-shopping'
            };
        }

        return {
            category: 'Uncategorized',
            confidence: 10,
            reasoning: 'No matching rules or AI categorization available',
            method: 'fallback'
        };
    }

    /**
     * Categorize item using AI (Ollama)
     * @param {Object} item - Amazon item
     * @param {Array} categories - Available categories
     * @returns {Object|null} { category, confidence, reasoning }
     */
    async categorizeWithAI(item, categories) {
        const prompt = this.buildAIPrompt(item, categories);

        try {
            const response = await fetch(`${this.ollamaUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.modelName,
                    prompt: prompt,
                    stream: false,
                    options: {
                        temperature: 0.1,
                        num_predict: 200
                    }
                }),
                signal: AbortSignal.timeout(30000),
                agent: this.httpAgent
            });

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.status}`);
            }

            const data = await response.json();

            // Log AI response if setting is enabled
            const db = await import('../src/database.js');
            const logSetting = db.getSetting('enable_amazon_item_ai_logs');
            if (logSetting && logSetting.value === true) {
                console.log('\n' + '='.repeat(80));
                console.log('[Amazon Item AI] Response for item:', item.title?.substring(0, 60) + '...');
                console.log('-'.repeat(80));
                console.log('Prompt sent to AI:');
                console.log(prompt);
                console.log('-'.repeat(80));
                console.log('AI Response:');
                console.log(data.response);
                console.log('='.repeat(80) + '\n');
            }

            return this.parseAIResponse(data.response, categories);
        } catch (error) {
            console.error('[Amazon Item AI] Error:', error.message);
            return null;
        }
    }

    /**
     * Build AI prompt for item categorization
     * @param {Object} item - Amazon item
     * @param {Array} categories - Available categories
     * @returns {string} Prompt
     */
    buildAIPrompt(item, categories) {
        // Build list of category names only (for clarity)
        const categoryNames = categories.map(c => c.name).join(', ');

        // Build detailed category list with descriptions
        const categoryDetails = categories
            .map(c => {
                const desc = c.description ? ` - ${c.description}` : '';
                const keywords = c.keywords ? ` (Keywords: ${c.keywords})` : '';
                return `- ${c.name}${desc}${keywords}`;
            })
            .join('\n');

        return `You are a financial transaction categorization assistant. Categorize this Amazon purchase item into ONE of the available categories.

IMPORTANT: You MUST choose from EXACTLY these category names (DO NOT modify or combine them):
${categoryNames}

Category Details (THE AUTHORITATIVE SOURCE - READ THESE CAREFULLY):
${categoryDetails}

Amazon Item Details:
- Title: ${item.title}
${item.category ? `- Amazon Category: ${item.category}` : ''}
${item.price ? `- Price: $${item.price}` : ''}
${item.quantity > 1 ? `- Quantity: ${item.quantity}` : ''}
${item.seller ? `- Seller: ${item.seller}` : ''}
${item.asin ? `- ASIN: ${item.asin}` : ''}

CRITICAL CATEGORIZATION RULES (MUST FOLLOW):

1. CATEGORY DESCRIPTIONS ARE THE SINGLE SOURCE OF TRUTH
   - The user's category descriptions above define EXACTLY what belongs in each category
   - If an item type is explicitly mentioned in a description, it MUST go in that category
   - DO NOT use your general knowledge about where items are typically sold or found
   - DO NOT categorize based on store departments or retail conventions

2. EXACT MATCHING OF ITEM TYPES
   - If the category description explicitly lists "shampoo" and the item is shampoo → use that category
   - If the description lists "detergent" and the item is detergent → use that category
   - Search for the item type in the category descriptions and keywords first

3. CATEGORY NAME RULES
   - You MUST use the EXACT category name from the list - DO NOT create new category names
   - DO NOT combine name with description (e.g., "House - House ordinary expenses" is WRONG)
   - DO NOT make up categories like "Electronics & Gadgets"

4. PRIORITIZATION ORDER
   a) First: Check if item type is explicitly mentioned in any category description/keywords
   b) Second: Match based on the description's general theme
   c) Last: Amazon category as a weak hint only

5. EXAMPLE OF CORRECT REASONING
   - Item: "Shampoo"
   - User has category "Supplies - House supplies like shampoo, toiletry, detergents"
   - User has category "Groceries - Food and consumable items"
   - CORRECT: "Supplies" (shampoo is explicitly listed in the description)
   - WRONG: "Groceries" (just because shampoo is sold in grocery stores)

Valid category names to choose from:
${categoryNames}

Respond in this EXACT format (no additional text):

CATEGORY: [exact category name from the list above]
CONFIDENCE: [number from 0-100]
REASONING: [brief explanation mentioning which description/keyword matched]

Example:
CATEGORY: Supplies
CONFIDENCE: 95
REASONING: Shampoo is explicitly mentioned in the Supplies category description as "House supplies like shampoo, toiletry"`;
    }

    /**
     * Parse AI response into structured format
     * @param {string} response - AI response text
     * @param {Array} categories - Available categories
     * @returns {Object|null} { category, confidence, reasoning }
     */
    parseAIResponse(response, categories) {
        try {
            const categoryMatch = response.match(/CATEGORY:\s*(.+)/i);
            const confidenceMatch = response.match(/CONFIDENCE:\s*(\d+)/i);
            const reasoningMatch = response.match(/REASONING:\s*(.+)/i);

            if (!categoryMatch) {
                console.error('[Amazon Item AI] Could not parse category from response');
                return null;
            }

            let category = categoryMatch[1].trim();
            const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 70;
            const reasoning = reasoningMatch ? reasoningMatch[1].trim() : 'AI-based categorization';

            // Validate category exists (case-insensitive exact match)
            let validCategory = categories.find(c =>
                c.name.toLowerCase() === category.toLowerCase()
            );

            // If exact match fails, try fuzzy matching as fallback
            if (!validCategory) {
                // Try to find close matches (e.g., "Groceries" vs "Grocery", "Health Care" vs "Healthcare")
                validCategory = categories.find(c => {
                    const suggested = category.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const actual = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return suggested === actual ||
                           suggested.includes(actual) ||
                           actual.includes(suggested);
                });

                if (validCategory) {
                    console.warn(`[Amazon Item AI] Fuzzy matched "${category}" to "${validCategory.name}"`);
                }
            }

            // If still no match, log error and return null
            if (!validCategory) {
                const availableCategories = categories.map(c => c.name).join(', ');
                console.error(`[Amazon Item AI] Invalid category suggested: "${category}"`);
                console.error(`[Amazon Item AI] Available categories: ${availableCategories}`);
                console.error(`[Amazon Item AI] Full AI response: ${response}`);
                return null;
            }

            return {
                category: validCategory.name,
                confidence: Math.max(50, Math.min(95, confidence)),
                reasoning: reasoning
            };
        } catch (error) {
            console.error('[Amazon Item AI] Failed to parse response:', error.message);
            return null;
        }
    }

    /**
     * Map Amazon's category to user category using basic heuristics
     * @param {string} amazonCategory - Amazon's category
     * @param {Array} categories - User categories
     * @returns {string|null} User category name
     */
    mapAmazonCategoryToUserCategory(amazonCategory, categories) {
        const mapping = {
            'Grocery': 'Groceries',
            'Grocery & Gourmet Food': 'Groceries',
            'Health & Personal Care': 'Healthcare',
            'Health & Household': 'Healthcare',
            'Beauty & Personal Care': 'Healthcare',
            'Home & Kitchen': 'Shopping',
            'Kitchen & Dining': 'Shopping',
            'Electronics': 'Shopping',
            'Computers': 'Shopping',
            'Books': 'Entertainment',
            'Movies & TV': 'Entertainment',
            'Video Games': 'Entertainment',
            'Toys & Games': 'Shopping',
            'Sports & Outdoors': 'Shopping',
            'Clothing, Shoes & Jewelry': 'Shopping',
            'Automotive': 'Auto & Transport',
            'Pet Supplies': 'Shopping',
            'Office Products': 'Shopping'
        };

        const mappedName = mapping[amazonCategory];
        if (mappedName) {
            const category = categories.find(c => c.name === mappedName);
            if (category) {
                return category.name;
            }
        }

        return null;
    }

    /**
     * Categorize multiple items in batch
     * @param {Array} items - Array of Amazon items
     * @param {number} limit - Optional limit (for debugging)
     * @returns {Array} Results with categorization for each item
     */
    async categorizeItemsBatch(items, limit = null) {
        const itemsToProcess = limit ? items.slice(0, limit) : items;
        const results = [];

        for (const item of itemsToProcess) {
            try {
                const result = await this.categorizeItem(item);
                results.push({
                    itemId: item.id,
                    ...result
                });
            } catch (error) {
                console.error(`[Amazon Item] Failed to categorize item ${item.id}:`, error.message);
                results.push({
                    itemId: item.id,
                    category: 'Uncategorized',
                    confidence: 10,
                    reasoning: `Error: ${error.message}`,
                    method: 'error'
                });
            }
        }

        return results;
    }

    /**
     * Learn from user's category choice and create/update rule
     * @param {Object} item - Amazon item
     * @param {string} userCategory - User-selected category
     * @returns {Object} Result with created rule info
     */
    async learnFromUser(item, userCategory) {
        try {
            // Strategy: Create a title-based rule for similar items
            // Extract key words from title (remove common words)
            const title = item.title.toLowerCase();
            const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];

            // Get significant words (more than 3 chars, not common words)
            const words = title.split(/\s+/)
                .filter(w => w.length > 3 && !commonWords.includes(w))
                .slice(0, 3); // Take first 3 significant words

            if (words.length === 0) {
                console.log('[Amazon Item] No significant words found for rule creation');
                return { success: false, reason: 'No significant words in title' };
            }

            // Create partial match pattern from key words
            const pattern = words[0]; // Use the first significant word as pattern
            const ruleName = `${pattern} -> ${userCategory}`;

            // Check if similar rule already exists
            const existingRules = database.getAmazonItemRules();
            const similarRule = existingRules.find(r =>
                r.pattern.toLowerCase() === pattern.toLowerCase() &&
                r.category === userCategory
            );

            if (similarRule) {
                console.log(`[Amazon Item] Similar rule already exists: ${similarRule.name}`);
                // Update stats for existing rule
                database.updateAmazonItemRuleStats(similarRule.id, true);
                return {
                    success: true,
                    ruleId: similarRule.id,
                    action: 'updated',
                    ruleName: similarRule.name
                };
            }

            // Create new rule
            const result = database.createAmazonItemRule({
                name: ruleName,
                pattern: pattern,
                category: userCategory,
                matchType: 'partial',
                ruleSource: 'user',
                asin: null, // Don't create ASIN-specific rules automatically
                amazonCategory: item.category
            });

            console.log(`[Amazon Item] Created new rule: ${ruleName}`);
            return {
                success: true,
                ruleId: result.id,
                action: 'created',
                ruleName: ruleName
            };
        } catch (error) {
            console.error('[Amazon Item] Failed to learn from user:', error.message);
            return {
                success: false,
                reason: error.message
            };
        }
    }
}

// Export singleton instance
export const amazonItemCategorization = new AmazonItemCategorization();
