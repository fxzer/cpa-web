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
import {
  requestEventsApi,
  DEFAULT_REQUEST_EVENTS_PAGE_SIZE,
  REQUEST_EVENTS_PAGE_SIZE_OPTIONS,
  type RequestEventItem,
  type RequestEventsPagedResponse,
} from '@/services/api/requestEvents';
import { useNotificationStore } from '@/stores/useNotificationStore';
import type { GeminiKeyConfig, ProviderKeyConfig, OpenAIProviderConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import { RequestEventDetailModal } from '@/components/usage/RequestEventDetailModal';
import {
  buildConfiguredCredentialLookup,
  buildCredentialDisplay,
  resolveConfiguredCredential,
  resolveProviderModelColumnDisplay,
} from '@/utils/credentialResolver';
import { buildSourceInfoMap, resolveSourceDisplay, type SourceInfoMap } from '@/utils/sourceResolver';
import { formatRelativeTime } from '@/utils/timestamp';
import { mapRequestEventToDetail } from '@/utils/requestEvents';
import {
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
const SEARCH_DEBOUNCE_MS = 300;

/** 搜索输入防抖：避免每次按键都触发服务端查询 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type RequestEventRow = {
  id: string;
  timestamp: string;
  timestampMs: number;
  timestampLabel: string;
  timestampRelative: string;
  requestId: string;
  provider: string;
  providerTag: string;
  providerDisplayName: string;
  /** 后端原始 provider 列值，用于服务端过滤 */
  originalProvider: string;
  model: string;
  modelAlias: string;
  endpoint: string;
  endpointMethod: string;
  endpointPath: string;
  sourceKey: string;
  sourceRaw: string;
  /** 后端 source_hash 值，用于服务端过滤 */
  sourceHash: string;
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

/** 全局聚合统计，由父页从 aggregate 接口获取后传入，用于页头与导出判定 */
export interface RequestEventsAggregateStats {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
}

export interface RequestEventsDetailsCardProps {
  /** 全局聚合统计（页头数值来源）。分页后表格只持有当页数据，全局统计由父页注入 */
  aggregate: RequestEventsAggregateStats | null;
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
  /** 表格无数据可显示时的加载状态上报，供父页用页面级 loading 覆盖首屏 */
  onTableLoadingChange?: (loading: boolean) => void;
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

const formatCredentialKeyLine = (
  row: Pick<RequestEventRow, 'credentialSubtitle' | 'authFile' | 'authLabel'>
): string => {
  if (row.credentialSubtitle) return row.credentialSubtitle;
  if (row.authFile && row.authFile !== '-') return row.authFile;
  if (row.authLabel && row.authLabel !== '-') return row.authLabel;
  return '-';
};

const buildModelRouteDisplay = (row: Pick<RequestEventRow, 'model' | 'modelAlias'>) => {
  const requestedModel = row.modelAlias || row.model;
  const upstreamModel = row.model;
  const showRoute =
    Boolean(row.modelAlias) && upstreamModel !== '-' && row.modelAlias !== upstreamModel;

  return {
    requestedModel,
    upstreamModel,
    showRoute,
    title: showRoute ? `${requestedModel} -> ${upstreamModel}` : requestedModel,
  };
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
  return Math.min(
    Math.max(parsed, MIN_CUSTOM_AUTO_REFRESH_SECONDS),
    MAX_CUSTOM_AUTO_REFRESH_SECONDS
  );
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

/** 解析单个 RequestEventItem 为展示行。rows memo 与导出共用，避免逻辑重复。 */
interface BuildRowDeps {
  sourceInfoMap: SourceInfoMap;
  authFileMap: Map<string, CredentialInfo>;
  credentialLookup: ReturnType<typeof buildConfiguredCredentialLookup>;
  openaiProviderNames: string[];
  language: string;
}

function buildRequestEventRow(
  item: RequestEventItem,
  index: number,
  deps: BuildRowDeps
): RequestEventRow {
  const { sourceInfoMap, authFileMap, credentialLookup, openaiProviderNames, language } = deps;
  const detail = mapRequestEventToDetail(item);
  const timestamp = detail.timestamp;
  const timestampMs =
    typeof detail.__timestampMs === 'number' && detail.__timestampMs > 0 ? detail.__timestampMs : 0;
  const date = Number.isNaN(timestampMs) || timestampMs <= 0 ? null : new Date(timestampMs);
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
  const totalTokens = Math.max(toNumber(detail.tokens?.total_tokens), extractTotalTokens(detail));
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
    timestampMs,
    timestampLabel: date ? date.toLocaleString(language) : timestamp || '-',
    timestampRelative: date ? formatRelativeTime(date, language) : timestamp || '-',
    requestId,
    provider: providerColumn.headline,
    providerTag: providerColumn.tag,
    providerDisplayName: providerColumn.displayName,
    originalProvider: usageProvider,
    model,
    modelAlias,
    endpoint,
    endpointMethod,
    endpointPath,
    sourceKey,
    sourceRaw: sourceRaw || '-',
    sourceHash: item.source_hash ?? '',
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
}

export function RequestEventsDetailsCard({
  aggregate,
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
  onTableLoadingChange,
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
  // 分页与服务端过滤相关状态
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_REQUEST_EVENTS_PAGE_SIZE);
  const [pagedItems, setPagedItems] = useState<RequestEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [autoRefreshValue, setAutoRefreshValue] = useState<AutoRefreshValue>(AUTO_REFRESH_OFF);
  const [customAutoRefreshSeconds, setCustomAutoRefreshSeconds] = useState(
    DEFAULT_CUSTOM_AUTO_REFRESH_SECONDS.toString()
  );
  const [localAuthFiles, setLocalAuthFiles] = useState<AuthFileItem[]>([]);
  const [selectedFailureRow, setSelectedFailureRow] = useState<RequestEventRow | null>(null);
  const [selectedDetailRowId, setSelectedDetailRowId] = useState<string | null>(null);
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
      { value: AUTO_REFRESH_CUSTOM, label: t('monitoring_center.auto_refresh_custom') },
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

  useInterval(
    () => {
      setCountdownNowMs(Date.now());
    },
    autoRefreshDelay ? 1000 : null
  );

  const handleCustomAutoRefreshSecondsChange = useCallback((value: string) => {
    setCustomAutoRefreshSeconds(value.replace(/\D/g, ''));
  }, []);

  const handleCustomAutoRefreshSecondsBlur = useCallback(() => {
    setCustomAutoRefreshSeconds(
      normalizeCustomAutoRefreshSeconds(customAutoRefreshSeconds).toString()
    );
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
    // 数据来自服务端分页接口返回的当页 items，不再从全量 usage 派生。
    // 过滤/排序已下推到后端，这里只做展示字段的解析与凭据映射。
    const rowDeps: BuildRowDeps = {
      sourceInfoMap,
      authFileMap,
      credentialLookup,
      openaiProviderNames,
      language: i18n.language,
    };
    const baseRows = pagedItems.map((item, index) => buildRequestEventRow(item, index, rowDeps));

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

    return baseRows.map((row) => ({
      ...row,
      source: buildDisambiguatedSourceLabel(row),
    }));
  }, [authFileMap, credentialLookup, i18n.language, openaiProviderNames, pagedItems, sourceInfoMap]);

  const timeRangeOptions = useMemo(
    () =>
      REQUEST_EVENTS_TIME_RANGE_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t]
  );

  // hasTimingData 仅取决于当页是否有延迟字段（用于导出列与表格性能列展示）
  const hasTimingData = useMemo(
    () => rows.some((row) => row.firstByteLatencyMs !== null || row.generationMs !== null),
    [rows]
  );

  // 过滤下拉选项改为来自后端 distinct 接口（取全局去重值），不再依赖当页数据。
  // 这样即使某 model 不在当前页，用户仍能在下拉里选到。
  const [distinctModels, setDistinctModels] = useState<string[]>([]);
  const [distinctProviders, setDistinctProviders] = useState<string[]>([]);
  const [distinctSourceHashes, setDistinctSourceHashes] = useState<string[]>([]);
  const [distinctApiKeyHashes, setDistinctApiKeyHashes] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      requestEventsApi.distinct('model').catch(() => ({ values: [] as string[] })),
      requestEventsApi.distinct('provider').catch(() => ({ values: [] as string[] })),
      requestEventsApi.distinct('source_hash').catch(() => ({ values: [] as string[] })),
      requestEventsApi.distinct('api_key_hash').catch(() => ({ values: [] as string[] })),
    ]).then(([models, providers, sources, apiKeys]) => {
      if (cancelled) return;
      setDistinctModels(models.values ?? []);
      setDistinctProviders(providers.values ?? []);
      setDistinctSourceHashes(sources.values ?? []);
      setDistinctApiKeyHashes(apiKeys.values ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 当页行的 sourceHash→source 显示名 映射，用于 source 下拉的 label（distinct 只返回 hash）
  const sourceLabelByHash = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => {
      if (row.sourceHash && !map.has(row.sourceHash)) {
        map.set(row.sourceHash, row.source);
      }
    });
    return map;
  }, [rows]);
  const apiKeyLabelByHash = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => {
      if (row.apiKeyHash && !map.has(row.apiKeyHash)) {
        map.set(row.apiKeyHash, row.resolvedApiKey || row.apiKeyHashShort);
      }
    });
    return map;
  }, [rows]);

  const modelOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...distinctModels
        .filter((value) => value && value !== '-')
        .map((model) => ({ value: model, label: model })),
    ],
    [distinctModels, t]
  );

  const providerOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...distinctProviders
        .filter((value) => value && value !== '-')
        .map((provider) => ({ value: provider, label: provider })),
    ],
    [distinctProviders, t]
  );

  const sourceOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...distinctSourceHashes
        .filter((value) => value)
        .map((hash) => ({
          value: hash,
          label: sourceLabelByHash.get(hash) ?? shortHash(hash),
        })),
    ],
    [distinctSourceHashes, sourceLabelByHash, t]
  );

  const apiKeyOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...distinctApiKeyHashes
        .filter((value) => value)
        .map((hash) => ({
          value: hash,
          label: apiKeyLabelByHash.get(hash) ?? shortHash(hash),
        })),
    ],
    [distinctApiKeyHashes, apiKeyLabelByHash, t]
  );

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

  // 服务端过滤值：source/apiKey 用后端原始 hash，model/provider/result 用原始值。
  const effectiveModelFilter = modelFilter;
  const effectiveProviderFilter = providerFilter;
  const effectiveSourceFilter = sourceFilter;
  const effectiveApiKeyFilter = apiKeyFilter;
  const effectiveResultFilter = resultFilter;
  const normalizedSearch = search.trim();
  const debouncedSearch = useDebouncedValue(normalizedSearch, SEARCH_DEBOUNCE_MS);

  // timeRange → 服务端时间窗（毫秒），下推到后端 WHERE。
  const timeWindowMs = useMemo(() => {
    if (timeRange === 'all') return null;
    return USAGE_TIME_RANGE_MS[timeRange];
  }, [timeRange]);

  // 构造发往后端的查询参数（过滤已下推，不再在前端过滤）。
  const queryParams = useMemo(() => {
    const nowMs = Date.now();
    const params: Parameters<typeof requestEventsApi.listPaged>[0] = {
      page,
      page_size: pageSize,
    };
    if (timeWindowMs && timeWindowMs > 0) {
      params.start = new Date(nowMs - timeWindowMs).toISOString();
    }
    if (effectiveModelFilter !== ALL_FILTER) params.model = effectiveModelFilter;
    if (effectiveProviderFilter !== ALL_FILTER) params.provider = effectiveProviderFilter;
    if (effectiveSourceFilter !== ALL_FILTER) params.source_hash = effectiveSourceFilter;
    if (effectiveApiKeyFilter !== ALL_FILTER) params.api_key_hash = effectiveApiKeyFilter;
    if (effectiveResultFilter === RESULT_SUCCESS_FILTER) params.result = 'success';
    else if (effectiveResultFilter === RESULT_FAILURE_FILTER) params.result = 'failure';
    if (debouncedSearch) params.search = debouncedSearch;
    return params;
  }, [
    page,
    pageSize,
    timeWindowMs,
    effectiveModelFilter,
    effectiveProviderFilter,
    effectiveSourceFilter,
    effectiveApiKeyFilter,
    effectiveResultFilter,
    debouncedSearch,
  ]);

  // 分页查询 effect：任一过滤/分页参数变化都重新拉取当页数据。
  const refreshKey = lastRefreshedAt?.getTime() ?? 0;
  useEffect(() => {
    let cancelled = false;
    setRowsLoading(true);
    requestEventsApi
      .listPaged(queryParams)
      .then((res: RequestEventsPagedResponse) => {
        if (cancelled) return;
        setPagedItems(res.items ?? []);
        setTotal(res.total ?? 0);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPagedItems([]);
        setTotal(0);
        const message = err instanceof Error ? err.message : '';
        showNotification(
          `${t('request_monitoring.error_load_failed')}${message ? `: ${message}` : ''}`,
          'error'
        );
      })
      .finally(() => {
        if (!cancelled) setRowsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryParams, refreshKey, showNotification, t]);

  // 首屏（当前无任何数据可显示）加载中时上报 true，让父页的页面级 loading 覆盖到表格首屏渲染完成，
  // 避免「loading 已结束但表格还没出来」时闪现空状态。已有数据时的翻页/刷新不上报，避免频繁弹 loading。
  const hasAnyData = total > 0 || pagedItems.length > 0;
  useEffect(() => {
    onTableLoadingChange?.(rowsLoading && !hasAnyData);
  }, [rowsLoading, hasAnyData, onTableLoadingChange]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handlePageSizeChange = useCallback((value: string) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    setPageSize(next);
    setPage(1);
  }, []);

  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(1, next), totalPages);
      setPage(clamped);
    },
    [totalPages]
  );

  const handleFilterChange = useCallback((setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  }, []);

  const handleTimeRangeChange = useCallback((value: string) => {
    setTimeRange(value as UsageTimeRange);
    setPage(1);
  }, []);

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
    setPage(1);
  };

  // 导出：分页后前端只持有当页数据，导出时按当前过滤条件循环拉取全部页拼成全集。
  const [exporting, setExporting] = useState(false);
  const buildCsvFromRows = useCallback(
    (exportRows: RequestEventRow[]) => {
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

      const csvRows = exportRows.map((row) =>
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
    },
    [hasTimingData]
  );

  const buildJsonFromRows = useCallback((exportRows: RequestEventRow[]) => {
    const payload = exportRows.map((row) => ({
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
  }, [hasTimingData]);

  // 按当前过滤条件（不含分页参数）循环拉取所有页，返回全集的展示行。
  const fetchAllFilteredRows = useCallback(async (): Promise<RequestEventRow[]> => {
    // 从 queryParams 中剥离分页参数，只保留过滤条件。
    const filterParams = { ...queryParams };
    delete (filterParams as { page?: number }).page;
    delete (filterParams as { page_size?: number }).page_size;
    const fetchSize = 100;
    let collected: RequestEventItem[] = [];
    let p = 1;
    // 安全上限，避免异常情况下无限循环。
    for (let guard = 0; guard < 1000; guard++) {
      const res = await requestEventsApi.listPaged({ ...filterParams, page: p, page_size: fetchSize });
      collected = collected.concat(res.items ?? []);
      if (collected.length >= (res.total ?? 0) || (res.items ?? []).length === 0) break;
      p += 1;
    }
    // 复用 buildRequestEventRow 解析全集，避免污染 pagedItems 这个 UI 状态。
    const rowDeps: BuildRowDeps = {
      sourceInfoMap,
      authFileMap,
      credentialLookup,
      openaiProviderNames,
      language: i18n.language,
    };
    return collected.map((item, index) => buildRequestEventRow(item, index, rowDeps));
  }, [queryParams, sourceInfoMap, authFileMap, credentialLookup, openaiProviderNames, i18n]);

  const handleExportCsv = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const exportRows = await fetchAllFilteredRows();
      if (!exportRows.length) return;
      buildCsvFromRows(exportRows);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('request_monitoring.error_load_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setExporting(false);
    }
  }, [exporting, fetchAllFilteredRows, buildCsvFromRows, showNotification, t]);

  const handleExportJson = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const exportRows = await fetchAllFilteredRows();
      if (!exportRows.length) return;
      buildJsonFromRows(exportRows);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('request_monitoring.error_load_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setExporting(false);
    }
  }, [exporting, fetchAllFilteredRows, buildJsonFromRows, showNotification, t]);

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

  // 分页后页头统计：count 用服务端过滤后总数 total，successRate 用父页注入的全局聚合。
  const filteredSuccessRate = useMemo(() => {
    if (!aggregate || aggregate.totalRequests <= 0) return null;
    return (aggregate.successCount / aggregate.totalRequests) * 100;
  }, [aggregate]);

  useEffect(() => {
    if (!onFilteredStatsChange) return;
    onFilteredStatsChange({
      count: total,
      successRate: filteredSuccessRate,
      canExport: total > 0,
      exportCsv: () => exportCsvRef.current(),
      exportJson: () => exportJsonRef.current(),
    });
  }, [total, filteredSuccessRate, onFilteredStatsChange]);

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
            onChange={handleFilterChange(setResultFilter)}
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
            onChange={handleTimeRangeChange}
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
            style={{ paddingRight: 28 }}
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
            onChange={handleFilterChange(setProviderFilter)}
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
            onChange={handleFilterChange(setModelFilter)}
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
            onChange={handleFilterChange(setSourceFilter)}
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
            onChange={handleFilterChange(setApiKeyFilter)}
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
              <span className={styles.requestEventsFilterLabel}>
                {t('monitoring_center.auto_refresh')}
              </span>
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

      {total === 0 ? (
        <EmptyState
          title={
            hasActiveFilters
              ? t('usage_stats.request_events_no_result_title')
              : t('usage_stats.request_events_empty_title')
          }
          description={
            hasActiveFilters
              ? t('usage_stats.request_events_no_result_desc')
              : t('usage_stats.request_events_empty_desc')
          }
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
                {rows.map((row) => {
                  const endpointHeadline = formatEndpointHeadline(
                    row.endpointMethod,
                    row.endpointPath
                  );
                  const endpointSubline = formatEndpointSubline(endpointHeadline, row.endpoint);
                  const modelRoute = buildModelRouteDisplay(row);

                  return (
                    <tr key={row.id}>
                      <td title={row.timestampLabel} className={styles.requestEventsTimeResultCell}>
                        <div className={styles.requestEventsPrimaryText}>{row.timestampRelative}</div>
                        <div className={styles.requestEventsStatusLine}>
                          {row.failed ? (
                            <button
                              type="button"
                              className={`${styles.requestEventsResultFailed} ${styles.requestEventsResultButton}`}
                              onClick={() => setSelectedDetailRowId(row.id)}
                              aria-label={t('usage_stats.request_events_failure_log_view')}
                            >
                              {t('stats.failure')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={`${styles.requestEventsResultSuccess} ${styles.requestEventsResultButton}`}
                              onClick={() => setSelectedDetailRowId(row.id)}
                              aria-label={t('usage_stats.request_events_detail_title')}
                            >
                              {t('stats.success')}
                            </button>
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
                            [row.providerTag, row.providerDisplayName || row.provider]
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                        >
                          {row.providerTag ? (
                            <>
                              <span className={styles.requestEventsProviderTag}>
                                {row.providerTag}
                              </span>
                              {row.providerDisplayName ? (
                                <span className={styles.requestEventsProviderName}>
                                  {row.providerDisplayName}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <>
                              {row.providerDisplayName || row.provider}
                            </>
                          )}
                        </div>
                        <div
                          className={`${styles.requestEventsSecondaryText} ${styles.requestEventsModelRouteLine}`}
                          title={modelRoute.title !== '-' ? modelRoute.title : undefined}
                        >
                          <span className={styles.requestEventsRequestedModel}>
                            {modelRoute.requestedModel}
                          </span>
                          {modelRoute.showRoute ? (
                            <>
                              <span className={styles.requestEventsModelRouteArrow}>-&gt;</span>
                              <span className={styles.requestEventsUpstreamModel}>
                                {modelRoute.upstreamModel}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td
                        className={styles.requestEventsEndpointCell}
                        title={[row.endpoint, row.requestId].filter(Boolean).join(' · ')}
                      >
                        <div className={styles.requestEventsEndpointLine}>{endpointHeadline}</div>
                        {endpointSubline ? (
                          <div className={styles.requestEventsEndpointSubline}>
                            {endpointSubline}
                          </div>
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
                          title={
                            [row.account, row.credentialBadge].filter(Boolean).join(' · ') ||
                            undefined
                          }
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
          <div className={styles.requestEventsPagination}>
            <div className={styles.requestEventsPageSize}>
              <Select
                value={String(pageSize)}
                options={REQUEST_EVENTS_PAGE_SIZE_OPTIONS.map((size) => ({
                  value: String(size),
                  label: `${size} / ${t('common.page', { defaultValue: '页' })}`,
                }))}
                onChange={handlePageSizeChange}
                className={styles.requestEventsPageSizeSelect}
                ariaLabel={t('usage_stats.request_events_page_size', {
                  defaultValue: '每页条数',
                })}
                fullWidth={false}
              />
            </div>
            <div className={styles.requestEventsPageInfo}>
              {t('usage_stats.request_events_page_info', {
                page,
                totalPages,
                total,
                defaultValue: `第 ${page} / ${totalPages} 页 · 共 ${total} 条`,
              })}
            </div>
            <div className={styles.requestEventsPageNav}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || rowsLoading}
              >
                {t('common.prev_page', { defaultValue: '上一页' })}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages || rowsLoading}
              >
                {t('common.next_page', { defaultValue: '下一页' })}
              </Button>
            </div>
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
                <span className={styles.requestEventsFailureMetaValue}>
                  {selectedCredentialInfo.name}
                </span>
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

      <RequestEventDetailModal
        eventId={selectedDetailRowId}
        onClose={() => setSelectedDetailRowId(null)}
      />
    </div>
  );
}
