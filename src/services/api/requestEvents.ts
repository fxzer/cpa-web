/**
 * 请求事件持久化 API（CPA 内置 SQLite）
 */

import { apiClient } from './client';
import type { ModelPrice } from '@/utils/usage';

const REQUEST_EVENTS_TIMEOUT_MS = 60 * 1000;

/** 拉取请求事件列表时的默认上限 */
export const MAX_REQUEST_EVENTS_LIMIT = 50_000;

export interface RequestEventTokens {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  total_tokens: number;
}

export interface RequestEventItem {
  id: string;
  request_id?: string;
  timestamp: string;
  timestamp_ms: number;
  provider?: string;
  model: string;
  alias?: string;
  endpoint?: string;
  method?: string;
  path?: string;
  auth_type?: string;
  auth_index?: string;
  source?: string;
  api_key_hash?: string;
  account_snapshot?: string;
  auth_label_snapshot?: string;
  auth_file_snapshot?: string;
  auth_provider_snapshot?: string;
  auth_snapshot_at_ms?: number;
  latency_ms?: number;
  failed: boolean;
  fail_body?: string;
  fail_status_code?: number;
  tokens: RequestEventTokens;
  request_body?: string;
  response_body?: string;
}

export interface RequestEventSummary {
  total_requests: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
}

export interface RequestEventsListResponse {
  items: RequestEventItem[];
  summary: RequestEventSummary;
}

export interface RequestEventsStatusResponse {
  db_path?: string;
  event_count?: number;
  dead_letters?: number;
  writer?: {
    queued?: number;
    dropped?: number;
    last_flush_at?: number;
    inserted?: number;
    skipped?: number;
    dead_letters?: number;
  };
}

export interface RequestEventsQuery {
  start?: string;
  end?: string;
  limit?: number;
}

export const requestEventsApi = {
  list: (params?: RequestEventsQuery) =>
    apiClient.get<RequestEventsListResponse>('/request-events', {
      timeout: REQUEST_EVENTS_TIMEOUT_MS,
      params,
    }),

  get: (id: string) =>
    apiClient.get<RequestEventItem>(`/request-events/${encodeURIComponent(id)}`, {
      timeout: REQUEST_EVENTS_TIMEOUT_MS,
    }),

  status: () =>
    apiClient.get<RequestEventsStatusResponse>('/request-events/status', {
      timeout: 15_000,
    }),

  delete: (ids: string[]) =>
    apiClient.delete<{ deleted: number }>('/request-events', {
      timeout: REQUEST_EVENTS_TIMEOUT_MS,
      data: { ids },
    }),

  export: () =>
    apiClient.get<Blob>('/request-events/export', {
      timeout: REQUEST_EVENTS_TIMEOUT_MS,
      responseType: 'blob',
    }),

  import: (body: string | Blob) =>
    apiClient.post<{ added: number; skipped: number; total: number; failed: number }>(
      '/request-events/import',
      body,
      {
        timeout: REQUEST_EVENTS_TIMEOUT_MS,
        headers:
          typeof body === 'string'
            ? { 'Content-Type': 'application/x-ndjson' }
            : { 'Content-Type': 'application/octet-stream' },
      }
    ),
};

export const modelPricesApi = {
  get: () => apiClient.get<{ prices: Record<string, ModelPrice> }>('/model-prices'),

  put: (prices: Record<string, ModelPrice>) =>
    apiClient.put<{ prices: Record<string, ModelPrice> }>('/model-prices', { prices }),

  syncLiteLLM: (models?: string[]) =>
    apiClient.post<{
      source: string;
      imported: number;
      skipped: number;
      prices: Record<string, ModelPrice>;
    }>('/model-prices/sync-litellm', { models: models ?? [] }),
};
