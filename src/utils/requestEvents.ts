import type { RequestEventItem } from '@/services/api/requestEvents';
import {
  buildUsageSnapshotFromDetails,
  type UsageDetailWithEndpoint,
  type UsageStatsSnapshot,
} from '@/utils/usage';

const parseEndpointParts = (endpoint: string) => {
  const match = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/i.exec(endpoint.trim());
  if (!match) {
    return { method: '', path: endpoint };
  }
  return { method: match[1].toUpperCase(), path: match[2] };
};

export const mapRequestEventToDetail = (item: RequestEventItem): UsageDetailWithEndpoint => {
  const endpoint = item.endpoint?.trim() || '-';
  const { method, path } = parseEndpointParts(endpoint);

  return {
    id: item.id,
    request_id: item.request_id,
    timestamp: item.timestamp,
    provider: item.provider,
    source: item.source || '',
    auth_index: item.auth_index ?? null,
    auth_type: item.auth_type,
    api_key_hash: item.api_key_hash,
    account_snapshot: item.account_snapshot,
    auth_label_snapshot: item.auth_label_snapshot,
    auth_file_snapshot: item.auth_file_snapshot,
    auth_provider_snapshot: item.auth_provider_snapshot,
    auth_snapshot_at_ms: item.auth_snapshot_at_ms,
    latency_ms: item.latency_ms ?? undefined,
    failed: item.failed,
    model_alias: item.alias,
    tokens: {
      input_tokens: item.tokens.input_tokens,
      output_tokens: item.tokens.output_tokens,
      reasoning_tokens: item.tokens.reasoning_tokens,
      cached_tokens: item.tokens.cached_tokens,
      cache_tokens: item.tokens.cached_tokens,
      total_tokens: item.tokens.total_tokens,
    },
    __endpoint: endpoint,
    __endpointMethod: method || item.method,
    __endpointPath: path || item.path,
    __modelName: item.model,
    __timestampMs: item.timestamp_ms,
  };
};

export const mapRequestEventsToDetails = (items: RequestEventItem[]): UsageDetailWithEndpoint[] =>
  items.map(mapRequestEventToDetail);

export const buildUsageSnapshotFromRequestEvents = (
  items: RequestEventItem[]
): UsageStatsSnapshot => buildUsageSnapshotFromDetails(mapRequestEventsToDetails(items));
