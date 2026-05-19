import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconKey,
  IconBot,
  IconFileText,
  IconSatellite,
  IconDiamond
} from '@/components/ui/icons';
import { useAuthStore, useConfigStore, useModelsStore, useNotificationStore } from '@/stores';
import { useUsageStatsStore, USAGE_STATS_STALE_TIME_MS } from '@/stores/useUsageStatsStore';
import { apiKeysApi, providersApi, authFilesApi } from '@/services/api';
import { copyToClipboard } from '@/utils/clipboard';
import { filterUsageByTimeRange, formatCompactNumber } from '@/utils/usage';
import {
  MONITOR_USAGE_TIME_RANGE_STORAGE_KEY,
  loadMonitorUsageTimeRange
} from '@/utils/monitorUsageTimeRange';
import styles from './DashboardPage.module.scss';

interface QuickStat {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  path: string;
  loading?: boolean;
  sublabel?: string;
  iconAccent: 'key' | 'providers' | 'auth' | 'models' | 'usageTokens';
}

interface ProviderStats {
  gemini: number | null;
  codex: number | null;
  claude: number | null;
  openai: number | null;
}

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);
  const { showNotification } = useNotificationStore();

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [stats, setStats] = useState<{
    apiKeys: number | null;
    authFiles: number | null;
  }>({
    apiKeys: null,
    authFiles: null
  });

  const [providerStats, setProviderStats] = useState<ProviderStats>({
    gemini: null,
    codex: null,
    claude: null,
    openai: null
  });

  const [loading, setLoading] = useState(true);

  const usageFromStore = useUsageStatsStore((state) => state.usage);
  const usageStatsLoading = useUsageStatsStore((state) => state.loading);
  const loadUsageStatsAction = useUsageStatsStore((state) => state.loadUsageStats);
  const [monitorTimeRange, setMonitorTimeRange] = useState(loadMonitorUsageTimeRange);

  const handleCopyApiBase = useCallback(async () => {
    const base = apiBase?.trim();
    if (!base) return;
    const ok = await copyToClipboard(base);
    showNotification(
      t(ok ? 'notification.link_copied' : 'notification.copy_failed'),
      ok ? 'success' : 'error'
    );
  }, [apiBase, showNotification, t]);

  // Time-of-day state for dynamic greeting
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(getTimeOfDay);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  const apiKeysCache = useRef<string[]>([]);

  useEffect(() => {
    apiKeysCache.current = [];
  }, [apiBase, config?.apiKeys]);

  // Update time every 60 seconds
  useEffect(() => {
    const id = setInterval(() => {
      setTimeOfDay(getTimeOfDay());
      setCurrentTime(new Date());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '/dashboard') {
      setMonitorTimeRange(loadMonitorUsageTimeRange());
    }
  }, [location.pathname]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === MONITOR_USAGE_TIME_RANGE_STORAGE_KEY || event.key === null) {
        setMonitorTimeRange(loadMonitorUsageTimeRange());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      return;
    }
    void loadUsageStatsAction({
      force: true,
      fullRange: true,
      staleTimeMs: USAGE_STATS_STALE_TIME_MS,
      timeRange: monitorTimeRange
    }).catch(() => {});
  }, [connectionStatus, monitorTimeRange, loadUsageStatsAction]);

  const normalizeApiKeyList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const keys: string[] = [];

    input.forEach((item) => {
      const record =
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      const value =
        typeof item === 'string'
          ? item
          : record
            ? (record['api-key'] ?? record['apiKey'] ?? record.key ?? record.Key)
            : '';
      const trimmed = String(value ?? '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      keys.push(trimmed);
    });

    return keys;
  };

  const resolveApiKeysForModels = useCallback(async () => {
    if (apiKeysCache.current.length) {
      return apiKeysCache.current;
    }

    const configKeys = normalizeApiKeyList(config?.apiKeys);
    if (configKeys.length) {
      apiKeysCache.current = configKeys;
      return configKeys;
    }

    try {
      const list = await apiKeysApi.list();
      const normalized = normalizeApiKeyList(list);
      if (normalized.length) {
        apiKeysCache.current = normalized;
      }
      return normalized;
    } catch {
      return [];
    }
  }, [config?.apiKeys]);

  const fetchModels = useCallback(async () => {
    if (connectionStatus !== 'connected' || !apiBase) {
      return;
    }

    try {
      const apiKeys = await resolveApiKeysForModels();
      const primaryKey = apiKeys[0];
      await fetchModelsFromStore(apiBase, primaryKey);
    } catch {
      // Ignore model fetch errors on dashboard
    }
  }, [connectionStatus, apiBase, resolveApiKeysForModels, fetchModelsFromStore]);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const [keysRes, filesRes, geminiRes, codexRes, claudeRes, openaiRes] = await Promise.allSettled([
          apiKeysApi.list(),
          authFilesApi.list(),
          providersApi.getGeminiKeys(),
          providersApi.getCodexConfigs(),
          providersApi.getClaudeConfigs(),
          providersApi.getOpenAIProviders()
        ]);

        setStats({
          apiKeys: keysRes.status === 'fulfilled' ? keysRes.value.length : null,
          authFiles: filesRes.status === 'fulfilled' ? filesRes.value.files.length : null
        });

        setProviderStats({
          gemini: geminiRes.status === 'fulfilled' ? geminiRes.value.length : null,
          codex: codexRes.status === 'fulfilled' ? codexRes.value.length : null,
          claude: claudeRes.status === 'fulfilled' ? claudeRes.value.length : null,
          openai: openaiRes.status === 'fulfilled' ? openaiRes.value.length : null
        });
      } finally {
        setLoading(false);
      }
    };

    if (connectionStatus === 'connected') {
      fetchStats();
      fetchModels();
    } else {
      setLoading(false);
    }
  }, [connectionStatus, fetchModels]);

  // Calculate total provider keys only when all provider stats are available.
  const providerStatsReady =
    providerStats.gemini !== null &&
    providerStats.codex !== null &&
    providerStats.claude !== null &&
    providerStats.openai !== null;
  const hasProviderStats =
    providerStats.gemini !== null ||
    providerStats.codex !== null ||
    providerStats.claude !== null ||
    providerStats.openai !== null;
  const totalProviderKeys = providerStatsReady
    ? (providerStats.gemini ?? 0) +
      (providerStats.codex ?? 0) +
      (providerStats.claude ?? 0) +
      (providerStats.openai ?? 0)
    : 0;

  const filteredUsageForMonitor = useMemo(
    () => (usageFromStore ? filterUsageByTimeRange(usageFromStore, monitorTimeRange) : null),
    [usageFromStore, monitorTimeRange]
  );

  const usageTokensCardLoading =
    connectionStatus === 'connected' && usageStatsLoading && !usageFromStore;
  const usageTokensDisplay =
    connectionStatus !== 'connected'
      ? '-'
      : formatCompactNumber(filteredUsageForMonitor?.total_tokens ?? 0);

  const quickStats: QuickStat[] = [
    {
      label: t('dashboard.management_keys'),
      value: stats.apiKeys ?? '-',
      icon: <IconKey size={24} />,
      path: '/config',
      loading: loading && stats.apiKeys === null,
      iconAccent: 'key'
    },
    {
      label: t('nav.ai_providers'),
      value: loading ? '-' : providerStatsReady ? totalProviderKeys : '-',
      icon: <IconBot size={24} />,
      path: '/ai-providers',
      loading: loading,
      sublabel: hasProviderStats
        ? t('dashboard.provider_keys_detail', {
            gemini: providerStats.gemini ?? '-',
            codex: providerStats.codex ?? '-',
            claude: providerStats.claude ?? '-',
            openai: providerStats.openai ?? '-'
          })
        : undefined,
      iconAccent: 'providers'
    },
    {
      label: t('nav.auth_files'),
      value: stats.authFiles ?? '-',
      icon: <IconFileText size={24} />,
      path: '/auth-files',
      loading: loading && stats.authFiles === null,
      sublabel: t('dashboard.oauth_credentials'),
      iconAccent: 'auth'
    },
    {
      label: t('dashboard.available_models'),
      value: modelsLoading ? '-' : models.length,
      icon: <IconSatellite size={24} />,
      path: '/models',
      loading: modelsLoading,
      iconAccent: 'models'
    },
    {
      label: t('dashboard.total_tokens'),
      value: usageTokensDisplay,
      icon: <IconDiamond size={24} />,
      path: '/monitoring-dashboard',
      loading: usageTokensCardLoading,
      iconAccent: 'usageTokens'
    }
  ];

  const routingStrategyRaw = config?.routingStrategy?.trim() || '';
  const routingStrategyDisplay = !routingStrategyRaw
    ? '-'
    : routingStrategyRaw === 'round-robin'
      ? t('basic_settings.routing_strategy_round_robin')
      : routingStrategyRaw === 'fill-first'
        ? t('basic_settings.routing_strategy_fill_first')
        : routingStrategyRaw;
  const routingStrategyBadgeClass = !routingStrategyRaw
    ? styles.configBadgeUnknown
    : routingStrategyRaw === 'round-robin'
      ? styles.configBadgeRoundRobin
      : routingStrategyRaw === 'fill-first'
        ? styles.configBadgeFillFirst
        : styles.configBadgeUnknown;

  // Derived time-based values
  const greetingKey = `dashboard.greeting_${timeOfDay}`;
  const caringKey = `dashboard.caring_${timeOfDay}`;

  const formattedDate = currentTime.toLocaleDateString(i18n.language, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const formattedTime = currentTime.toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit'
  });

  const connectionStatusLabel = t(
    connectionStatus === 'connected'
      ? 'common.connected'
      : connectionStatus === 'connecting'
        ? 'common.connecting'
        : 'common.disconnected'
  );

  const trimmedServerVersion = serverVersion?.trim() ?? '';
  const displayServerVersion =
    trimmedServerVersion !== '' ? `v${trimmedServerVersion.replace(/^[vV]+/, '')}` : '';

  const connectionPillTitle =
    displayServerVersion && connectionStatus === 'connected'
      ? `${connectionStatusLabel} · ${displayServerVersion}`
      : connectionStatusLabel;

  const bentoIconByAccent: Record<QuickStat['iconAccent'], string> = {
    key: styles.bentoIconKey,
    providers: styles.bentoIconProviders,
    auth: styles.bentoIconAuth,
    models: styles.bentoIconModels,
    usageTokens: styles.bentoIconUsageTokens
  };

  return (
    <div className={styles.dashboard}>
      {/* Decorative background orbs */}
      <div className={styles.backgroundOrbs} aria-hidden="true">
        <div className={styles.orb1} />
        <div className={styles.orb2} />
      </div>

      {/* Hero welcome section */}
      <section className={styles.hero}>
        <span className={styles.heroWatermark} aria-hidden="true">
          OVERVIEW
        </span>
        <div className={styles.heroContent}>
          <span className={styles.heroGreeting}>{t(greetingKey)}</span>
          <h1 className={styles.heroTitle}>{t('dashboard.welcome_back')}</h1>
          <p className={styles.heroCaring}>{t(caringKey)}</p>
        </div>
        <div className={styles.heroMeta}>
          <div className={styles.dateTimeBlock}>
            <span className={styles.time}>{formattedTime}</span>
            <span className={styles.dateTimeSep} aria-hidden="true">
              ·
            </span>
            <span className={styles.date}>{formattedDate}</span>
          </div>
          <div className={styles.connectionRow}>
            {connectionStatus === 'connected' && Boolean(apiBase?.trim()) && (
              <button
                type="button"
                className={styles.apiBasePill}
                onClick={() => void handleCopyApiBase()}
                title={`${apiBase} · ${t('common.copy')}`}
              >
                {apiBase}
              </button>
            )}
            <div className={styles.connectionPill} title={connectionPillTitle}>
              <span
                className={`${styles.statusDot} ${
                  connectionStatus === 'connected'
                    ? styles.connected
                    : connectionStatus === 'connecting'
                      ? styles.connecting
                      : styles.disconnected
                }`}
              />
              <span className={styles.pillText}>{connectionStatusLabel}</span>
            </div>
          </div>
          {serverBuildDate && (
            <span className={styles.buildDate}>
              {new Date(serverBuildDate).toLocaleDateString(i18n.language)}
            </span>
          )}
        </div>
      </section>

      {/* Bento stats grid */}
      <section className={styles.statsSection}>
        <h2 className={styles.sectionHeading}>{t('dashboard.system_overview')}</h2>
        <div className={styles.bentoGrid}>
          {quickStats.map((stat, index) => (
            <Link
              key={stat.path}
              to={stat.path}
              className={`${styles.bentoCard} ${index === 0 ? styles.bentoLarge : ''}`}
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <div className={`${styles.bentoIcon} ${bentoIconByAccent[stat.iconAccent]}`}>{stat.icon}</div>
              <div className={styles.bentoContent}>
                <span className={styles.bentoValue}>
                  {stat.loading ? '...' : stat.value}
                </span>
                <span className={styles.bentoLabel}>{stat.label}</span>
                {stat.sublabel && !stat.loading && (
                  <span className={styles.bentoSublabel}>{stat.sublabel}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Config pills section */}
      {config && (
        <section className={styles.configSection}>
          <div className={styles.configSectionHeader}>
            <h2 className={styles.sectionHeading}>{t('dashboard.current_config')}</h2>
            <Link to="/config" className={styles.configEditLink}>
              {t('dashboard.edit_settings')} →
            </Link>
          </div>
          <div className={styles.configPillGrid}>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.debug_enable')}</span>
              <span className={`${styles.configPillValue} ${config.debug ? styles.on : styles.off}`}>
                {config.debug ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.logging_to_file_enable')}</span>
              <span className={`${styles.configPillValue} ${config.loggingToFile ? styles.on : styles.off}`}>
                {config.loggingToFile ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.retry_count_label')}</span>
              <span className={styles.configPillValue}>{config.requestRetry ?? 0}</span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.ws_auth_enable')}</span>
              <span className={`${styles.configPillValue} ${config.wsAuth ? styles.on : styles.off}`}>
                {config.wsAuth ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('dashboard.routing_strategy')}</span>
              <span className={`${styles.configBadge} ${routingStrategyBadgeClass}`}>
                {routingStrategyDisplay}
              </span>
            </div>
            {config.proxyUrl && (
              <div className={`${styles.configPill} ${styles.configPillWide}`}>
                <span className={styles.configPillLabel}>{t('basic_settings.proxy_url_label')}</span>
                <span className={styles.configPillMono}>{config.proxyUrl}</span>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
