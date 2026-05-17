import { useEffect, useMemo, useState } from 'react';
import {
  isUsageServiceId,
  normalizeUsageServiceBase,
  usageServiceApi,
} from '@/services/api/usageService';
import { useAuthStore, useUsageServiceStore } from '@/stores';
import { detectApiBaseFromLocation } from '@/utils/connection';

export type RequestMonitoringUnavailableReason =
  | 'checking'
  | 'service_not_configured'
  | 'service_unavailable'
  | 'monitoring_disabled';

export interface RequestMonitoringAvailability {
  checking: boolean;
  available: boolean;
  serviceBase: string;
  reason: RequestMonitoringUnavailableReason | '';
}

export function useRequestMonitoringAvailability(): RequestMonitoringAvailability {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const usageServiceEnabled = useUsageServiceStore((state) => state.enabled);
  const usageServiceBase = useUsageServiceStore((state) => state.serviceBase);
  const usageServiceRevision = useUsageServiceStore((state) => state.revision);
  const [state, setState] = useState<RequestMonitoringAvailability>({
    checking: true,
    available: false,
    serviceBase: '',
    reason: 'checking',
  });

  const candidates = useMemo(
    () =>
      Array.from(
        new Set(
          [
            usageServiceEnabled && usageServiceBase ? usageServiceBase : '',
            apiBase,
            detectApiBaseFromLocation(),
          ]
            .map((value) => normalizeUsageServiceBase(value || ''))
            .filter(Boolean)
        )
      ),
    [apiBase, usageServiceBase, usageServiceEnabled]
  );

  useEffect(() => {
    let cancelled = false;

    const detect = async () => {
      if (!managementKey || candidates.length === 0) {
        setState({
          checking: false,
          available: false,
          serviceBase: '',
          reason: 'service_not_configured',
        });
        return;
      }

      setState((current) => ({ ...current, checking: true, reason: 'checking' }));
      const hasConfiguredUsageService = Boolean(usageServiceEnabled && usageServiceBase);

      for (const candidate of candidates) {
        try {
          const info = await usageServiceApi.getInfo(candidate);
          if (!isUsageServiceId(info.service)) continue;
          const status = await usageServiceApi.getStatus(candidate, managementKey);
          if (cancelled) return;
          const collectorEnabled = status.collector?.collector !== 'stopped';
          setState({
            checking: false,
            available: collectorEnabled,
            serviceBase: candidate,
            reason: collectorEnabled ? '' : 'monitoring_disabled',
          });
          return;
        } catch {
          // 普通管理接口没有 Usage Service 元信息，继续尝试下一个地址。
        }
      }

      if (cancelled) return;
      setState({
        checking: false,
        available: false,
        serviceBase: '',
        reason: hasConfiguredUsageService ? 'service_unavailable' : 'service_not_configured',
      });
    };

    void detect();

    return () => {
      cancelled = true;
    };
  }, [candidates, managementKey, usageServiceBase, usageServiceEnabled, usageServiceRevision]);

  return state;
}
