import { useCallback, useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconDownload,
  IconSearch,
  IconSlidersHorizontal,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import {
  logsApi,
  usageApi,
  usageServiceApi,
  isUsageServiceId,
  normalizeUsageServiceBase,
  configApi,
} from '@/services/api';
import type { UsageServiceStatus } from '@/services/api/usageService';
import { useAuthStore, useConfigStore, useNotificationStore, useUsageServiceStore } from '@/stores';
import { detectApiBaseFromLocation } from '@/utils/connection';
import { downloadBlob } from '@/utils/download';
import { formatCompactNumber, formatDurationMs } from '@/utils/usage';
import {
  buildRequestMonitoringOptions,
  buildRequestMonitoringRows,
  filterRequestMonitoringRows,
  type RequestMonitoringFilters,
  type RequestMonitoringRow,
  type RequestMonitoringStatusFilter,
} from '@/utils/requestMonitoring';
import styles from './RequestMonitoringPage.module.scss';

const MAX_VISIBLE_ROWS = 300;
const AUTO_REFRESH_MS = 10_000;
const MANAGEMENT_API_USAGE_PATH = '/v0/management/usage';

/** 与监控中心 stat 卡片相近的强调色，用于顶部四卡渐变 */
const REQUEST_MONITORING_STATUS_ACCENTS = [
  { accent: '#8b8680', accentSoft: 'rgba(139, 134, 128, 0.18)', accentBorder: 'rgba(139, 134, 128, 0.35)' },
  { accent: '#8b5cf6', accentSoft: 'rgba(139, 92, 246, 0.18)', accentBorder: 'rgba(139, 92, 246, 0.35)' },
  { accent: '#22c55e', accentSoft: 'rgba(34, 197, 94, 0.18)', accentBorder: 'rgba(34, 197, 94, 0.32)' },
  { accent: '#f97316', accentSoft: 'rgba(249, 115, 22, 0.18)', accentBorder: 'rgba(249, 115, 22, 0.32)' },
] as const;

type RequestMonitoringDataSource = 'usage-service' | 'management-api';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
};

const formatTimeAgo = (timestampMs?: number): string => {
  if (!timestampMs || timestampMs <= 0) return '-';
  const diffMs = Math.max(0, Date.now() - timestampMs);
  if (diffMs < 60_000) return `${Math.max(1, Math.round(diffMs / 1000))}s`;
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m`;
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h`;
  return `${Math.round(diffMs / 86_400_000)}d`;
};

const formatTokenParts = (row: RequestMonitoringRow): string => {
  const parts = [
    `in ${formatCompactNumber(row.inputTokens)}`,
    `out ${formatCompactNumber(row.outputTokens)}`,
  ];
  if (row.cachedTokens > 0) parts.push(`cache ${formatCompactNumber(row.cachedTokens)}`);
  if (row.reasoningTokens > 0) parts.push(`think ${formatCompactNumber(row.reasoningTokens)}`);
  return parts.join(' / ');
};

/** 凭证列第二行：apikey #<authIndex>-<hash>，单行不换行 */
const formatCredentialKeyLine = (row: RequestMonitoringRow): string => {
  const type = row.authType && row.authType !== '-' ? row.authType : '';
  const idx = row.authIndex && row.authIndex !== '-' ? row.authIndex : '';
  const hash = row.apiKeyHashShort && row.apiKeyHashShort !== '-' ? row.apiKeyHashShort : '';
  let tail = '';
  if (idx && hash) tail = `#${idx}-${hash}`;
  else if (idx) tail = `#${idx}`;
  else if (hash) tail = hash;
  else tail = '-';
  if (type) return `${type} ${tail}`;
  return tail;
};

const buildSelectOptions = (label: string, values: readonly string[]) => [
  { value: '', label },
  ...values.map((value) => ({ value, label: value })),
];

const resolveServiceLabel = (status: UsageServiceStatus | null, loading: boolean): string => {
  if (loading) return 'checking';
  if (!status) return 'offline';
  const collector = status.collector?.collector || 'unknown';
  return collector === 'running' ? 'running' : collector;
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
  const [autoRefresh, setAutoRefresh] = useLocalStorage(
    'requestMonitoringPage.autoRefresh',
    false
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setupSaving, setSetupSaving] = useState(false);
  const [draftEnabled, setDraftEnabled] = useState(usageServiceEnabled);
  const [draftServiceBase, setDraftServiceBase] = useState(
    usageServiceBase || apiBase || detectApiBaseFromLocation()
  );
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<RequestMonitoringStatusFilter>('all');
  const [providerFilter, setProviderFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [apiKeyFilter, setApiKeyFilter] = useState('');
  const [downloadingRequestId, setDownloadingRequestId] = useState('');

  const resolveUsageServiceBase = useCallback(async (): Promise<string> => {
    if (!usageServiceEnabled || !usageServiceBase) return '';

    const candidates = Array.from(
      new Set(
        [usageServiceBase]
          .map((value) => normalizeUsageServiceBase(value || ''))
          .filter(Boolean)
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

  const rows = useMemo(() => buildRequestMonitoringRows(usagePayload), [usagePayload]);
  const providerOptions = useMemo(() => buildRequestMonitoringOptions(rows, 'provider'), [rows]);
  const modelOptions = useMemo(() => buildRequestMonitoringOptions(rows, 'model'), [rows]);
  const apiKeyOptions = useMemo(() => buildRequestMonitoringOptions(rows, 'apiKeyHash'), [rows]);
  const apiKeyLabels = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => {
      if (row.apiKeyHash && !map.has(row.apiKeyHash)) {
        map.set(row.apiKeyHash, row.apiKeyHashShort);
      }
    });
    return map;
  }, [rows]);

  const filters = useMemo<RequestMonitoringFilters>(
    () => ({
      search: deferredSearch,
      status: statusFilter,
      provider: providerFilter,
      model: modelFilter,
      apiKeyHash: apiKeyFilter,
    }),
    [apiKeyFilter, deferredSearch, modelFilter, providerFilter, statusFilter]
  );

  const filteredRows = useMemo(() => filterRequestMonitoringRows(rows, filters), [filters, rows]);
  const visibleRows = useMemo(() => filteredRows.slice(0, MAX_VISIBLE_ROWS), [filteredRows]);
  const failedCount = useMemo(() => rows.filter((row) => row.status === 'failed').length, [rows]);
  const successRate = rows.length > 0 ? ((rows.length - failedCount) / rows.length) * 100 : 100;
  const selectedApiKeyOptions = useMemo(
    () => [
      { value: '', label: t('request_monitoring.filter_all_api_keys') },
      ...apiKeyOptions.map((hash) => ({
        value: hash,
        label: apiKeyLabels.get(hash) || hash,
      })),
    ],
    [apiKeyLabels, apiKeyOptions, t]
  );

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setProviderFilter('');
    setModelFilter('');
    setApiKeyFilter('');
  };

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

  const downloadRequestLog = useCallback(
    async (requestId: string) => {
      if (!requestId) return;
      setDownloadingRequestId(requestId);
      try {
        const response = await logsApi.downloadRequestLogById(requestId);
        const blob =
          response.data instanceof Blob
            ? response.data
            : new Blob([response.data], { type: 'text/plain' });
        downloadBlob({ filename: `${requestId}.log`, blob });
      } catch (err) {
        showNotification(
          `${t('request_monitoring.download_failed')}${getErrorMessage(err) ? `: ${getErrorMessage(err)}` : ''}`,
          'error'
        );
      } finally {
        setDownloadingRequestId('');
      }
    },
    [showNotification, t]
  );

  const serviceLabel = resolveServiceLabel(status, loading && !status);
  const collectorStatus = status?.collector;
  const serviceMeta =
    dataSource === 'management-api'
      ? t('request_monitoring.management_api_meta', { path: MANAGEMENT_API_USAGE_PATH })
      : serviceBase || t('request_monitoring.service_base_empty');
  const dbMeta =
    dataSource === 'management-api'
      ? t('request_monitoring.management_api_db_meta')
      : status?.dbPath || t('request_monitoring.db_path_empty');
  const progressMeta =
    dataSource === 'management-api'
      ? t('request_monitoring.management_api_progress_meta')
      : `${t('request_monitoring.last_inserted')} ${formatTimeAgo(collectorStatus?.lastInsertedAt)}`;
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
          <h1 className={styles.pageTitle}>{t('request_monitoring.title')}</h1>
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
          <Button
            variant="secondary"
            size="sm"
            loading={loading}
            onClick={() => void loadData()}
          >
            {t('common.refresh')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
            {t('request_monitoring.settings')}
          </Button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {showUsageStatisticsDisabledWarning && (
        <div className={styles.warningBox}>
          {t('request_monitoring.usage_statistics_disabled')}
        </div>
      )}

      <div className={styles.statsGrid}>
        <StatusCard
          label={t('request_monitoring.service_status')}
          value={t(`request_monitoring.collector_${serviceLabel}`, { defaultValue: serviceLabel })}
          meta={serviceMeta}
          accent={REQUEST_MONITORING_STATUS_ACCENTS[0]}
        />
        <StatusCard
          label={t('request_monitoring.total_events')}
          value={formatCompactNumber(status?.events ?? rows.length)}
          meta={dbMeta}
          accent={REQUEST_MONITORING_STATUS_ACCENTS[1]}
        />
        <StatusCard
          label={t('request_monitoring.success_rate')}
          value={`${successRate.toFixed(1)}%`}
          meta={t('request_monitoring.failed_count', { count: failedCount })}
          accent={REQUEST_MONITORING_STATUS_ACCENTS[2]}
        />
        <StatusCard
          label={t('request_monitoring.collector_progress')}
          value={formatCompactNumber(collectorStatus?.totalInserted ?? rows.length)}
          meta={progressMeta}
          accent={REQUEST_MONITORING_STATUS_ACCENTS[3]}
        />
      </div>

      {collectorStatus?.lastError && (
        <div className={styles.warningBox}>
          {t('request_monitoring.collector_error')}: {collectorStatus.lastError}
        </div>
      )}

      <Card
        className={styles.tableCard}
        title={t('request_monitoring.table_title')}
        extra={
          <span className={styles.tableCount}>
            {t('request_monitoring.table_count', {
              shown: visibleRows.length,
              total: filteredRows.length,
            })}
          </span>
        }
      >
        <div className={styles.filters}>
          <div className={styles.searchBox}>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('request_monitoring.search_placeholder')}
              rightElement={<IconSearch size={16} />}
              aria-label={t('request_monitoring.search_placeholder')}
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as RequestMonitoringStatusFilter)}
            options={[
              { value: 'all', label: t('request_monitoring.filter_all_status') },
              { value: 'success', label: t('request_monitoring.status_success') },
              { value: 'failed', label: t('request_monitoring.status_failed') },
            ]}
            ariaLabel={t('request_monitoring.filter_status')}
            className={styles.select}
          />
          <Select
            value={providerFilter}
            onChange={setProviderFilter}
            options={buildSelectOptions(t('request_monitoring.filter_all_providers'), providerOptions)}
            ariaLabel={t('request_monitoring.filter_provider')}
            className={styles.select}
          />
          <Select
            value={modelFilter}
            onChange={setModelFilter}
            options={buildSelectOptions(t('request_monitoring.filter_all_models'), modelOptions)}
            ariaLabel={t('request_monitoring.filter_model')}
            className={styles.select}
          />
          <Select
            value={apiKeyFilter}
            onChange={setApiKeyFilter}
            options={selectedApiKeyOptions}
            ariaLabel={t('request_monitoring.filter_api_key')}
            className={styles.select}
          />
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <IconSlidersHorizontal size={16} />
            {t('request_monitoring.reset_filters')}
          </Button>
        </div>

        {visibleRows.length === 0 ? (
          <EmptyState
            title={
              rows.length === 0
                ? t('request_monitoring.empty_title')
                : t('request_monitoring.no_result_title')
            }
            description={
              rows.length === 0
                ? dataSource === 'management-api'
                  ? t(
                      showUsageStatisticsDisabledWarning
                        ? 'request_monitoring.empty_desc_usage_disabled'
                        : 'request_monitoring.empty_desc_management_api'
                    )
                  : t('request_monitoring.empty_desc')
                : t('request_monitoring.no_result_desc')
            }
            action={
              rows.length === 0 ? (
                <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
                  {t('request_monitoring.settings')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('request_monitoring.col_time')}</th>
                  <th>{t('request_monitoring.col_provider_model')}</th>
                  <th>{t('request_monitoring.col_endpoint')}</th>
                  <th>{t('request_monitoring.col_credential')}</th>
                  <th>{t('request_monitoring.col_usage')}</th>
                  <th>{t('request_monitoring.col_request_id')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className={styles.timeCell}>
                        <span className={styles.timeText}>{row.timestampLabel}</span>
                        <span className={`${styles.statusPill} ${styles[row.status]}`}>
                          {row.status === 'failed'
                            ? t('request_monitoring.status_failed')
                            : t('request_monitoring.status_success')}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.primaryText}>{row.provider}</div>
                      <div className={styles.secondaryText}>{row.model}</div>
                    </td>
                    <td>
                      <div className={styles.endpointLine}>
                        <span className={styles.methodBadge}>{row.endpointMethod}</span>
                        <span className={styles.pathText}>{row.endpointPath}</span>
                      </div>
                      <div className={styles.secondaryText}>{row.endpoint}</div>
                    </td>
                    <td className={styles.credentialTd}>
                      <div className={styles.primaryText}>{row.account}</div>
                      <div className={styles.credentialKeyLine} title={formatCredentialKeyLine(row)}>
                        {formatCredentialKeyLine(row)}
                      </div>
                    </td>
                    <td>
                      <div className={styles.primaryText}>
                        {formatCompactNumber(row.totalTokens)} /{' '}
                        {formatDurationMs(row.latencyMs, { invalidText: '-' })}
                      </div>
                      <div className={styles.secondaryText}>{formatTokenParts(row)}</div>
                    </td>
                    <td>
                      <div className={styles.requestIdText}>{row.requestId || '-'}</div>
                      {requestLogEnabled && row.requestId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void downloadRequestLog(row.requestId)}
                          loading={downloadingRequestId === row.requestId}
                          title={t('request_monitoring.download_request_log')}
                        >
                          <IconDownload size={15} />
                          {t('request_monitoring.download')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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

interface StatusCardAccent {
  accent: string;
  accentSoft: string;
  accentBorder: string;
}

interface StatusCardProps {
  label: string;
  value: string;
  meta: string;
  accent: StatusCardAccent;
}

function StatusCard({ label, value, meta, accent }: StatusCardProps) {
  return (
    <div
      className={styles.statusCard}
      style={
        {
          '--accent': accent.accent,
          '--accent-soft': accent.accentSoft,
          '--accent-border': accent.accentBorder,
        } as CSSProperties
      }
    >
      <div className={styles.statusCardLabel}>{label}</div>
      <div className={styles.statusCardValue}>{value}</div>
      <div className={styles.statusCardMeta}>{meta}</div>
    </div>
  );
}
