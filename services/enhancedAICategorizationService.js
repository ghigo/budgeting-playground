/**
 * Enhanced AI Categorization Service
 * 4-stage pipeline: exact match → rule-based → semantic similarity → LLM reasoning
 * Supports Amazon purchases and general transactions
 * Includes learning engine with automatic rule generation and retraining
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

// Retraining configuration
const RETRAINING_CONFIG = {
    INITIAL_THRESHOLD: 5,           // 0-100 purchases: retrain every 5 corrections
    LEARNING_THRESHOLD: 10,          // 100-500 purchases: retrain every 10 corrections
    MATURE_THRESHOLD: 50,            // 500+ purchases: retrain every 50 corrections
    INITIAL_PHASE_LIMIT: 100,
    LEARNING_PHASE_LIMIT: 500
};

class EnhancedAICategorization {
    constructor() {
        this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        this.llmModel = process.env.OLLAMA_MODEL || 'llama3.2:3b';
        this.embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';
        this.httpAgent = httpAgent;
        this.embeddingsCache = new Map(); // In-memory cache for faster similarity search
        this.embeddingsAvailable = null; // Cache embedding availability check
        this.embeddingCheckWarningShown = false;
    }

    /**
     * STAGE 1: Exact Match
     * Check if this exact item has been categorized and confirmed before
     */
    async exactMatch(itemId, itemType) {
        // Check if we have an exact match from a previously confirmed categorization
        const existingCategorization = database.getAICategorization(itemId, itemType);

        if (existingCategorization && existingCategorization.user_confirmed === 'Yes') {
            return {
                category: existingCategorization.category,
                confidence: 1.0,
                method: 'exact_match',
                reasoning: 'Previously confirmed categorization for this exact item',
                alternatives: []
            };
        }

        return null;
    }

    /**
     * STAGE 2: Rule-Based Matching
     * Apply exact match rules, vendor rules, and pattern rules
     */
    async ruleBasedMatch(item, itemType) {
        const itemText = this.getItemText(item, itemType).toLowerCase();

        // Get all enabled rules
        const rules = database.getEnabledCategoryRules();

        if (!rules || rules.length === 0) {
            return null;
        }

        // Sort rules by specificity (longer patterns first)
        const sortedRules = rules.sort((a, b) => b.pattern.length - a.pattern.length);

        for (const rule of sortedRules) {
            const pattern = rule.pattern.toLowerCase();
            const matchType = rule.match_type || 'regex';

            let isMatch = false;

            try {
                switch (matchType) {
                    case 'exact':
                        isMatch = itemText === pattern;
                        break;
                    case 'contains':
                        isMatch = itemText.includes(pattern);
                        break;
                    case 'startswith':
                        isMatch = itemText.startsWith(pattern);
                        break;
                    case 'endswith':
                        isMatch = itemText.endsWith(pattern);
                        break;
                    case 'regex':
                    default:
                        const regex = new RegExp(pattern, 'i');
                        isMatch = regex.test(itemText);
                        break;
                }
            } catch (error) {
                console.error(`Rule pattern error: ${pattern}`, error);
                continue;
            }

            if (isMatch) {
                const confidence = rule.confidence_override || 0.90;
                return {
                    category: rule.category,
                    confidence: confidence,
                    method: 'rule',
                    reasoning: `Matched rule: "${rule.name}" (pattern: ${rule.pattern})`,
                    alternatives: []
                };
            }
        }

        // Check Amazon-specific item rules if it's an Amazon item
        if (itemType === 'amazon_item' && item.asin) {
            const itemRules = database.getAmazonItemRulesByASIN(item.asin);
            if (itemRules) {
                return {
                    category: itemRules.category,
                    confidence: 0.95,
                    method: 'rule',
                    reasoning: `Matched ASIN rule for exact product`,
                    alternatives: []
                };
            }
        }

        return null;
    }

    /**
     * STAGE 3: Semantic Similarity Search
     * Use embeddings to find similar previously categorized items
     */
    async semanticSimilarity(item, itemType, categories) {
        // Skip if we already know embeddings aren't available
        if (this.embeddingsAvailable === false) {
            return null;
        }

        try {
            // Generate embedding for the current item
            const itemText = this.getItemText(item, itemType);
            const itemEmbedding = await this.generateEmbedding(itemText);

            if (!itemEmbedding || itemEmbedding.length === 0) {
                return null;
            }

            // Get confirmed embeddings from database
            const confirmedEmbeddings = database.getConfirmedEmbeddings(itemType, 1000);

            if (!confirmedEmbeddings || confirmedEmbeddings.length === 0) {
                return null;
            }

            // Calculate cosine similarity with all confirmed embeddings
            const similarities = confirmedEmbeddings.map(embedding => ({
                ...embedding,
                similarity: this.cosineSimilarity(itemEmbedding, embedding.embedding_vector)
            }));

            // Sort by similarity (highest first)
            similarities.sort((a, b) => b.similarity - a.similarity);

            // Get top match
            const topMatch = similarities[0];

            // If similarity is high enough, use this category
            if (topMatch.similarity > 0.85) {
                // Get top 3 for voting if multiple high-confidence matches
                const topMatches = similarities.slice(0, 5).filter(s => s.similarity > 0.80);

                // Vote by similarity weights
                const categoryVotes = {};
                topMatches.forEach(match => {
                    categoryVotes[match.category] = (categoryVotes[match.category] || 0) + match.similarity;
                });

                // Get category with highest weighted vote
                const winningCategory = Object.entries(categoryVotes)
                    .sort((a, b) => b[1] - a[1])[0][0];

                // Generate alternatives from other high-similarity categories
                const alternatives = Object.entries(categoryVotes)
                    .filter(([cat, score]) => cat !== winningCategory)
                    .map(([cat, score]) => ({
                        category: cat,
                        confidence: Math.min(score / categoryVotes[winningCategory], 0.95)
                    }))
                    .slice(0, 3);

                return {
                    category: winningCategory,
                    confidence: Math.min(topMatch.similarity, 0.92),
                    method: 'embedding',
                    reasoning: `High semantic similarity (${(topMatch.similarity * 100).toFixed(1)}%) to "${topMatch.embedding_text}"`,
                    alternatives: alternatives
                };
            }

            return null;
        } catch (error) {
            console.error('Semantic similarity search failed:', error);
            return null;
        }
    }

    /**
     * STAGE 4: LLM Reasoning (Fallback)
     * Use Ollama LLM for intelligent categorization
     */
    async llmReasoning(item, itemType, categories) {
        try {
            // Check if Ollama is available
            const isAvailable = await this.checkOllamaAvailable();
            if (!isAvailable) {
                return this.fallbackCategorization(item, itemType, categories);
            }

            const prompt = this.buildLLMPrompt(item, itemType, categories);

            const response = await fetch(`${this.ollamaUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.llmModel,
                    prompt: prompt,
                    format: 'json',
                    stream: false,
                    options: {
                        temperature: 0.3,
                        num_predict: 200
                    }
                }),
                signal: AbortSignal.timeout(30000),
                agent: this.httpAgent
            });

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.status}`);
            }

            const result = await response.json();
            const parsed = this.parseLLMResponse(result.response, categories);

            return {
                ...parsed,
                method: 'llm'
            };
        } catch (error) {
            console.error('LLM reasoning failed:', error);
            return this.fallbackCategorization(item, itemType, categories);
        }
    }

    /**
     * Main categorization pipeline
     * Executes all 4 stages in sequence
     */
    async categorize(item, itemType, itemId = null, cachedCategories = null) {
        const categories = cachedCategories || database.getCategories();

        // Use provided itemId or generate from item
        const id = itemId || this.getItemId(item, itemType);

        // STAGE 1: Exact Match
        const exactMatch = await this.exactMatch(id, itemType);
        if (exactMatch) {
            // Save categorization result
            database.saveAICategorization(
                id, itemType, exactMatch.category, exactMatch.confidence,
                exactMatch.method, exactMatch.alternatives, exactMatch.reasoning
            );
            return exactMatch;
        }

        // STAGE 2: Rule-Based Matching
        const ruleMatch = await this.ruleBasedMatch(item, itemType);
        if (ruleMatch && ruleMatch.confidence > 0.9) {
            database.saveAICategorization(
                id, itemType, ruleMatch.category, ruleMatch.confidence,
                ruleMatch.method, ruleMatch.alternatives, ruleMatch.reasoning
            );
            return ruleMatch;
        }

        // STAGE 3: Semantic Similarity
        const similarityMatch = await this.semanticSimilarity(item, itemType, categories);
        if (similarityMatch && similarityMatch.confidence > 0.85) {
            database.saveAICategorization(
                id, itemType, similarityMatch.category, similarityMatch.confidence,
                similarityMatch.method, similarityMatch.alternatives, similarityMatch.reasoning
            );
            return similarityMatch;
        }

        // STAGE 4: LLM Reasoning (Fallback)
        const llmResult = await this.llmReasoning(item, itemType, categories);
        database.saveAICategorization(
            id, itemType, llmResult.category, llmResult.confidence,
            llmResult.method, llmResult.alternatives, llmResult.reasoning
        );
        return llmResult;
    }

    /**
     * Batch categorization with progress tracking
     */
    async batchCategorize(items, itemType, options = {}) {
        const results = [];
        const batchSize = options.batchSize || 10;

        // Fetch categories once for all items (massive performance improvement)
        const categories = database.getCategories();

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);

            const batchResults = await Promise.all(
                batch.map(item => this.categorize(item, itemType, null, categories))
            );

            results.push(...batchResults);

            // Report progress if callback provided
            if (options.onProgress) {
                options.onProgress({
                    processed: Math.min(i + batchSize, items.length),
                    total: items.length,
                    percentage: Math.min(((i + batchSize) / items.length) * 100, 100)
                });
            }

            // Small delay between batches to avoid overwhelming Ollama (reduced from 100ms to 10ms)
            if (i + batchSize < items.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        return results;
    }

    /**
     * Record user feedback and trigger learning
     */
    async recordFeedback(itemId, itemType, suggestedCategory, actualCategory, suggestionMethod, suggestionConfidence) {
        // Save feedback to database
        database.saveAIFeedback(
            itemId, itemType, suggestedCategory, actualCategory,
            suggestionMethod, suggestionConfidence
        );

        // Update the categorization to be user-confirmed
        database.saveAICategorization(
            itemId, itemType, actualCategory, 1.0,
            'user_confirmed', [], 'User manually confirmed this categorization', 'Yes'
        );

        // Update embedding with confirmed category
        const item = this.getItemById(itemId, itemType);
        if (item) {
            const itemText = this.getItemText(item, itemType);
            const embedding = await this.generateEmbedding(itemText);
            if (embedding) {
                database.saveEmbedding(itemId, itemType, itemText, embedding, actualCategory, 'Yes');
            }
        }

        // Immediate rule creation for repeated patterns
        await this.checkAndCreateRules(itemId, itemType, actualCategory);

        // Check if retraining threshold reached (check database, not just in-memory counter)
        const feedbackCount = database.getFeedbackCountSinceLastTraining();
        const threshold = this.getRetrainingThreshold();

        if (feedbackCount >= threshold) {
            console.log(`🔄 Retraining threshold reached (${feedbackCount}/${threshold} corrections)`);
            console.log('   Triggering immediate retraining...');
            // Trigger background retraining (non-blocking)
            this.retrain().catch(err => console.error('Retraining failed:', err));
        }
    }

    /**
     * Check for patterns and create auto-generated rules
     */
    async checkAndCreateRules(itemId, itemType, actualCategory) {
        // Get feedback patterns that might warrant rule creation
        const patterns = database.getFeedbackPatternsForRuleGeneration();

        for (const pattern of patterns) {
            // If same item corrected 2+ times to same category, create exact match rule
            if (pattern.correction_count >= 2 && pattern.item_type === itemType) {
                const item = this.getItemById(pattern.item_id, itemType);
                if (item) {
                    const itemText = this.getItemText(item, itemType);

                    try {
                        // Create auto-generated rule
                        const ruleName = `Auto: ${itemText.substring(0, 50)}`;
                        database.createAutoGeneratedRule(
                            ruleName,
                            itemText,
                            pattern.actual_category,
                            'exact',
                            0.98,
                            'ai_learning'
                        );
                        console.log(`✨ Auto-created rule: "${ruleName}" → ${pattern.actual_category}`);
                    } catch (error) {
                        // Rule might already exist, ignore
                    }
                }
            }
        }
    }

    /**
     * Retrain the categorization system
     */
    async retrain() {
        const startTime = Date.now();
        console.log('🎯 Starting retraining process...');

        try {
            // Get all unprocessed feedback
            const feedback = database.getUnprocessedFeedback(1000);

            if (feedback.length === 0) {
                console.log('No feedback to process');
                return;
            }

            let rulesGenerated = 0;
            let embeddingsUpdated = 0;

            // 1. Generate rules from patterns
            const patterns = database.getFeedbackPatternsForRuleGeneration();
            for (const pattern of patterns) {
                if (pattern.correction_count >= 2) {
                    try {
                        const item = this.getItemById(pattern.item_id, pattern.item_type);
                        if (item) {
                            const itemText = this.getItemText(item, pattern.item_type);
                            const ruleName = `Auto: ${itemText.substring(0, 50)}`;

                            database.createAutoGeneratedRule(
                                ruleName,
                                itemText,
                                pattern.actual_category,
                                'exact',
                                0.98,
                                'ai_learning'
                            );
                            rulesGenerated++;
                        }
                    } catch (error) {
                        // Rule exists, skip
                    }
                }
            }

            // 2. Update embeddings for confirmed categorizations
            for (const fb of feedback) {
                const item = this.getItemById(fb.item_id, fb.item_type);
                if (item) {
                    const itemText = this.getItemText(item, fb.item_type);
                    const embedding = await this.generateEmbedding(itemText);

                    if (embedding) {
                        database.saveEmbedding(
                            fb.item_id, fb.item_type, itemText, embedding,
                            fb.actual_category, 'Yes'
                        );
                        embeddingsUpdated++;
                    }
                }
            }

            // 3. Mark feedback as processed
            const feedbackIds = feedback.map(f => f.id);
            database.markFeedbackAsProcessed(feedbackIds);

            // 4. Clear embeddings cache to force reload
            this.embeddingsCache.clear();

            // 5. Record training history
            const duration = Date.now() - startTime;
            database.saveAITrainingHistory(
                feedback.length,
                rulesGenerated,
                embeddingsUpdated,
                duration,
                'automatic',
                `Processed ${feedback.length} corrections, generated ${rulesGenerated} rules, updated ${embeddingsUpdated} embeddings`
            );

            console.log(`✅ Retraining complete in ${duration}ms:`);
            console.log(`   - Processed ${feedback.length} corrections`);
            console.log(`   - Generated ${rulesGenerated} rules`);
            console.log(`   - Updated ${embeddingsUpdated} embeddings`);
        } catch (error) {
            console.error('Retraining failed:', error);
        }
    }

    /**
     * Get adaptive retraining threshold based on system maturity
     */
    getRetrainingThreshold() {
        // Get total categorized items to determine phase
        const stats = database.getAmazonItemStats();
        const totalCategorized = stats?.categorized_items || 0;

        if (totalCategorized < RETRAINING_CONFIG.INITIAL_PHASE_LIMIT) {
            return RETRAINING_CONFIG.INITIAL_THRESHOLD; // Initial phase: every 5
        } else if (totalCategorized < RETRAINING_CONFIG.LEARNING_PHASE_LIMIT) {
            return RETRAINING_CONFIG.LEARNING_THRESHOLD; // Learning phase: every 10
        } else {
            return RETRAINING_CONFIG.MATURE_THRESHOLD; // Mature phase: every 50
        }
    }

    /**
     * Attempt to auto-install embedding model
     */
    async autoInstallEmbeddingModel() {
        console.log(`📥 Attempting to auto-install embedding model: ${this.embeddingModel}`);
        console.log('   This may take a few minutes (model size: ~275 MB)...');

        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            // Try to pull the model using Ollama CLI
            const { stdout, stderr } = await execAsync(`ollama pull ${this.embeddingModel}`, {
                timeout: 300000 // 5 minute timeout
            });

            console.log('✅ Embedding model installed successfully!');
            console.log('   Semantic similarity search is now enabled.');
            this.embeddingsAvailable = true;
            return true;
        } catch (error) {
            console.error('❌ Failed to auto-install embedding model:', error.message);
            console.log('');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('⚠️  EMBEDDINGS DISABLED - Semantic Search Unavailable');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('');
            console.log('The AI categorization system is working, but Stage 3 (Semantic');
            console.log('Similarity) is disabled. This reduces accuracy for similar items.');
            console.log('');
            console.log('To enable semantic similarity search, manually install the model:');
            console.log('');
            console.log(`  $ ollama pull ${this.embeddingModel}`);
            console.log('');
            console.log('Then restart the server:');
            console.log('');
            console.log('  $ npm run start:prod');
            console.log('');
            console.log('Current categorization pipeline:');
            console.log('  ✅ Stage 1: Exact Match (100% confidence)');
            console.log('  ✅ Stage 2: Rule-Based (90-98% confidence)');
            console.log('  ❌ Stage 3: Semantic Similarity (DISABLED)');
            console.log('  ✅ Stage 4: LLM Reasoning (fallback)');
            console.log('');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('');
            return false;
        }
    }

    /**
     * Generate embedding using Ollama
     */
    async generateEmbedding(text) {
        try {
            // Try the newer /api/embed endpoint first (Ollama 0.1.0+)
            let response = await fetch(`${this.ollamaUrl}/api/embed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.embeddingModel,
                    input: text
                }),
                signal: AbortSignal.timeout(10000),
                agent: this.httpAgent
            });

            // If 404, try the older /api/embeddings endpoint
            if (response.status === 404) {
                response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: this.embeddingModel,
                        prompt: text
                    }),
                    signal: AbortSignal.timeout(10000),
                    agent: this.httpAgent
                });
            }

            if (!response.ok) {
                // If still failing, it's likely the model isn't installed
                if (response.status === 404) {
                    this.embeddingsAvailable = false;

                    // Only try to auto-install once
                    if (!this.embeddingCheckWarningShown) {
                        this.embeddingCheckWarningShown = true;

                        // Attempt automatic installation
                        const installed = await this.autoInstallEmbeddingModel();

                        if (installed) {
                            // Try generating embedding again after successful installation
                            return this.generateEmbedding(text);
                        }
                    }

                    return null;
                }
                throw new Error(`Ollama embeddings API error: ${response.status}`);
            }

            const result = await response.json();
            // Mark as available on first success
            if (this.embeddingsAvailable === null) {
                this.embeddingsAvailable = true;
            }
            // Handle both response formats
            return result.embedding || result.embeddings?.[0];
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn('⚠️  Embedding generation timed out');
            } else if (!error.message.includes('not found') && !error.message.includes('404')) {
                console.warn('⚠️  Failed to generate embedding:', error.message);
            }
            return null;
        }
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    cosineSimilarity(vec1, vec2) {
        if (!vec1 || !vec2 || vec1.length !== vec2.length) {
            return 0;
        }

        let dotProduct = 0;
        let mag1 = 0;
        let mag2 = 0;

        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            mag1 += vec1[i] * vec1[i];
            mag2 += vec2[i] * vec2[i];
        }

        mag1 = Math.sqrt(mag1);
        mag2 = Math.sqrt(mag2);

        if (mag1 === 0 || mag2 === 0) {
            return 0;
        }

        return dotProduct / (mag1 * mag2);
    }

    /**
     * Build LLM prompt for categorization
     */
    buildLLMPrompt(item, itemType, categories) {
        const categoryList = categories
            .map(c => {
                let desc = `- ${c.name}`;
                if (c.description) desc += `\n  ${c.description}`;
                if (c.examples) desc += `\n  Examples: ${c.examples}`;
                return desc;
            })
            .join('\n\n');

        const itemText = this.getItemText(item, itemType);
        const itemDetails = this.getItemDetails(item, itemType);

        return `You are a purchase categorization assistant. Categorize the following purchase into one of the user's defined categories.

Available Categories:
${categoryList}

Purchase to categorize:
${itemDetails}

Respond ONLY with valid JSON:
{
  "category": "category_name",
  "confidence": 0.85,
  "reasoning": "brief explanation",
  "alternatives": [
    {"category": "alternative_name", "confidence": 0.15}
  ]
}

Be confident when the item clearly matches a category. Use lower confidence (0.5-0.7) when uncertain.`;
    }

    /**
     * Parse LLM JSON response
     */
    parseLLMResponse(response, categories) {
        try {
            // Try to extract JSON
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }

            const parsed = JSON.parse(jsonMatch[0]);

            // Validate category exists
            const category = categories.find(c =>
                c.name.toLowerCase() === parsed.category.toLowerCase()
            );

            if (!category) {
                throw new Error('Category not found');
            }

            return {
                category: category.name,
                confidence: parsed.confidence || 0.7,
                reasoning: parsed.reasoning || 'LLM categorization',
                alternatives: parsed.alternatives || []
            };
        } catch (error) {
            console.error('Failed to parse LLM response:', error);
            return this.fallbackCategorization({}, 'unknown', categories);
        }
    }

    /**
     * Fallback categorization when all else fails
     */
    fallbackCategorization(item, itemType, categories) {
        const uncategorized = categories.find(c => c.name.toLowerCase() === 'uncategorized')
            || categories.find(c => c.name.toLowerCase() === 'other')
            || categories[0];

        return {
            category: uncategorized.name,
            confidence: 0.3,
            method: 'fallback',
            reasoning: 'Could not determine category with confidence',
            alternatives: []
        };
    }

    /**
     * Check if Ollama is available
     */
    async checkOllamaAvailable() {
        try {
            const response = await fetch(`${this.ollamaUrl}/api/tags`, {
                signal: AbortSignal.timeout(2000),
                agent: this.httpAgent
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get item text for embedding/matching
     */
    getItemText(item, itemType) {
        switch (itemType) {
            case 'amazon_item':
                return `${item.title || ''} ${item.category || ''}`.trim();
            case 'transaction':
                return `${item.description || ''} ${item.merchant_name || ''}`.trim();
            default:
                return JSON.stringify(item);
        }
    }

    /**
     * Get detailed item information for LLM prompt
     */
    getItemDetails(item, itemType) {
        switch (itemType) {
            case 'amazon_item':
                return `- Item: ${item.title || 'Unknown'}
- Amazon Category: ${item.category || 'N/A'}
- Price: $${item.price || 0}
- Seller: ${item.seller || 'Amazon'}`;
            case 'transaction':
                return `- Description: ${item.description || 'N/A'}
- Merchant: ${item.merchant_name || 'N/A'}
- Amount: $${Math.abs(item.amount || 0).toFixed(2)}`;
            default:
                return JSON.stringify(item, null, 2);
        }
    }

    /**
     * Get item ID
     */
    getItemId(item, itemType) {
        switch (itemType) {
            case 'amazon_item':
                return item.id?.toString() || item.asin || '';
            case 'transaction':
                return item.transaction_id || '';
            default:
                return item.id?.toString() || '';
        }
    }

    /**
     * Get item by ID from database
     */
    getItemById(itemId, itemType) {
        switch (itemType) {
            case 'amazon_item':
                return database.getAmazonItemById(parseInt(itemId));
            case 'transaction':
                return database.getTransactionById(itemId);
            default:
                return null;
        }
    }

    /**
     * Get service status
     */
    async getStatus() {
        const ollamaAvailable = await this.checkOllamaAvailable();
        const threshold = this.getRetrainingThreshold();
        const feedbackCount = database.getFeedbackCountSinceLastTraining();

        return {
            ollamaAvailable,
            llmModel: this.llmModel,
            embeddingModel: this.embeddingModel,
            retrainingThreshold: threshold,
            pendingFeedback: feedbackCount,
            nextRetrainingIn: Math.max(0, threshold - feedbackCount)
        };
    }
}

// Export singleton instance
const enhancedAI = new EnhancedAICategorization();
export default enhancedAI;
