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
        const allCategories = database.getCategories();
        // Filter to only categories enabled for Amazon categorization
        const categories = allCategories.filter(cat => cat.use_for_amazon);

        if (categories.length === 0) {
            console.warn('[Amazon Item] No categories enabled for Amazon categorization');
            return {
                category: 'Uncategorized',
                confidence: 0,
                reasoning: 'No categories available for Amazon categorization',
                method: 'no-categories'
            };
        }

        // Method 1: Check ASIN-based rules (highest priority, exact match)
        if (item.asin) {
            const asinRule = database.findAmazonItemRuleByASIN(item.asin);
            if (asinRule) {
                const reasoning = `Matched by ASIN rule: ${asinRule.name}`;
                console.log('[Amazon Item] ASIN Rule Match');
                console.log('  INPUT:  ' + item.asin + ' | ' + (item.title.length > 50 ? item.title.substring(0, 47) + '...' : item.title));
                console.log('  OUTPUT: ' + asinRule.category + ' (95% confidence)');
                console.log('  REASON: ' + reasoning);
                return {
                    category: asinRule.category,
                    confidence: 95,
                    reasoning: reasoning,
                    method: 'asin-rule',
                    ruleId: asinRule.id
                };
            }
        }

        // Method 2: Check title pattern rules
        if (item.title) {
            const titleRule = database.findAmazonItemRuleByTitle(item.title);
            if (titleRule) {
                const reasoning = `Matched by title pattern: ${titleRule.pattern}`;
                console.log('[Amazon Item] Title Pattern Match');
                console.log('  INPUT:  ' + (item.title.length > 70 ? item.title.substring(0, 67) + '...' : item.title));
                console.log('  OUTPUT: ' + titleRule.category + ' (90% confidence)');
                console.log('  REASON: ' + reasoning);
                return {
                    category: titleRule.category,
                    confidence: 90,
                    reasoning: reasoning,
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
                    console.log('\n' + '─'.repeat(80));
                    console.log('[Amazon Item] AI Categorization');
                    console.log('  INPUT:  ' + (item.title.length > 70 ? item.title.substring(0, 67) + '...' : item.title));
                    console.log('  OUTPUT: ' + aiResult.category + ` (${aiResult.confidence}% confidence)`);
                    console.log('  REASON: ' + aiResult.reasoning);
                    console.log('─'.repeat(80) + '\n');
                    return {
                        ...aiResult,
                        method: 'ai'
                    };
                } else if (aiResult) {
                    console.log(`[Amazon Item] AI returned low confidence (${aiResult.confidence}%), falling back to other methods`);
                }
            } catch (error) {
                console.error('[Amazon Item] AI categorization failed:', error.message);
            }
        }

        // Method 4: Map Amazon's category to user category (basic heuristics)
        if (item.category) {
            const mappedCategory = this.mapAmazonCategoryToUserCategory(item.category, categories);
            if (mappedCategory) {
                const reasoning = `Mapped from Amazon category: ${item.category}`;
                console.log('[Amazon Item] Amazon Category Mapping');
                console.log('  INPUT:  Amazon: "' + item.category + '" | ' + (item.title.length > 45 ? item.title.substring(0, 42) + '...' : item.title));
                console.log('  OUTPUT: ' + mappedCategory + ' (70% confidence)');
                console.log('  REASON: ' + reasoning);
                return {
                    category: mappedCategory,
                    confidence: 70,
                    reasoning: reasoning,
                    method: 'amazon-category-mapping'
                };
            }
        }

        // Method 5: Fallback - categorize as "Shopping" or "Uncategorized"
        const shoppingCategory = categories.find(c => c.name === 'Shopping' || c.name === 'Online Shopping');
        if (shoppingCategory) {
            const reasoning = 'Default categorization for Amazon purchases';
            console.log('[Amazon Item] Fallback (Shopping)');
            console.log('  INPUT:  ' + (item.title.length > 70 ? item.title.substring(0, 67) + '...' : item.title));
            console.log('  OUTPUT: ' + shoppingCategory.name + ' (40% confidence)');
            console.log('  REASON: ' + reasoning);
            return {
                category: shoppingCategory.name,
                confidence: 40,
                reasoning: reasoning,
                method: 'fallback-shopping'
            };
        }

        const reasoning = 'No matching rules or AI categorization available';
        console.log('[Amazon Item] Uncategorized');
        console.log('  INPUT:  ' + (item.title.length > 70 ? item.title.substring(0, 67) + '...' : item.title));
        console.log('  OUTPUT: Uncategorized (10% confidence)');
        console.log('  REASON: ' + reasoning);
        return {
            category: 'Uncategorized',
            confidence: 10,
            reasoning: reasoning,
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
                console.log('\n' + '═'.repeat(80));
                console.log('╔═══ DETAILED AI CATEGORIZATION LOG ═══╗');
                console.log('╠═══ INPUT ═══╗');
                console.log('║ Item: ' + item.title?.substring(0, 60) + (item.title?.length > 60 ? '...' : ''));
                console.log('║ ASIN: ' + (item.asin || 'N/A'));
                console.log('║ Amazon Category: ' + (item.category || 'N/A'));
                console.log('╚═════════════╝');
                console.log('');
                console.log('╔═══ PROMPT SENT TO AI ═══╗');
                console.log('║');
                prompt.split('\n').forEach(line => console.log('║ ' + line));
                console.log('╚═════════════════════════╝');
                console.log('');
                console.log('╔═══ RAW AI RESPONSE ═══╗');
                console.log('║');
                data.response.split('\n').forEach(line => console.log('║ ' + line));
                console.log('╚═══════════════════════╝');
                console.log('═'.repeat(80) + '\n');
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

        return `Categorize this item: ${item.title}

Available categories:
${categoryDetails}

CRITICAL RULES:

1. ONLY use the category names listed above - do NOT invent or guess categories
   - If you think an item should go in "Electronics" but that category doesn't exist, find the closest match or use low confidence
   - The categories above are the ONLY valid options

2. IT IS BETTER TO USE LOW CONFIDENCE THAN TO BE WRONG
   - If you're not sure which category fits, use 30-50% confidence
   - Only use 80-95% confidence if you're absolutely certain
   - Wrong categorization with high confidence is WORSE than low confidence

3. Match items to what they ARE, not what they're used FOR
   - Drill bits ARE tools/hardware (not supplies)
   - Wine glasses ARE kitchenware/household items (NOT food, even though they hold food)
   - Power adapters/cables/transistors ARE electronics or tools (not supplies)
   - Shampoo/soap/detergent ARE supplies (household/personal care consumables)
   - Bandages/medicine ARE healthcare items
   - Coffee/snacks ARE groceries/food (edible items)

4. Read the category DESCRIPTIONS carefully
   - If a description explicitly mentions the item type, use that category with high confidence (80-95%)
   - If the category NAME closely matches what the item is, use that category
   - Example: "drill bits" should match a category about tools/hardware/appliances, not supplies

5. Do NOT force items into "Supplies" as a catch-all
   - Supplies = personal care and household consumables (soap, shampoo, paper towels, cleaning products)
   - Supplies ≠ tools, electronics, kitchenware, or general household items
   - If uncertain, use the most general category with LOW confidence (30-50%)

You must choose from these exact names: ${categoryNames}

Respond ONLY in this format:
CATEGORY: [exact name from above list]
CONFIDENCE: [number 0-100 - use 30-50 if unsure, 80-95 only if certain]
REASONING: [explain what the item IS and why it matches this category]`;
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
