import { useMemo } from 'react';
import type { ChartData, ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import {
  buildUsageTokenCacheHitTrend,
  formatUsdFixedOne,
  type ModelPrice,
  type UsageTimeRange
} from '@/utils/usage';
import type { UsagePayload } from '@/components/usage';
import styles from '@/pages/MonitoringCenterPage.module.scss';

export interface MonitorTrendChartProps {
  usage: UsagePayload | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  timeRange: UsageTimeRange;
  modelPrices: Record<string, ModelPrice>;
}

const TOKEN_AXIS_UNITS = [
  { value: 1_000_000_000_000, suffix: 'T' },
  { value: 1_000_000_000, suffix: 'B' },
  { value: 1_000_000, suffix: 'M' },
  { value: 1_000, suffix: 'K' }
];

const getTokenAxisUnit = (tickValues: number[]) => {
  const positive = tickValues
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.abs(value))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);

  const smallestStep = positive.reduce<number | null>((step, value, index) => {
    if (index === 0) return step;
    const diff = value - positive[index - 1];
    if (diff <= 0) return step;
    return step === null ? diff : Math.min(step, diff);
  }, null) ?? positive[0] ?? 0;

  return TOKEN_AXIS_UNITS.find((unit) => smallestStep >= unit.value) ?? null;
};

const formatTokenAxisValue = (value: number, ticks: { value: number | string }[]) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  if (numeric === 0) {
    return '0';
  }

  const unit = getTokenAxisUnit(ticks.map((tick) => Number(tick.value)));
  if (!unit) {
    return numeric.toLocaleString();
  }

  const scaled = numeric / unit.value;
  const absScaled = Math.abs(scaled);
  const fractionDigits = Number.isInteger(scaled) ? 0 : absScaled >= 10 ? 1 : 2;
  return `${scaled.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits
  })}${unit.suffix}`;
};

const TOKEN_COLOR = '#8b5cf6';
const COST_COLOR = '#f59e0b';
const CACHE_HIT_COLOR = '#22c55e';

const formatPercent = (value: number) => `${value.toFixed(value >= 10 || value === 0 ? 0 : 1)}%`;
const formatCostValue = (value: number) => formatUsdFixedOne(value);

const getChartMinWidth = (pointCount: number, isMobile: boolean): string | undefined => {
  if (pointCount <= 24) return undefined;
  const perPoint = isMobile ? 44 : 22;
  const minWidth = Math.min(pointCount * perPoint, 12000);
  return `${minWidth}px`;
};

export function MonitorTrendChart({
  usage,
  loading,
  isDark,
  isMobile,
  timeRange,
  modelPrices
}: MonitorTrendChartProps) {
  const { t } = useTranslation();

  const trend = useMemo(
    () => buildUsageTokenCacheHitTrend(usage, timeRange, modelPrices),
    [usage, timeRange, modelPrices]
  );
  const pointRadius = trend.labels.length > 180 || (isMobile && trend.labels.length > 80) ? 0 : isMobile ? 2 : 3;

  const chartData = useMemo<ChartData<'line'>>(
    () => ({
      labels: trend.labels,
      datasets: [
        {
          label: t('usage_stats.total_tokens'),
          data: trend.tokenSeries,
          yAxisID: 'yTokens',
          borderColor: TOKEN_COLOR,
          backgroundColor: 'rgba(139, 92, 246, 0.14)',
          pointBackgroundColor: TOKEN_COLOR,
          pointBorderColor: TOKEN_COLOR,
          pointRadius,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: false,
          borderWidth: isMobile ? 1.5 : 2
        },
        {
          label: t('usage_stats.total_cost'),
          data: trend.costSeries,
          yAxisID: 'yCost',
          borderColor: COST_COLOR,
          backgroundColor: 'rgba(245, 158, 11, 0.16)',
          pointBackgroundColor: COST_COLOR,
          pointBorderColor: COST_COLOR,
          pointRadius,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: false,
          borderWidth: isMobile ? 1.5 : 2
        },
        {
          label: t('usage_stats.cache_hit'),
          data: trend.cacheHitSeries,
          yAxisID: 'yCacheHit',
          borderColor: CACHE_HIT_COLOR,
          backgroundColor: 'rgba(34, 197, 94, 0.16)',
          pointBackgroundColor: CACHE_HIT_COLOR,
          pointBorderColor: CACHE_HIT_COLOR,
          pointRadius,
          pointHoverRadius: 4,
          tension: 0.25,
          fill: false,
          borderWidth: isMobile ? 1.5 : 2
        }
      ]
    }),
    [isMobile, pointRadius, t, trend.cacheHitSeries, trend.costSeries, trend.labels, trend.tokenSeries]
  );

  const chartOptions = useMemo<ChartOptions<'line'>>(() => {
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(17, 24, 39, 0.06)';
    const axisBorderColor = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(17, 24, 39, 0.10)';
    const tickColor = isDark ? 'rgba(255, 255, 255, 0.72)' : 'rgba(17, 24, 39, 0.72)';
    const tooltipBg = isDark ? 'rgba(17, 24, 39, 0.92)' : 'rgba(255, 255, 255, 0.98)';
    const tooltipTitle = isDark ? '#ffffff' : '#111827';
    const tooltipBody = isDark ? 'rgba(255, 255, 255, 0.86)' : '#374151';
    const tooltipBorder = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(17, 24, 39, 0.10)';
    const tickFontSize = isMobile ? 10 : 12;

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
          usePointStyle: true,
          callbacks: {
            title: (items) => {
              const index = items[0]?.dataIndex;
              return typeof index === 'number' ? trend.tooltipLabels[index] ?? '' : '';
            },
            label: (context) => {
              const label = context.dataset.label || '';
              const value = Number(context.parsed?.y ?? 0);
              if (context.dataset.yAxisID === 'yCost') {
                return `${label}: ${formatCostValue(value)}`;
              }
              if (context.dataset.yAxisID === 'yCacheHit') {
                return `${label}: ${formatPercent(value)}`;
              }
              return `${label}: ${value.toLocaleString()}`;
            },
            afterBody: (items) => {
              const index = items[0]?.dataIndex;
              const requestCount = typeof index === 'number' ? trend.requestCounts[index] : 0;
              if (!requestCount || requestCount <= 1) {
                return '';
              }
              return t('monitoring_center.cache_hit_bucket_requests', { count: requestCount });
            }
          }
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
            maxTicksLimit: isMobile ? 8 : 12,
            callback: (value) => {
              const index = typeof value === 'number' ? value : Number(value);
              const raw =
                Number.isFinite(index) && trend.labels[index]
                  ? trend.labels[index]
                  : typeof value === 'string'
                    ? value
                    : '';

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
        yTokens: {
          beginAtZero: true,
          position: 'left',
          grid: {
            color: gridColor
          },
          border: {
            color: axisBorderColor
          },
          ticks: {
            color: tickColor,
            font: { size: tickFontSize },
            callback: (value, _index, ticks) => formatTokenAxisValue(Number(value), ticks)
          }
        },
        yCost: {
          beginAtZero: true,
          position: 'right',
          grid: {
            drawOnChartArea: false
          },
          border: {
            color: axisBorderColor
          },
          ticks: {
            color: tickColor,
            font: { size: tickFontSize },
            callback: (value) => formatCostValue(Number(value))
          }
        },
        yCacheHit: {
          beginAtZero: true,
          min: 0,
          max: 100,
          position: 'right',
          grid: {
            drawOnChartArea: false
          },
          border: {
            color: axisBorderColor
          },
          ticks: {
            color: tickColor,
            font: { size: tickFontSize },
            callback: (value) => `${Number(value)}%`
          }
        }
      }
    };
  }, [isDark, isMobile, t, trend.labels, trend.requestCounts, trend.tooltipLabels]);

  return (
    <Card
      title={t('monitoring_center.combined_trend_title')}
      className={styles.detailsFixedCard}
    >
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : trend.labels.length > 0 ? (
        <div className={styles.chartWrapper}>
          <div className={styles.chartLegend} aria-label="Chart legend">
            {chartData.datasets.map((dataset, index) => (
              <div key={`${dataset.label}-${index}`} className={styles.legendItem} title={dataset.label}>
                <span className={styles.legendDot} style={{ backgroundColor: String(dataset.borderColor) }} />
                <span className={styles.legendLabel}>{dataset.label}</span>
              </div>
            ))}
          </div>
          <div className={styles.chartArea}>
            <div className={styles.chartScroller}>
              <div
                className={styles.chartCanvas}
                style={{ minWidth: getChartMinWidth(trend.labels.length, isMobile) }}
              >
                <Line data={chartData} options={chartOptions} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
