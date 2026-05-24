import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { IconDownload, IconSearch } from '@/components/ui/icons';
import { getAuthFileStatusMessage } from '@/features/authFiles/constants';
import { useInterval } from '@/hooks/useInterval';
import { authFilesApi } from '@/services/api/authFiles';
import { logsApi } from '@/services/api/logs';
import { useNotificationStore } from '@/stores/useNotificationStore';
import type { GeminiKeyConfig, ProviderKeyConfig, OpenAIProviderConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import {
  buildConfiguredCredentialLookup,
  buildCredentialDisplay,
  resolveConfiguredCredential,
  resolveProviderModelColumnDisplay,
} from '@/utils/credentialResolver';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import { parseTimestampMs } from '@/utils/timestamp';
import {
  collectUsageDetailsWithEndpoint,
  computeCacheHitRatio,
  extractFirstByteLatencyMs,
  extractGenerationMs,
  extractTotalTokens,
  formatDurationMs,
  normalizeAuthIndex,
  type UsageThinking,
  USAGE_TIME_RANGE_MS,
  type UsageTimeRange,
} from '@/utils/usage';
import { REQUEST_EVENTS_TIME_RANGE_OPTIONS } from '@/utils/usageTimeRange';
import { downloadBlob } from '@/utils/download';
import { copyToClipboard } from '@/utils/clipboard';
import styles from '@/pages/UsagePage.module.scss';

const ALL_FILTER = '__all__';
const RESULT_SUCCESS_FILTER = 'success';
const RESULT_FAILURE_FILTER = 'failure';
const MAX_RENDERED_EVENTS = 500;

type RequestEventRow = {
  id: string;
  timestamp: string;
  timestampMs: number;
  timestampLabel: string;
  requestId: string;
  provider: string;
  providerTag: string;
  providerDisplayName: string;
  model: string;
  modelAlias: string;
  endpoint: string;
  endpointMethod: string;
  endpointPath: string;
  sourceKey: string;
  sourceRaw: string;
  source: string;
  sourceType: string;
  authIndex: string;
  authType: string;
  account: string;
  credentialBadge: string;
  authLabel: string;
  authFile: string;
  resolvedApiKey: string;
  credentialSubtitle: string;
  apiKeyHash: string;
  apiKeyHashShort: string;
  failed: boolean;
  firstByteLatencyMs: number | null;
  generationMs: number | null;
  latencyMs: number | null;
  tps: number | null;
  thinking: UsageThinking | null;
  thinkingLabel: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  cacheHitRatio: number | null;
};

export type RequestEventsFilteredStats = {
  count: number;
  successRate: number | null;
  canExport: boolean;
  exportCsv: () => void;
  exportJson: () => void;
};

export interface RequestEventsDetailsCardProps {
  usage: unknown;
  loading: boolean;
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
  authFiles?: AuthFileItem[];
  onRefresh?: () => Promise<void> | void;
  lastRefreshedAt?: Date | null;
  fixedHeight?: boolean;
  requestLogEnabled?: boolean;
  showAutoRefreshControls?: boolean;
  onFilteredStatsChange?: (stats: RequestEventsFilteredStats) => void;
}

const AUTO_REFRESH_OFF = 'off';
const AUTO_REFRESH_CUSTOM = 'custom';
const AUTO_REFRESH_INTERVALS = {
  '15s': 15_000,
  '30s': 30_000,
  '1m': 60_000,
  '5m': 300_000,
} as const;
const MIN_CUSTOM_AUTO_REFRESH_SECONDS = 5;
const MAX_CUSTOM_AUTO_REFRESH_SECONDS = 3600;
const DEFAULT_CUSTOM_AUTO_REFRESH_SECONDS = 60;

type AutoRefreshValue =
  | keyof typeof AUTO_REFRESH_INTERVALS
  | typeof AUTO_REFRESH_OFF
  | typeof AUTO_REFRESH_CUSTOM;

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const firstText = (...values: Array<unknown>): string => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = typeof value === 'string' ? value.trim() : String(value).trim();
    if (text) return text;
  }
  return '';
};

const shortHash = (hash: string): string => {
  const normalized = hash.trim().toLowerCase();
  if (!normalized) return '';
  return normalized.length > 16 ? `${normalized.slice(0, 12)}...` : normalized;
};

const API_KEY_EDGE_VISIBLE_CHARS = 10;
const API_KEY_MASK_TEXT = '**********';

const maskRequestEventApiKey = (apiKey: string): string => {
  const trimmed = apiKey.trim();
  if (!trimmed) return '';

  if (trimmed.length <= API_KEY_EDGE_VISIBLE_CHARS * 2) {
    const visibleChars = trimmed.length < 4 ? 1 : 2;
    const start = trimmed.slice(0, visibleChars);
    const end = trimmed.slice(-visibleChars);
    return `${start}${API_KEY_MASK_TEXT}${end}`;
  }

  return `${trimmed.slice(0, API_KEY_EDGE_VISIBLE_CHARS)}${API_KEY_MASK_TEXT}${trimmed.slice(-API_KEY_EDGE_VISIBLE_CHARS)}`;
};

const formatCredentialKeyLine = (row: Pick<RequestEventRow, 'credentialSubtitle' | 'authFile' | 'authLabel'>): string => {
  if (row.credentialSubtitle) return row.credentialSubtitle;
  if (row.authFile && row.authFile !== '-') return row.authFile;
  if (row.authLabel && row.authLabel !== '-') return row.authLabel;
  return '-';
};

const renderCredentialSubtitle = (
  row: Pick<RequestEventRow, 'credentialSubtitle' | 'authFile' | 'authLabel' | 'resolvedApiKey'>,
  styles: Record<string, string>,
  onCopyApiKey: (apiKey: string) => void,
  copyTitle: string
) => {
  const text = formatCredentialKeyLine(row);
  if (!text || text === '-') return '-';

  if (row.resolvedApiKey) {
    const maskedApiKey = maskRequestEventApiKey(row.resolvedApiKey);
    return (
      <button
        type="button"
        className={styles.requestEventsCredentialKeyButton}
        onClick={() => onCopyApiKey(row.resolvedApiKey)}
        title={copyTitle}
        aria-label={copyTitle}
      >
        {maskedApiKey}
      </button>
    );
  }

  return text;
};

const normalizeCustomAutoRefreshSeconds = (value: unknown): number => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CUSTOM_AUTO_REFRESH_SECONDS;
  }
  return Math.min(Math.max(parsed, MIN_CUSTOM_AUTO_REFRESH_SECONDS), MAX_CUSTOM_AUTO_REFRESH_SECONDS);
};

const normalizeThinkingText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const formatThinkingLabel = (thinking: UsageThinking | null): string => {
  if (!thinking) return '-';

  const intensity = normalizeThinkingText(thinking.intensity);
  const level = normalizeThinkingText(thinking.level);
  const mode = normalizeThinkingText(thinking.mode);
  const budget =
    typeof thinking.budget === 'number' && Number.isFinite(thinking.budget)
      ? thinking.budget
      : null;
  const label = intensity || level || (budget !== null ? String(budget) : mode);
  const budgetLabel = budget !== null ? budget.toLocaleString() : null;

  if (!label) return '-';
  if (budgetLabel !== null && label === String(budget)) {
    return budgetLabel;
  }
  if (mode === 'budget' && budget !== null && budget > 0) {
    return `${label} (${budgetLabel})`;
  }
  if (budget === -1 && label !== 'auto') {
    return `${label} (-1)`;
  }
  return label;
};

const formatCacheHitRatio = (ratio: number | null): string => {
  if (ratio === null) return '--';
  return `${(ratio * 100).toFixed(1)}%`;
};

const formatEndpointHeadline = (method: string, path: string): string => {
  const pathText = path.trim() || '-';
  const methodText = method.trim();
  return methodText ? `${methodText} ${pathText}` : pathText;
};

const formatEndpointSubline = (headline: string, endpoint: string): string | null => {
  const normalizedHeadline = headline.trim();
  const normalizedEndpoint = endpoint.trim();
  if (!normalizedEndpoint || normalizedEndpoint === '-') return null;
  if (normalizedEndpoint.toLowerCase() === normalizedHeadline.toLowerCase()) return null;
  return normalizedEndpoint;
};

const encodeCsv = (value: string | number): string => {
  const text = String(value ?? '');
  const trimmedLeft = text.replace(/^\s+/, '');
  const safeText = trimmedLeft && /^[=+\-@]/.test(trimmedLeft) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
};

export function RequestEventsDetailsCard({
  usage,
  loading,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
  authFiles,
  onRefresh,
  lastRefreshedAt,
  fixedHeight = false,
  requestLogEnabled = false,
  showAutoRefreshControls = true,
  onFilteredStatsChange,
}: RequestEventsDetailsCardProps) {
  const { t, i18n } = useTranslation();
  const { showNotification } = useNotificationStore();

  const [search, setSearch] = useState('');
  const [timeRange, setTimeRange] = useState<UsageTimeRange>('all');
  const [modelFilter, setModelFilter] = useState(ALL_FILTER);
  const [providerFilter, setProviderFilter] = useState(ALL_FILTER);
  const [sourceFilter, setSourceFilter] = useState(ALL_FILTER);
  const [apiKeyFilter, setApiKeyFilter] = useState(ALL_FILTER);
  const [resultFilter, setResultFilter] = useState(ALL_FILTER);
  const [autoRefreshValue, setAutoRefreshValue] = useState<AutoRefreshValue>(AUTO_REFRESH_OFF);
  const [customAutoRefreshSeconds, setCustomAutoRefreshSeconds] = useState(
    DEFAULT_CUSTOM_AUTO_REFRESH_SECONDS.toString()
  );
  const [localAuthFiles, setLocalAuthFiles] = useState<AuthFileItem[]>([]);
  const [selectedFailureRow, setSelectedFailureRow] = useState<RequestEventRow | null>(null);
  const [downloadingRequestId, setDownloadingRequestId] = useState('');
  const [nextRefreshAtMs, setNextRefreshAtMs] = useState<number | null>(null);
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());

  const resolvedAuthFiles = authFiles ?? localAuthFiles;

  const refreshAuthFiles = useCallback(async () => {
    if (authFiles) return;
    try {
      const res = await authFilesApi.list();
      const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
      if (!Array.isArray(files)) return;
      setLocalAuthFiles(files);
    } catch {
      // Ignore auth file refresh failures.
    }
  }, [authFiles]);

  useEffect(() => {
    if (authFiles) return;
    void refreshAuthFiles();
  }, [authFiles, refreshAuthFiles]);

  useEffect(() => {
    if (authFiles || !lastRefreshedAt) {
      return;
    }
    void refreshAuthFiles();
  }, [authFiles, lastRefreshedAt, refreshAuthFiles]);

  const authFileMap = useMemo(() => {
    const map = new Map<string, CredentialInfo>();
    resolvedAuthFiles.forEach((file) => {
      const key = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
      if (!key) return;
      map.set(key, {
        name: file.name || key,
        type: (file.type || file.provider || '').toString(),
        statusMessage: getAuthFileStatusMessage(file),
      });
    });
    return map;
  }, [resolvedAuthFiles]);

  const sourceInfoMap = useMemo(
    () =>
      buildSourceInfoMap({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProviders,
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs]
  );

  const credentialLookup = useMemo(
    () =>
      buildConfiguredCredentialLookup({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProviders,
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs]
  );

  const autoRefreshOptions = useMemo(
    () => [
      { value: AUTO_REFRESH_OFF, label: t('monitoring_center.auto_refresh_off') },
      { value: '15s', label: '15s' },
      { value: '30s', label: '30s' },
      { value: '1m', label: '1m' },
      { value: '5m', label: '5m' },
      { value: AUTO_REFRESH_CUSTOM, label: t('monitoring_center.auto_refresh_custom') }
    ],
    [t]
  );
  const normalizedCustomAutoRefreshSeconds = useMemo(
    () => normalizeCustomAutoRefreshSeconds(customAutoRefreshSeconds),
    [customAutoRefreshSeconds]
  );
  const autoRefreshDelay = useMemo(() => {
    if (!onRefresh || autoRefreshValue === AUTO_REFRESH_OFF) {
      return null;
    }
    if (autoRefreshValue === AUTO_REFRESH_CUSTOM) {
      return normalizedCustomAutoRefreshSeconds * 1000;
    }
    return AUTO_REFRESH_INTERVALS[autoRefreshValue];
  }, [autoRefreshValue, normalizedCustomAutoRefreshSeconds, onRefresh]);

  useEffect(() => {
    if (!autoRefreshDelay) {
      setNextRefreshAtMs(null);
      return;
    }

    const now = Date.now();
    setCountdownNowMs(now);

    const nextFromRefresh = lastRefreshedAt ? lastRefreshedAt.getTime() + autoRefreshDelay : null;
    const nextRefreshAt =
      nextFromRefresh && nextFromRefresh > now ? nextFromRefresh : now + autoRefreshDelay;

    setNextRefreshAtMs(nextRefreshAt);
  }, [autoRefreshDelay, lastRefreshedAt]);

  useInterval(() => {
    setCountdownNowMs(Date.now());
  }, autoRefreshDelay ? 1000 : null);

  const handleCustomAutoRefreshSecondsChange = useCallback((value: string) => {
    setCustomAutoRefreshSeconds(value.replace(/\D/g, ''));
  }, []);

  const handleCustomAutoRefreshSecondsBlur = useCallback(() => {
    setCustomAutoRefreshSeconds(normalizeCustomAutoRefreshSeconds(customAutoRefreshSeconds).toString());
  }, [customAutoRefreshSeconds]);

  useInterval(() => {
    if (!onRefresh || loading || !autoRefreshDelay) return;
    setNextRefreshAtMs(Date.now() + autoRefreshDelay);
    void onRefresh();
  }, autoRefreshDelay);

  const autoRefreshCountdown =
    autoRefreshDelay && nextRefreshAtMs
      ? Math.max(0, Math.ceil((nextRefreshAtMs - countdownNowMs) / 1000))
      : null;

  const openaiProviderNames = useMemo(
    () => openaiProviders.map((item) => item.name).filter(Boolean),
    [openaiProviders]
  );

  const rows = useMemo<RequestEventRow[]>(() => {
    const details = collectUsageDetailsWithEndpoint(usage);

    const baseRows = details.map((detail, index) => {
      const timestamp = detail.timestamp;
      const timestampMs =
        typeof detail.__timestampMs === 'number' && detail.__timestampMs > 0
          ? detail.__timestampMs
          : parseTimestampMs(timestamp);
      const date = Number.isNaN(timestampMs) ? null : new Date(timestampMs);
      const requestId = firstText(detail.request_id, detail.id);
      const usageProvider = firstText(detail.provider, detail.auth_provider_snapshot);
      const endpoint = firstText(detail.__endpoint) || '-';
      const endpointMethod = firstText(detail.__endpointMethod);
      const endpointPath = firstText(detail.__endpointPath) || endpoint;
      const sourceRaw = String(detail.source ?? '').trim();
      const authIndexRaw = detail.auth_index as unknown;
      const authIndex =
        authIndexRaw === null || authIndexRaw === undefined || authIndexRaw === ''
          ? '-'
          : String(authIndexRaw);
      const sourceInfo = resolveSourceDisplay(sourceRaw, authIndexRaw, sourceInfoMap, authFileMap);
      const source = sourceInfo.displayName;
      const sourceKey = sourceInfo.identityKey ?? `source:${sourceRaw || source}`;
      const sourceType = sourceInfo.type;
      const model = String(detail.__modelName ?? '').trim() || '-';
      const modelAlias = firstText(detail.model_alias);
      const inputTokens = Math.max(toNumber(detail.tokens?.input_tokens), 0);
      const outputTokens = Math.max(toNumber(detail.tokens?.output_tokens), 0);
      const reasoningTokens = Math.max(toNumber(detail.tokens?.reasoning_tokens), 0);
      const cachedTokens = Math.max(
        Math.max(toNumber(detail.tokens?.cached_tokens), 0),
        Math.max(toNumber(detail.tokens?.cache_tokens), 0)
      );
      const totalTokens = Math.max(
        toNumber(detail.tokens?.total_tokens),
        extractTotalTokens(detail)
      );
      const backendId = typeof detail.id === 'string' && detail.id.trim() ? detail.id.trim() : '';
      const apiKeyHash = firstText(detail.api_key_hash);
      const authType = firstText(detail.auth_type) || '-';
      const resolvedCredential = resolveConfiguredCredential(credentialLookup, {
        authIndex: authIndexRaw,
        apiKeyHash,
        source: sourceRaw,
      });
      const authIndexKey = normalizeAuthIndex(authIndexRaw);
      const authFileInfo = authIndexKey ? authFileMap.get(authIndexKey) : undefined;
      const credentialDisplay = buildCredentialDisplay({
        accountSnapshot: firstText(detail.account_snapshot),
        authLabelSnapshot: firstText(detail.auth_label_snapshot),
        authFileSnapshot: firstText(detail.auth_file_snapshot),
        authIndex,
        authType,
        source,
        resolvedCredential,
      });
      const providerColumn = resolveProviderModelColumnDisplay({
        usageProvider,
        resolvedCredential,
        sourceType: sourceInfo.type,
        sourceIdentityKey: sourceInfo.identityKey,
        authFileType: authFileInfo?.type,
        openaiProviderNames,
        sourceDisplayName: sourceInfo.requestDisplayName,
      });
      const firstByteLatencyMs = extractFirstByteLatencyMs(detail);
      const generationMs = extractGenerationMs(detail);
      const latencyMs =
        typeof detail.latency_ms === 'number' && Number.isFinite(detail.latency_ms)
          ? detail.latency_ms
          : null;
      const tps = generationMs && generationMs > 0 ? outputTokens / (generationMs / 1000) : null;
      const thinking = detail.thinking ?? null;
      const thinkingEffort = normalizeThinkingText(detail.thinking_effort);
      const thinkingLabel = thinkingEffort || formatThinkingLabel(thinking);
      const cacheHitRatio = computeCacheHitRatio(inputTokens, cachedTokens);

      return {
        id: backendId || `${timestamp}-${model}-${sourceKey}-${authIndex}-${index}`,
        timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: date ? date.toLocaleString(i18n.language) : timestamp || '-',
        requestId,
        provider: providerColumn.headline,
        providerTag: providerColumn.tag,
        providerDisplayName: providerColumn.displayName,
        model,
        modelAlias,
        endpoint,
        endpointMethod,
        endpointPath,
        sourceKey,
        sourceRaw: sourceRaw || '-',
        source,
        sourceType,
        authIndex,
        authType,
        account: credentialDisplay.headline,
        credentialBadge: credentialDisplay.badge,
        authLabel: firstText(detail.auth_label_snapshot) || '-',
        authFile: firstText(detail.auth_file_snapshot) || '-',
        resolvedApiKey: credentialDisplay.resolvedApiKey,
        credentialSubtitle: credentialDisplay.subtitle,
        apiKeyHash,
        apiKeyHashShort: shortHash(apiKeyHash) || '-',
        failed: detail.failed === true,
        firstByteLatencyMs,
        generationMs,
        latencyMs,
        tps,
        thinking,
        thinkingLabel,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cachedTokens,
        totalTokens,
        cacheHitRatio,
      };
    });

    const sourceLabelKeyMap = new Map<string, Set<string>>();
    baseRows.forEach((row) => {
      const keys = sourceLabelKeyMap.get(row.source) ?? new Set<string>();
      keys.add(row.sourceKey);
      sourceLabelKeyMap.set(row.source, keys);
    });

    const buildDisambiguatedSourceLabel = (row: RequestEventRow) => {
      const labelKeyCount = sourceLabelKeyMap.get(row.source)?.size ?? 0;
      if (labelKeyCount <= 1) {
        return row.source;
      }

      if (row.authIndex !== '-') {
        return `${row.source} · ${row.authIndex}`;
      }

      if (row.sourceRaw !== '-' && row.sourceRaw !== row.source) {
        return `${row.source} · ${row.sourceRaw}`;
      }

      if (row.sourceType) {
        return `${row.source} · ${row.sourceType}`;
      }

      return `${row.source} · ${row.sourceKey}`;
    };

    return baseRows
      .map((row) => ({
        ...row,
        source: buildDisambiguatedSourceLabel(row),
      }))
      .sort((a, b) => b.timestampMs - a.timestampMs);
  }, [authFileMap, credentialLookup, i18n.language, openaiProviderNames, sourceInfoMap, usage]);

  const timeRangeOptions = useMemo(
    () =>
      REQUEST_EVENTS_TIME_RANGE_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t]
  );

  const timeFilteredRows = useMemo(() => {
    if (timeRange === 'all') return rows;

    const nowMs = Date.now();
    const startMs = nowMs - USAGE_TIME_RANGE_MS[timeRange];
    return rows.filter((row) => row.timestampMs >= startMs && row.timestampMs <= nowMs);
  }, [rows, timeRange]);

  const hasTimingData = useMemo(
    () => timeFilteredRows.some((row) => row.firstByteLatencyMs !== null || row.generationMs !== null),
    [timeFilteredRows]
  );

  const modelOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(
        new Set(
          timeFilteredRows.flatMap((row) =>
            [row.modelAlias, row.model].filter((value) => value && value !== '-')
          )
        )
      ).map((model) => ({
        value: model,
        label: model,
      })),
    ],
    [timeFilteredRows, t]
  );

  const providerOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(
        new Set(timeFilteredRows.map((row) => row.provider).filter((provider) => provider !== '-'))
      ).map((provider) => ({
        value: provider,
        label: provider,
      })),
    ],
    [timeFilteredRows, t]
  );

  const sourceOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    timeFilteredRows.forEach((row) => {
      if (!optionMap.has(row.sourceKey)) {
        optionMap.set(row.sourceKey, row.source);
      }
    });

    return [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(optionMap.entries()).map(([value, label]) => ({
        value,
        label,
      })),
    ];
  }, [timeFilteredRows, t]);

  const apiKeyOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    timeFilteredRows.forEach((row) => {
      if (!row.apiKeyHash) return;
      const label = row.resolvedApiKey || row.apiKeyHashShort;
      if (!optionMap.has(row.apiKeyHash)) {
        optionMap.set(row.apiKeyHash, label);
      }
    });

    return [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(optionMap.entries()).map(([value, label]) => ({
        value,
        label,
      })),
    ];
  }, [timeFilteredRows, t]);

  const resultOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      {
        value: RESULT_SUCCESS_FILTER,
        label: t('stats.success'),
        labelClassName: styles.requestEventsResultOptionSuccess,
      },
      {
        value: RESULT_FAILURE_FILTER,
        label: t('stats.failure'),
        labelClassName: styles.requestEventsResultOptionFailure,
      },
    ],
    [t]
  );

  const modelOptionSet = useMemo(
    () => new Set(modelOptions.map((option) => option.value)),
    [modelOptions]
  );
  const providerOptionSet = useMemo(
    () => new Set(providerOptions.map((option) => option.value)),
    [providerOptions]
  );
  const sourceOptionSet = useMemo(
    () => new Set(sourceOptions.map((option) => option.value)),
    [sourceOptions]
  );
  const apiKeyOptionSet = useMemo(
    () => new Set(apiKeyOptions.map((option) => option.value)),
    [apiKeyOptions]
  );
  const resultOptionSet = useMemo(
    () => new Set(resultOptions.map((option) => option.value)),
    [resultOptions]
  );

  const effectiveModelFilter = modelOptionSet.has(modelFilter) ? modelFilter : ALL_FILTER;
  const effectiveProviderFilter = providerOptionSet.has(providerFilter) ? providerFilter : ALL_FILTER;
  const effectiveSourceFilter = sourceOptionSet.has(sourceFilter) ? sourceFilter : ALL_FILTER;
  const effectiveApiKeyFilter = apiKeyOptionSet.has(apiKeyFilter) ? apiKeyFilter : ALL_FILTER;
  const effectiveResultFilter = resultOptionSet.has(resultFilter) ? resultFilter : ALL_FILTER;
  const normalizedSearch = search.trim().toLowerCase();

  const filteredRows = useMemo(
    () =>
      timeFilteredRows.filter((row) => {
        const modelMatched =
          effectiveModelFilter === ALL_FILTER ||
          row.model === effectiveModelFilter ||
          row.modelAlias === effectiveModelFilter;
        const providerMatched =
          effectiveProviderFilter === ALL_FILTER || row.provider === effectiveProviderFilter;
        const sourceMatched =
          effectiveSourceFilter === ALL_FILTER || row.sourceKey === effectiveSourceFilter;
        const apiKeyMatched =
          effectiveApiKeyFilter === ALL_FILTER || row.apiKeyHash === effectiveApiKeyFilter;
        const resultMatched =
          effectiveResultFilter === ALL_FILTER ||
          (effectiveResultFilter === RESULT_FAILURE_FILTER ? row.failed : !row.failed);
        const searchMatched =
          !normalizedSearch ||
          [
            row.requestId,
            row.provider,
            row.providerTag,
            row.providerDisplayName,
            row.model,
            row.modelAlias,
            row.endpoint,
            row.endpointMethod,
            row.endpointPath,
            row.account,
            row.authIndex,
            row.authType,
            row.authLabel,
            row.authFile,
            row.resolvedApiKey,
            row.credentialSubtitle,
            row.source,
            row.sourceRaw,
            row.apiKeyHash,
            row.apiKeyHashShort,
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalizedSearch);

        return (
          modelMatched &&
          providerMatched &&
          sourceMatched &&
          apiKeyMatched &&
          resultMatched &&
          searchMatched
        );
      }),
    [
      effectiveApiKeyFilter,
      effectiveModelFilter,
      effectiveProviderFilter,
      effectiveResultFilter,
      effectiveSourceFilter,
      normalizedSearch,
      timeFilteredRows,
    ]
  );

  const filteredSuccessRate = useMemo(() => {
    if (filteredRows.length === 0) return null;
    const failedCount = filteredRows.filter((row) => row.failed).length;
    return ((filteredRows.length - failedCount) / filteredRows.length) * 100;
  }, [filteredRows]);

  const renderedRows = useMemo(() => filteredRows.slice(0, MAX_RENDERED_EVENTS), [filteredRows]);

  const hasActiveFilters =
    timeRange !== 'all' ||
    normalizedSearch !== '' ||
    effectiveModelFilter !== ALL_FILTER ||
    effectiveProviderFilter !== ALL_FILTER ||
    effectiveSourceFilter !== ALL_FILTER ||
    effectiveApiKeyFilter !== ALL_FILTER ||
    effectiveResultFilter !== ALL_FILTER;

  const handleClearFilters = () => {
    setTimeRange('all');
    setSearch('');
    setModelFilter(ALL_FILTER);
    setProviderFilter(ALL_FILTER);
    setSourceFilter(ALL_FILTER);
    setApiKeyFilter(ALL_FILTER);
    setResultFilter(ALL_FILTER);
  };

  const handleExportCsv = () => {
    if (!filteredRows.length) return;

    const csvHeader = [
      'timestamp',
      'request_id',
      'provider',
      'model_alias',
      'model',
      'endpoint',
      'source',
      'source_raw',
      'credential',
      'credential_api_key',
      'auth_type',
      'auth_index',
      'api_key_hash',
      'result',
      ...(hasTimingData ? ['first_byte_latency_ms', 'generation_ms', 'tps'] : []),
      'thinking_effort',
      'input_tokens',
      'output_tokens',
      'reasoning_tokens',
      'cached_tokens',
      'total_tokens',
      'cache_hit_ratio',
    ];

    const csvRows = filteredRows.map((row) =>
      [
        row.timestamp,
        row.requestId,
        row.provider,
        row.modelAlias,
        row.model,
        row.endpoint,
        row.source,
        row.sourceRaw,
        row.account,
        row.resolvedApiKey,
        row.authType,
        row.authIndex,
        row.apiKeyHash,
        row.failed ? 'failed' : 'success',
        ...(hasTimingData
          ? [
              row.firstByteLatencyMs ?? '',
              row.generationMs ?? '',
              row.tps !== null ? row.tps.toFixed(2) : '',
            ]
          : []),
        row.thinkingLabel === '-' ? '' : row.thinkingLabel,
        row.inputTokens,
        row.outputTokens,
        row.reasoningTokens,
        row.cachedTokens,
        row.totalTokens,
        row.cacheHitRatio !== null ? row.cacheHitRatio.toFixed(4) : '',
      ]
        .map((value) => encodeCsv(value))
        .join(',')
    );

    const content = [csvHeader.join(','), ...csvRows].join('\n');
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.csv`,
      blob: new Blob([content], { type: 'text/csv;charset=utf-8' }),
    });
  };

  const handleExportJson = () => {
    if (!filteredRows.length) return;

    const payload = filteredRows.map((row) => ({
      timestamp: row.timestamp,
      request_id: row.requestId,
      provider: row.provider,
      model: row.model,
      endpoint: row.endpoint,
      source: row.source,
      source_raw: row.sourceRaw,
      credential: row.account,
      credential_api_key: row.resolvedApiKey || undefined,
      auth_type: row.authType,
      auth_index: row.authIndex,
      api_key_hash: row.apiKeyHash,
      failed: row.failed,
      ...(hasTimingData && row.firstByteLatencyMs !== null
        ? { first_byte_latency_ms: row.firstByteLatencyMs }
        : {}),
      ...(hasTimingData && row.generationMs !== null ? { generation_ms: row.generationMs } : {}),
      ...(hasTimingData && row.tps !== null ? { tps: row.tps } : {}),
      ...(row.thinkingLabel !== '-' ? { thinking_effort: row.thinkingLabel } : {}),
      tokens: {
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        reasoning_tokens: row.reasoningTokens,
        cached_tokens: row.cachedTokens,
        total_tokens: row.totalTokens,
      },
      ...(row.cacheHitRatio !== null ? { cache_hit_ratio: row.cacheHitRatio } : {}),
    }));

    const content = JSON.stringify(payload, null, 2);
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.json`,
      blob: new Blob([content], { type: 'application/json;charset=utf-8' }),
    });
  };

  const handleCloseFailureModal = useCallback(() => {
    setSelectedFailureRow(null);
  }, []);

  const handleDownloadRequestLog = useCallback(
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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        showNotification(
          `${t('request_monitoring.download_failed')}${message ? `: ${message}` : ''}`,
          'error'
        );
      } finally {
        setDownloadingRequestId('');
      }
    },
    [showNotification, t]
  );

  const handleCopyCredentialApiKey = useCallback(
    async (apiKey: string) => {
      const copied = await copyToClipboard(apiKey);
      showNotification(
        t(copied ? 'usage_stats.request_events_api_key_copied' : 'notification.copy_failed'),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const selectedCredentialInfo = useMemo(() => {
    if (!selectedFailureRow) return null;
    const normalizedAuthIndex = normalizeAuthIndex(selectedFailureRow.authIndex);
    if (!normalizedAuthIndex) return null;
    return authFileMap.get(normalizedAuthIndex) ?? null;
  }, [authFileMap, selectedFailureRow]);
  const selectedFailureMessage = selectedCredentialInfo?.statusMessage?.trim() || '';

  const exportCsvRef = useRef(handleExportCsv);
  const exportJsonRef = useRef(handleExportJson);
  exportCsvRef.current = handleExportCsv;
  exportJsonRef.current = handleExportJson;

  useEffect(() => {
    if (!onFilteredStatsChange) return;
    onFilteredStatsChange({
      count: filteredRows.length,
      successRate: filteredSuccessRate,
      canExport: filteredRows.length > 0,
      exportCsv: () => exportCsvRef.current(),
      exportJson: () => exportJsonRef.current(),
    });
  }, [filteredRows.length, filteredSuccessRate, onFilteredStatsChange]);

  return (
    <div
      className={`${styles.requestEventsRoot} ${fixedHeight ? styles.requestEventsFixedRoot : ''}`.trim()}
    >
      <div className={styles.requestEventsToolbar}>
        <div
          className={`${styles.requestEventsFilterItem} ${styles.requestEventsResultFilterItem}`}
        >
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_result')}
          </span>
          <Select
            value={effectiveResultFilter}
            options={resultOptions}
            onChange={setResultFilter}
            className={`${styles.requestEventsSelect} ${styles.requestEventsResultSelect}`}
            ariaLabel={t('usage_stats.request_events_filter_result')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_time_range')}
          </span>
          <Select
            value={timeRange}
            options={timeRangeOptions}
            onChange={(value) => setTimeRange(value as UsageTimeRange)}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_time_range')}
            fullWidth={false}
          />
        </div>
        <div className={`${styles.requestEventsFilterItem} ${styles.requestEventsSearchItem}`}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_search_label')}
          </span>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('usage_stats.request_events_search_placeholder')}
            rightElement={<IconSearch size={16} />}
            aria-label={t('usage_stats.request_events_search_placeholder')}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_provider')}
          </span>
          <Select
            value={effectiveProviderFilter}
            options={providerOptions}
            onChange={setProviderFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_provider')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_model')}
          </span>
          <Select
            value={effectiveModelFilter}
            options={modelOptions}
            onChange={setModelFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_model')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_source')}
          </span>
          <Select
            value={effectiveSourceFilter}
            options={sourceOptions}
            onChange={setSourceFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_source')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_api_key')}
          </span>
          <Select
            value={effectiveApiKeyFilter}
            options={apiKeyOptions}
            onChange={setApiKeyFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_api_key')}
            fullWidth={false}
          />
        </div>
        <div className={`${styles.requestEventsFilterItem} ${styles.requestEventsClearFilterItem}`}>
          <span className={styles.requestEventsFilterLabel} aria-hidden="true">
            {'\u00a0'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className={styles.requestEventsClearFilters}
            onClick={handleClearFilters}
            disabled={!hasActiveFilters}
          >
            {t('usage_stats.clear_filters')}
          </Button>
        </div>
        {onRefresh && showAutoRefreshControls && (
          <div className={styles.requestEventsFilterItem}>
            <span className={styles.requestEventsFilterLabelRow}>
              <span className={styles.requestEventsFilterLabel}>{t('monitoring_center.auto_refresh')}</span>
              {autoRefreshCountdown !== null && (
                <span className={styles.requestEventsCountdown}>
                  {t('monitoring_center.auto_refresh_countdown', { count: autoRefreshCountdown })}
                </span>
              )}
            </span>
            <div className={styles.requestEventsAutoRefreshControls}>
              <Select
                value={autoRefreshValue}
                options={autoRefreshOptions}
                onChange={(value) => setAutoRefreshValue(value as AutoRefreshValue)}
                className={styles.requestEventsSelect}
                ariaLabel={t('monitoring_center.auto_refresh')}
                fullWidth={false}
              />
              {autoRefreshValue === AUTO_REFRESH_CUSTOM && (
                <Input
                  type="text"
                  inputMode="numeric"
                  value={customAutoRefreshSeconds}
                  onChange={(event) => handleCustomAutoRefreshSecondsChange(event.target.value)}
                  onBlur={handleCustomAutoRefreshSecondsBlur}
                  className={styles.requestEventsAutoRefreshInput}
                  aria-label={t('monitoring_center.auto_refresh_custom_seconds')}
                  placeholder={normalizedCustomAutoRefreshSeconds.toString()}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {loading && rows.length === 0 ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_empty_title')}
          description={t('usage_stats.request_events_empty_desc')}
        />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_no_result_title')}
          description={t('usage_stats.request_events_no_result_desc')}
        />
      ) : (
        <>
          <div className={styles.requestEventsTableWrapper}>
            <table className={`${styles.table} ${styles.requestEventsTable}`}>
              <colgroup>
                <col className={styles.requestEventsTimeResultCol} />
                <col className={styles.requestEventsProviderModelCol} />
                <col className={styles.requestEventsEndpointRequestCol} />
                <col className={styles.requestEventsCredentialCol} />
                <col className={styles.requestEventsUsageCol} />
                <col className={styles.requestEventsPerformanceCol} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('usage_stats.request_events_time_result')}</th>
                  <th>{t('usage_stats.request_events_provider_model')}</th>
                  <th>{t('usage_stats.request_events_endpoint_request')}</th>
                  <th>{t('usage_stats.request_events_credential')}</th>
                  <th>{t('usage_stats.request_events_usage')}</th>
                  <th>{t('usage_stats.request_events_performance')}</th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row) => {
                  const endpointHeadline = formatEndpointHeadline(row.endpointMethod, row.endpointPath);
                  const endpointSubline = formatEndpointSubline(endpointHeadline, row.endpoint);

                  return (
                  <tr key={row.id}>
                    <td title={row.timestamp} className={styles.requestEventsTimeResultCell}>
                      <div className={styles.requestEventsPrimaryText}>{row.timestampLabel}</div>
                      <div className={styles.requestEventsStatusLine}>
                        {row.failed ? (
                          <button
                            type="button"
                            className={`${styles.requestEventsResultFailed} ${styles.requestEventsResultButton}`}
                            onClick={() => setSelectedFailureRow(row)}
                            aria-label={t('usage_stats.request_events_failure_log_view')}
                          >
                            {t('stats.failure')}
                          </button>
                        ) : (
                          <span className={styles.requestEventsResultSuccess}>
                            {t('stats.success')}
                          </span>
                        )}
                        {row.cacheHitRatio !== null && (
                          <span className={styles.requestEventsCacheHitBadge}>
                            {t('usage_stats.request_events_cache_hit_short')}{' '}
                            {formatCacheHitRatio(row.cacheHitRatio)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={styles.requestEventsProviderModelCell}>
                      <div
                        className={styles.requestEventsPrimaryText}
                        title={
                          [row.provider !== '-' ? row.provider : '', row.modelAlias]
                            .filter(Boolean)
                            .join(' · ') || undefined
                        }
                      >
                        {row.providerTag ? (
                          <>
                            <span className={styles.requestEventsProviderTag}>{row.providerTag}</span>
                            {row.providerDisplayName ? (
                              <span className={styles.requestEventsProviderName}>
                                {row.providerDisplayName}
                              </span>
                            ) : null}
                            {row.modelAlias ? (
                              <span className={styles.requestEventsModelAliasTag}>{row.modelAlias}</span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            {row.providerDisplayName || row.provider}
                            {row.modelAlias ? (
                              <span className={styles.requestEventsModelAliasTag}>{row.modelAlias}</span>
                            ) : null}
                          </>
                        )}
                      </div>
                      <div
                        className={styles.requestEventsSecondaryText}
                        title={row.model !== '-' ? row.model : undefined}
                      >
                        {row.model}
                      </div>
                    </td>
                    <td
                      className={styles.requestEventsEndpointCell}
                      title={[row.endpoint, row.requestId].filter(Boolean).join(' · ')}
                    >
                      <div className={styles.requestEventsEndpointLine}>
                        {endpointHeadline}
                      </div>
                      {endpointSubline ? (
                        <div className={styles.requestEventsEndpointSubline}>{endpointSubline}</div>
                      ) : null}
                      <div className={styles.requestEventsRequestLine}>
                        <span className={styles.requestEventsRequestIdText}>
                          {row.requestId || '-'}
                        </span>
                        {requestLogEnabled && row.requestId && (
                          <Button
                            className={styles.requestEventsDownloadButton}
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDownloadRequestLog(row.requestId)}
                            loading={downloadingRequestId === row.requestId}
                            title={t('request_monitoring.download_request_log')}
                            aria-label={t('request_monitoring.download_request_log')}
                          >
                            <IconDownload size={14} />
                          </Button>
                        )}
                      </div>
                    </td>
                    <td className={styles.requestEventsCredentialCell}>
                      <div
                        className={styles.requestEventsPrimaryText}
                        title={[row.account, row.credentialBadge].filter(Boolean).join(' · ') || undefined}
                      >
                        {row.account}
                        {row.credentialBadge ? (
                          <span className={styles.credentialType}>{row.credentialBadge}</span>
                        ) : null}
                      </div>
                      <div
                        className={styles.requestEventsSecondaryText}
                        title={
                          row.resolvedApiKey
                            ? t('usage_stats.request_events_api_key_copy_title')
                            : formatCredentialKeyLine(row)
                        }
                      >
                        {renderCredentialSubtitle(
                          row,
                          styles,
                          handleCopyCredentialApiKey,
                          t('usage_stats.request_events_api_key_copy_title')
                        )}
                      </div>
                    </td>
                    <td className={styles.requestEventsUsageCell}>
                      <div className={styles.requestEventsMetricHeadline}>
                        <span className={styles.requestEventsMetricLabel}>
                          {t('usage_stats.request_events_total_short')}
                        </span>
                        <span className={styles.requestEventsMetricValue}>
                          {row.totalTokens.toLocaleString()}
                        </span>
                      </div>
                      <div className={styles.requestEventsTokenPair}>
                        <span
                          className={`${styles.requestEventsTokenChip} ${styles.requestEventsTokenChipIn}`}
                          title={t('usage_stats.request_events_input_short')}
                        >
                          <span className={styles.requestEventsTokenChipLabel}>
                            {t('usage_stats.request_events_input_short')}
                          </span>
                          <span className={styles.requestEventsTokenChipValue}>
                            {row.inputTokens.toLocaleString()}
                          </span>
                        </span>
                        <span
                          className={`${styles.requestEventsTokenChip} ${styles.requestEventsTokenChipOut}`}
                          title={t('usage_stats.request_events_output_short')}
                        >
                          <span className={styles.requestEventsTokenChipLabel}>
                            {t('usage_stats.request_events_output_short')}
                          </span>
                          <span className={styles.requestEventsTokenChipValue}>
                            {row.outputTokens.toLocaleString()}
                          </span>
                        </span>
                      </div>
                      {(row.cachedTokens > 0 || row.reasoningTokens > 0) && (
                        <div className={styles.requestEventsMetricGrid}>
                          {row.cachedTokens > 0 && (
                            <span>
                              <span className={styles.requestEventsMetricLabel}>
                                {t('usage_stats.request_events_cached_short')}
                              </span>
                              <span className={styles.requestEventsMetricValue}>
                                {row.cachedTokens.toLocaleString()}
                              </span>
                            </span>
                          )}
                          {row.reasoningTokens > 0 && (
                            <span>
                              <span className={styles.requestEventsMetricLabel}>
                                {t('usage_stats.request_events_reasoning_short')}
                              </span>
                              <span className={styles.requestEventsMetricValue}>
                                {row.reasoningTokens.toLocaleString()}
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                      <div className={styles.requestEventsInlineBadges}>
                        {row.thinkingLabel !== '-' && (
                          <span
                            className={styles.requestEventsCompactBadge}
                            title={
                              row.thinking
                                ? [
                                    row.thinking.mode
                                      ? `${t('usage_stats.thinking_mode')}: ${row.thinking.mode}`
                                      : '',
                                    row.thinking.level
                                      ? `${t('usage_stats.thinking_level')}: ${row.thinking.level}`
                                      : '',
                                    typeof row.thinking.budget === 'number'
                                      ? `${t('usage_stats.thinking_budget')}: ${row.thinking.budget.toLocaleString()}`
                                      : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')
                                : undefined
                            }
                          >
                            {t('usage_stats.request_events_thinking_short')} {row.thinkingLabel}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={styles.requestEventsPerformanceCell}>
                      <div className={styles.requestEventsMetricHeadline}>
                        <span className={styles.requestEventsMetricLabel}>
                          {t('usage_stats.request_events_generation_short')}
                        </span>
                        <span className={styles.requestEventsMetricValue}>
                          {formatDurationMs(row.generationMs)}
                        </span>
                      </div>
                      <div className={styles.requestEventsMetricStack}>
                        <span>
                          <span className={styles.requestEventsMetricLabel}>
                            {t('usage_stats.request_events_first_byte_short')}
                          </span>
                          <span className={styles.requestEventsMetricValue}>
                            {formatDurationMs(row.firstByteLatencyMs)}
                          </span>
                        </span>
                        <span>
                          <span className={styles.requestEventsMetricLabel}>
                            {t('usage_stats.request_events_tps')}
                          </span>
                          <span className={styles.requestEventsMetricValue}>
                            {row.tps !== null ? row.tps.toFixed(2) : '--'}
                          </span>
                        </span>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal
        open={selectedFailureRow !== null}
        title={t('usage_stats.request_events_failure_log_title')}
        onClose={handleCloseFailureModal}
        width={560}
      >
        {selectedFailureRow && (
          <div className={styles.requestEventsFailureModalBody}>
            <div className={styles.requestEventsFailureMeta}>
              <div>
                <span className={styles.requestEventsFailureMetaLabel}>
                  {t('usage_stats.request_events_failure_log_timestamp')}
                </span>
                <span className={styles.requestEventsFailureMetaValue}>
                  {selectedFailureRow.timestampLabel}
                </span>
              </div>
              <div>
                <span className={styles.requestEventsFailureMetaLabel}>
                  {t('usage_stats.request_events_failure_log_model')}
                </span>
                <span className={styles.requestEventsFailureMetaValue}>
                  {selectedFailureRow.modelAlias
                    ? `${selectedFailureRow.modelAlias} · ${selectedFailureRow.model}`
                    : selectedFailureRow.model}
                </span>
              </div>
            </div>

            {selectedCredentialInfo?.name && (
              <div className={styles.requestEventsFailureCredentialRow}>
                <span className={styles.requestEventsFailureMetaLabel}>
                  {t('usage_stats.request_events_failure_log_credential')}
                </span>
                <span className={styles.requestEventsFailureMetaValue}>{selectedCredentialInfo.name}</span>
              </div>
            )}

            <div className={styles.requestEventsFailureMessageBlock}>
              <div className={styles.requestEventsFailureMetaLabel}>
                {t('usage_stats.request_events_failure_log_message_label')}
              </div>
              <div className={styles.requestEventsFailureMessage}>
                {selectedFailureMessage || t('usage_stats.request_events_failure_log_empty')}
              </div>
            </div>

            <div className={styles.requestEventsFailureNote}>
              {t('usage_stats.request_events_failure_log_note')}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
