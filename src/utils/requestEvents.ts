import type { RequestEventItem, RequestEventsAggregate } from '@/services/api/requestEvents';
import {
  buildUsageSnapshotFromDetails,
  formatDayLabel,
  type ServiceHealthGrid,
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

/**
 * 用聚合接口的小时桶还原「最近 7 天 × 24 小时」的服务健康网格，
 * 替代原先把全量事件拉到前端逐条统计的 buildServiceHealthGrid。
 *
 * 说明：聚合桶按 UTC 整小时划分（bucket_ms 为该 UTC 小时起点），
 * 这里用本地时区把它定位到对应的 (日期, 小时)。对整小时偏移的时区，
 * 一个 UTC 小时桶正好落在一个本地小时内；分时区会有边界误差，影响很小。
 */
export function buildServiceHealthGridFromAggregate(agg: RequestEventsAggregate): ServiceHealthGrid {
  const ROWS = 7;
  const COLS = 24;
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWindow = new Date(startOfToday);
  startOfWindow.setDate(startOfWindow.getDate() - (ROWS - 1));
  const windowStartMs = startOfWindow.getTime();

  const cells: ServiceHealthGrid['cells'] = [];
  const labels: string[] = [];
  let totalSuccess = 0;
  let totalFailure = 0;
  for (let row = 0; row < ROWS; row++) {
    const day = new Date(startOfWindow);
    day.setDate(day.getDate() + row);
    labels.push(formatDayLabel(day));
    const hourCells = Array.from({ length: COLS }, () => ({ success: 0, failure: 0, rate: -1 }));
    cells.push(hourCells);
  }

  agg.requests_by_hour.forEach((bucket) => {
    if (!bucket || typeof bucket.bucket_ms !== 'number') return;
    const d = new Date(bucket.bucket_ms);
    const dayStart = new Date(d);
    dayStart.setHours(0, 0, 0, 0);
    const rowIndex = Math.floor((dayStart.getTime() - windowStartMs) / 86_400_000);
    if (rowIndex < 0 || rowIndex >= ROWS) return;
    const hour = d.getHours();
    if (hour < 0 || hour >= COLS) return;
    const cell = cells[rowIndex][hour];
    cell.success += bucket.success;
    cell.failure += bucket.failure;
    totalSuccess += bucket.success;
    totalFailure += bucket.failure;
  });

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = cells[row][col];
      const total = cell.success + cell.failure;
      cell.rate = total > 0 ? cell.success / total : -1;
    }
  }

  const overallTotal = totalSuccess + totalFailure;
  return {
    rows: ROWS,
    cols: COLS,
    cells,
    labels,
    totalSuccess,
    totalFailure,
    overallRate: overallTotal > 0 ? totalSuccess / overallTotal : -1,
  };
}
