/**
 * 使用统计相关工具
 * 迁移自基线 modules/usage.js 的纯逻辑部分
 */

import type { LatencyAccumulator } from './usage/latency';
import {
  addLatencySample,
  createLatencyAccumulator,
  extractLatencyMs,
  finalizeLatencyStats,
} from './usage/latency';
import { computeCacheHitRatio } from './usage/cacheHit';
import { maskApiKey } from './format';
import { parseTimestampMs } from './timestamp';

export { computeCacheHitRatio } from './usage/cacheHit';
export {
  LATENCY_SOURCE_FIELD,
  LATENCY_SOURCE_UNIT,
  extractLatencyMs,
  formatDurationMs,
} from './usage/latency';

export interface KeyStatBucket {
  success: number;
  failure: number;
}

export interface KeyStats {
  bySource: Record<string, KeyStatBucket>;
  byAuthIndex: Record<string, KeyStatBucket>;
}

export interface UsageThinking {
  intensity?: string;
  mode?: string;
  level?: string;
  budget?: number;
}

export interface RateStats {
  rpm: number;
  tpm: number;
  windowMinutes: number;
  requestCount: number;
  tokenCount: number;
}

export interface ModelPrice {
  prompt: number;
  completion: number;
  cache: number;
}

export interface UsageDetail {
  id?: string;
  request_id?: string;
  timestamp: string;
  provider?: string;
  source: string;
  auth_index: string | number | null;
  auth_type?: string;
  api_key_hash?: string;
  account_snapshot?: string;
  auth_label_snapshot?: string;
  auth_file_snapshot?: string;
  auth_provider_snapshot?: string;
  auth_snapshot_at_ms?: number;
  latency_ms?: number;
  first_byte_latency_ms?: number;
  generation_ms?: number;
  tokens: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    cached_tokens: number;
    cache_tokens?: number;
    total_tokens: number;
  };
  thinking?: UsageThinking | null;
  thinking_effort?: string;
  failed: boolean;
  /** 请求时使用的模型别名（如 mini / lite / std / pro） */
  model_alias?: string;
  __modelName?: string;
  __timestampMs?: number;
}

export interface UsageDetailWithEndpoint extends UsageDetail {
  __endpoint: string;
  __endpointMethod?: string;
  __endpointPath?: string;
  __timestampMs: number;
}

export interface UsageModelSnapshot {
  total_requests: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  details: UsageDetail[];
}

export interface UsageApiSnapshot {
  total_requests: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  models: Record<string, UsageModelSnapshot>;
}

export interface UsageStatsSnapshot {
  total_requests: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  apis: Record<string, UsageApiSnapshot>;
  requests_by_day: Record<string, number>;
  requests_by_hour: Record<string, number>;
  tokens_by_day: Record<string, number>;
  tokens_by_hour: Record<string, number>;
}

export interface UsageQueryRange {
  start?: string;
  end?: string;
}

export interface UsageDeleteResponse {
  deleted?: number;
  missing?: string[];
  [key: string]: unknown;
}

export interface ApiStats {
  endpoint: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  totalCost: number;
  models: Record<
    string,
    { requests: number; successCount: number; failureCount: number; tokens: number }
  >;
}

export interface ModelStatsSummary {
  model: string;
  requests: number;
  successCount: number;
  failureCount: number;
  tokens: number;
  cost: number;
  averageLatencyMs: number | null;
  averageFirstByteLatencyMs: number | null;
  averageTps: number | null;
  latencySampleCount: number;
  firstByteLatencySampleCount: number;
  tpsSampleCount: number;
}

export type UsageTimeRange = '5m' | '30m' | '1h' | '7h' | '24h' | '7d' | '30d' | 'all';

const TOKENS_PER_PRICE_UNIT = 1_000_000;
const MODEL_PRICE_STORAGE_KEY = 'cli-proxy-model-prices-v2';
const USAGE_ENDPOINT_METHOD_REGEX = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/i;
export const USAGE_TIME_RANGE_MS: Record<Exclude<UsageTimeRange, 'all'>, number> = {
  '5m': 5 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '7h': 7 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const getApisRecord = (usageData: unknown): Record<string, unknown> | null => {
  const usageRecord = isRecord(usageData) ? usageData : null;
  const apisRaw = usageRecord ? usageRecord.apis : null;
  return isRecord(apisRaw) ? apisRaw : null;
};

const normalizeUsageThinking = (value: unknown): UsageThinking | null => {
  if (!isRecord(value)) {
    return null;
  }

  const intensity = typeof value.intensity === 'string' ? value.intensity.trim() : '';
  const mode = typeof value.mode === 'string' ? value.mode.trim() : '';
  const level = typeof value.level === 'string' ? value.level.trim() : '';
  const budget =
    typeof value.budget === 'number' && Number.isFinite(value.budget) ? value.budget : undefined;

  if (!intensity && !mode && !level && budget === undefined) {
    return null;
  }

  return {
    ...(intensity ? { intensity } : {}),
    ...(mode ? { mode } : {}),
    ...(level ? { level } : {}),
    ...(budget !== undefined ? { budget } : {}),
  };
};

interface UsageSummary {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
}

const createUsageSummary = (): UsageSummary => ({
  totalRequests: 0,
  successCount: 0,
  failureCount: 0,
  totalTokens: 0,
});

const toUsageSummaryFields = (summary: UsageSummary) => ({
  total_requests: summary.totalRequests,
  success_count: summary.successCount,
  failure_count: summary.failureCount,
  total_tokens: summary.totalTokens,
});

const toNonNegativeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

const readOptionalStringField = (
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (value === null || value === undefined) continue;
    const text = typeof value === 'string' ? value.trim() : String(value).trim();
    if (text) return text;
  }
  return undefined;
};

const readOptionalNumberField = (
  record: Record<string, unknown>,
  ...keys: string[]
): number | undefined => {
  for (const key of keys) {
    const value = toNonNegativeNumber(record[key]);
    if (value !== null) return value;
  }
  return undefined;
};

const isSameModelIdentifier = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

/** 从 usage 明细中提取请求侧模型别名；与上游模型名相同时视为无独立别名。 */
export const readUsageModelAlias = (
  record: Record<string, unknown>,
  upstreamModel: string
): string | undefined => {
  const alias = readOptionalStringField(record, 'alias', 'model_alias', 'modelAlias');
  if (!alias) return undefined;
  const upstream = String(upstreamModel ?? '').trim();
  if (upstream && isSameModelIdentifier(alias, upstream)) {
    return undefined;
  }
  return alias;
};

const normalizeUsageTokens = (value: unknown): UsageDetail['tokens'] => {
  const tokens = isRecord(value) ? value : {};
  const inputTokens = toNonNegativeNumber(tokens.input_tokens) ?? 0;
  const outputTokens = toNonNegativeNumber(tokens.output_tokens) ?? 0;
  const reasoningTokens = toNonNegativeNumber(tokens.reasoning_tokens) ?? 0;
  const cachedTokens = Math.max(
    toNonNegativeNumber(tokens.cached_tokens) ?? 0,
    toNonNegativeNumber(tokens.cache_tokens) ?? 0,
    toNonNegativeNumber(tokens.cache_read_tokens) ?? 0
  );
  const totalTokens =
    toNonNegativeNumber(tokens.total_tokens) ??
    inputTokens + outputTokens + reasoningTokens + cachedTokens;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens,
    cached_tokens: cachedTokens,
    ...(tokens.cache_tokens !== undefined ? { cache_tokens: cachedTokens } : {}),
    total_tokens: totalTokens,
  };
};

export type UsageTokenCacheHitAggregation = 'request' | '5m' | 'hour' | 'day' | 'month';

export interface UsageTokenCacheHitTrendData {
  labels: string[];
  tooltipLabels: string[];
  tokenSeries: number[];
  costSeries: number[];
  cacheHitSeries: number[];
  requestCounts: number[];
}

const REQUEST_LEVEL_CACHE_HIT_POINT_LIMIT = 240;

const formatUsageTrendRequestLabel = (timestampMs: number) =>
  new Date(timestampMs)
    .toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    .replace(',', '');

const formatUsageTrendRequestTooltipLabel = (timestampMs: number) =>
  new Date(timestampMs).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

const formatUsageTrendBucketDatePart = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const formatUsageTrendBucketTimePart = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

const getUsageTrendBucketStartMs = (
  timestampMs: number,
  aggregation: Exclude<UsageTokenCacheHitAggregation, 'request'>
) => {
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

const formatUsageTrendBucketLabel = (
  timestampMs: number,
  aggregation: Exclude<UsageTokenCacheHitAggregation, 'request'>
) => {
  const date = new Date(timestampMs);
  if (aggregation === 'month') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  if (aggregation === 'day') {
    return formatUsageTrendBucketDatePart(date);
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${formatUsageTrendBucketTimePart(date)}`;
};

export const getUsageTokenCacheHitAggregation = (
  timeRange: UsageTimeRange,
  pointCount: number,
  spanMs: number
): UsageTokenCacheHitAggregation => {
  if (timeRange === '5m' || timeRange === '30m' || timeRange === '1h') {
    return 'request';
  }
  if (timeRange === '7h') {
    return pointCount > REQUEST_LEVEL_CACHE_HIT_POINT_LIMIT ? '5m' : 'request';
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

const getUsageDetailCacheHitPercent = (detail: UsageDetail): number => {
  const inputTokens = detail.tokens.input_tokens;
  const cachedTokens = Math.max(detail.tokens.cached_tokens, detail.tokens.cache_tokens ?? 0);
  return (computeCacheHitRatio(inputTokens, cachedTokens) ?? 0) * 100;
};

export function buildUsageTokenCacheHitTrend(
  usageData: unknown,
  timeRange: UsageTimeRange,
  modelPrices: Record<string, ModelPrice> = {}
): UsageTokenCacheHitTrendData {
  const requestPoints = collectUsageDetails(usageData)
    .map((detail) => {
      const timestampMs =
        typeof detail.__timestampMs === 'number' && detail.__timestampMs > 0
          ? detail.__timestampMs
          : parseTimestampMs(detail.timestamp);
      if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
        return null;
      }

      return {
        timestampMs,
        label: formatUsageTrendRequestLabel(timestampMs),
        tooltipLabel: formatUsageTrendRequestTooltipLabel(timestampMs),
        tokenCount: extractTotalTokens(detail),
        cost: calculateCost(detail, modelPrices),
        cacheHitPercent: getUsageDetailCacheHitPercent(detail),
        requestCount: 1,
      };
    })
    .filter((point): point is NonNullable<typeof point> => point !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  if (!requestPoints.length) {
    return {
      labels: [],
      tooltipLabels: [],
      tokenSeries: [],
      costSeries: [],
      cacheHitSeries: [],
      requestCounts: [],
    };
  }

  const spanMs = requestPoints[requestPoints.length - 1].timestampMs - requestPoints[0].timestampMs;
  const aggregation = getUsageTokenCacheHitAggregation(timeRange, requestPoints.length, spanMs);
  if (aggregation === 'request') {
    return {
      labels: requestPoints.map((point) => point.label),
      tooltipLabels: requestPoints.map((point) => point.tooltipLabel),
      tokenSeries: requestPoints.map((point) => point.tokenCount),
      costSeries: requestPoints.map((point) => point.cost),
      cacheHitSeries: requestPoints.map((point) => point.cacheHitPercent),
      requestCounts: requestPoints.map((point) => point.requestCount),
    };
  }

  const bucketMap = new Map<
    number,
    { tokenCount: number; cost: number; cacheHitPercentTotal: number; requestCount: number }
  >();
  requestPoints.forEach((point) => {
    const bucketStartMs = getUsageTrendBucketStartMs(point.timestampMs, aggregation);
    const bucket = bucketMap.get(bucketStartMs) ?? {
      tokenCount: 0,
      cost: 0,
      cacheHitPercentTotal: 0,
      requestCount: 0,
    };
    bucket.tokenCount += point.tokenCount;
    bucket.cost += point.cost;
    bucket.cacheHitPercentTotal += point.cacheHitPercent;
    bucket.requestCount += 1;
    bucketMap.set(bucketStartMs, bucket);
  });

  const buckets = Array.from(bucketMap.entries()).sort(([left], [right]) => left - right);
  return {
    labels: buckets.map(([timestampMs]) => formatUsageTrendBucketLabel(timestampMs, aggregation)),
    tooltipLabels: buckets.map(([timestampMs]) =>
      formatUsageTrendBucketLabel(timestampMs, aggregation)
    ),
    tokenSeries: buckets.map(([, bucket]) => bucket.tokenCount),
    costSeries: buckets.map(([, bucket]) => bucket.cost),
    cacheHitSeries: buckets.map(([, bucket]) =>
      bucket.requestCount > 0 ? bucket.cacheHitPercentTotal / bucket.requestCount : 0
    ),
    requestCounts: buckets.map(([, bucket]) => bucket.requestCount),
  };
}

const normalizeUsageRecordDetail = (
  detailRaw: unknown,
  modelName: string,
  endpoint: string
): UsageDetailWithEndpoint | null => {
  const detail = isRecord(detailRaw) ? detailRaw : null;
  if (!detail || typeof detail.timestamp !== 'string') {
    return null;
  }

  const timestamp = detail.timestamp;
  const timestampMs = parseTimestampMs(timestamp);
  const id = typeof detail.id === 'string' && detail.id.trim() ? detail.id.trim() : undefined;
  const latencyMs = toNonNegativeNumber(detail.latency_ms);
  const firstByteLatencyMs = extractFirstByteLatencyMs(detail);
  const generationMs = extractGenerationMs(detail);
  const source =
    typeof detail.source === 'string'
      ? detail.source
      : detail.source === null || detail.source === undefined
        ? ''
        : String(detail.source);
  const normalizedSource = normalizeUsageSourceId(source);
  const thinkingEffort =
    typeof detail.thinking_effort === 'string' && detail.thinking_effort.trim()
      ? detail.thinking_effort.trim()
      : undefined;
  const requestId = readOptionalStringField(detail, 'request_id', 'requestId');
  const provider = readOptionalStringField(detail, 'provider');
  const authType = readOptionalStringField(detail, 'auth_type', 'authType');
  const rawApiKey = readOptionalStringField(detail, 'api_key', 'apiKey');
  const apiKeyHash =
    readOptionalStringField(detail, 'api_key_hash', 'apiKeyHash') ||
    (normalizedSource.startsWith(USAGE_SOURCE_PREFIX_KEY)
      ? normalizedSource.slice(USAGE_SOURCE_PREFIX_KEY.length)
      : rawApiKey
        ? fnv1a64Hex(rawApiKey)
        : undefined);
  const accountSnapshot = readOptionalStringField(detail, 'account_snapshot', 'accountSnapshot');
  const authLabelSnapshot = readOptionalStringField(
    detail,
    'auth_label_snapshot',
    'authLabelSnapshot'
  );
  const authFileSnapshot = readOptionalStringField(
    detail,
    'auth_file_snapshot',
    'authFileSnapshot'
  );
  const authProviderSnapshot = readOptionalStringField(
    detail,
    'auth_provider_snapshot',
    'authProviderSnapshot'
  );
  const authSnapshotAtMs = readOptionalNumberField(
    detail,
    'auth_snapshot_at_ms',
    'authSnapshotAtMs'
  );
  const modelAlias = readUsageModelAlias(detail, modelName);

  const endpointMatch = endpoint.match(USAGE_ENDPOINT_METHOD_REGEX);

  return {
    ...(id ? { id } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    timestamp,
    ...(provider ? { provider } : {}),
    source: normalizedSource,
    auth_index: (detail.auth_index ??
      detail.authIndex ??
      detail.AuthIndex ??
      null) as UsageDetail['auth_index'],
    ...(authType ? { auth_type: authType } : {}),
    ...(apiKeyHash ? { api_key_hash: apiKeyHash } : {}),
    ...(accountSnapshot ? { account_snapshot: accountSnapshot } : {}),
    ...(authLabelSnapshot ? { auth_label_snapshot: authLabelSnapshot } : {}),
    ...(authFileSnapshot ? { auth_file_snapshot: authFileSnapshot } : {}),
    ...(authProviderSnapshot ? { auth_provider_snapshot: authProviderSnapshot } : {}),
    ...(authSnapshotAtMs !== undefined ? { auth_snapshot_at_ms: authSnapshotAtMs } : {}),
    ...(latencyMs !== null ? { latency_ms: latencyMs } : {}),
    ...(firstByteLatencyMs !== null ? { first_byte_latency_ms: firstByteLatencyMs } : {}),
    ...(generationMs !== null ? { generation_ms: generationMs } : {}),
    tokens: normalizeUsageTokens(detail.tokens),
    thinking: normalizeUsageThinking(detail.thinking),
    ...(thinkingEffort ? { thinking_effort: thinkingEffort } : {}),
    failed: detail.failed === true,
    ...(modelAlias ? { model_alias: modelAlias } : {}),
    __modelName: modelName,
    __endpoint: endpoint,
    __endpointMethod: endpointMatch?.[1]?.toUpperCase(),
    __endpointPath: endpointMatch?.[2],
    __timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
  };
};

const decodeUsageRequestPayload = (value: unknown): Record<string, unknown> | null => {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const binary = atob(value.trim());
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const parsed: unknown = JSON.parse(decoded);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const collectEncodedUsageRequestDetails = (usageData: unknown): UsageDetailWithEndpoint[] => {
  const usageRecord = isRecord(usageData) ? usageData : null;
  const requests = Array.isArray(usageRecord?.requests) ? usageRecord.requests : [];
  if (!requests.length) return [];

  return requests
    .map((item) => {
      const record = decodeUsageRequestPayload(item);
      if (!record) return null;
      const endpoint = readOptionalStringField(record, 'endpoint') || 'unknown';
      const modelName =
        readOptionalStringField(record, 'model', 'model_name', 'modelName') ||
        readOptionalStringField(record, 'alias') ||
        'unknown';
      return normalizeUsageRecordDetail(record, modelName, endpoint);
    })
    .filter((detail): detail is UsageDetailWithEndpoint => Boolean(detail));
};

const collectBackendUsageDetails = (
  usageData: Record<string, unknown>
): UsageDetailWithEndpoint[] => {
  const details: UsageDetailWithEndpoint[] = [];

  Object.entries(usageData).forEach(([endpoint, endpointEntry]) => {
    if (!isRecord(endpointEntry)) return;

    Object.entries(endpointEntry).forEach(([modelName, recordsRaw]) => {
      if (!Array.isArray(recordsRaw)) return;

      recordsRaw.forEach((record) => {
        const detail = normalizeUsageRecordDetail(record, modelName, endpoint);
        if (detail) {
          details.push(detail);
        }
      });
    });
  });

  return details;
};

export function buildUsageSnapshotFromDetails(
  details: Iterable<UsageDetailWithEndpoint>
): UsageStatsSnapshot {
  const snapshot: UsageStatsSnapshot = {
    total_requests: 0,
    success_count: 0,
    failure_count: 0,
    total_tokens: 0,
    apis: {},
    requests_by_day: {},
    requests_by_hour: {},
    tokens_by_day: {},
    tokens_by_hour: {},
  };

  for (const detail of details) {
    const endpoint = detail.__endpoint || 'unknown';
    const modelName = detail.__modelName || 'unknown';
    const apiEntry =
      snapshot.apis[endpoint] ??
      (snapshot.apis[endpoint] = {
        total_requests: 0,
        success_count: 0,
        failure_count: 0,
        total_tokens: 0,
        models: {},
      });
    const modelEntry =
      apiEntry.models[modelName] ??
      (apiEntry.models[modelName] = {
        total_requests: 0,
        success_count: 0,
        failure_count: 0,
        total_tokens: 0,
        details: [],
      });
    const totalTokens = extractTotalTokens(detail);
    const failed = detail.failed === true;

    snapshot.total_requests += 1;
    apiEntry.total_requests += 1;
    modelEntry.total_requests += 1;

    if (failed) {
      snapshot.failure_count += 1;
      apiEntry.failure_count += 1;
      modelEntry.failure_count += 1;
    } else {
      snapshot.success_count += 1;
      apiEntry.success_count += 1;
      modelEntry.success_count += 1;
    }

    snapshot.total_tokens += totalTokens;
    apiEntry.total_tokens += totalTokens;
    modelEntry.total_tokens += totalTokens;
    modelEntry.details.push(detail);

    if (detail.__timestampMs > 0) {
      const date = new Date(detail.__timestampMs);
      const dayKey = date.toISOString().slice(0, 10);
      const hourKey = date.getUTCHours().toString().padStart(2, '0');
      snapshot.requests_by_day[dayKey] = (snapshot.requests_by_day[dayKey] ?? 0) + 1;
      snapshot.requests_by_hour[hourKey] = (snapshot.requests_by_hour[hourKey] ?? 0) + 1;
      snapshot.tokens_by_day[dayKey] = (snapshot.tokens_by_day[dayKey] ?? 0) + totalTokens;
      snapshot.tokens_by_hour[hourKey] = (snapshot.tokens_by_hour[hourKey] ?? 0) + totalTokens;
    }
  }

  return snapshot;
}

export function normalizeUsageData(
  usageData: unknown
): UsageStatsSnapshot | Record<string, unknown> | null {
  const payload = isRecord(usageData) && isRecord(usageData.usage) ? usageData.usage : usageData;
  const usageRecord = isRecord(payload) ? payload : null;
  if (!usageRecord) {
    return null;
  }

  if (getApisRecord(usageRecord)) {
    return usageRecord;
  }

  return buildUsageSnapshotFromDetails([
    ...collectEncodedUsageRequestDetails(usageRecord),
    ...collectBackendUsageDetails(usageRecord),
  ]);
}

export function extractGenerationMs(detail: unknown): number | null {
  const record = isRecord(detail) ? detail : null;
  const generationMs = toNonNegativeNumber(record?.generation_ms);
  if (generationMs !== null) {
    return generationMs;
  }

  const latencyMs = toNonNegativeNumber(record?.latency_ms);
  if (latencyMs === null) {
    return null;
  }

  const firstByteLatencyMs = toNonNegativeNumber(record?.first_byte_latency_ms);
  return firstByteLatencyMs === null ? latencyMs : Math.max(latencyMs - firstByteLatencyMs, 0);
}

export function extractFirstByteLatencyMs(detail: unknown): number | null {
  const record = isRecord(detail) ? detail : null;
  const firstByteLatencyMs = toNonNegativeNumber(record?.first_byte_latency_ms);
  if (firstByteLatencyMs !== null) {
    return firstByteLatencyMs;
  }

  return toNonNegativeNumber(record?.latency_ms) !== null ? 0 : null;
}

export function filterUsageByTimeRange<T>(
  usageData: T,
  range: UsageTimeRange,
  nowMs: number = Date.now()
): T {
  if (range === 'all') {
    return usageData;
  }

  const usageRecord = isRecord(usageData) ? usageData : null;
  const apis = getApisRecord(usageData);
  if (!usageRecord || !apis) {
    return usageData;
  }

  const rangeMs = USAGE_TIME_RANGE_MS[range];
  if (!Number.isFinite(rangeMs) || rangeMs <= 0) {
    return usageData;
  }

  const windowStart = nowMs - rangeMs;
  const filteredApis: Record<string, unknown> = {};
  const totalSummary = createUsageSummary();

  Object.entries(apis).forEach(([apiName, apiEntry]) => {
    if (!isRecord(apiEntry)) {
      return;
    }

    const models = isRecord(apiEntry.models) ? apiEntry.models : null;
    if (!models) {
      return;
    }

    const filteredModels: Record<string, unknown> = {};
    const apiSummary = createUsageSummary();
    let hasModelData = false;

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) {
        return;
      }

      const detailsRaw = Array.isArray(modelEntry.details) ? modelEntry.details : [];
      const modelSummary = createUsageSummary();
      const filteredDetails: unknown[] = [];

      detailsRaw.forEach((detail) => {
        const detailRecord = isRecord(detail) ? detail : null;
        if (!detailRecord || typeof detailRecord.timestamp !== 'string') {
          return;
        }
        const timestamp = parseTimestampMs(detailRecord.timestamp);
        if (Number.isNaN(timestamp) || timestamp < windowStart || timestamp > nowMs) {
          return;
        }

        filteredDetails.push(detail);
        modelSummary.totalRequests += 1;
        if (detailRecord.failed === true) {
          modelSummary.failureCount += 1;
        } else {
          modelSummary.successCount += 1;
        }
        modelSummary.totalTokens += extractTotalTokens(detailRecord);
      });

      if (!filteredDetails.length) {
        return;
      }

      filteredModels[modelName] = {
        ...modelEntry,
        ...toUsageSummaryFields(modelSummary),
        details: filteredDetails,
      };
      hasModelData = true;

      apiSummary.totalRequests += modelSummary.totalRequests;
      apiSummary.successCount += modelSummary.successCount;
      apiSummary.failureCount += modelSummary.failureCount;
      apiSummary.totalTokens += modelSummary.totalTokens;
    });

    if (!hasModelData) {
      return;
    }

    filteredApis[apiName] = {
      ...apiEntry,
      ...toUsageSummaryFields(apiSummary),
      models: filteredModels,
    };

    totalSummary.totalRequests += apiSummary.totalRequests;
    totalSummary.successCount += apiSummary.successCount;
    totalSummary.failureCount += apiSummary.failureCount;
    totalSummary.totalTokens += apiSummary.totalTokens;
  });

  return {
    ...usageRecord,
    ...toUsageSummaryFields(totalSummary),
    apis: filteredApis,
  } as T;
}

export const normalizeAuthIndex = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
};

const USAGE_SOURCE_PREFIX_KEY = 'k:';
const USAGE_SOURCE_PREFIX_MASKED = 'm:';
const USAGE_SOURCE_PREFIX_TEXT = 't:';

const isNormalizedUsageSourceId = (value: string): boolean =>
  value.startsWith(USAGE_SOURCE_PREFIX_KEY) ||
  value.startsWith(USAGE_SOURCE_PREFIX_MASKED) ||
  value.startsWith(USAGE_SOURCE_PREFIX_TEXT);

const KEY_LIKE_TOKEN_REGEX =
  /(sk-[A-Za-z0-9-_]{6,}|sk-ant-[A-Za-z0-9-_]{6,}|AIza[0-9A-Za-z-_]{8,}|AI[a-zA-Z0-9_-]{6,}|hf_[A-Za-z0-9]{6,}|pk_[A-Za-z0-9]{6,}|rk_[A-Za-z0-9]{6,})/;
const MASKED_TOKEN_HINT_REGEX = /^[^\s]{1,24}(\*{2,}|\.{3}|…)[^\s]{1,24}$/;

const keyFingerprintCache = new Map<string, string>();

export const computeUsageSourceKeyFingerprint = (value: string): string => fnv1a64Hex(value);

const fnv1a64Hex = (value: string): string => {
  const cached = keyFingerprintCache.get(value);
  if (cached) return cached;

  const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
  }

  const hex = hash.toString(16).padStart(16, '0');
  keyFingerprintCache.set(value, hex);
  return hex;
};

const looksLikeRawSecret = (text: string): boolean => {
  if (!text || /\s/.test(text)) return false;

  const lower = text.toLowerCase();
  if (lower.endsWith('.json')) return false;
  if (lower.startsWith('http://') || lower.startsWith('https://')) return false;
  if (/[\\/]/.test(text)) return false;

  if (KEY_LIKE_TOKEN_REGEX.test(text)) return true;

  if (text.length >= 32 && text.length <= 512) {
    return true;
  }

  if (text.length >= 16 && text.length < 32 && /^[A-Za-z0-9._=-]+$/.test(text)) {
    return /[A-Za-z]/.test(text) && /\d/.test(text);
  }

  return false;
};

const extractRawSecretFromText = (text: string): string | null => {
  if (!text) return null;
  if (looksLikeRawSecret(text)) return text;

  const keyLikeMatch = text.match(KEY_LIKE_TOKEN_REGEX);
  if (keyLikeMatch?.[0]) return keyLikeMatch[0];

  const queryMatch = text.match(
    /(?:[?&])(api[-_]?key|key|token|access_token|authorization)=([^&#\s]+)/i
  );
  const queryValue = queryMatch?.[2];
  if (queryValue && looksLikeRawSecret(queryValue)) {
    return queryValue;
  }

  const headerMatch = text.match(
    /(api[-_]?key|key|token|access[-_]?token|authorization)\s*[:=]\s*([A-Za-z0-9._=-]+)/i
  );
  const headerValue = headerMatch?.[2];
  if (headerValue && looksLikeRawSecret(headerValue)) {
    return headerValue;
  }

  const bearerMatch = text.match(/\bBearer\s+([A-Za-z0-9._=-]{6,})/i);
  const bearerValue = bearerMatch?.[1];
  if (bearerValue && looksLikeRawSecret(bearerValue)) {
    return bearerValue;
  }

  return null;
};

export function normalizeUsageSourceId(
  value: unknown,
  masker: (val: string) => string = maskApiKey
): string {
  const raw =
    typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (isNormalizedUsageSourceId(trimmed)) return trimmed;

  const extracted = extractRawSecretFromText(trimmed);
  if (extracted) {
    return `${USAGE_SOURCE_PREFIX_KEY}${fnv1a64Hex(extracted)}`;
  }

  if (MASKED_TOKEN_HINT_REGEX.test(trimmed)) {
    return `${USAGE_SOURCE_PREFIX_MASKED}${masker(trimmed)}`;
  }

  return `${USAGE_SOURCE_PREFIX_TEXT}${trimmed}`;
}

export function buildCandidateUsageSourceIds(input: {
  apiKey?: string;
  prefix?: string;
}): string[] {
  const result: string[] = [];

  const prefix = input.prefix?.trim();
  if (prefix) {
    result.push(`${USAGE_SOURCE_PREFIX_TEXT}${prefix}`);
  }

  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    // Include the normalised form first so that "non-standard" keys (e.g. short tokens,
    // keys containing '/' etc.) that are classified as text by normalizeUsageSourceId()
    // can still match usage details.
    result.push(normalizeUsageSourceId(apiKey));
    result.push(`${USAGE_SOURCE_PREFIX_KEY}${fnv1a64Hex(apiKey)}`);
    result.push(`${USAGE_SOURCE_PREFIX_MASKED}${maskApiKey(apiKey)}`);
  }

  return Array.from(new Set(result));
}

/**
 * 对使用数据中的敏感字段进行遮罩
 */
export function maskUsageSensitiveValue(
  value: unknown,
  masker: (val: string) => string = maskApiKey
): string {
  if (value === null || value === undefined) {
    return '';
  }
  const raw = typeof value === 'string' ? value : String(value);
  if (!raw) {
    return '';
  }

  let masked = raw;

  const queryRegex = /([?&])(api[-_]?key|key|token|access_token|authorization)=([^&#\s]+)/gi;
  masked = masked.replace(
    queryRegex,
    (_full, prefix, keyName, valuePart) => `${prefix}${keyName}=${masker(valuePart)}`
  );

  const headerRegex =
    /(api[-_]?key|key|token|access[-_]?token|authorization)\s*([:=])\s*([A-Za-z0-9._-]+)/gi;
  masked = masked.replace(
    headerRegex,
    (_full, keyName, separator, valuePart) => `${keyName}${separator}${masker(valuePart)}`
  );

  const keyLikeRegex =
    /(sk-[A-Za-z0-9]{6,}|AI[a-zA-Z0-9_-]{6,}|AIza[0-9A-Za-z-_]{8,}|hf_[A-Za-z0-9]{6,}|pk_[A-Za-z0-9]{6,}|rk_[A-Za-z0-9]{6,})/g;
  masked = masked.replace(keyLikeRegex, (match) => masker(match));

  if (masked === raw) {
    const trimmed = raw.trim();
    if (trimmed && !/\s/.test(trimmed)) {
      const looksLikeKey =
        /^sk-/i.test(trimmed) ||
        /^AI/i.test(trimmed) ||
        /^AIza/i.test(trimmed) ||
        /^hf_/i.test(trimmed) ||
        /^pk_/i.test(trimmed) ||
        /^rk_/i.test(trimmed) ||
        (!/[\\/]/.test(trimmed) && (/\d/.test(trimmed) || trimmed.length >= 10)) ||
        trimmed.length >= 24;
      if (looksLikeKey) {
        return masker(trimmed);
      }
    }
  }

  return masked;
}

/**
 * 格式化每分钟数值
 */
export function formatPerMinuteValue(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '0.00';
  }
  const abs = Math.abs(num);
  if (abs >= 1000) {
    return Math.round(num).toLocaleString();
  }
  if (abs >= 100) {
    return num.toFixed(0);
  }
  if (abs >= 10) {
    return num.toFixed(1);
  }
  return num.toFixed(2);
}

/**
 * 格式化紧凑数字
 */
export function formatCompactNumber(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '0';
  }
  const abs = Math.abs(num);
  if (abs >= 1_000_000) {
    return `${(num / 1_000_000).toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}M`;
  }
  if (abs >= 1_000) {
    return `${(num / 1_000).toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}K`;
  }
  return abs >= 1 ? Math.round(num).toLocaleString() : num.toFixed(2);
}

/**
 * 格式化美元
 */
export function formatUsd(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '$0.00';
  }

  const abs = Math.abs(num);
  const fractionDigits = abs >= 1000 ? 0 : abs >= 10 ? 1 : 2;
  const parts = num.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return `$${parts}`;
}

export function formatUsdFixedOne(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '$0.0';
  }

  return `$${num.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}`;
}

const usageDetailsCache = new WeakMap<object, UsageDetail[]>();
const usageDetailsWithEndpointCache = new WeakMap<object, UsageDetailWithEndpoint[]>();

/**
 * 从使用数据中收集所有请求明细
 */
export function collectUsageDetails(usageData: unknown): UsageDetail[] {
  const cacheKey = isRecord(usageData) ? (usageData as object) : null;
  if (cacheKey) {
    const cached = usageDetailsCache.get(cacheKey);
    if (cached) return cached;
  }

  const apis = getApisRecord(usageData);
  const encodedDetails = collectEncodedUsageRequestDetails(usageData);
  if (!apis) return encodedDetails;
  const details: UsageDetail[] = [...encodedDetails];
  const sourceCache = new Map<string, string>();

  const normalizeSource = (value: unknown): string => {
    const raw =
      typeof value === 'string'
        ? value
        : value === null || value === undefined
          ? ''
          : String(value);
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const cached = sourceCache.get(trimmed);
    if (cached !== undefined) return cached;
    const normalized = normalizeUsageSourceId(trimmed);
    sourceCache.set(trimmed, normalized);
    return normalized;
  };

  Object.values(apis).forEach((apiEntry) => {
    if (!isRecord(apiEntry)) return;
    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) return;
      const modelDetailsRaw = modelEntry.details;
      const modelDetails = Array.isArray(modelDetailsRaw) ? modelDetailsRaw : [];

      modelDetails.forEach((detailRaw) => {
        if (!isRecord(detailRaw) || typeof detailRaw.timestamp !== 'string') return;
        const timestamp = detailRaw.timestamp;
        const timestampMs = parseTimestampMs(timestamp);
        const latencyMs = extractLatencyMs(detailRaw);
        const generationMs = extractGenerationMs(detailRaw);
        const firstByteLatencyMs = extractFirstByteLatencyMs(detailRaw);
        const id =
          typeof detailRaw.id === 'string' && detailRaw.id.trim() ? detailRaw.id.trim() : undefined;
        const thinkingEffort =
          typeof detailRaw.thinking_effort === 'string' && detailRaw.thinking_effort.trim()
            ? detailRaw.thinking_effort.trim()
            : undefined;
        const requestId = readOptionalStringField(detailRaw, 'request_id', 'requestId');
        const provider = readOptionalStringField(detailRaw, 'provider');
        const authType = readOptionalStringField(detailRaw, 'auth_type', 'authType');
        const apiKeyHash = readOptionalStringField(detailRaw, 'api_key_hash', 'apiKeyHash');
        const accountSnapshot = readOptionalStringField(
          detailRaw,
          'account_snapshot',
          'accountSnapshot'
        );
        const authLabelSnapshot = readOptionalStringField(
          detailRaw,
          'auth_label_snapshot',
          'authLabelSnapshot'
        );
        const authFileSnapshot = readOptionalStringField(
          detailRaw,
          'auth_file_snapshot',
          'authFileSnapshot'
        );
        const authProviderSnapshot = readOptionalStringField(
          detailRaw,
          'auth_provider_snapshot',
          'authProviderSnapshot'
        );
        const authSnapshotAtMs = readOptionalNumberField(
          detailRaw,
          'auth_snapshot_at_ms',
          'authSnapshotAtMs'
        );
        const modelAlias = readUsageModelAlias(detailRaw, modelName);
        details.push({
          ...(id ? { id } : {}),
          ...(requestId ? { request_id: requestId } : {}),
          timestamp,
          ...(provider ? { provider } : {}),
          source: normalizeSource(detailRaw.source),
          auth_index: (detailRaw?.auth_index ??
            detailRaw?.authIndex ??
            detailRaw?.AuthIndex ??
            null) as UsageDetail['auth_index'],
          ...(authType ? { auth_type: authType } : {}),
          ...(apiKeyHash ? { api_key_hash: apiKeyHash } : {}),
          ...(accountSnapshot ? { account_snapshot: accountSnapshot } : {}),
          ...(authLabelSnapshot ? { auth_label_snapshot: authLabelSnapshot } : {}),
          ...(authFileSnapshot ? { auth_file_snapshot: authFileSnapshot } : {}),
          ...(authProviderSnapshot ? { auth_provider_snapshot: authProviderSnapshot } : {}),
          ...(authSnapshotAtMs !== undefined ? { auth_snapshot_at_ms: authSnapshotAtMs } : {}),
          latency_ms: latencyMs ?? undefined,
          first_byte_latency_ms: firstByteLatencyMs ?? undefined,
          generation_ms: generationMs ?? undefined,
          tokens: normalizeUsageTokens(detailRaw.tokens),
          thinking: normalizeUsageThinking(detailRaw.thinking),
          ...(thinkingEffort ? { thinking_effort: thinkingEffort } : {}),
          failed: detailRaw.failed === true,
          ...(modelAlias ? { model_alias: modelAlias } : {}),
          __modelName: modelName,
          __timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        });
      });
    });
  });

  if (cacheKey) {
    usageDetailsCache.set(cacheKey, details);
  }
  return details;
}

/**
 * 从使用数据中收集包含 endpoint/method/path 的请求明细
 */
export function collectUsageDetailsWithEndpoint(usageData: unknown): UsageDetailWithEndpoint[] {
  const cacheKey = isRecord(usageData) ? (usageData as object) : null;
  if (cacheKey) {
    const cached = usageDetailsWithEndpointCache.get(cacheKey);
    if (cached) return cached;
  }

  const apis = getApisRecord(usageData);
  const encodedDetails = collectEncodedUsageRequestDetails(usageData);
  if (!apis) {
    if (cacheKey) {
      usageDetailsWithEndpointCache.set(cacheKey, encodedDetails);
    }
    return encodedDetails;
  }

  const details: UsageDetailWithEndpoint[] = [...encodedDetails];
  const sourceCache = new Map<string, string>();

  const normalizeSource = (value: unknown): string => {
    const raw =
      typeof value === 'string'
        ? value
        : value === null || value === undefined
          ? ''
          : String(value);
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const cached = sourceCache.get(trimmed);
    if (cached !== undefined) return cached;
    const normalized = normalizeUsageSourceId(trimmed);
    sourceCache.set(trimmed, normalized);
    return normalized;
  };

  Object.entries(apis).forEach(([endpoint, apiEntry]) => {
    if (!isRecord(apiEntry)) return;
    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;

    const endpointMatch = endpoint.match(USAGE_ENDPOINT_METHOD_REGEX);
    const endpointMethod = endpointMatch?.[1]?.toUpperCase();
    const endpointPath = endpointMatch?.[2];

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) return;
      const modelDetailsRaw = modelEntry.details;
      const modelDetails = Array.isArray(modelDetailsRaw) ? modelDetailsRaw : [];

      modelDetails.forEach((detailRaw) => {
        if (!isRecord(detailRaw) || typeof detailRaw.timestamp !== 'string') return;
        const timestamp = detailRaw.timestamp;
        const timestampMs = parseTimestampMs(timestamp);
        const latencyMs = extractLatencyMs(detailRaw);
        const generationMs = extractGenerationMs(detailRaw);
        const firstByteLatencyMs = extractFirstByteLatencyMs(detailRaw);
        const id =
          typeof detailRaw.id === 'string' && detailRaw.id.trim() ? detailRaw.id.trim() : undefined;
        const thinkingEffort =
          typeof detailRaw.thinking_effort === 'string' && detailRaw.thinking_effort.trim()
            ? detailRaw.thinking_effort.trim()
            : undefined;
        const requestId = readOptionalStringField(detailRaw, 'request_id', 'requestId');
        const provider = readOptionalStringField(detailRaw, 'provider');
        const authType = readOptionalStringField(detailRaw, 'auth_type', 'authType');
        const apiKeyHash = readOptionalStringField(detailRaw, 'api_key_hash', 'apiKeyHash');
        const accountSnapshot = readOptionalStringField(
          detailRaw,
          'account_snapshot',
          'accountSnapshot'
        );
        const authLabelSnapshot = readOptionalStringField(
          detailRaw,
          'auth_label_snapshot',
          'authLabelSnapshot'
        );
        const authFileSnapshot = readOptionalStringField(
          detailRaw,
          'auth_file_snapshot',
          'authFileSnapshot'
        );
        const authProviderSnapshot = readOptionalStringField(
          detailRaw,
          'auth_provider_snapshot',
          'authProviderSnapshot'
        );
        const authSnapshotAtMs = readOptionalNumberField(
          detailRaw,
          'auth_snapshot_at_ms',
          'authSnapshotAtMs'
        );
        const modelAlias = readUsageModelAlias(detailRaw, modelName);
        details.push({
          ...(id ? { id } : {}),
          ...(requestId ? { request_id: requestId } : {}),
          timestamp,
          ...(provider ? { provider } : {}),
          source: normalizeSource(detailRaw.source),
          auth_index: (detailRaw?.auth_index ??
            detailRaw?.authIndex ??
            detailRaw?.AuthIndex ??
            null) as UsageDetail['auth_index'],
          ...(authType ? { auth_type: authType } : {}),
          ...(apiKeyHash ? { api_key_hash: apiKeyHash } : {}),
          ...(accountSnapshot ? { account_snapshot: accountSnapshot } : {}),
          ...(authLabelSnapshot ? { auth_label_snapshot: authLabelSnapshot } : {}),
          ...(authFileSnapshot ? { auth_file_snapshot: authFileSnapshot } : {}),
          ...(authProviderSnapshot ? { auth_provider_snapshot: authProviderSnapshot } : {}),
          ...(authSnapshotAtMs !== undefined ? { auth_snapshot_at_ms: authSnapshotAtMs } : {}),
          latency_ms: latencyMs ?? undefined,
          first_byte_latency_ms: firstByteLatencyMs ?? undefined,
          generation_ms: generationMs ?? undefined,
          tokens: normalizeUsageTokens(detailRaw.tokens),
          thinking: normalizeUsageThinking(detailRaw.thinking),
          ...(thinkingEffort ? { thinking_effort: thinkingEffort } : {}),
          failed: detailRaw.failed === true,
          ...(modelAlias ? { model_alias: modelAlias } : {}),
          __modelName: modelName,
          __endpoint: endpoint,
          __endpointMethod: endpointMethod,
          __endpointPath: endpointPath,
          __timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        });
      });
    });
  });

  if (cacheKey) {
    usageDetailsWithEndpointCache.set(cacheKey, details);
  }
  return details;
}

/**
 * 从单条明细提取总 tokens
 */
export function extractTotalTokens(detail: unknown): number {
  const record = isRecord(detail) ? detail : null;
  const tokensRaw = record?.tokens;
  const tokens = isRecord(tokensRaw) ? tokensRaw : {};
  if (typeof tokens.total_tokens === 'number') {
    return tokens.total_tokens;
  }
  const inputTokens = typeof tokens.input_tokens === 'number' ? tokens.input_tokens : 0;
  const outputTokens = typeof tokens.output_tokens === 'number' ? tokens.output_tokens : 0;
  const reasoningTokens = typeof tokens.reasoning_tokens === 'number' ? tokens.reasoning_tokens : 0;
  const cachedTokens = Math.max(
    typeof tokens.cached_tokens === 'number' ? Math.max(tokens.cached_tokens, 0) : 0,
    typeof tokens.cache_tokens === 'number' ? Math.max(tokens.cache_tokens, 0) : 0
  );

  return inputTokens + outputTokens + reasoningTokens + cachedTokens;
}

/**
 * 计算最近 N 分钟的 RPM/TPM
 */
export function calculateRecentPerMinuteRates(
  windowMinutes: number = 30,
  usageData: unknown
): RateStats {
  const details = collectUsageDetails(usageData);
  const effectiveWindow = Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes : 30;

  if (!details.length) {
    return { rpm: 0, tpm: 0, windowMinutes: effectiveWindow, requestCount: 0, tokenCount: 0 };
  }

  const now = Date.now();
  const windowStart = now - effectiveWindow * 60 * 1000;
  let requestCount = 0;
  let tokenCount = 0;

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > now) {
      return;
    }
    requestCount += 1;
    tokenCount += extractTotalTokens(detail);
  });

  const denominator = effectiveWindow > 0 ? effectiveWindow : 1;
  return {
    rpm: requestCount / denominator,
    tpm: tokenCount / denominator,
    windowMinutes: effectiveWindow,
    requestCount,
    tokenCount,
  };
}

/**
 * 从使用数据获取模型名称列表
 */
export function getModelNamesFromUsage(usageData: unknown): string[] {
  const apis = getApisRecord(usageData);
  if (!apis) return [];
  const names = new Set<string>();
  Object.values(apis).forEach((apiEntry) => {
    if (!isRecord(apiEntry)) return;
    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;
    Object.keys(models).forEach((modelName) => {
      if (modelName) {
        names.add(modelName);
      }
    });
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/**
 * 计算成本数据
 */
export function calculateCost(
  detail: UsageDetail,
  modelPrices: Record<string, ModelPrice>
): number {
  const modelName = detail.__modelName || '';
  const price = modelPrices[modelName];
  if (!price) {
    return 0;
  }
  const tokens = detail.tokens;
  const rawInputTokens = Number(tokens.input_tokens);
  const rawCompletionTokens = Number(tokens.output_tokens);
  const rawCachedTokensPrimary = Number(tokens.cached_tokens);
  const rawCachedTokensAlternate = Number(tokens.cache_tokens);

  const inputTokens = Number.isFinite(rawInputTokens) ? Math.max(rawInputTokens, 0) : 0;
  const completionTokens = Number.isFinite(rawCompletionTokens)
    ? Math.max(rawCompletionTokens, 0)
    : 0;
  const cachedTokens = Math.max(
    Number.isFinite(rawCachedTokensPrimary) ? Math.max(rawCachedTokensPrimary, 0) : 0,
    Number.isFinite(rawCachedTokensAlternate) ? Math.max(rawCachedTokensAlternate, 0) : 0
  );
  const promptTokens = Math.max(inputTokens - cachedTokens, 0);

  const promptCost = (promptTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.prompt) || 0);
  const cachedCost = (cachedTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.cache) || 0);
  const completionCost =
    (completionTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.completion) || 0);
  const total = promptCost + cachedCost + completionCost;
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/**
 * 计算总成本
 */
export function calculateTotalCost(
  usageData: unknown,
  modelPrices: Record<string, ModelPrice>
): number {
  const details = collectUsageDetails(usageData);
  if (!details.length || !Object.keys(modelPrices).length) {
    return 0;
  }
  return details.reduce((sum, detail) => sum + calculateCost(detail, modelPrices), 0);
}

/**
 * 从 localStorage 加载模型价格
 */
export function loadModelPrices(): Record<string, ModelPrice> {
  try {
    if (typeof localStorage === 'undefined') {
      return {};
    }
    const raw = localStorage.getItem(MODEL_PRICE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }
    const normalized: Record<string, ModelPrice> = {};
    Object.entries(parsed).forEach(([model, price]: [string, unknown]) => {
      if (!model) return;
      const priceRecord = isRecord(price) ? price : null;
      const promptRaw = Number(priceRecord?.prompt);
      const completionRaw = Number(priceRecord?.completion);
      const cacheRaw = Number(priceRecord?.cache);

      if (
        !Number.isFinite(promptRaw) &&
        !Number.isFinite(completionRaw) &&
        !Number.isFinite(cacheRaw)
      ) {
        return;
      }

      const prompt = Number.isFinite(promptRaw) && promptRaw >= 0 ? promptRaw : 0;
      const completion = Number.isFinite(completionRaw) && completionRaw >= 0 ? completionRaw : 0;
      const cache =
        Number.isFinite(cacheRaw) && cacheRaw >= 0
          ? cacheRaw
          : Number.isFinite(promptRaw) && promptRaw >= 0
            ? promptRaw
            : prompt;

      normalized[model] = {
        prompt,
        completion,
        cache,
      };
    });
    return normalized;
  } catch {
    return {};
  }
}

/**
 * 保存模型价格到 localStorage
 */
export function saveModelPrices(prices: Record<string, ModelPrice>): void {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.setItem(MODEL_PRICE_STORAGE_KEY, JSON.stringify(prices));
  } catch {
    console.warn('保存模型价格失败');
  }
}

/**
 * 获取模型统计数据
 */
export function getModelStats(
  usageData: unknown,
  modelPrices: Record<string, ModelPrice>
): ModelStatsSummary[] {
  const apis = getApisRecord(usageData);
  if (!apis) return [];

  const modelMap = new Map<
    string,
    {
      requests: number;
      successCount: number;
      failureCount: number;
      tokens: number;
      cost: number;
      latency: LatencyAccumulator;
      firstByteLatency: LatencyAccumulator;
      totalTps: number;
      tpsSampleCount: number;
    }
  >();

  Object.values(apis).forEach((apiData) => {
    if (!isRecord(apiData)) return;
    const modelsRaw = apiData.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;

    Object.entries(models).forEach(([modelName, modelData]) => {
      if (!isRecord(modelData)) return;
      const existing = modelMap.get(modelName) || {
        requests: 0,
        successCount: 0,
        failureCount: 0,
        tokens: 0,
        cost: 0,
        latency: createLatencyAccumulator(),
        firstByteLatency: createLatencyAccumulator(),
        totalTps: 0,
        tpsSampleCount: 0,
      };
      existing.requests += Number(modelData.total_requests) || 0;
      existing.tokens += Number(modelData.total_tokens) || 0;

      const details = Array.isArray(modelData.details) ? modelData.details : [];

      const price = modelPrices[modelName];

      const hasExplicitCounts =
        typeof modelData.success_count === 'number' || typeof modelData.failure_count === 'number';
      if (hasExplicitCounts) {
        existing.successCount += Number(modelData.success_count) || 0;
        existing.failureCount += Number(modelData.failure_count) || 0;
      }

      if (details.length > 0) {
        details.forEach((detail) => {
          const detailRecord = isRecord(detail) ? detail : null;
          const latencyMs = extractLatencyMs(detailRecord);
          const firstByteLatencyMs = extractFirstByteLatencyMs(detailRecord);
          const generationMs = extractGenerationMs(detailRecord);
          const tokens = isRecord(detailRecord?.tokens) ? detailRecord.tokens : null;
          const outputTokensRaw = Number(tokens?.output_tokens);
          const outputTokens = Number.isFinite(outputTokensRaw) ? Math.max(outputTokensRaw, 0) : 0;
          const tps =
            generationMs && generationMs > 0 ? outputTokens / (generationMs / 1000) : null;
          if (!hasExplicitCounts) {
            if (detailRecord?.failed === true) {
              existing.failureCount += 1;
            } else {
              existing.successCount += 1;
            }
          }

          addLatencySample(existing.latency, latencyMs);
          addLatencySample(
            existing.firstByteLatency,
            firstByteLatencyMs !== null && firstByteLatencyMs > 0 ? firstByteLatencyMs : null
          );
          if (tps !== null && Number.isFinite(tps) && tps >= 0) {
            existing.totalTps += tps;
            existing.tpsSampleCount += 1;
          }

          if (price && detailRecord) {
            existing.cost += calculateCost(
              { ...(detailRecord as unknown as UsageDetail), __modelName: modelName },
              modelPrices
            );
          }
        });
      }
      modelMap.set(modelName, existing);
    });
  });

  return Array.from(modelMap.entries())
    .map(([model, stats]) => {
      const latencyStats = finalizeLatencyStats(stats.latency);
      const firstByteLatencyStats = finalizeLatencyStats(stats.firstByteLatency);
      return {
        model,
        requests: stats.requests,
        successCount: stats.successCount,
        failureCount: stats.failureCount,
        tokens: stats.tokens,
        cost: stats.cost,
        averageLatencyMs: latencyStats.averageMs,
        averageFirstByteLatencyMs: firstByteLatencyStats.averageMs,
        averageTps: stats.tpsSampleCount > 0 ? stats.totalTps / stats.tpsSampleCount : null,
        latencySampleCount: latencyStats.sampleCount,
        firstByteLatencySampleCount: firstByteLatencyStats.sampleCount,
        tpsSampleCount: stats.tpsSampleCount,
      };
    })
    .sort((a, b) => b.requests - a.requests);
}

/**
 * 格式化小时标签
 */
export function formatHourLabel(date: Date): string {
  if (!(date instanceof Date)) {
    return '';
  }
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hour = date.getHours().toString().padStart(2, '0');
  return `${month}-${day} ${hour}:00`;
}

/**
 * 格式化日期标签
 */
export function formatDayLabel(date: Date): string {
  if (!(date instanceof Date)) {
    return '';
  }
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 构建小时级别的数据序列
 */
export function buildHourlySeriesByModel(
  usageData: unknown,
  metric: 'requests' | 'tokens' = 'requests',
  hourWindow: number = 24
): {
  labels: string[];
  dataByModel: Map<string, number[]>;
  hasData: boolean;
} {
  const hourMs = 60 * 60 * 1000;
  const resolvedHourWindow =
    Number.isFinite(hourWindow) && hourWindow > 0
      ? Math.min(Math.max(Math.floor(hourWindow), 1), 24 * 31)
      : 24;
  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);

  const earliestBucket = new Date(currentHour);
  earliestBucket.setHours(earliestBucket.getHours() - (resolvedHourWindow - 1));
  const earliestTime = earliestBucket.getTime();

  const labels: string[] = [];
  for (let i = 0; i < resolvedHourWindow; i++) {
    const bucketStart = earliestTime + i * hourMs;
    labels.push(formatHourLabel(new Date(bucketStart)));
  }

  const details = collectUsageDetails(usageData);
  const dataByModel = new Map<string, number[]>();
  let hasData = false;

  if (!details.length) {
    return { labels, dataByModel, hasData };
  }

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return;
    }

    const normalized = new Date(timestamp);
    normalized.setMinutes(0, 0, 0);
    const bucketStart = normalized.getTime();
    const lastBucketTime = earliestTime + (labels.length - 1) * hourMs;
    if (bucketStart < earliestTime || bucketStart > lastBucketTime) {
      return;
    }

    const bucketIndex = Math.floor((bucketStart - earliestTime) / hourMs);
    if (bucketIndex < 0 || bucketIndex >= labels.length) {
      return;
    }

    const modelName = detail.__modelName || 'Unknown';
    if (!dataByModel.has(modelName)) {
      dataByModel.set(modelName, new Array(labels.length).fill(0));
    }

    const bucketValues = dataByModel.get(modelName)!;
    if (metric === 'tokens') {
      bucketValues[bucketIndex] += extractTotalTokens(detail);
    } else {
      bucketValues[bucketIndex] += 1;
    }
    hasData = true;
  });

  return { labels, dataByModel, hasData };
}

/**
 * 构建日级别的数据序列
 */
export function buildDailySeriesByModel(
  usageData: unknown,
  metric: 'requests' | 'tokens' = 'requests'
): {
  labels: string[];
  dataByModel: Map<string, number[]>;
  hasData: boolean;
} {
  const details = collectUsageDetails(usageData);
  const valuesByModel = new Map<string, Map<string, number>>();
  const labelsSet = new Set<string>();
  let hasData = false;

  if (!details.length) {
    return { labels: [], dataByModel: new Map(), hasData };
  }

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return;
    }
    const dayLabel = formatDayLabel(new Date(timestamp));
    if (!dayLabel) {
      return;
    }

    const modelName = detail.__modelName || 'Unknown';
    if (!valuesByModel.has(modelName)) {
      valuesByModel.set(modelName, new Map());
    }
    const modelDayMap = valuesByModel.get(modelName)!;
    const increment = metric === 'tokens' ? extractTotalTokens(detail) : 1;
    modelDayMap.set(dayLabel, (modelDayMap.get(dayLabel) || 0) + increment);
    labelsSet.add(dayLabel);
    hasData = true;
  });

  const labels = Array.from(labelsSet).sort();
  const dataByModel = new Map<string, number[]>();
  valuesByModel.forEach((dayMap, modelName) => {
    const series = labels.map((label) => dayMap.get(label) || 0);
    dataByModel.set(modelName, series);
  });

  return { labels, dataByModel, hasData };
}

export function computeKeyStats(
  usageData: unknown,
  masker: (val: string) => string = maskApiKey
): KeyStats {
  const apis = getApisRecord(usageData);
  if (!apis) {
    return { bySource: {}, byAuthIndex: {} };
  }

  const sourceStats: Record<string, KeyStatBucket> = {};
  const authIndexStats: Record<string, KeyStatBucket> = {};

  const ensureBucket = (bucket: Record<string, KeyStatBucket>, key: string) => {
    if (!bucket[key]) {
      bucket[key] = { success: 0, failure: 0 };
    }
    return bucket[key];
  };

  Object.values(apis).forEach((apiEntry) => {
    if (!isRecord(apiEntry)) return;
    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;

    Object.values(models).forEach((modelEntry) => {
      if (!isRecord(modelEntry)) return;
      const details = Array.isArray(modelEntry.details) ? modelEntry.details : [];

      details.forEach((detail) => {
        const detailRecord = isRecord(detail) ? detail : null;
        const source = normalizeUsageSourceId(detailRecord?.source, masker);
        const authIndexKey = normalizeAuthIndex(detailRecord?.auth_index);
        const isFailed = detailRecord?.failed === true;

        if (source) {
          const bucket = ensureBucket(sourceStats, source);
          if (isFailed) {
            bucket.failure += 1;
          } else {
            bucket.success += 1;
          }
        }

        if (authIndexKey) {
          const bucket = ensureBucket(authIndexStats, authIndexKey);
          if (isFailed) {
            bucket.failure += 1;
          } else {
            bucket.success += 1;
          }
        }
      });
    });
  });

  return {
    bySource: sourceStats,
    byAuthIndex: authIndexStats,
  };
}

export function computeKeyStatsFromDetails(usageDetails: UsageDetail[]): KeyStats {
  const bySource: Record<string, KeyStatBucket> = {};
  const byAuthIndex: Record<string, KeyStatBucket> = {};

  const ensureBucket = (bucket: Record<string, KeyStatBucket>, key: string) => {
    if (!bucket[key]) {
      bucket[key] = { success: 0, failure: 0 };
    }
    return bucket[key];
  };

  usageDetails.forEach((detail) => {
    const source = detail.source;
    const authIndexKey = normalizeAuthIndex(detail.auth_index);
    const isFailed = detail.failed === true;

    if (source) {
      const bucket = ensureBucket(bySource, source);
      if (isFailed) {
        bucket.failure += 1;
      } else {
        bucket.success += 1;
      }
    }

    if (authIndexKey) {
      const bucket = ensureBucket(byAuthIndex, authIndexKey);
      if (isFailed) {
        bucket.failure += 1;
      } else {
        bucket.success += 1;
      }
    }
  });

  return { bySource, byAuthIndex };
}

export type TokenCategory = 'input' | 'output' | 'cached' | 'reasoning';

export interface TokenBreakdownSeries {
  labels: string[];
  dataByCategory: Record<TokenCategory, number[]>;
  hasData: boolean;
}

const TOKEN_CATEGORIES: TokenCategory[] = ['input', 'output', 'cached', 'reasoning'];

const extractCategoryTokens = (
  detail: UsageDetail
): Record<TokenCategory, number> => {
  const t = detail.tokens;
  return {
    input: typeof t.input_tokens === 'number' ? Math.max(t.input_tokens, 0) : 0,
    output: typeof t.output_tokens === 'number' ? Math.max(t.output_tokens, 0) : 0,
    cached: Math.max(
      typeof t.cached_tokens === 'number' ? Math.max(t.cached_tokens, 0) : 0,
      typeof (t as { cache_tokens?: number }).cache_tokens === 'number'
        ? Math.max((t as { cache_tokens?: number }).cache_tokens!, 0)
        : 0
    ),
    reasoning: typeof t.reasoning_tokens === 'number' ? Math.max(t.reasoning_tokens, 0) : 0,
  };
};

export function buildHourlyTokenBreakdown(
  usageData: unknown,
  hourWindow: number = 24
): TokenBreakdownSeries {
  const hourMs = 60 * 60 * 1000;
  const resolvedHourWindow =
    Number.isFinite(hourWindow) && hourWindow > 0
      ? Math.min(Math.max(Math.floor(hourWindow), 1), 24 * 31)
      : 24;
  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);

  const earliestBucket = new Date(currentHour);
  earliestBucket.setHours(earliestBucket.getHours() - (resolvedHourWindow - 1));
  const earliestTime = earliestBucket.getTime();

  const labels: string[] = [];
  for (let i = 0; i < resolvedHourWindow; i++) {
    labels.push(formatHourLabel(new Date(earliestTime + i * hourMs)));
  }

  const dataByCategory: Record<TokenCategory, number[]> = {
    input: new Array(labels.length).fill(0),
    output: new Array(labels.length).fill(0),
    cached: new Array(labels.length).fill(0),
    reasoning: new Array(labels.length).fill(0),
  };

  const details = collectUsageDetails(usageData);
  let hasData = false;

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const normalized = new Date(timestamp);
    normalized.setMinutes(0, 0, 0);
    const bucketStart = normalized.getTime();
    const lastBucketTime = earliestTime + (labels.length - 1) * hourMs;
    if (bucketStart < earliestTime || bucketStart > lastBucketTime) return;
    const bucketIndex = Math.floor((bucketStart - earliestTime) / hourMs);
    if (bucketIndex < 0 || bucketIndex >= labels.length) return;

    const tokens = extractCategoryTokens(detail);
    TOKEN_CATEGORIES.forEach((cat) => {
      dataByCategory[cat][bucketIndex] += tokens[cat];
    });
    hasData = true;
  });

  return { labels, dataByCategory, hasData };
}

export function buildDailyTokenBreakdown(usageData: unknown): TokenBreakdownSeries {
  const dayMap: Record<string, Record<TokenCategory, number>> = {};
  let hasData = false;

  collectUsageDetails(usageData).forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const dayLabel = formatDayLabel(new Date(timestamp));
    if (!dayLabel) return;

    if (!dayMap[dayLabel]) {
      dayMap[dayLabel] = { input: 0, output: 0, cached: 0, reasoning: 0 };
    }
    const tokens = extractCategoryTokens(detail);
    TOKEN_CATEGORIES.forEach((cat) => {
      dayMap[dayLabel][cat] += tokens[cat];
    });
    hasData = true;
  });

  const labels = Object.keys(dayMap).sort();
  const dataByCategory: Record<TokenCategory, number[]> = {
    input: labels.map((l) => dayMap[l].input),
    output: labels.map((l) => dayMap[l].output),
    cached: labels.map((l) => dayMap[l].cached),
    reasoning: labels.map((l) => dayMap[l].reasoning),
  };
  return { labels, dataByCategory, hasData };
}

export interface CostSeries {
  labels: string[];
  data: number[];
  hasData: boolean;
}

/**
 * 按小时构建费用时间序列
 */
export function buildHourlyCostSeries(
  usageData: unknown,
  modelPrices: Record<string, ModelPrice>,
  hourWindow: number = 24
): CostSeries {
  const hourMs = 60 * 60 * 1000;
  const resolvedHourWindow =
    Number.isFinite(hourWindow) && hourWindow > 0
      ? Math.min(Math.max(Math.floor(hourWindow), 1), 24 * 31)
      : 24;
  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);

  const earliestBucket = new Date(currentHour);
  earliestBucket.setHours(earliestBucket.getHours() - (resolvedHourWindow - 1));
  const earliestTime = earliestBucket.getTime();

  const labels: string[] = [];
  for (let i = 0; i < resolvedHourWindow; i++) {
    labels.push(formatHourLabel(new Date(earliestTime + i * hourMs)));
  }

  const data = new Array(labels.length).fill(0);
  const details = collectUsageDetails(usageData);
  let hasData = false;

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const normalized = new Date(timestamp);
    normalized.setMinutes(0, 0, 0);
    const bucketStart = normalized.getTime();
    const lastBucketTime = earliestTime + (labels.length - 1) * hourMs;
    if (bucketStart < earliestTime || bucketStart > lastBucketTime) return;
    const bucketIndex = Math.floor((bucketStart - earliestTime) / hourMs);
    if (bucketIndex < 0 || bucketIndex >= labels.length) return;

    const cost = calculateCost(detail, modelPrices);
    if (cost > 0) {
      data[bucketIndex] += cost;
      hasData = true;
    }
  });

  return { labels, data, hasData };
}

/**
 * 按天构建费用时间序列
 */
export function buildDailyCostSeries(
  usageData: unknown,
  modelPrices: Record<string, ModelPrice>
): CostSeries {
  const details = collectUsageDetails(usageData);
  const dayMap: Record<string, number> = {};
  let hasData = false;

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const dayLabel = formatDayLabel(new Date(timestamp));
    if (!dayLabel) return;

    const cost = calculateCost(detail, modelPrices);
    if (cost > 0) {
      dayMap[dayLabel] = (dayMap[dayLabel] || 0) + cost;
      hasData = true;
    }
  });

  const labels = Object.keys(dayMap).sort();
  const data = labels.map((l) => dayMap[l]);

  return { labels, data, hasData };
}
