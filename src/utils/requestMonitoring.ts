import {
  buildConfiguredCredentialLookup,
  buildCredentialDisplay,
  resolveConfiguredCredential,
  type SourceInfoMapInput,
} from './credentialResolver';
import {
  collectUsageDetailsWithEndpoint,
  extractTotalTokens,
  normalizeAuthIndex,
  type UsageDetailWithEndpoint,
} from './usage';

export type RequestMonitoringStatus = 'success' | 'failed';
export type RequestMonitoringStatusFilter = 'all' | RequestMonitoringStatus;

export interface RequestMonitoringRow {
  id: string;
  requestId: string;
  timestampMs: number;
  timestampLabel: string;
  status: RequestMonitoringStatus;
  provider: string;
  model: string;
  endpoint: string;
  endpointMethod: string;
  endpointPath: string;
  authIndex: string;
  authType: string;
  account: string;
  authLabel: string;
  authFile: string;
  resolvedApiKey: string;
  credentialSubtitle: string;
  source: string;
  apiKeyHash: string;
  apiKeyHashShort: string;
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export interface RequestMonitoringFilters {
  search: string;
  status: RequestMonitoringStatusFilter;
  provider: string;
  model: string;
  apiKeyHash: string;
}

const EMPTY_LABEL = '-';

const firstText = (...values: Array<unknown>): string => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = typeof value === 'string' ? value.trim() : String(value).trim();
    if (text) return text;
  }
  return '';
};

const displaySource = (source: string): string => {
  if (!source) return '';
  if (source.startsWith('m:') || source.startsWith('t:')) {
    return source.slice(2);
  }
  if (source.startsWith('k:')) {
    return `hash ${source.slice(2, 14)}`;
  }
  return source;
};

const shortHash = (hash: string): string => {
  const normalized = hash.trim().toLowerCase();
  if (!normalized) return '';
  return normalized.length > 16 ? `${normalized.slice(0, 12)}...` : normalized;
};

/** 凭证列主标题：优先展示供应商名；副标题由 buildCredentialDisplay 生成 */
const buildCredentialHeadline = (
  detail: UsageDetailWithEndpoint,
  credentialLookup: ReturnType<typeof buildConfiguredCredentialLookup>
): { account: string; resolvedApiKey: string; credentialSubtitle: string } => {
  const resolvedCredential = resolveConfiguredCredential(credentialLookup, {
    authIndex: detail.auth_index,
    apiKeyHash: firstText(detail.api_key_hash),
    source: firstText(detail.source),
  });
  const display = buildCredentialDisplay({
    provider: firstText(detail.provider),
    authProviderSnapshot: firstText(detail.auth_provider_snapshot),
    accountSnapshot: firstText(detail.account_snapshot),
    authLabelSnapshot: firstText(detail.auth_label_snapshot),
    authFileSnapshot: firstText(detail.auth_file_snapshot),
    resolvedCredential,
  });
  return {
    account: display.headline,
    resolvedApiKey: display.resolvedApiKey,
    credentialSubtitle: display.subtitle,
  };
};

const formatTimestamp = (timestampMs: number, fallback: string): string => {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return fallback || EMPTY_LABEL;
  }
  return new Date(timestampMs).toLocaleString();
};

const buildRowSearchText = (row: RequestMonitoringRow): string =>
  [
    row.requestId,
    row.provider,
    row.model,
    row.endpoint,
    row.endpointMethod,
    row.endpointPath,
    row.authIndex,
    row.authType,
    row.account,
    row.authLabel,
    row.authFile,
    row.resolvedApiKey,
    row.credentialSubtitle,
    row.source,
    row.apiKeyHash,
  ]
    .join(' ')
    .toLowerCase();

export const buildRequestMonitoringRows = (
  usagePayload: unknown,
  credentialConfig?: SourceInfoMapInput
): RequestMonitoringRow[] => {
  const details = collectUsageDetailsWithEndpoint(usagePayload);
  const credentialLookup = buildConfiguredCredentialLookup(credentialConfig ?? {});

  return details
    .map((detail: UsageDetailWithEndpoint, index): RequestMonitoringRow => {
      const requestId = firstText(detail.request_id, detail.id);
      const provider = firstText(detail.provider, detail.auth_provider_snapshot);
      const authIndex = normalizeAuthIndex(detail.auth_index) ?? '';
      const apiKeyHash = firstText(detail.api_key_hash);
      const source = displaySource(firstText(detail.source));
      const credential = buildCredentialHeadline(detail, credentialLookup);
      const account = credential.account;
      const latencyMs =
        typeof detail.latency_ms === 'number' && Number.isFinite(detail.latency_ms)
          ? detail.latency_ms
          : null;
      const totalTokens = extractTotalTokens(detail);

      return {
        id:
          detail.id ||
          requestId ||
          `${detail.__timestampMs || detail.timestamp}-${detail.__endpoint}-${detail.__modelName}-${authIndex}-${index}`,
        requestId,
        timestampMs: detail.__timestampMs,
        timestampLabel: formatTimestamp(detail.__timestampMs, detail.timestamp),
        status: detail.failed ? 'failed' : 'success',
        provider: provider || EMPTY_LABEL,
        model: firstText(detail.__modelName) || EMPTY_LABEL,
        endpoint: firstText(detail.__endpoint) || EMPTY_LABEL,
        endpointMethod: firstText(detail.__endpointMethod) || EMPTY_LABEL,
        endpointPath: firstText(detail.__endpointPath) || EMPTY_LABEL,
        authIndex: authIndex || EMPTY_LABEL,
        authType: firstText(detail.auth_type) || EMPTY_LABEL,
        account: account || EMPTY_LABEL,
        authLabel: firstText(detail.auth_label_snapshot) || EMPTY_LABEL,
        authFile: firstText(detail.auth_file_snapshot) || EMPTY_LABEL,
        resolvedApiKey: credential.resolvedApiKey || EMPTY_LABEL,
        credentialSubtitle: credential.credentialSubtitle || EMPTY_LABEL,
        source: source || EMPTY_LABEL,
        apiKeyHash,
        apiKeyHashShort: shortHash(apiKeyHash) || EMPTY_LABEL,
        latencyMs,
        inputTokens: detail.tokens.input_tokens,
        outputTokens: detail.tokens.output_tokens,
        reasoningTokens: detail.tokens.reasoning_tokens,
        cachedTokens: Math.max(detail.tokens.cached_tokens, detail.tokens.cache_tokens ?? 0),
        totalTokens,
      };
    })
    .sort((left, right) => right.timestampMs - left.timestampMs);
};

export const filterRequestMonitoringRows = (
  rows: readonly RequestMonitoringRow[],
  filters: RequestMonitoringFilters
): RequestMonitoringRow[] => {
  const search = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.status !== 'all' && row.status !== filters.status) return false;
    if (filters.provider && row.provider !== filters.provider) return false;
    if (filters.model && row.model !== filters.model) return false;
    if (filters.apiKeyHash && row.apiKeyHash !== filters.apiKeyHash) return false;
    if (search && !buildRowSearchText(row).includes(search)) return false;
    return true;
  });
};

export const buildRequestMonitoringOptions = (
  rows: readonly RequestMonitoringRow[],
  field: 'provider' | 'model' | 'apiKeyHash'
): string[] => {
  const values = new Set<string>();
  rows.forEach((row) => {
    const value = row[field];
    if (value && value !== EMPTY_LABEL) values.add(value);
  });
  return Array.from(values).sort((left, right) => left.localeCompare(right));
};
