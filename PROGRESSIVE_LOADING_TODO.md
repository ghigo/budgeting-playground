# Progressive Loading & Individual Approval - Implementation Status

## ✅ Completed (Backend)

### Server Changes (src/server.js)
- ✅ Added `offset` parameter to `/api/ai/review-all` endpoint
- ✅ Changed default `limit` from 50 to 10 for faster initial display
- ✅ Added `offset`, `limit`, and corrected `has_more` in response
- ✅ Added `account_name` to suggestion data

### API Response Format
```javascript
{
  total_reviewed: 10,
  total_available: 603,
  suggestions_count: 8,
  suggestions: [/* with account_name */],
  offset: 0,
  limit: 10,
  has_more: true
}
```

## ✅ Partially Completed (Frontend)

### TransactionsPage.js - aiAutoCategorizeUncategorized()
- ✅ Changed to fetch first batch (10 items) with offset=0
- ✅ Show modal immediately after first batch loads
- ✅ Pass offset/limit to modal function
- ⚠️ Function signature changed but modal not yet updated

## 🚧 TODO: Complete Modal Rewrite

### Required Changes to `showReCategorizationReview()` function

#### 1. Function Signature
```javascript
// OLD
async function showReCategorizationReview(suggestions, totalReviewed, totalAvailable, hasMore)

// NEW
async function showReCategorizationReview(initialSuggestions, totalAvailable, initialOffset, batchLimit)
```

#### 2. Show Account Name & Date Prominently
```html
<div class="suggestion-header">
    <span class="suggestion-date">12/25/2024</span>
    <span class="suggestion-account">Chase Checking</span>  <!-- NEW -->
    <span class="suggestion-amount">$45.67</span>
</div>
```

#### 3. Add Individual "Apply" Button
```html
<div class="suggestion-content">
    <div class="suggestion-details">...</div>
    <div class="suggestion-actions">
        <button class="btn-apply-single" data-index="${idx}">
            ✓ Apply
        </button>
    </div>
</div>
```

#### 4. Remove Items After Individual Apply
```javascript
async function applySuggestion(index) {
    // Apply to backend
    await fetchAPI('/api/ai/apply-suggestions', ...)

    // Animate removal
    item.classList.add('removing');  // CSS: opacity 0, translateX(100px)
    setTimeout(() => item.remove(), 300);

    // Update counts
    appliedCount++;
    updateCounts();
}
```

#### 5. Progressive/Infinite Loading
```javascript
// State
let allSuggestions = [...initialSuggestions];
let currentOffset = initialOffset + batchLimit;
let isLoadingMore = false;

// Scroll listener
reviewContainer.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = reviewContainer;
    if (scrollHeight - scrollTop - clientHeight < 200) {
        loadMoreSuggestions();  // Fetch next batch
    }
});

// Load more function
async function loadMoreSuggestions() {
    if (isLoadingMore || currentOffset >= totalAvailable) return;

    isLoadingMore = true;
    const response = await fetchAPI('/api/ai/review-all', {
        method: 'POST',
        body: JSON.stringify({
            confidenceThreshold: 100,
            limit: batchLimit,
            offset: currentOffset
        })
    });

    // Append new items to DOM
    // Update currentOffset
    // Re-attach event listeners
}
```

#### 6. Update Summary Counts
```html
<div class="review-summary">
    <p><strong>Total to review:</strong> 603 transactions</p>
    <p><strong>Loaded:</strong> <span id="loaded-count">10</span> suggestions</p>
    <p><strong>Applied:</strong> <span id="applied-count">0</span></p>
</div>
```

#### 7. Keep "Apply All Remaining" Batch Button
```javascript
eventBus.once(`modal:${modal.id}:apply-all`, async () => {
    // Apply all remaining items at once
    // Use current selector values for each
});
```

## CSS Additions Needed

```css
.suggestion-account {
    background: #e0e7ff;
    color: #3730a3;
    padding: 0.125rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 500;
}

.suggestion-item.removing {
    opacity: 0;
    transform: translateX(100px);
    margin-top: -80px;
    transition: all 0.3s;
}

.btn-apply-single {
    padding: 0.5rem 1rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
}

.btn-apply-single:hover {
    background: #2563eb;
    transform: scale(1.05);
}

.loading-more {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem;
}

.spinner {
    width: 20px;
    height: 20px;
    border: 3px solid #e5e7eb;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}
```

## Testing Checklist

- [ ] First batch loads quickly (< 2 seconds)
- [ ] Modal shows immediately with 10 items
- [ ] Account name visible on each item
- [ ] Date prominently displayed
- [ ] Individual "Apply" button works
- [ ] Item disappears after individual apply with smooth animation
- [ ] Counts update correctly (Loaded, Applied)
- [ ] Scroll to bottom triggers loading more
- [ ] More items append smoothly
- [ ] Category selectors work on dynamically loaded items
- [ ] Manual corrections still send to learning API
- [ ] "Apply All Remaining" batch button works
- [ ] All 603 transactions can be reviewed progressively

## Performance Goals

- Initial modal display: < 2 seconds
- Individual apply: < 500ms
- Load more batch: < 2 seconds per 10 items
- Smooth scrolling with 50+ items loaded

## User Experience Flow

1. User clicks "🤖 AI Categorize"
2. After ~2 seconds, modal appears with first 10 suggestions
3. User can immediately start reviewing
4. As user scrolls, more suggestions load automatically
5. User applies items one-by-one or edits categories
6. Applied items disappear from list
7. Counts update to show progress
8. User can "Apply All Remaining" at any time
9. Background loading continues seamlessly
