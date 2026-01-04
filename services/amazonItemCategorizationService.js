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
                const reasoning = `Matched by ASIN rule: ${asinRule.name}`;
                console.log(`[Amazon Item] ASIN rule matched: ${item.asin} -> ${asinRule.category} - ${reasoning}`);
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
                console.log(`[Amazon Item] Title rule matched: ${item.title} -> ${titleRule.category} - ${reasoning}`);
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
                    console.log(`[Amazon Item] AI categorization: ${item.title} -> ${aiResult.category} (${aiResult.confidence}%) - ${aiResult.reasoning}`);
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
                const reasoning = `Mapped from Amazon category: ${item.category}`;
                console.log(`[Amazon Item] Amazon category mapping: ${item.title} -> ${mappedCategory} - ${reasoning}`);
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
            console.log(`[Amazon Item] Fallback categorization: ${item.title} -> ${shoppingCategory.name} - ${reasoning}`);
            return {
                category: shoppingCategory.name,
                confidence: 40,
                reasoning: reasoning,
                method: 'fallback-shopping'
            };
        }

        const reasoning = 'No matching rules or AI categorization available';
        console.log(`[Amazon Item] Uncategorized: ${item.title} - ${reasoning}`);
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

User's Category Definitions:
${categoryDetails}

Amazon Item Details:
- Title: ${item.title}
${item.category ? `- Amazon Category: ${item.category}` : ''}
${item.price ? `- Price: $${item.price}` : ''}
${item.quantity > 1 ? `- Quantity: ${item.quantity}` : ''}
${item.seller ? `- Seller: ${item.seller}` : ''}
${item.asin ? `- ASIN: ${item.asin}` : ''}
${item.account_name ? `- Account: ${item.account_name}` : ''}

CATEGORIZATION APPROACH:

Use your general knowledge about products and categories, BUT give HIGH WEIGHT to the user's category descriptions, especially when items are explicitly mentioned.

CRITICAL: Use COMMON SENSE and your understanding of what items fundamentally are:
- A drill bit is a TOOL (not groceries, not entertainment, not healthcare)
- Food/beverages are GROCERIES or RESTAURANTS
- Movies/games/books are ENTERTAINMENT
- Medicine/medical supplies are HEALTHCARE
- Don't make absurd connections (e.g., "drill bits are associated with grocery shopping" is WRONG)

1. CATEGORY DESCRIPTIONS HAVE HIGH WEIGHT (when they exist)
   - When an item type is explicitly mentioned in a category description or keywords, strongly prefer that category
   - Example: If "shampoo" is listed in "Supplies" description, shampoo should go to Supplies (not Groceries)
   - The user's descriptions reflect their personal categorization preferences
   - Explicit mentions in descriptions should override typical retail categorization

2. USE GENERAL KNOWLEDGE WITH COMMON SENSE
   - First, understand what the item fundamentally IS (tool, food, clothing, electronics, etc.)
   - Match to the category that best fits the item's PRIMARY nature
   - If no specific category exists, use the most general appropriate category (e.g., "Shopping", "Other")
   - DO NOT make illogical reasoning chains (e.g., "tools are used for home repairs which are related to grocery shopping")
   - When descriptions are empty or ambiguous, rely heavily on the category NAME and general knowledge

3. CATEGORY NAME RULES (STRICT)
   - You MUST use the EXACT category name from the list - DO NOT create new category names
   - DO NOT combine name with description (e.g., "House - House ordinary expenses" is WRONG)
   - DO NOT make up categories like "Electronics & Gadgets" or "Tools & Home Improvement"

4. DECISION PRIORITY
   a) HIGHEST: Item explicitly mentioned in a category description/keywords → use that category
   b) HIGH: Item's fundamental nature matches category name (e.g., drill bits → "Tools" if it exists)
   c) MEDIUM: Item fits the general theme of a category with good description
   d) LOW: If no good match, use "Shopping", "Other", or most general category
   e) NEVER: Make illogical reasoning chains to force a poor match

5. EXAMPLES OF CORRECT REASONING

   Example 1 - Explicit mention wins:
   - Item: "Shampoo"
   - User has "Supplies - House supplies like shampoo, toiletry, detergents"
   - User has "Groceries - Food and consumable items"
   - CORRECT: "Supplies" (95% confidence - shampoo explicitly mentioned in Supplies description)
   - WRONG: "Groceries" (would ignore the explicit mention in Supplies)

   Example 2 - Use common sense when no specific category exists:
   - Item: "Drill bit set for woodworking"
   - User has: "Groceries", "Entertainment", "Shopping", "Healthcare", etc. (no Tools/Hardware category)
   - CORRECT: "Shopping" (75% confidence - drill bits are tools, Shopping is for general purchases)
   - WRONG: "Groceries" (nonsensical - drill bits are not food or groceries)
   - WRONG: "Entertainment" (nonsensical - drill bits are not for entertainment)

   Example 3 - General knowledge with theme matching:
   - Item: "USB Cable"
   - User has "Electronics - Gadgets and electronic devices"
   - User has "Shopping - General purchases"
   - CORRECT: "Electronics" (85% confidence - cables are electronic accessories, fits theme)
   - ACCEPTABLE: "Shopping" (70% confidence - if Electronics description doesn't fit well)

Valid category names to choose from:
${categoryNames}

Respond in this EXACT format (no additional text):

CATEGORY: [exact category name from the list above]
CONFIDENCE: [number from 0-100]
REASONING: [brief explanation of why this category, mentioning if explicitly listed or theme match]

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
