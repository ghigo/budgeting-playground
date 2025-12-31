# AI-Powered Transaction Categorization - Local Model Options

## Overview
This document explores options for running AI models locally to categorize financial transactions based on description, merchant, and amount.

## Requirements Analysis

### Input Data
- **Transaction description**: "AMZN Mktp US*2X3Y4Z5W6"
- **Merchant name**: "Amazon"
- **Amount**: $45.99
- **Existing categories**: List of user-defined categories

### Expected Output
- **Category**: "Shopping" or "Shopping > Online"
- **Confidence score**: 0.0 - 1.0
- **Reasoning**: Optional explanation

### Performance Requirements
- **Latency**: < 1 second per transaction (ideally < 500ms)
- **Throughput**: Handle batch categorization (100+ transactions)
- **Memory**: Should run on typical development machine
- **Cost**: Free, local inference

---

## Option 1: Ollama ⭐ RECOMMENDED

### Overview
Ollama is the easiest and most popular way to run local LLMs. Think "Docker for AI models."

### Pros
- ✅ **Easiest setup**: One command installation
- ✅ **Model management**: Simple pull/run commands
- ✅ **REST API**: Easy to integrate with Node.js
- ✅ **Optimized**: Built-in quantization and optimization
- ✅ **Active community**: Well-maintained, frequent updates
- ✅ **Cross-platform**: Mac, Linux, Windows

### Cons
- ❌ Requires separate process running
- ❌ ~4GB RAM minimum for small models

### Installation
```bash
# Mac
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Start server
ollama serve
```

### Recommended Models for Transaction Categorization

#### 1. **Phi-3 Mini (3.8B)** - Best Overall
```bash
ollama pull phi3:mini
```
- **Size**: ~2.3GB (4-bit quantized)
- **Speed**: ~50-100 tokens/sec on CPU
- **Quality**: Excellent for classification tasks
- **Context**: 128k tokens (overkill for this use case)
- **Best for**: Fast, accurate categorization

#### 2. **Llama 3.2 (1B/3B)** - Fastest
```bash
ollama pull llama3.2:1b
```
- **Size**: ~1.3GB (1B) or ~2GB (3B)
- **Speed**: ~100-200 tokens/sec on CPU
- **Quality**: Good for simple classification
- **Best for**: Maximum speed

#### 3. **Mistral 7B (quantized)** - Most Accurate
```bash
ollama pull mistral:7b-instruct-q4_0
```
- **Size**: ~4.1GB (4-bit quantized)
- **Speed**: ~30-50 tokens/sec on CPU
- **Quality**: Highest accuracy
- **Best for**: When accuracy matters most

### Integration Example
```javascript
// services/aiCategorization.js
async function categorizeTransaction(transaction, categories) {
    const prompt = `Given this transaction, suggest the most appropriate category:

Transaction: ${transaction.description}
Merchant: ${transaction.merchant_name}
Amount: $${transaction.amount}

Available categories:
${categories.map(c => `- ${c.name}`).join('\n')}

Respond with ONLY the category name, nothing else.`;

    const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'phi3:mini',
            prompt: prompt,
            stream: false,
            options: {
                temperature: 0.1, // Low for consistency
                num_predict: 20   // Short response
            }
        })
    });

    const result = await response.json();
    return result.response.trim();
}
```

---

## Option 2: llama.cpp + Node.js Bindings

### Overview
Direct integration using C++ inference engine with Node.js bindings.

### Pros
- ✅ **No separate server**: Embedded in your app
- ✅ **Very fast**: Optimized C++ inference
- ✅ **Small footprint**: Minimal overhead
- ✅ **Full control**: Fine-tune everything

### Cons
- ❌ More complex setup
- ❌ Need to manage model files manually
- ❌ Platform-specific builds

### Installation
```bash
npm install node-llama-cpp
```

### Example
```javascript
const { LlamaModel, LlamaContext } = require('node-llama-cpp');

const model = new LlamaModel({
    modelPath: './models/phi-3-mini-4k-instruct-q4.gguf'
});

const context = new LlamaContext({ model });
const result = await context.evaluate(prompt);
```

---

## Option 3: Transformers.js (Browser/Node)

### Overview
Run small transformer models directly in JavaScript (ONNX runtime).

### Pros
- ✅ **Pure JavaScript**: No external dependencies
- ✅ **Works in browser**: Could do client-side categorization
- ✅ **Easy setup**: npm install

### Cons
- ❌ Limited model selection
- ❌ Smaller models only (< 1B params)
- ❌ Slower than native implementations

### Installation
```bash
npm install @xenova/transformers
```

### Example
```javascript
import { pipeline } from '@xenova/transformers';

const classifier = await pipeline('zero-shot-classification',
    'Xenova/distilbert-base-uncased-mnli');

const result = await classifier(
    transaction.description,
    categories.map(c => c.name)
);
```

---

## Option 4: LocalAI (OpenAI-Compatible)

### Overview
OpenAI API-compatible server that runs models locally.

### Pros
- ✅ **Drop-in replacement**: Use OpenAI SDK
- ✅ **Multiple backends**: Supports various model types
- ✅ **Docker support**: Easy deployment

### Cons
- ❌ More heavyweight
- ❌ Overkill for simple categorization

---

## Comparison Matrix

| Feature | Ollama | llama.cpp | Transformers.js | LocalAI |
|---------|--------|-----------|-----------------|---------|
| **Setup Difficulty** | Easy | Medium | Easy | Medium |
| **Speed (CPU)** | Fast | Fastest | Slow | Fast |
| **Memory Usage** | 2-8GB | 2-8GB | 500MB-2GB | 3-10GB |
| **Model Selection** | Excellent | Excellent | Limited | Good |
| **Integration** | REST API | Native | Native | REST API |
| **Maintenance** | Low | Medium | Low | Medium |
| **Best For** | General use | Performance | Small models | OpenAI compatibility |

---

## Recommended Approach

### Phase 1: Prototype with Ollama + Phi-3 Mini
**Why**: Fastest to implement, great balance of speed/accuracy

1. Install Ollama
2. Pull `phi3:mini` model
3. Create API endpoint in your backend
4. Test with sample transactions

### Phase 2: Optimize Prompt Engineering
**Key techniques**:
- Few-shot learning (provide examples)
- Structured output (JSON format)
- Category descriptions
- Confidence scoring

### Example Optimized Prompt:
```
You are a financial transaction categorizer. Analyze the transaction and select the MOST appropriate category.

Transaction Details:
- Description: {description}
- Merchant: {merchant}
- Amount: ${amount}
- Date: {date}

Available Categories:
{categories with descriptions}

Examples:
- "AMZN Mktp US" → Shopping > Online
- "WHOLEFDS" → Groceries
- "SHELL OIL" → Transportation > Gas

Respond in JSON format:
{
  "category": "Category Name",
  "confidence": 0.95,
  "reasoning": "Brief explanation"
}
```

### Phase 3: Batch Processing & Caching
- Process multiple transactions in one request
- Cache common merchant → category mappings
- Fall back to rule-based for high-confidence matches

### Phase 4: Continuous Learning (Optional)
- User confirms/corrects AI suggestions
- Store corrections as few-shot examples
- Periodically fine-tune on user's data

---

## Cost-Benefit Analysis

### Traditional Rule-Based Approach
- ✅ Fast
- ✅ Deterministic
- ❌ Requires manual rules
- ❌ Doesn't handle edge cases

### AI-Powered Approach
- ✅ Handles variations (typos, new merchants)
- ✅ Context-aware (considers amount, patterns)
- ✅ Learns from examples
- ❌ Slower (0.5-2s vs 0.001s)
- ❌ Requires local model

### Hybrid Approach (RECOMMENDED)
1. **Fast path**: Check existing merchant mappings
2. **Medium path**: Apply rule-based patterns
3. **AI path**: Use LLM for uncertain cases only
4. **Learning**: Update mappings based on AI + user confirmations

This gives you 90% speed + 100% coverage.

---

## Next Steps

1. **Install Ollama**
2. **Pull phi3:mini**
3. **Create proof-of-concept endpoint**
4. **Test on 10-20 real transactions**
5. **Measure accuracy & speed**
6. **Iterate on prompts**

Would you like me to:
- A) Implement Ollama integration with your existing backend?
- B) Create a hybrid system (rules + AI)?
- C) Set up a different approach?
