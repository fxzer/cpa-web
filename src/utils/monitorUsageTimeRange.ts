import type { UsageTimeRange } from '@/utils/usage';
import { DEFAULT_USAGE_TIME_RANGE, isUsageTimeRange } from '@/utils/usageTimeRange';

/** 与监控中心共用 localStorage key，保证首页用量卡片与监控页同一时间范围。 */
export const MONITOR_USAGE_TIME_RANGE_STORAGE_KEY = 'cli-proxy-monitor-time-range-v1';

export function loadMonitorUsageTimeRange(): UsageTimeRange {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_USAGE_TIME_RANGE;
    }
    const raw = localStorage.getItem(MONITOR_USAGE_TIME_RANGE_STORAGE_KEY);
    return isUsageTimeRange(raw) ? raw : DEFAULT_USAGE_TIME_RANGE;
  } catch {
    return DEFAULT_USAGE_TIME_RANGE;
  }
}
