import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { RequestEventsDetailsCard, type RequestEventsFilteredStats } from '@/components/usage';
import usageStyles from '@/pages/UsagePage.module.scss';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import {
  usageApi,
  usageServiceApi,
  isUsageServiceId,
  normalizeUsageServiceBase,
  configApi,
} from '@/services/api';
import type { UsageServiceStatus } from '@/services/api/usageService';
import { useAuthStore, useConfigStore, useNotificationStore, useUsageServiceStore } from '@/stores';
import { detectApiBaseFromLocation } from '@/utils/connection';
import styles from './RequestMonitoringPage.module.scss';

const AUTO_REFRESH_MS = 10_000;
const MANAGEMENT_API_USAGE_PATH = '/v0/management/usage';

type RequestMonitoringDataSource = 'usage-service' | 'management-api';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
};

const buildManagementApiStatus = (): UsageServiceStatus => ({
  service: 'cliproxyapi',
  collector: {
    collector: 'management_api',
    transport: MANAGEMENT_API_USAGE_PATH,
  },
});

const isSameServiceBase = (left: string, right: string): boolean =>
  Boolean(left && right && normalizeUsageServiceBase(left) === normalizeUsageServiceBase(right));

export function RequestMonitoringPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const requestLogEnabled = config?.requestLog ?? false;
  const usageStatisticsEnabled = config?.usageStatisticsEnabled ?? false;
  const usageServiceEnabled = useUsageServiceStore((state) => state.enabled);
  const usageServiceBase = useUsageServiceStore((state) => state.serviceBase);
  const usageServiceRevision = useUsageServiceStore((state) => state.revision);
  const setUsageServiceConfig = useUsageServiceStore((state) => state.setUsageServiceConfig);

  const [serviceBase, setServiceBase] = useState('');
  const [dataSource, setDataSource] = useState<RequestMonitoringDataSource>('management-api');
  const [status, setStatus] = useState<UsageServiceStatus | null>(null);
  const [usagePayload, setUsagePayload] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useLocalStorage('requestMonitoringPage.autoRefresh', false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [setupSaving, setSetupSaving] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(usageServiceEnabled);
  const [draftServiceBase, setDraftServiceBase] = useState(
    usageServiceBase || apiBase || detectApiBaseFromLocation()
  );

  const resolveUsageServiceBase = useCallback(async (): Promise<string> => {
    if (!usageServiceEnabled || !usageServiceBase) return '';

    const candidates = Array.from(
      new Set(
        [usageServiceBase].map((value) => normalizeUsageServiceBase(value || '')).filter(Boolean)
      )
    );

    for (const candidate of candidates) {
      try {
        const info = await usageServiceApi.getInfo(candidate);
        if (isUsageServiceId(info.service)) return candidate;
      } catch {
        // 普通管理接口不会返回 Usage Service 信息，继续试下一个地址。
      }
    }

    return '';
  }, [usageServiceBase, usageServiceEnabled]);

  const loadData = useCallback(async () => {
    if (!managementKey) {
      setLoading(false);
      setStatus(null);
      setUsagePayload(null);
      setError(t('request_monitoring.error_missing_login'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const resolvedBase = await resolveUsageServiceBase();
      if (!resolvedBase) {
        const fallbackBase = normalizeUsageServiceBase(apiBase || detectApiBaseFromLocation());
        const nextUsage = await usageApi.getUsage();
        setDataSource('management-api');
        setServiceBase(fallbackBase);
        setStatus(buildManagementApiStatus());
        setUsagePayload(nextUsage);
        setLastRefreshedAt(new Date());
        return;
      }

      setDataSource('usage-service');
      setServiceBase(resolvedBase);
      const [nextStatus, nextUsage] = await Promise.all([
        usageServiceApi.getStatus(resolvedBase, managementKey),
        usageServiceApi.getUsage(resolvedBase, managementKey),
      ]);
      setStatus(nextStatus);
      setUsagePayload(nextUsage);
      setLastRefreshedAt(new Date());
    } catch (err) {
      setError(getErrorMessage(err) || t('request_monitoring.error_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [apiBase, managementKey, resolveUsageServiceBase, t]);

  useHeaderRefresh(loadData);

  useEffect(() => {
    void loadData();
  }, [loadData, usageServiceRevision]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void loadData();
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadData]);

  useEffect(() => {
    if (!settingsOpen) return;
    setDraftEnabled(usageServiceEnabled);
    setDraftServiceBase(usageServiceBase || serviceBase || apiBase || detectApiBaseFromLocation());
  }, [apiBase, serviceBase, settingsOpen, usageServiceBase, usageServiceEnabled]);

  const saveLocalServiceConfig = useCallback(() => {
    const normalizedServiceBase = normalizeUsageServiceBase(draftServiceBase);
    const normalizedApiBase = normalizeUsageServiceBase(apiBase);
    const detectedBase = normalizeUsageServiceBase(detectApiBaseFromLocation());
    const useManagementApi =
      !draftEnabled ||
      isSameServiceBase(normalizedServiceBase, normalizedApiBase) ||
      isSameServiceBase(normalizedServiceBase, detectedBase);

    setUsageServiceConfig({
      enabled: draftEnabled && !useManagementApi,
      serviceBase: useManagementApi ? '' : normalizedServiceBase,
    });
    setSettingsOpen(false);
    showNotification(
      t(
        useManagementApi
          ? 'request_monitoring.management_api_saved'
          : 'request_monitoring.config_saved'
      ),
      'success'
    );
  }, [apiBase, draftEnabled, draftServiceBase, setUsageServiceConfig, showNotification, t]);

  const setupUsageService = useCallback(async () => {
    const normalizedServiceBase = normalizeUsageServiceBase(draftServiceBase);
    const normalizedApiBase = normalizeUsageServiceBase(apiBase);
    if (!normalizedServiceBase || !normalizedApiBase || !managementKey) {
      showNotification(t('request_monitoring.setup_missing_fields'), 'error');
      return;
    }

    setSetupSaving(true);
    try {
      if (
        isSameServiceBase(normalizedServiceBase, normalizedApiBase) ||
        isSameServiceBase(normalizedServiceBase, detectApiBaseFromLocation())
      ) {
        await configApi.updateUsageStatisticsEnabled(draftEnabled);
        updateConfigValue('usage-statistics-enabled', draftEnabled);
        setUsageServiceConfig({ enabled: false, serviceBase: '' });
        setSettingsOpen(false);
        showNotification(t('request_monitoring.management_api_saved'), 'success');
        await fetchConfig(undefined, true);
        await loadData();
        return;
      }

      let infoService = '';
      try {
        const info = await usageServiceApi.getInfo(normalizedServiceBase);
        infoService = info.service || '';
      } catch {
        throw new Error(t('request_monitoring.error_standalone_service_not_found'));
      }

      if (!isUsageServiceId(infoService)) {
        throw new Error(t('request_monitoring.error_standalone_service_not_found'));
      }

      await usageServiceApi.setup(normalizedServiceBase, {
        cpaBaseUrl: normalizedApiBase,
        managementKey,
        collectorMode: 'http',
        batchSize: 100,
        pollIntervalMs: 1000,
        queryLimit: 50000,
        requestMonitoringEnabled: draftEnabled,
        ensureUsageStatisticsEnabled: draftEnabled,
      });
      setUsageServiceConfig({ enabled: draftEnabled, serviceBase: normalizedServiceBase });
      setSettingsOpen(false);
      showNotification(t('request_monitoring.setup_success'), 'success');
      await loadData();
    } catch (err) {
      showNotification(
        `${t('request_monitoring.setup_failed')}${getErrorMessage(err) ? `: ${getErrorMessage(err)}` : ''}`,
        'error'
      );
    } finally {
      setSetupSaving(false);
    }
  }, [
    apiBase,
    draftEnabled,
    draftServiceBase,
    fetchConfig,
    loadData,
    managementKey,
    setUsageServiceConfig,
    showNotification,
    t,
    updateConfigValue,
  ]);

  const collectorStatus = status?.collector;
  const showUsageStatisticsDisabledWarning =
    dataSource === 'management-api' && !usageStatisticsEnabled;

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
          <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
            {t('request_monitoring.settings')}
          </Button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {showUsageStatisticsDisabledWarning && (
        <div className={styles.warningBox}>{t('request_monitoring.usage_statistics_disabled')}</div>
      )}

      {collectorStatus?.lastError && (
        <div className={styles.warningBox}>
          {t('request_monitoring.collector_error')}: {collectorStatus.lastError}
        </div>
      )}

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

      <Modal
        open={settingsOpen}
        title={t('request_monitoring.settings_title')}
        width={620}
        onClose={() => setSettingsOpen(false)}
        footer={
          <div className={styles.modalFooter}>
            <Button variant="secondary" onClick={() => setSettingsOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="secondary" onClick={saveLocalServiceConfig}>
              {t('request_monitoring.save_address_only')}
            </Button>
            <Button onClick={() => void setupUsageService()} loading={setupSaving}>
              {t('request_monitoring.setup_and_save')}
            </Button>
          </div>
        }
      >
        <div className={styles.settingsBody}>
          <ToggleSwitch
            checked={draftEnabled}
            onChange={setDraftEnabled}
            label={t('request_monitoring.enable_collection')}
          />
          <Input
            label={t('request_monitoring.service_base_label')}
            value={draftServiceBase}
            onChange={(event) => setDraftServiceBase(event.target.value)}
            placeholder="http://127.0.0.1:18317"
            hint={t('request_monitoring.service_base_hint')}
          />
          <div className={styles.setupPreview}>
            <div>
              <span>{t('request_monitoring.current_cpa_base')}</span>
              <strong>{apiBase || '-'}</strong>
            </div>
            <div>
              <span>{t('request_monitoring.current_key')}</span>
              <strong>{managementKey ? t('request_monitoring.key_ready') : '-'}</strong>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
