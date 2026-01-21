# AI-Powered Amazon Purchase Categorization System

## Overview

This system provides an intelligent, locally-hosted AI categorization service for Amazon purchases and general transactions. It uses a 4-stage pipeline with adaptive learning to automatically categorize purchases with high accuracy.

## Architecture

### Core Components

1. **Enhanced AI Categorization Service** (`enhancedAICategorizationService.js`)
   - 4-stage categorization pipeline
   - Semantic similarity search using embeddings
   - LLM-based reasoning as fallback
   - Adaptive learning from user feedback

2. **Scheduled Retraining Service** (`scheduledRetrainingService.js`)
   - Automatic retraining on schedule (daily at 2 AM)
   - Threshold-based retraining (every N corrections)
   - Adaptive thresholds based on system maturity

3. **Database Schema** (SQLite)
   - `ai_categorizations`: Track all categorization attempts
   - `ai_feedback`: User corrections for learning
   - `ai_training_history`: Retraining audit log
   - `ai_embeddings`: Semantic vectors for similarity search
   - `ai_metrics`: Performance tracking over time

## 4-Stage Categorization Pipeline

### Stage 1: Exact Match (Confidence: 1.0)
- Checks if this exact item was categorized and confirmed before
- Returns immediately if found
- **Method**: `exact_match`

### Stage 2: Rule-Based Matching (Confidence: 0.90-0.98)
- Applies user-defined and auto-generated rules
- Supports multiple match types: exact, contains, startswith, endswith, regex
- Checks Amazon ASIN-specific rules
- Returns if confidence > 0.9
- **Method**: `rule`

### Stage 3: Semantic Similarity (Confidence: 0.85-0.92)
- Generates embedding for current item using Ollama `nomic-embed-text`
- Compares with all confirmed categorizations using cosine similarity
- Uses weighted voting from top 5 matches if similarity > 0.85
- **Method**: `embedding`

### Stage 4: LLM Reasoning (Confidence: 0.30-0.85)
- Uses Ollama `llama3.2:3b` model for intelligent categorization
- Considers item details, category descriptions, and examples
- Provides reasoning and alternative suggestions
- Fallback if all other stages fail
- **Method**: `llm` or `fallback`

## Learning Engine

### Automatic Rule Generation

The system automatically creates rules when:
- Same item corrected 2+ times to the same category → Creates exact match rule
- Pattern emerges from multiple corrections → Generates pattern-based rule

### Adaptive Retraining Schedule

The retraining threshold adapts based on system maturity:

| Phase | Purchase Count | Threshold | Frequency |
|-------|---------------|-----------|-----------|
| **Initial** | 0-100 | Every 5 corrections | More frequent learning |
| **Learning** | 100-500 | Every 10 corrections | Balanced learning |
| **Mature** | 500+ | Every 50 corrections | Optimized stability |

### Retraining Process

When triggered (by threshold or daily schedule):

1. **Pattern Analysis**: Identifies repeated correction patterns
2. **Rule Generation**: Creates auto-generated rules from patterns
3. **Embedding Updates**: Regenerates embeddings for confirmed items
4. **Feedback Processing**: Marks processed feedback
5. **Metrics Recording**: Logs training statistics

## API Endpoints

### Categorization

#### POST `/api/categorize`
Categorize a single purchase/item.

**Request:**
```json
{
  "purchase": {
    "id": "123",
    "title": "LEGO Classic Creative Bricks",
    "category": "Toys & Games",
    "price": 29.99
  },
  "item_type": "amazon_item",
  "item_id": "123"
}
```

**Response:**
```json
{
  "category": "Kids - Toys",
  "confidence": 0.92,
  "method": "embedding",
  "reasoning": "High semantic similarity (91.5%) to previous toy purchase",
  "alternatives": [
    {"category": "Gifts", "confidence": 0.15}
  ]
}
```

#### POST `/api/categorize/batch`
Batch categorize multiple purchases.

**Request:**
```json
{
  "purchases": [...],
  "item_type": "amazon_item",
  "batch_size": 10
}
```

**Response:**
```json
{
  "total": 50,
  "results": [...]
}
```

### Feedback & Learning

#### POST `/api/feedback`
Submit user correction for learning.

**Request:**
```json
{
  "purchase_id": "123",
  "item_type": "amazon_item",
  "suggested_category": "Kids - Toys",
  "actual_category": "Kids - Educational",
  "suggestion_method": "embedding",
  "suggestion_confidence": 0.92
}
```

**Response:**
```json
{
  "success": true,
  "message": "Feedback recorded successfully"
}
```

### Status & Metrics

#### GET `/api/categorize/status`
Get AI service status and metrics.

**Response:**
```json
{
  "ollamaAvailable": true,
  "llmModel": "llama3.2:3b",
  "embeddingModel": "nomic-embed-text",
  "correctionsSinceRetrain": 7,
  "retrainingThreshold": 10,
  "pendingFeedback": 7,
  "nextRetrainingIn": 3,
  "metrics": [...],
  "trainingHistory": [...],
  "accuracyByMethod": [...]
}
```

#### GET `/api/metrics/categorization`
Get detailed categorization metrics.

**Query Parameters:**
- `item_type`: Filter by item type (e.g., `amazon_item`)
- `start_date`: Start date for metrics (ISO format)
- `end_date`: End date for metrics (ISO format)
- `days`: Number of days to look back (default: 30)

**Response:**
```json
{
  "metrics": [
    {
      "date": "2026-01-20",
      "item_type": "amazon_item",
      "total_categorizations": 45,
      "correct_categorizations": 42,
      "accuracy_rate": 0.933,
      "avg_confidence": 0.87,
      "method_breakdown": {
        "exact_match": 10,
        "rule": 15,
        "embedding": 12,
        "llm": 8
      },
      "confidence_breakdown": {
        "high": 35,
        "medium": 8,
        "low": 2
      }
    }
  ],
  "accuracyByMethod": [
    {
      "method": "exact_match",
      "total": 150,
      "confirmed": 150,
      "avg_confidence": 1.0,
      "accuracy": 1.0
    },
    {
      "method": "embedding",
      "total": 120,
      "confirmed": 112,
      "avg_confidence": 0.89,
      "accuracy": 0.933
    }
  ]
}
```

### Retraining

#### POST `/api/categorize/retrain`
Manually trigger retraining.

**Response:**
```json
{
  "success": true,
  "message": "Retraining initiated in background"
}
```

#### GET `/api/categorize/retrain/status`
Get retraining status.

**Response:**
```json
{
  "running": true,
  "isRetraining": false,
  "feedbackCount": 7,
  "threshold": 10,
  "nextRetrainingIn": 3,
  "lastTraining": "2026-01-20T02:00:00.000Z",
  "dailySchedule": "2:00 AM",
  "periodicCheck": "Every 5 minutes"
}
```

## Technology Stack

### Backend
- **Node.js** with Express.js
- **SQLite** (better-sqlite3) for local database
- **node-cron** for scheduled jobs

### AI Stack
- **Ollama** (local AI runtime)
  - `llama3.2:3b` for LLM reasoning
  - `nomic-embed-text` for embeddings
- No external API calls - 100% local processing

### Key Dependencies
```json
{
  "ollama": "^0.5.0",
  "node-cron": "^3.0.3",
  "better-sqlite3": "^12.5.0",
  "express": "^4.22.1"
}
```

## Setup Instructions

### Prerequisites

1. **Install Ollama**
   ```bash
   # macOS
   brew install ollama

   # Linux
   curl -fsSL https://ollama.com/install.sh | sh

   # Windows
   # Download from https://ollama.com/download
   ```

2. **Pull Required Models**
   ```bash
   # LLM model for categorization
   ollama pull llama3.2:3b

   # Embedding model for similarity search
   ollama pull nomic-embed-text
   ```

3. **Start Ollama Server**
   ```bash
   ollama serve
   ```

### Configuration

Set environment variables in `.env`:

```env
# Ollama Configuration
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text

# Database (SQLite - auto-created)
# No configuration needed

# Server
PORT=3000
```

### Starting the Service

```bash
# Install dependencies
npm install

# Start server (includes scheduled retraining)
npm start

# The service will automatically:
# 1. Initialize database with AI tables
# 2. Start scheduled retraining (daily at 2 AM)
# 3. Begin periodic threshold checks (every 5 minutes)
```

## Usage Flow

### 1. Initial Setup

Define your categories in the app:
- Navigate to Categories page
- Add categories with descriptions and examples
- Examples: "Groceries", "Kids - Toys", "Home Improvement"

### 2. Import Historical Data

Upload Amazon order history:
- Export orders from Amazon as CSV
- Upload via `/api/imports/amazon-csv` endpoint
- System categorizes all purchases
- Low-confidence items flagged for review

### 3. Review & Correct

Review flagged purchases:
- Filter by confidence < 0.75
- Correct any miscategorizations
- Submit corrections via `/api/feedback`
- System learns immediately

### 4. Automatic Improvement

The system automatically:
- Retrains every 10 corrections (or daily)
- Creates rules from patterns
- Updates embeddings
- Improves accuracy over time

### 5. Ongoing Categorization

For new purchases:
- **High confidence (>0.9)**: Auto-approved
- **Medium confidence (0.75-0.9)**: Optional review
- **Low confidence (<0.75)**: Requires review

## Performance Metrics

### Success Metrics Tracked

1. **Overall Accuracy**: % of categorizations that are correct
2. **Accuracy by Confidence Bucket**:
   - High (>0.9): Target 98%+
   - Medium (0.75-0.9): Target 90%+
   - Low (<0.75): Target 70%+
3. **Accuracy by Method**:
   - Exact Match: 100%
   - Rule-Based: 95%+
   - Semantic Similarity: 90%+
   - LLM Reasoning: 80%+
4. **Average Confidence**: Trend should increase over time
5. **Manual Review Rate**: % requiring user intervention (should decrease)

### Expected Performance

| Phase | Purchases | Overall Accuracy | Review Rate |
|-------|-----------|-----------------|-------------|
| **Initial** | 0-100 | 70-80% | 40-50% |
| **Learning** | 100-500 | 85-92% | 20-30% |
| **Mature** | 500+ | 92-96% | 10-15% |

## Database Schema

### AI Categorization Tables

#### `ai_categorizations`
Tracks all categorization attempts.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| item_id | TEXT | Item identifier |
| item_type | TEXT | Type (amazon_item, transaction) |
| category | TEXT | Assigned category |
| confidence | REAL | Confidence score (0-1) |
| method | TEXT | Categorization method used |
| alternatives | TEXT | JSON array of alternatives |
| reasoning | TEXT | Explanation |
| user_confirmed | TEXT | 'Yes' if user verified |
| created_at | TEXT | Timestamp |

#### `ai_feedback`
User corrections for learning.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| item_id | TEXT | Item identifier |
| item_type | TEXT | Type |
| suggested_category | TEXT | AI suggestion |
| actual_category | TEXT | User's correction |
| suggestion_method | TEXT | Method that failed |
| suggestion_confidence | REAL | Original confidence |
| processed | TEXT | 'Yes' if used in training |
| created_at | TEXT | Timestamp |

#### `ai_training_history`
Retraining audit log.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| timestamp | TEXT | Training time |
| feedback_count | INTEGER | Feedback processed |
| rules_generated | INTEGER | New rules created |
| embeddings_updated | INTEGER | Embeddings regenerated |
| duration_ms | INTEGER | Training duration |
| trigger_type | TEXT | manual/automatic/daily |
| notes | TEXT | Additional info |

#### `ai_embeddings`
Semantic vectors for similarity search.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| item_id | TEXT | Item identifier |
| item_type | TEXT | Type |
| embedding_text | TEXT | Original text |
| embedding_vector | TEXT | JSON array of floats |
| category | TEXT | Category |
| user_confirmed | TEXT | 'Yes' if verified |
| created_at | TEXT | Created timestamp |
| updated_at | TEXT | Updated timestamp |

#### `ai_metrics`
Daily performance metrics.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| date | TEXT | Metric date |
| item_type | TEXT | Type |
| total_categorizations | INTEGER | Total attempts |
| correct_categorizations | INTEGER | Correct count |
| accuracy_rate | REAL | Accuracy (0-1) |
| avg_confidence | REAL | Average confidence |
| method_breakdown | TEXT | JSON of method counts |
| confidence_breakdown | TEXT | JSON of confidence buckets |

## Troubleshooting

### Ollama Not Available

**Symptom**: API returns `"ollamaAvailable": false`

**Solutions**:
1. Check if Ollama is running: `ps aux | grep ollama`
2. Start Ollama: `ollama serve`
3. Verify models are pulled: `ollama list`
4. Check Ollama URL in `.env`

### Low Categorization Accuracy

**Symptom**: Many incorrect categorizations

**Solutions**:
1. Review and add category descriptions and examples
2. Manually correct more purchases to build training data
3. Trigger manual retraining: `POST /api/categorize/retrain`
4. Review auto-generated rules for conflicts

### Retraining Not Happening

**Symptom**: `correctionsSinceRetrain` keeps increasing

**Solutions**:
1. Check retraining service status: `GET /api/categorize/retrain/status`
2. Check server logs for errors
3. Manually trigger: `POST /api/categorize/retrain`
4. Verify cron is running (should see periodic logs)

### High Memory Usage

**Symptom**: Server using excessive memory

**Solutions**:
1. Reduce batch size in categorization requests
2. Limit embeddings cache size
3. Unload Ollama model when not in use
4. Restart server to clear caches

## Future Enhancements

Potential improvements:
- [ ] Per-user category preferences within family accounts
- [ ] Split purchases across multiple categories with percentages
- [ ] Automatic vendor detection and extraction
- [ ] Integration with receipt scanning
- [ ] Export to tax software formats
- [ ] Category hierarchy/nesting support
- [ ] Seasonal pattern detection
- [ ] Merchant logo recognition
- [ ] Multi-language support

## Privacy & Security

### Local-First Architecture
- **All AI processing happens locally** via Ollama
- **No external API calls** for categorization
- **Financial data never leaves your system**
- **Full control** over your data

### Data Storage
- SQLite database stored locally in `/data` directory
- No cloud sync or external backups (unless you configure it)
- Can be encrypted with SQLite encryption extensions

## Support

For issues or questions:
- GitHub Issues: [budgeting-playground/issues](https://github.com/ghigo/budgeting-playground/issues)
- Check server logs for detailed error messages
- Review `/api/categorize/status` for system health

## License

MIT License - See LICENSE file for details
