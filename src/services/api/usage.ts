/**
 * 使用统计相关 API（基于 CPA 内置 request-events）
 */

import { requestEventsApi } from './requestEvents';
import { buildUsageSnapshotFromRequestEvents } from '@/utils/requestEvents';
import type { UsageDeleteResponse, UsageQueryRange } from '@/utils/usage';

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
};
