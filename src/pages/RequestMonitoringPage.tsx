import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { RequestEventsDetailsCard, type RequestEventsFilteredStats } from '@/components/usage';
import usageStyles from '@/pages/UsagePage.module.scss';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { requestEventsApi, MAX_REQUEST_EVENTS_LIMIT } from '@/services/api/requestEvents';
import { useAuthStore, useConfigStore } from '@/stores';
import { buildUsageSnapshotFromRequestEvents } from '@/utils/requestEvents';
import { getErrorMessage } from '@/utils/error';
import { ServiceHealthHeatmapCard } from '@/components/monitor/ServiceHealthHeatmapCard';
import { useThemeStore } from '@/stores';
import styles from './RequestMonitoringPage.module.scss';

const AUTO_REFRESH_MS = 10_000;

export function RequestMonitoringPage() {
  const { t } = useTranslation();
  const managementKey = useAuthStore((state) => state.managementKey);
  const config = useConfigStore((state) => state.config);
  const requestLogEnabled = config?.requestLog ?? false;
  const isDark = useThemeStore((state) => state.resolvedTheme) === 'dark';
  const usageStatisticsEnabled = config?.usageStatisticsEnabled ?? true;

  const [usagePayload, setUsagePayload] = useState<unknown>(null);
  const [eventCount, setEventCount] = useState<number | null>(null);
  const [writerDropped, setWriterDropped] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useLocalStorage('requestMonitoringPage.autoRefresh', false);
  const [healthModalOpen, setHealthModalOpen] = useState(false);
  const [filteredStats, setFilteredStats] = useState<RequestEventsFilteredStats>({
    count: 0,
    successRate: null,
    canExport: false,
    exportCsv: () => undefined,
    exportJson: () => undefined,
  });

  const handleFilteredStatsChange = useCallback((stats: RequestEventsFilteredStats) => {
    setFilteredStats(stats);
  }, []);

  const loadData = useCallback(async () => {
    if (!managementKey) {
      setLoading(false);
      setUsagePayload(null);
      setError(t('request_monitoring.error_missing_login'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [eventsResponse, statusResponse] = await Promise.all([
        requestEventsApi.list({ limit: MAX_REQUEST_EVENTS_LIMIT }),
        requestEventsApi.status().catch(() => null),
      ]);
      setUsagePayload(buildUsageSnapshotFromRequestEvents(eventsResponse.items));
      setEventCount(statusResponse?.event_count ?? eventsResponse.summary.total_requests);
      setWriterDropped(statusResponse?.writer?.dropped ?? 0);
      setLastRefreshedAt(new Date());
    } catch (err) {
      setError(getErrorMessage(err) || t('request_monitoring.error_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [managementKey, t]);

  useHeaderRefresh(loadData);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /**
   * 防重叠自动刷新：递归 setTimeout + cancelled 保护
   * 只有在 await loadData() 完成后才调度下一轮，从根本上杜绝重叠
   */
  useEffect(() => {
    if (!autoRefresh) return;

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await loadData();
      if (!cancelled) {
        timerId = setTimeout(tick, AUTO_REFRESH_MS);
      }
    };

    timerId = setTimeout(tick, AUTO_REFRESH_MS);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [autoRefresh, loadData]);

  return (
    <div className={styles.container}>
      {loading && !usagePayload && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingBox}>
            <LoadingSpinner size={28} />
            <span>{t('common.loading')}</span>
          </div>
        </div>
      )}

      <div className={styles.header}>
        <div>
          <h1 className={styles.pageTitle}>
            {t('request_monitoring.title')}
            <span className={styles.pageTitleStats}>
              {t('usage_stats.request_events_count', { count: filteredStats.count })}
              {filteredStats.successRate !== null && (
                <span className={usageStyles.requestEventsSuccessRate}>
                  {t('usage_stats.request_events_success_rate_suffix', {
                    rate: filteredStats.successRate.toFixed(1),
                  })}
                </span>
              )}
            </span>
          </h1>
          <p className={styles.pageSubTitle}>
            {t('request_monitoring.subtitle')}
            {lastRefreshedAt && (
              <>
                {' '}
                {t('usage_stats.last_updated')}: {lastRefreshedAt.toLocaleTimeString()}
              </>
            )}
            {eventCount !== null && (
              <>
                {' '}
                · {t('request_monitoring.persisted_events', { count: eventCount })}
              </>
            )}
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.toolbarCluster}>
            <ToggleSwitch
              checked={autoRefresh}
              onChange={setAutoRefresh}
              label={t('request_monitoring.auto_refresh')}
            />
          </div>
          <Button variant="secondary" size="sm" loading={loading} onClick={() => void loadData()}>
            {t('common.refresh')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setHealthModalOpen(true)}>
            {t('request_monitoring.service_health_btn')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={filteredStats.exportCsv}
            disabled={!filteredStats.canExport}
          >
            {t('usage_stats.export_csv')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={filteredStats.exportJson}
            disabled={!filteredStats.canExport}
          >
            {t('usage_stats.export_json')}
          </Button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {!usageStatisticsEnabled && (
        <div className={styles.warningBox}>{t('request_monitoring.usage_statistics_disabled')}</div>
      )}

      {writerDropped > 0 && (
        <div className={styles.warningBox}>
          {t('request_monitoring.writer_dropped', { count: writerDropped })}
        </div>
      )}

      <Modal
        open={healthModalOpen}
        onClose={() => setHealthModalOpen(false)}
        title={t('request_monitoring.service_health_title')}
        width={820}
      >
        <ServiceHealthHeatmapCard
          usagePayload={usagePayload}
          loading={loading}
          isDark={isDark}
        />
      </Modal>

      <RequestEventsDetailsCard
        usage={usagePayload}
        loading={loading}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={config?.openaiCompatibility || []}
        requestLogEnabled={requestLogEnabled}
        showAutoRefreshControls={false}
        fixedHeight
        onRefresh={loadData}
        lastRefreshedAt={lastRefreshedAt}
        onFilteredStatsChange={handleFilteredStatsChange}
      />
    </div>
  );
}
