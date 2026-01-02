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
 * Import Copilot transactions from CSV
 */
export function importCopilotTransactionsFromCSV(csvContent) {
    const parsedTransactions = parseCopilotCSV(csvContent);

    let importedCount = 0;
    let skippedCount = 0;
    const categoriesCreated = new Set();

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

            // Create category if it doesn't exist and is provided
            if (transaction.category) {
                try {
                    // Handle parent > child category structure
                    const parts = transaction.category.split('>').map(p => p.trim());

                    if (parts.length === 2) {
                        // Ensure parent exists first
                        try {
                            database.addCategory(parts[0], null);
                            categoriesCreated.add(parts[0]);
                        } catch (error) {
                            // Parent might already exist
                        }

                        // Then create child
                        try {
                            database.addCategory(parts[1], parts[0]);
                            categoriesCreated.add(parts[1]);
                        } catch (error) {
                            // Child might already exist
                        }

                        // Use child as the category
                        transaction.category = parts[1];
                    } else {
                        // Single category
                        try {
                            database.addCategory(transaction.category, null);
                            categoriesCreated.add(transaction.category);
                        } catch (error) {
                            // Category might already exist
                        }
                    }
                } catch (error) {
                    console.warn(`Error creating category "${transaction.category}":`, error.message);
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
                transaction.category,
                transaction.pending,
                transaction.verified,
                transaction.confidence,
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
        total: parsedTransactions.length,
        categoriesCreated: categoriesCreated.size
    };
}
