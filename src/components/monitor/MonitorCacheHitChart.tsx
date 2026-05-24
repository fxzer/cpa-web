import { useMemo } from 'react';
import type { ChartData, ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import type { UsagePayload } from '@/components/usage';
import { collectUsageDetails, computeCacheHitRatio, type UsageTimeRange } from '@/utils/usage';
import { parseTimestampMs } from '@/utils/timestamp';
import styles from '@/pages/MonitoringCenterPage.module.scss';

export interface MonitorCacheHitChartProps {
  usage: UsagePayload | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  timeRange: UsageTimeRange;
}

interface CacheHitPoint {
  label: string;
  tooltipLabel: string;
  value: number;
  requestCount: number;
}

const CACHE_HIT_COLOR = '#22c55e';
const REQUEST_LEVEL_POINT_LIMIT = 240;
type CacheHitAggregation = 'request' | '5m' | 'hour' | 'day' | 'month';

const formatRequestPointLabel = (timestampMs: number) =>
  new Date(timestampMs)
    .toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
    .replace(',', '');

const formatRequestTooltipLabel = (timestampMs: number) =>
  new Date(timestampMs).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

const formatPercent = (value: number) => `${value.toFixed(value >= 10 || value === 0 ? 0 : 1)}%`;

const formatBucketDatePart = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const formatBucketTimePart = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

const getBucketStartMs = (timestampMs: number, aggregation: Exclude<CacheHitAggregation, 'request'>) => {
  const date = new Date(timestampMs);
  if (aggregation === 'month') {
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  if (aggregation === 'day') {
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  if (aggregation === 'hour') {
    date.setMinutes(0, 0, 0);
    return date.getTime();
  }

  date.setMinutes(Math.floor(date.getMinutes() / 5) * 5, 0, 0);
  return date.getTime();
};

const formatBucketLabel = (timestampMs: number, aggregation: Exclude<CacheHitAggregation, 'request'>) => {
  const date = new Date(timestampMs);
  if (aggregation === 'month') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  if (aggregation === 'day') {
    return formatBucketDatePart(date);
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${formatBucketTimePart(date)}`;
};

const getAggregationMode = (
  timeRange: UsageTimeRange,
  pointCount: number,
  spanMs: number
): CacheHitAggregation => {
  if (timeRange === '5m' || timeRange === '30m' || timeRange === '1h') {
    return 'request';
  }
  if (timeRange === '7h') {
    return pointCount > REQUEST_LEVEL_POINT_LIMIT ? '5m' : 'request';
  }
  if (timeRange === '24h' || timeRange === '7d') {
    return 'hour';
  }
  if (timeRange === '30d') {
    return 'day';
  }
  if (spanMs > 180 * 24 * 60 * 60 * 1000) {
    return 'month';
  }
  if (spanMs > 7 * 24 * 60 * 60 * 1000) {
    return 'day';
  }
  return 'hour';
};

const getChartMinWidth = (pointCount: number, isMobile: boolean): string | undefined => {
  if (pointCount <= 24) return undefined;
  const perPoint = isMobile ? 44 : 22;
  const minWidth = Math.min(pointCount * perPoint, 12000);
  return `${minWidth}px`;
};

function buildCacheHitPoints(usage: UsagePayload | null, timeRange: UsageTimeRange): CacheHitPoint[] {
  if (!usage) return [];

  const requestPoints = collectUsageDetails(usage)
    .map((detail) => {
      const timestampMs =
        typeof detail.__timestampMs === 'number' && detail.__timestampMs > 0
          ? detail.__timestampMs
          : parseTimestampMs(detail.timestamp);
      if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
        return null;
      }

      const inputTokens = detail.tokens.input_tokens;
      const cachedTokens = Math.max(detail.tokens.cached_tokens, detail.tokens.cache_tokens ?? 0);
      const ratio = computeCacheHitRatio(inputTokens, cachedTokens) ?? 0;

      return {
        label: formatRequestPointLabel(timestampMs),
        tooltipLabel: formatRequestTooltipLabel(timestampMs),
        value: Math.min(Math.max(ratio * 100, 0), 100),
        requestCount: 1,
        timestampMs
      };
    })
    .filter((point): point is CacheHitPoint & { timestampMs: number } => point !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  if (requestPoints.length === 0) {
    return [];
  }

  const spanMs = requestPoints[requestPoints.length - 1].timestampMs - requestPoints[0].timestampMs;
  const aggregation = getAggregationMode(timeRange, requestPoints.length, spanMs);
  if (aggregation === 'request') {
    return requestPoints;
  }

  const bucketMap = new Map<number, { totalRatio: number; requestCount: number }>();
  requestPoints.forEach((point) => {
    const bucketStartMs = getBucketStartMs(point.timestampMs, aggregation);
    const bucket = bucketMap.get(bucketStartMs) ?? { totalRatio: 0, requestCount: 0 };
    bucket.totalRatio += point.value;
    bucket.requestCount += 1;
    bucketMap.set(bucketStartMs, bucket);
  });

  return Array.from(bucketMap.entries())
    .sort(([left], [right]) => left - right)
    .map(([timestampMs, bucket]) => ({
      label: formatBucketLabel(timestampMs, aggregation),
      tooltipLabel: formatBucketLabel(timestampMs, aggregation),
      value: bucket.requestCount > 0 ? bucket.totalRatio / bucket.requestCount : 0,
      requestCount: bucket.requestCount
    }));
}

export function MonitorCacheHitChart({ usage, loading, isDark, isMobile, timeRange }: MonitorCacheHitChartProps) {
  const { t } = useTranslation();
  const points = useMemo(() => buildCacheHitPoints(usage, timeRange), [usage, timeRange]);
  const pointRadius = points.length > 180 || (isMobile && points.length > 80) ? 0 : isMobile ? 2 : 3;

  const chartData = useMemo<ChartData<'line'>>(
    () => ({
      labels: points.map((point) => point.label),
      datasets: [
        {
          label: t('usage_stats.cache_hit'),
          data: points.map((point) => point.value),
          borderColor: CACHE_HIT_COLOR,
          backgroundColor: 'rgba(34, 197, 94, 0.16)',
          pointBackgroundColor: CACHE_HIT_COLOR,
          pointBorderColor: CACHE_HIT_COLOR,
          pointRadius,
          pointHoverRadius: 4,
          tension: 0.25,
          fill: true,
          borderWidth: isMobile ? 1.5 : 2
        }
      ]
    }),
    [isMobile, pointRadius, points, t]
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
              return typeof index === 'number' ? points[index]?.tooltipLabel ?? '' : '';
            },
            label: (context) => {
              const value = Number(context.parsed?.y ?? 0);
              return `${context.dataset.label || ''}: ${formatPercent(value)}`;
            },
            afterLabel: (context) => {
              const point = points[context.dataIndex];
              if (!point || point.requestCount <= 1) {
                return '';
              }
              return t('monitoring_center.cache_hit_bucket_requests', { count: point.requestCount });
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
            maxTicksLimit: isMobile ? 8 : 12
          }
        },
        y: {
          beginAtZero: true,
          min: 0,
          max: 100,
          grid: {
            color: gridColor
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
  }, [isDark, isMobile, points, t]);

  return (
    <Card title={t('monitoring_center.cache_hit_trend_title')} className={styles.detailsFixedCard}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : points.length > 0 ? (
        <div className={styles.chartWrapper}>
          <div className={styles.chartLegend} aria-label="Chart legend">
            <div className={styles.legendItem} title={t('usage_stats.cache_hit')}>
              <span className={styles.legendDot} style={{ backgroundColor: CACHE_HIT_COLOR }} />
              <span className={styles.legendLabel}>{t('usage_stats.cache_hit')}</span>
            </div>
          </div>
          <div className={styles.chartArea}>
            <div className={styles.chartScroller}>
              <div
                className={styles.chartCanvas}
                style={{ minWidth: getChartMinWidth(points.length, isMobile) }}
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
