/**
 * Chart.js configuration utilities for usage statistics
 * Extracted from UsagePage.tsx for reusability
 */

import type { Chart, ChartOptions } from 'chart.js';

/**
 * Sparkline Y 轴：数据全为 0 或整条为常数时，Chart.js 默认会把 Y 范围对称扩展，
 * 折线会出现在画布垂直中间。固定 min=0 并在「塌缩」时给出 max，使零线落在底部。
 */
function sparklineYAxisMax(chart: Chart): number | undefined {
  const raw = chart.data.datasets[0]?.data;
  if (!Array.isArray(raw) || raw.length === 0) {
    return 1;
  }
  let maxVal = -Infinity;
  let minVal = Infinity;
  for (const v of raw) {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    maxVal = Math.max(maxVal, n);
    minVal = Math.min(minVal, n);
  }
  if (!Number.isFinite(maxVal)) {
    return 1;
  }
  if (maxVal <= 0 && minVal <= 0) {
    return 1;
  }
  if (maxVal === minVal) {
    const pad = Math.abs(maxVal) * 0.08;
    return maxVal + Math.max(pad, 1e-9);
  }
  return undefined;
}

/**
 * Static sparkline chart options (no dependencies on theme/mobile)
 */
export const sparklineOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: {
    x: { display: false },
    y: {
      display: false,
      beginAtZero: true,
      min: 0,
      grace: 0,
      max: (ctx: { chart: Chart }) => sparklineYAxisMax(ctx.chart)
    }
  },
  elements: { line: { tension: 0.45 }, point: { radius: 0 } }
} as unknown as ChartOptions<'line'>;

export interface ChartConfigOptions {
  period: 'hour' | 'day';
  labels: string[];
  isDark: boolean;
  isMobile: boolean;
}

/**
 * Build chart options with theme and responsive awareness
 */
export function buildChartOptions({
  period,
  labels,
  isDark,
  isMobile
}: ChartConfigOptions): ChartOptions<'line'> {
  const pointRadius = isMobile && period === 'hour' ? 0 : isMobile ? 2 : 4;
  const tickFontSize = isMobile ? 10 : 12;
  const maxTickLabelCount = isMobile ? (period === 'hour' ? 8 : 6) : period === 'hour' ? 12 : 10;
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(17, 24, 39, 0.06)';
  const axisBorderColor = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(17, 24, 39, 0.10)';
  const tickColor = isDark ? 'rgba(255, 255, 255, 0.72)' : 'rgba(17, 24, 39, 0.72)';
  const tooltipBg = isDark ? 'rgba(17, 24, 39, 0.92)' : 'rgba(255, 255, 255, 0.98)';
  const tooltipTitle = isDark ? '#ffffff' : '#111827';
  const tooltipBody = isDark ? 'rgba(255, 255, 255, 0.86)' : '#374151';
  const tooltipBorder = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(17, 24, 39, 0.10)';

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: tooltipBg,
        titleColor: tooltipTitle,
        bodyColor: tooltipBody,
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: 10,
        displayColors: true,
        usePointStyle: true
      }
    },
    scales: {
      x: {
        grid: {
          color: gridColor,
          drawTicks: false
        },
        border: {
          color: axisBorderColor
        },
        ticks: {
          color: tickColor,
          font: { size: tickFontSize },
          maxRotation: isMobile ? 0 : 45,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: maxTickLabelCount,
          callback: (value) => {
            const index = typeof value === 'number' ? value : Number(value);
            const raw =
              Number.isFinite(index) && labels[index] ? labels[index] : typeof value === 'string' ? value : '';

            if (period === 'hour') {
              const [md, time] = raw.split(' ');
              if (!time) return raw;
              if (time.startsWith('00:')) {
                return md ? [md, time] : time;
              }
              return time;
            }

            if (isMobile) {
              const parts = raw.split('-');
              if (parts.length === 3) {
                return `${parts[1]}-${parts[2]}`;
              }
            }
            return raw;
          }
        }
      },
      y: {
        beginAtZero: true,
        grid: {
          color: gridColor
        },
        border: {
          color: axisBorderColor
        },
        ticks: {
          color: tickColor,
          font: { size: tickFontSize }
        }
      }
    },
    elements: {
      line: {
        tension: 0.35,
        borderWidth: isMobile ? 1.5 : 2
      },
      point: {
        borderWidth: 2,
        radius: pointRadius,
        hoverRadius: 4
      }
    }
  };
}

/**
 * Calculate minimum chart width for hourly data on mobile devices
 */
export function getHourChartMinWidth(labelCount: number, isMobile: boolean): string | undefined {
  if (!isMobile || labelCount <= 0) return undefined;
  const perPoint = 56;
  const minWidth = Math.min(labelCount * perPoint, 3000);
  return `${minWidth}px`;
}
