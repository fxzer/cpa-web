import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import {
  buildServiceHealthGrid,
  formatCompactNumber,
  type ServiceHealthGrid,
} from '@/utils/usage';
import styles from '@/pages/RequestMonitoringPage.module.scss';

interface ServiceHealthHeatmapCardProps {
  usagePayload: unknown;
  loading: boolean;
  isDark: boolean;
}

const getCellColor = (rate: number, isDark: boolean): string => {
  if (rate < 0) return isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  if (rate >= 1) return isDark ? '#166534' : '#22c55e';
  if (rate >= 0.95) return isDark ? '#15803d' : '#4ade80';
  if (rate >= 0.8) return isDark ? '#a16207' : '#facc15';
  if (rate >= 0.5) return isDark ? '#9a3412' : '#fb923c';
  return isDark ? '#7f1d1d' : '#ef4444';
};

const getCellTitle = (rate: number, success: number, failure: number): string => {
  if (rate < 0) return 'No requests';
  const pct = (rate * 100).toFixed(1);
  return `${pct}% success (${success} ok, ${failure} failed)`;
};

export function ServiceHealthHeatmapCard({
  usagePayload,
  loading,
  isDark,
}: ServiceHealthHeatmapCardProps) {
  const { t } = useTranslation();

  const grid = useMemo<ServiceHealthGrid | null>(() => {
    if (!usagePayload) return null;
    return buildServiceHealthGrid(usagePayload);
  }, [usagePayload]);

  const weekDays = useMemo(() => {
    if (!grid) return [];
    return grid.labels.map((label) => {
      const parts = label.split('-');
      return parts.length === 2 ? `${parts[0]}/${parts[1]}` : label;
    });
  }, [grid]);

  return (
    <Card title={t('request_monitoring.service_health_title')} className={styles.healthCard}>
      {loading ? (
        <div className={styles.healthHint}>{t('common.loading')}</div>
      ) : grid ? (
        <div className={styles.healthGridWrapper}>
          <div className={styles.healthGridMeta}>
            <span>
              {t('usage_stats.success_count')}: {formatCompactNumber(grid.totalSuccess)}
            </span>
            <span>
              {t('usage_stats.failure_count')}: {formatCompactNumber(grid.totalFailure)}
            </span>
            {grid.overallRate >= 0 && (
              <span>
                {t('usage_stats.success_rate')}: {(grid.overallRate * 100).toFixed(1)}%
              </span>
            )}
          </div>
          <div className={styles.healthGrid}>
            <div className={styles.healthGridHeader}>
              <div className={styles.healthGridCorner} />
              {Array.from({ length: grid.cols }, (_, h) => (
                <div key={h} className={styles.healthGridColLabel}>
                  {h.toString().padStart(2, '0')}
                </div>
              ))}
            </div>
            {grid.cells.map((row, ri) => (
              <div key={ri} className={styles.healthGridRow}>
                <div className={styles.healthGridRowLabel}>{weekDays[ri]}</div>
                {row.map((cell, ci) => (
                  <div
                    key={ci}
                    className={styles.healthGridCell}
                    style={{ backgroundColor: getCellColor(cell.rate, isDark) }}
                    title={getCellTitle(cell.rate, cell.success, cell.failure)}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className={styles.healthGridLegend}>
            <span className={styles.healthLegendLabel}>No data</span>
            <span
              className={styles.healthLegendSwatch}
              style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}
            />
            <span className={styles.healthLegendLabel}>50%</span>
            <span
              className={styles.healthLegendSwatch}
              style={{ backgroundColor: isDark ? '#9a3412' : '#fb923c' }}
            />
            <span className={styles.healthLegendLabel}>80%</span>
            <span
              className={styles.healthLegendSwatch}
              style={{ backgroundColor: isDark ? '#a16207' : '#facc15' }}
            />
            <span className={styles.healthLegendLabel}>95%</span>
            <span
              className={styles.healthLegendSwatch}
              style={{ backgroundColor: isDark ? '#15803d' : '#4ade80' }}
            />
            <span className={styles.healthLegendLabel}>100%</span>
            <span
              className={styles.healthLegendSwatch}
              style={{ backgroundColor: isDark ? '#166534' : '#22c55e' }}
            />
          </div>
        </div>
      ) : (
        <div className={styles.healthHint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
