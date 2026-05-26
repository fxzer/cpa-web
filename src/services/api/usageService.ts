import axios from 'axios';
import { normalizeApiBase } from '@/utils/connection';

export interface UsageServiceInfo {
  service?: string;
  mode?: string;
  startedAt?: number;
  configured?: boolean;
}

export interface UsageServiceCollectorStatus {
  collector?: string;
  upstream?: string;
  mode?: string;
  transport?: string;
  queue?: string;
  lastConsumedAt?: number;
  lastInsertedAt?: number;
  totalInserted?: number;
  totalSkipped?: number;
  deadLetters?: number;
  lastError?: string;
}

export interface UsageServiceStatus {
  service?: string;
  dbPath?: string;
  events?: number;
  deadLetters?: number;
  collector?: UsageServiceCollectorStatus;
}

export interface UsageServiceSetupRequest {
  cpaBaseUrl: string;
  managementKey: string;
  collectorMode?: 'auto' | 'http' | 'resp';
  batchSize?: number;
  pollIntervalMs?: number;
  queryLimit?: number;
  requestMonitoringEnabled?: boolean;
  ensureUsageStatisticsEnabled?: boolean;
}

export interface UsageServiceApiError extends Error {
  status?: number;
  code?: string;
  data?: unknown;
}

export type UsageServicePayload = Record<string, unknown>;

export const USAGE_SERVICE_ID = 'cpa-manager';
export const LEGACY_USAGE_SERVICE_ID = 'cpa-usage-service';

const USAGE_SERVICE_TIMEOUT_MS = 15_000;
const USAGE_SERVICE_USAGE_TIMEOUT_MS = 60_000;

export const isUsageServiceId = (service?: string): boolean =>
  service === USAGE_SERVICE_ID || service === LEGACY_USAGE_SERVICE_ID;

export const normalizeUsageServiceBase = (input: string): string => normalizeApiBase(input);

const buildUrl = (base: string, path: string): string => {
  const normalized = normalizeUsageServiceBase(base).replace(/\/+$/, '');
  return `${normalized}${path}`;
};

const authHeaders = (managementKey?: string) =>
  managementKey ? { Authorization: `Bearer ${managementKey}` } : undefined;

const readErrorMessage = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.error === 'string') return record.error;
  if (typeof record.message === 'string') return record.message;
  return '';
};

const toUsageServiceApiError = (error: unknown): UsageServiceApiError => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    const message = readErrorMessage(data) || error.message || 'Usage Service request failed';
    const apiError = new Error(message) as UsageServiceApiError;
    apiError.name = 'UsageServiceApiError';
    apiError.status = error.response?.status;
    apiError.code =
      typeof data === 'object' && data && typeof (data as Record<string, unknown>).code === 'string'
        ? String((data as Record<string, unknown>).code)
        : error.code;
    apiError.data = data;
    return apiError;
  }

  if (error instanceof Error) return error as UsageServiceApiError;
  const fallback = new Error(
    typeof error === 'string' ? error : 'Usage Service request failed'
  ) as UsageServiceApiError;
  fallback.name = 'UsageServiceApiError';
  return fallback;
};

const withUsageServiceError = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw toUsageServiceApiError(error);
  }
};

export const usageServiceApi = {
  getInfo: async (base: string): Promise<UsageServiceInfo> =>
    withUsageServiceError(async () => {
      const response = await axios.get<UsageServiceInfo>(buildUrl(base, '/usage-service/info'), {
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      });
      return response.data;
    }),

  setup: async (base: string, payload: UsageServiceSetupRequest): Promise<void> =>
    withUsageServiceError(async () => {
      await axios.post(buildUrl(base, '/setup'), payload, {
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      });
    }),

  getStatus: async (base: string, managementKey?: string): Promise<UsageServiceStatus> =>
    withUsageServiceError(async () => {
      const response = await axios.get<UsageServiceStatus>(buildUrl(base, '/status'), {
        timeout: USAGE_SERVICE_TIMEOUT_MS,
        headers: authHeaders(managementKey),
      });
      return response.data;
    }),

  getUsage: async (base: string, managementKey?: string): Promise<UsageServicePayload> =>
    withUsageServiceError(async () => {
      const response = await axios.get<UsageServicePayload>(
        buildUrl(base, '/v0/management/usage'),
        {
          timeout: USAGE_SERVICE_USAGE_TIMEOUT_MS,
          headers: authHeaders(managementKey),
        }
      );
      return response.data;
    }),
};
