/**
 * Chart Utilities
 * Wrapper functions for Chart.js with consistent styling and configuration
 */

import { formatCurrency } from './formatters.js';

// Chart color palette
export const CHART_COLORS = {
    primary: '#3B82F6',
    success: '#10B981',
    danger: '#EF4444',
    warning: '#F59E0B',
    info: '#06B6D4',
    purple: '#8B5CF6',
    pink: '#EC4899',
    gray: '#6B7280'
};

/**
 * Default chart options
 */
export const DEFAULT_CHART_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            display: true,
            position: 'bottom'
        },
        tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            titleFont: {
                size: 14
            },
            bodyFont: {
                size: 13
            }
        }
    }
};

/**
 * Create or update a line chart
 * @param {HTMLCanvasElement|string} canvas - Canvas element or ID
 * @param {Object} data - Chart data
 * @param {Object} options - Chart options
 * @returns {Chart} Chart instance
 */
export function createLineChart(canvas, data, options = {}) {
    const ctx = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!ctx) {
        console.error('Chart canvas not found');
        return null;
    }

    const chartOptions = {
        ...DEFAULT_CHART_OPTIONS,
        ...options,
        plugins: {
            ...DEFAULT_CHART_OPTIONS.plugins,
            ...options.plugins
        }
    };

    return new Chart(ctx, {
        type: 'line',
        data,
        options: chartOptions
    });
}

/**
 * Create or update a bar chart
 * @param {HTMLCanvasElement|string} canvas - Canvas element or ID
 * @param {Object} data - Chart data
 * @param {Object} options - Chart options
 * @returns {Chart} Chart instance
 */
export function createBarChart(canvas, data, options = {}) {
    const ctx = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!ctx) {
        console.error('Chart canvas not found');
        return null;
    }

    const chartOptions = {
        ...DEFAULT_CHART_OPTIONS,
        ...options,
        plugins: {
            ...DEFAULT_CHART_OPTIONS.plugins,
            ...options.plugins
        }
    };

    return new Chart(ctx, {
        type: 'bar',
        data,
        options: chartOptions
    });
}

/**
 * Create or update a doughnut chart
 * @param {HTMLCanvasElement|string} canvas - Canvas element or ID
 * @param {Object} data - Chart data
 * @param {Object} options - Chart options
 * @returns {Chart} Chart instance
 */
export function createDoughnutChart(canvas, data, options = {}) {
    const ctx = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!ctx) {
        console.error('Chart canvas not found');
        return null;
    }

    const chartOptions = {
        ...DEFAULT_CHART_OPTIONS,
        ...options,
        plugins: {
            ...DEFAULT_CHART_OPTIONS.plugins,
            ...options.plugins,
            legend: {
                display: true,
                position: 'right',
                ...options.plugins?.legend
            }
        }
    };

    return new Chart(ctx, {
        type: 'doughnut',
        data,
        options: chartOptions
    });
}

/**
 * Update chart data and refresh
 * @param {Chart} chart - Chart instance
 * @param {Object} data - New chart data
 */
export function updateChartData(chart, data) {
    if (!chart) return;

    chart.data = data;
    chart.update();
}

/**
 * Destroy a chart safely
 * @param {Chart} chart - Chart instance
 */
export function destroyChart(chart) {
    if (chart) {
        chart.destroy();
    }
}

/**
 * Create currency tooltip formatter
 * @returns {Function} Tooltip callback function
 */
export function currencyTooltipFormatter() {
    return {
        callbacks: {
            label: function(context) {
                let label = context.dataset.label || '';
                if (label) {
                    label += ': ';
                }
                if (context.parsed.y !== null) {
                    label += formatCurrency(context.parsed.y);
                }
                return label;
            }
        }
    };
}

/**
 * Generate color palette for categories
 * @param {number} count - Number of colors needed
 * @returns {Array} Array of color strings
 */
export function generateColorPalette(count) {
    const baseColors = Object.values(CHART_COLORS);
    const colors = [];

    for (let i = 0; i < count; i++) {
        if (i < baseColors.length) {
            colors.push(baseColors[i]);
        } else {
            // Generate additional colors by adjusting hue
            const hue = (i * 137.508) % 360; // Golden angle
            colors.push(`hsl(${hue}, 70%, 50%)`);
        }
    }

    return colors;
}

/**
 * Create a cash flow chart (income vs expenses over time)
 * @param {HTMLCanvasElement|string} canvas - Canvas element or ID
 * @param {Array} labels - X-axis labels (dates)
 * @param {Array} incomeData - Income values
 * @param {Array} expenseData - Expense values
 * @returns {Chart} Chart instance
 */
export function createCashFlowChart(canvas, labels, incomeData, expenseData) {
    const data = {
        labels,
        datasets: [
            {
                label: 'Income',
                data: incomeData,
                borderColor: CHART_COLORS.success,
                backgroundColor: CHART_COLORS.success + '20',
                fill: true,
                tension: 0.4
            },
            {
                label: 'Expenses',
                data: expenseData,
                borderColor: CHART_COLORS.danger,
                backgroundColor: CHART_COLORS.danger + '20',
                fill: true,
                tension: 0.4
            }
        ]
    };

    const options = {
        plugins: {
            tooltip: currencyTooltipFormatter()
        },
        scales: {
            y: {
                beginAtZero: true,
                ticks: {
                    callback: function(value) {
                        return formatCurrency(value);
                    }
                }
            }
        }
    };

    return createLineChart(canvas, data, options);
}

/**
 * Create a category spending chart
 * @param {HTMLCanvasElement|string} canvas - Canvas element or ID
 * @param {Array} categories - Category names
 * @param {Array} amounts - Spending amounts
 * @param {Array} colors - Category colors (optional)
 * @returns {Chart} Chart instance
 */
export function createCategoryChart(canvas, categories, amounts, colors = null) {
    const chartColors = colors || generateColorPalette(categories.length);

    const data = {
        labels: categories,
        datasets: [{
            data: amounts,
            backgroundColor: chartColors,
            borderWidth: 2,
            borderColor: '#ffffff'
        }]
    };

    const options = {
        plugins: {
            tooltip: currencyTooltipFormatter(),
            legend: {
                display: categories.length <= 10,
                position: 'right'
            }
        }
    };

    return createDoughnutChart(canvas, data, options);
}

/**
 * Create a spending trend chart
 * @param {HTMLCanvasElement|string} canvas - Canvas element or ID
 * @param {Array} labels - X-axis labels (dates/months)
 * @param {Array} amounts - Spending amounts
 * @returns {Chart} Chart instance
 */
export function createTrendChart(canvas, labels, amounts) {
    const data = {
        labels,
        datasets: [{
            label: 'Spending',
            data: amounts,
            borderColor: CHART_COLORS.primary,
            backgroundColor: CHART_COLORS.primary + '20',
            fill: true,
            tension: 0.4
        }]
    };

    const options = {
        plugins: {
            tooltip: currencyTooltipFormatter(),
            legend: {
                display: false
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                ticks: {
                    callback: function(value) {
                        return formatCurrency(value);
                    }
                }
            }
        }
    };

    return createLineChart(canvas, data, options);
}

export default {
    CHART_COLORS,
    DEFAULT_CHART_OPTIONS,
    createLineChart,
    createBarChart,
    createDoughnutChart,
    updateChartData,
    destroyChart,
    currencyTooltipFormatter,
    generateColorPalette,
    createCashFlowChart,
    createCategoryChart,
    createTrendChart
};
