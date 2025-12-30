# Application Architecture

This document describes the refactored modular architecture of the budgeting application.

## Overview

The application has been refactored from a monolithic `app.js` file into a modular architecture with reusable components, services, and utilities.

## Directory Structure

```
public/
├── components/         # Reusable UI components
│   ├── FilterPanel.js   # Configurable filter panel component
│   ├── DataTable.js     # Data table with sorting and actions
│   └── Modal.js         # Modal dialog component
├── services/           # Business logic and state management
│   ├── api.js          # API service layer with error handling
│   ├── eventBus.js     # Event bus for reactive updates
│   ├── state.js        # Centralized state management
│   ├── toast.js        # Toast notification service
│   └── filterEngine.js # Unified filtering logic
├── utils/              # Utility functions
│   ├── formatters.js   # Data formatting (currency, dates, etc.)
│   └── charts.js       # Chart.js wrapper utilities
├── pages/              # Page modules (future)
└── app.js              # Main application (to be migrated)
```

## Components

### FilterPanel (`components/FilterPanel.js`)
Configurable filter panel that accepts a schema and renders appropriate controls.

**Features:**
- Search inputs
- Select dropdowns
- Date range pickers
- Custom date inputs
- Event emission on filter changes
- Get/set/clear filter values

**Usage:**
```javascript
import { FilterPanel } from './components/FilterPanel.js';

const filterPanel = new FilterPanel({
    containerId: 'filters',
    filters: [
        { type: 'search', name: 'search', label: 'Search', placeholder: 'Search...' },
        { type: 'select', name: 'category', label: 'Category', options: [...] }
    ],
    onChange: (values) => console.log(values),
    eventPrefix: 'transaction-filter'
});

filterPanel.render();
```

### DataTable (`components/DataTable.js`)
Reusable data table with configurable columns and row actions.

**Features:**
- Custom column renderers
- Action buttons
- Row click events
- Empty state handling
- Dynamic data updates

**Usage:**
```javascript
import { DataTable, createActionButtons } from './components/DataTable.js';

const table = new DataTable({
    containerId: 'table',
    columns: [
        { key: 'date', label: 'Date', render: (val) => formatDate(val) },
        { key: 'amount', label: 'Amount', render: (val) => formatCurrency(val) },
        { key: 'actions', label: 'Actions', render: (val, row) =>
            createActionButtons([
                { action: 'edit', label: 'Edit' },
                { action: 'delete', label: 'Delete', className: 'danger' }
            ])
        }
    ],
    data: transactions,
    emptyMessage: 'No transactions found'
});

table.render();
```

### Modal (`components/Modal.js`)
Modal dialog with customizable content and actions.

**Features:**
- Custom content (HTML)
- Action buttons
- Configurable close behavior
- Size options (small, medium, large)
- Event emission

**Usage:**
```javascript
import { Modal, showConfirmModal } from './components/Modal.js';

const modal = new Modal({
    id: 'my-modal',
    title: 'Confirm Action',
    content: '<p>Are you sure?</p>',
    actions: [
        { action: 'cancel', label: 'Cancel' },
        { action: 'confirm', label: 'Confirm', primary: true }
    ]
});

eventBus.on('modal:my-modal:confirm', () => {
    // Handle confirmation
});

modal.show();
```

## Services

### API Service (`services/api.js`)
Centralized API communication with automatic loading states and error handling.

**Features:**
- Request methods: get, post, put, patch, delete
- Automatic loading overlay
- Automatic error toasts
- Optional success messages
- Backward compatible with legacy fetchAPI()

**Usage:**
```javascript
import { api } from './services/api.js';

// Simple GET request
const data = await api.get('/api/transactions');

// POST with success message
await api.post('/api/transactions', { amount: 100 }, {
    showSuccess: true,
    successMessage: 'Transaction created'
});

// With loading overlay
await api.get('/api/accounts', { showLoading: true });
```

### EventBus (`services/eventBus.js`)
Enhanced event bus for reactive state management.

**Features:**
- Subscribe/unsubscribe to events
- One-time listeners
- Event history for debugging
- Error handling in listeners

**Usage:**
```javascript
import { eventBus } from './services/eventBus.js';

// Subscribe to events
eventBus.on('transactionsUpdated', () => {
    console.log('Transactions changed!');
});

// Emit events
eventBus.emit('transactionsUpdated', { count: 10 });

// One-time listener
eventBus.once('pageLoaded', () => {
    console.log('Page loaded once');
});
```

### State Management (`services/state.js`)
Centralized state management with reactive updates.

**Features:**
- Get/set state values
- Nested property access (dot notation)
- Automatic event emission on changes
- Watch/unwatch for reactive updates
- Convenience methods for common operations

**Usage:**
```javascript
import { state } from './services/state.js';

// Set values
state.set('currentPage', 'dashboard');
state.set('currentFilters.search', 'amazon');

// Get values
const page = state.get('currentPage');
const search = state.get('currentFilters.search');

// Watch for changes
state.watch('currentPage', ({ oldValue, newValue }) => {
    console.log(`Page changed from ${oldValue} to ${newValue}`);
});

// Convenience methods
state.setTransactions(transactions); // Emits 'transactions:updated'
state.setAccounts(accounts);         // Emits 'accounts:updated'
```

### Toast Service (`services/toast.js`)
Toast notification system with undo functionality.

**Features:**
- Multiple types: info, success, error, warning
- Undo functionality for reversible actions
- Configurable duration
- Click to dismiss

**Usage:**
```javascript
import { showToast, showSuccess, showError } from './services/toast.js';

// Simple toast
showSuccess('Transaction saved');

// Toast with undo
showToast('Transaction deleted', 'success', {
    undoAction: async () => {
        await api.post('/api/transactions/restore', { id: txId });
        showSuccess('Transaction restored');
    }
});
```

### FilterEngine (`services/filterEngine.js`)
Unified filtering logic for data arrays.

**Features:**
- Multiple filter types: search, exact, dateRange, number, boolean
- Custom matchers
- Date range calculations
- Sort and group utilities
- Aggregation functions

**Usage:**
```javascript
import { FilterEngine } from './services/filterEngine.js';

const schema = {
    search: { type: 'search', field: 'description' },
    category: { type: 'exact', field: 'category' },
    dateRange: { type: 'dateRange', dateField: 'date' }
};

const filters = {
    search: 'amazon',
    category: 'Shopping',
    dateRange: 'thisMonth'
};

const filtered = FilterEngine.filter(transactions, filters, schema);
```

## Utilities

### Formatters (`utils/formatters.js`)
Common formatting functions.

**Functions:**
- `formatCurrency(amount)` - Format as USD currency
- `formatDate(dateString)` - Format date string
- `escapeHtml(text)` - Escape HTML to prevent XSS
- `renderCategoryBadge(category, options)` - Render category badge
- `getContrastColor(hexColor)` - Get contrasting text color
- `showLoading()` / `hideLoading()` - Loading overlay

### Charts (`utils/charts.js`)
Chart.js wrapper utilities.

**Features:**
- Consistent chart styling
- Currency formatting in tooltips
- Pre-configured chart types
- Helper functions for common charts

**Functions:**
- `createLineChart(canvas, data, options)`
- `createBarChart(canvas, data, options)`
- `createDoughnutChart(canvas, data, options)`
- `createCashFlowChart(canvas, labels, income, expenses)`
- `createCategoryChart(canvas, categories, amounts, colors)`
- `createTrendChart(canvas, labels, amounts)`

## Migration Strategy

The refactoring foundation is now in place. To complete the migration:

1. **Update HTML** to load ES6 modules
2. **Gradually migrate app.js** to use new services
3. **Extract page modules** (transactions, amazon, dashboard, etc.)
4. **Replace duplicated logic** with reusable components
5. **Test all functionalities** after each migration step

## Benefits

- **Code Reuse**: Eliminate 40-50% code duplication
- **Maintainability**: Modular, focused components
- **Testability**: Isolated, testable units
- **Scalability**: Easy to add new features
- **Type Safety**: Prepared for TypeScript migration
- **Performance**: Lazy loading of page modules (future)

## Industry Standards

This architecture follows established patterns:

- **Service Layer Pattern**: Centralized API communication
- **Observer Pattern**: EventBus for reactive updates
- **Component-Based Architecture**: Reusable UI components
- **Singleton Pattern**: State management, API service
- **MVC Pattern**: Separation of concerns (components = view, services = controller, state = model)
