import { useMemo } from 'react';
import type { ChartData, ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import {
  buildDailyTokenBreakdown,
  buildHourlyTokenBreakdown,
  formatCompactNumber,
  type TokenBreakdownSeries,
  type UsageTimeRange,
} from '@/utils/usage';
import type { UsagePayload } from '@/components/usage';
import styles from '@/pages/MonitoringCenterPage.module.scss';

interface MonitorTokenBreakdownCardProps {
  usage: UsagePayload | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  timeRange: UsageTimeRange;
}

const CATEGORY_CONFIG: Record<
  string,
  { labelKey: string; color: string; bg: string }
> = {
  input: {
    labelKey: 'usage_stats.token_input',
    color: '#8b5cf6',
    bg: 'rgba(139, 92, 246, 0.7)',
  },
  output: {
    labelKey: 'usage_stats.token_output',
    color: '#22c55e',
    bg: 'rgba(34, 197, 94, 0.7)',
  },
  cached: {
    labelKey: 'usage_stats.token_cached',
    color: '#0ea5e9',
    bg: 'rgba(14, 165, 233, 0.7)',
  },
  reasoning: {
    labelKey: 'usage_stats.token_reasoning',
    color: '#f97316',
    bg: 'rgba(249, 115, 22, 0.7)',
  },
};

export function MonitorTokenBreakdownCard({
  usage,
  loading,
  isDark,
  isMobile,
  timeRange,
}: MonitorTokenBreakdownCardProps) {
  const { t } = useTranslation();

  const series = useMemo<TokenBreakdownSeries>(() => {
    if (!usage) return { labels: [], dataByCategory: { input: [], output: [], cached: [], reasoning: [] }, hasData: false };
    if (timeRange === '7h' || timeRange === '24h') {
      const hourWindow = timeRange === '7h' ? 7 : 24;
      return buildHourlyTokenBreakdown(usage, hourWindow);
    }
    return buildDailyTokenBreakdown(usage);
  }, [timeRange, usage]);

  const chartData = useMemo<ChartData<'bar'>>(
    () => ({
      labels: series.labels,
      datasets: (['input', 'output', 'cached', 'reasoning'] as const).map((cat) => {
        const cfg = CATEGORY_CONFIG[cat];
        return {
          label: t(cfg.labelKey),
          data: series.dataByCategory[cat],
          backgroundColor: cfg.bg,
          borderColor: cfg.color,
          borderWidth: 1,
          borderRadius: 2,
        };
      }),
    }),
    [series, t]
  );

  const chartOptions = useMemo<ChartOptions<'bar'>>(
    () => {
      const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(17, 24, 39, 0.06)';
      const axisBorderColor = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(17, 24, 39, 0.10)';
      const tickColor = isDark ? 'rgba(255, 255, 255, 0.72)' : 'rgba(17, 24, 39, 0.72)';
      const tickFontSize = isMobile ? 10 : 12;

      return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index' as const,
          intersect: false,
        },
        plugins: {
          legend: {
            position: 'bottom' as const,
            labels: {
              color: tickColor,
              font: { size: tickFontSize },
              boxWidth: 12,
              padding: 16,
              usePointStyle: true,
              pointStyle: 'rectRounded',
            },
          },
          tooltip: {
            mode: 'index' as const,
            intersect: false,
            callbacks: {
              title: (items) => items[0]?.label ?? '',
              label: (ctx) => {
                const value = Number(ctx.parsed?.y ?? 0);
                return `${ctx.dataset.label}: ${formatCompactNumber(value)}`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { color: gridColor, drawTicks: false },
            border: { color: axisBorderColor },
            ticks: {
              color: tickColor,
              font: { size: tickFontSize },
              maxRotation: isMobile ? 0 : 45,
              minRotation: 0,
              autoSkip: true,
              maxTicksLimit: isMobile ? 8 : 12,
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: gridColor },
            border: { color: axisBorderColor },
            ticks: {
              color: tickColor,
              font: { size: tickFontSize },
              callback: (value) => formatCompactNumber(Number(value)),
            },
          },
        },
      };
    },
    [isDark, isMobile]
  );

  return (
    <Card title={t('monitoring_center.token_breakdown_title')} className={styles.detailsFixedCard}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : series.hasData ? (
        <div className={styles.chartWrapper}>
          <div className={styles.chartArea}>
            <div className={styles.chartScroller}>
              <div className={styles.chartCanvas}>
                <Bar data={chartData} options={chartOptions} />
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
