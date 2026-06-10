/**
 * 使用统计相关 API（基于 CPA 内置 request-events）
 */

import { requestEventsApi } from './requestEvents';
import {
  buildUsageSnapshotFromRequestEvents,
  mapRequestEventsToDetails,
} from '@/utils/requestEvents';
import {
  computeKeyStats,
  type KeyStats,
  type UsageDeleteResponse,
  type UsageQueryRange,
} from '@/utils/usage';

export const usageApi = {
  getUsage: async (params?: UsageQueryRange) => {
    const response = await requestEventsApi.list({
      start: params?.start,
      end: params?.end,
    });
    return buildUsageSnapshotFromRequestEvents(response.items);
  },

  deleteUsage: async (ids: string[]) => {
    const result = await requestEventsApi.delete(ids);
    return { deleted: result.deleted } as UsageDeleteResponse;
  },

  async getKeyStats(usageData?: unknown): Promise<KeyStats> {
    if (usageData) {
      const { normalizeUsageData } = await import('@/utils/usage');
      return computeKeyStats(normalizeUsageData(usageData));
    }
    const response = await requestEventsApi.list({ limit: 50000 });
    return computeKeyStats(buildUsageSnapshotFromRequestEvents(response.items));
  },

  listDetails: async (params?: UsageQueryRange) => {
    const response = await requestEventsApi.list({
      start: params?.start,
      end: params?.end,
    });
    return mapRequestEventsToDetails(response.items);
  },
};
