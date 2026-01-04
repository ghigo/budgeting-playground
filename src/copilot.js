import * as database from './database.js';
import { randomUUID } from 'crypto';

// ============================================================================
// COPILOT CSV PARSING
// ============================================================================

/**
 * Parse Copilot Money CSV export
 * Expected format:
 * "date","name","amount","status","category","parent category","excluded","tags","type","account","account mask","note","recurring"
 */
export function parseCopilotCSV(csvContent) {
    const lines = csvContent.trim().split('\n');

    if (lines.length < 2) {
        throw new Error('CSV file is empty or has no data rows');
    }

    // Parse header
    const headers = parseCSVLine(lines[0]);

    // Validate required headers
    const requiredHeaders = ['date', 'name', 'amount', 'account'];
    for (const required of requiredHeaders) {
        if (!headers.includes(required)) {
            throw new Error(`Missing required column: ${required}`);
        }
    }

    const transactions = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);

        if (values.length === 0 || values.length < headers.length - 5) {
            continue; // Skip empty or malformed lines
        }

        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });

        // Extract transaction data
        const date = row['date'];
        const name = row['name'];
        const amount = row['amount'];
        const status = row['status'] || 'posted';
        const category = row['category'] || '';
        const parentCategory = row['parent category'] || '';
        const excluded = row['excluded'] === 'true' || row['excluded'] === 'TRUE';
        const type = row['type'] || 'regular';
        const account = row['account'] || 'Unknown';
        const accountMask = row['account mask'] || '';
        const note = row['note'] || '';

        // Skip excluded transactions and internal transfers if requested
        if (excluded || type === 'internal transfer') {
            continue;
        }

        // Parse amount (Copilot uses positive for expenses, negative for income)
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount)) {
            console.warn(`Skipping transaction with invalid amount: ${name} - ${amount}`);
            continue;
        }

        // Standardize date to YYYY-MM-DD
        const standardizedDate = standardizeDate(date);
        if (!standardizedDate) {
            console.warn(`Skipping transaction with invalid date: ${name} - ${date}`);
            continue;
        }

        // Determine final category
        let finalCategory = category;
        if (category && parentCategory && category !== parentCategory) {
            // Use full path if both are present
            finalCategory = `${parentCategory} > ${category}`;
        } else if (parentCategory && !category) {
            finalCategory = parentCategory;
        }

        transactions.push({
            transaction_id: randomUUID(),
            date: standardizedDate,
            description: name,
            merchant_name: name,
            account_name: accountMask ? `${account} (${accountMask})` : account,
            amount: parsedAmount,
            category: finalCategory || null,
            pending: status === 'pending' ? 'Yes' : 'No',
            verified: 'No',
            confidence: finalCategory ? 95 : 0, // High confidence if category from Copilot
            notes: note || null,
            payment_channel: null,
            created_at: new Date().toISOString()
        });
    }

    return transactions;
}

/**
 * Parse a CSV line, handling quoted fields
 */
function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"';
                i++; // Skip next quote
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // End of field
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    values.push(current.trim());
    return values;
}

/**
 * Standardize date to YYYY-MM-DD format
 */
function standardizeDate(dateStr) {
    if (!dateStr) return null;

    // If already in YYYY-MM-DD format, return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }

    const date = new Date(dateStr);

    if (isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString().split('T')[0];
}

/**
 * Analyze Copilot CSV and detect unmapped categories
 */
export function analyzeCopilotCSV(csvContent) {
    const parsedTransactions = parseCopilotCSV(csvContent);

    // Get all existing categories
    const existingCategories = database.getCategories();
    const existingCategoryNames = new Set(existingCategories.map(c => c.name));

    // Collect unique categories from Copilot that don't exist
    const unmappedCategories = new Map(); // copilotCategory -> { count, sampleTransactions }

    for (const transaction of parsedTransactions) {
        if (transaction.category) {
            // Check if category exists (case-insensitive)
            const categoryExists = Array.from(existingCategoryNames).some(
                existing => existing.toLowerCase() === transaction.category.toLowerCase()
            );

            if (!categoryExists) {
                if (!unmappedCategories.has(transaction.category)) {
                    unmappedCategories.set(transaction.category, {
                        count: 0,
                        sampleTransactions: []
                    });
                }
                const categoryData = unmappedCategories.get(transaction.category);
                categoryData.count++;
                if (categoryData.sampleTransactions.length < 3) {
                    categoryData.sampleTransactions.push({
                        description: transaction.description,
                        amount: transaction.amount,
                        date: transaction.date
                    });
                }
            }
        }
    }

    // Convert to array for easier frontend handling
    const unmappedList = Array.from(unmappedCategories.entries()).map(([category, data]) => ({
        copilotCategory: category,
        count: data.count,
        sampleTransactions: data.sampleTransactions
    }));

    return {
        totalTransactions: parsedTransactions.length,
        unmappedCategories: unmappedList,
        needsMapping: unmappedList.length > 0
    };
}

/**
 * Import Copilot transactions with category mappings
 * @param {string} csvContent - CSV file content
 * @param {Object} categoryMappings - Map of copilotCategory -> appCategory (or null to skip)
 */
export function importCopilotTransactionsWithMappings(csvContent, categoryMappings = {}) {
    const parsedTransactions = parseCopilotCSV(csvContent);

    let importedCount = 0;
    let skippedCount = 0;

    for (const transaction of parsedTransactions) {
        try {
            // Check if transaction already exists (by date, description, amount, and account)
            const existing = database.db.prepare(`
                SELECT transaction_id
                FROM transactions
                WHERE date = ?
                  AND description = ?
                  AND amount = ?
                  AND account_name = ?
                LIMIT 1
            `).get(
                transaction.date,
                transaction.description,
                transaction.amount,
                transaction.account_name
            );

            if (existing) {
                skippedCount++;
                continue;
            }

            // Apply category mapping if category is provided
            let finalCategory = null;
            let confidence = 0;

            if (transaction.category) {
                // Check if we have a mapping for this category
                if (categoryMappings[transaction.category]) {
                    finalCategory = categoryMappings[transaction.category];
                    confidence = 95; // High confidence from Copilot mapping
                } else {
                    // Check if category exists in app (case-insensitive)
                    const existingCategories = database.getCategories();
                    const matchingCategory = existingCategories.find(
                        c => c.name.toLowerCase() === transaction.category.toLowerCase()
                    );
                    if (matchingCategory) {
                        finalCategory = matchingCategory.name;
                        confidence = 95;
                    }
                    // If no mapping and doesn't exist, leave as null
                }
            }

            // Insert transaction
            database.db.prepare(`
                INSERT INTO transactions (
                    transaction_id, date, description, merchant_name,
                    account_name, amount, category, pending, verified,
                    confidence, notes, payment_channel, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                transaction.transaction_id,
                transaction.date,
                transaction.description,
                transaction.merchant_name,
                transaction.account_name,
                transaction.amount,
                finalCategory,
                transaction.pending,
                transaction.verified,
                confidence,
                transaction.notes,
                transaction.payment_channel,
                transaction.created_at
            );

            importedCount++;
        } catch (error) {
            console.error(`Error importing transaction ${transaction.description}:`, error.message);
            skippedCount++;
        }
    }

    return {
        imported: importedCount,
        skipped: skippedCount,
        total: parsedTransactions.length
    };
}
