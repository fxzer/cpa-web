import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AuthRefreshQueueItem } from '@/types/authRefreshQueue';
import { parseTimestampMs } from '@/utils/timestamp';
import styles from '@/pages/CredentialCenterPage.module.scss';

const ONE_MINUTE_MS = 60 * 1000;
const TEN_MINUTES_MS = 10 * ONE_MINUTE_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

type RefreshBucketId = 'within_1m' | 'within_10m' | 'within_1h' | 'within_1d' | 'within_7d' | 'longer';

interface RefreshBucketDefinition {
  id: RefreshBucketId;
  labelKey: string;
  maxMs: number;
  toneClass: string;
}

interface RefreshQueueEntry {
  item: AuthRefreshQueueItem;
  refreshAtMs: number;
  deltaMs: number;
  bucketId: RefreshBucketId;
}

interface AuthRefreshQueueCountdownCardProps {
  queue: AuthRefreshQueueItem[];
  loading: boolean;
  error: string | null;
  generatedAt?: string | null;
  onRefresh: () => void;
}

const getDisplayName = (item: AuthRefreshQueueItem): string =>
  item.name?.trim() || item.id?.trim() || item.auth_index?.trim() || '--';

const getBucketId = (deltaMs: number): RefreshBucketId => {
  if (deltaMs <= ONE_MINUTE_MS) return 'within_1m';
  if (deltaMs <= TEN_MINUTES_MS) return 'within_10m';
  if (deltaMs <= ONE_HOUR_MS) return 'within_1h';
  if (deltaMs <= ONE_DAY_MS) return 'within_1d';
  if (deltaMs <= SEVEN_DAYS_MS) return 'within_7d';
  return 'longer';
};

const formatClockTime = (timestampMs: number): string =>
  new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestampMs));

/** 与 RequestMonitoringPage `REQUEST_MONITORING_STATUS_ACCENTS[0]` 一致，用于「最早刷新」与「更长时间」中性格 */
const STATUS_CARD_NEUTRAL = {
  accent: '#8b8680',
  accentSoft: 'rgba(139, 134, 128, 0.18)',
  accentBorder: 'rgba(139, 134, 128, 0.35)'
} as const;

/**
 * 与 RequestMonitoringPage 顶部 `StatusCard` 相同写法：--accent / --accent-soft / --accent-border
 * 数值与时段语义对齐（红→橙→蓝→紫→灰）
 */
const REFRESH_QUEUE_BUCKET_CARD_ACCENTS: Record<
  RefreshBucketId,
  { accent: string; accentSoft: string; accentBorder: string }
> = {
  within_1m: {
    accent: '#dc2626',
    accentSoft: 'rgba(220, 38, 38, 0.18)',
    accentBorder: 'rgba(220, 38, 38, 0.35)'
  },
  within_10m: {
    accent: '#f97316',
    accentSoft: 'rgba(249, 115, 22, 0.18)',
    accentBorder: 'rgba(249, 115, 22, 0.32)'
  },
  within_1h: {
    accent: '#d97706',
    accentSoft: 'rgba(217, 119, 6, 0.18)',
    accentBorder: 'rgba(217, 119, 6, 0.32)'
  },
  within_1d: {
    accent: '#2563eb',
    accentSoft: 'rgba(37, 99, 235, 0.16)',
    accentBorder: 'rgba(37, 99, 235, 0.3)'
  },
  within_7d: {
    accent: '#7c3aed',
    accentSoft: 'rgba(124, 58, 237, 0.16)',
    accentBorder: 'rgba(124, 58, 237, 0.3)'
  },
  longer: STATUS_CARD_NEUTRAL
};

const bucketCardAccentStyle = (accent: (typeof REFRESH_QUEUE_BUCKET_CARD_ACCENTS)[RefreshBucketId]): CSSProperties =>
  ({
    '--accent': accent.accent,
    '--accent-soft': accent.accentSoft,
    '--accent-border': accent.accentBorder
  }) as CSSProperties;

export function AuthRefreshQueueCountdownCard({
  queue,
  loading,
  error,
  generatedAt,
  onRefresh
}: AuthRefreshQueueCountdownCardProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const [activeBucketId, setActiveBucketId] = useState<RefreshBucketId | null>(null);
  const bucketAreaRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeBucketId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (detailsRef.current?.contains(target)) return;
      if (bucketAreaRef.current?.contains(target)) return;
      setActiveBucketId(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveBucketId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeBucketId]);

  const bucketDefinitions = useMemo<RefreshBucketDefinition[]>(
    () => [
      {
        id: 'within_1m',
        labelKey: 'credential_center.refresh_queue_bucket_1m',
        maxMs: ONE_MINUTE_MS,
        toneClass: styles.refreshQueueBucketDanger
      },
      {
        id: 'within_10m',
        labelKey: 'credential_center.refresh_queue_bucket_10m',
        maxMs: TEN_MINUTES_MS,
        toneClass: styles.refreshQueueBucketWarning
      },
      {
        id: 'within_1h',
        labelKey: 'credential_center.refresh_queue_bucket_1h',
        maxMs: ONE_HOUR_MS,
        toneClass: styles.refreshQueueBucketNotice
      },
      {
        id: 'within_1d',
        labelKey: 'credential_center.refresh_queue_bucket_1d',
        maxMs: ONE_DAY_MS,
        toneClass: styles.refreshQueueBucketInfo
      },
      {
        id: 'within_7d',
        labelKey: 'credential_center.refresh_queue_bucket_7d',
        maxMs: SEVEN_DAYS_MS,
        toneClass: styles.refreshQueueBucketCalm
      },
      {
        id: 'longer',
        labelKey: 'credential_center.refresh_queue_bucket_longer',
        maxMs: Number.POSITIVE_INFINITY,
        toneClass: styles.refreshQueueBucketMuted
      }
    ],
    []
  );

  const entries = useMemo<RefreshQueueEntry[]>(
    () =>
      queue
        .map((item) => {
          const refreshAtMs = parseTimestampMs(item.next_refresh_at);
          if (!Number.isFinite(refreshAtMs)) return null;
          const deltaMs = refreshAtMs - now;
          return {
            item,
            refreshAtMs,
            deltaMs,
            bucketId: getBucketId(deltaMs)
          };
        })
        .filter((entry): entry is RefreshQueueEntry => entry !== null)
        .sort((left, right) => left.refreshAtMs - right.refreshAtMs),
    [now, queue]
  );

  const buckets = useMemo(
    () =>
      bucketDefinitions.map((definition) => ({
        ...definition,
        entries: entries.filter((entry) => entry.bucketId === definition.id)
      })),
    [bucketDefinitions, entries]
  );

  const earliestEntry = entries[0] ?? null;
  const generatedAtMs = generatedAt ? parseTimestampMs(generatedAt) : Number.NaN;

  const formatDuration = useCallback(
    (durationMs: number): string => {
      if (durationMs <= 0) return t('credential_center.refresh_queue_due_now');

      const totalSeconds = Math.ceil(durationMs / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (days > 0) return `${days}${t('usage_stats.duration_unit_d')} ${hours}${t('usage_stats.duration_unit_h')}`;
      if (hours > 0) return `${hours}${t('usage_stats.duration_unit_h')} ${minutes}${t('usage_stats.duration_unit_m')}`;
      if (minutes > 0) return `${minutes}${t('usage_stats.duration_unit_m')} ${seconds}${t('usage_stats.duration_unit_s')}`;
      return `${seconds}${t('usage_stats.duration_unit_s')}`;
    },
    [t]
  );

  const formatDueLabel = useCallback(
    (durationMs: number): string =>
      durationMs <= 0
        ? t('credential_center.refresh_queue_due_now')
        : t('credential_center.refresh_queue_due_in', { time: formatDuration(durationMs) }),
    [formatDuration, t]
  );

  const toggleBucket = useCallback((bucketId: RefreshBucketId) => {
    setActiveBucketId((current) => (current === bucketId ? null : bucketId));
  }, []);

  return (
    <Card
      title={t('credential_center.refresh_queue_title')}
      className={styles.refreshQueueCard}
      extra={
        <div className={styles.refreshQueueHeaderMeta}>
          <span>{t('credential_center.refresh_queue_total', { count: entries.length })}</span>
          {Number.isFinite(generatedAtMs) && (
            <span>{t('credential_center.refresh_queue_snapshot', { time: formatClockTime(generatedAtMs) })}</span>
          )}
          <Button variant="secondary" size="sm" onClick={onRefresh} loading={loading}>
            {t('credential_center.refresh_queue_refresh')}
          </Button>
        </div>
      }
    >
      {loading && entries.length === 0 ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : entries.length === 0 && !error ? (
        <EmptyState
          title={t('credential_center.refresh_queue_empty_title')}
          description={t('credential_center.refresh_queue_empty_desc')}
        />
      ) : (
        <div className={styles.refreshQueueFloatingRoot}>
          <div className={styles.refreshQueueSummary}>
            <div className={styles.refreshQueueEarliestSlot}>
              <div
                className={styles.refreshQueueStatusCard}
                style={bucketCardAccentStyle(STATUS_CARD_NEUTRAL)}
              >
                <div className={styles.refreshQueueStatusCardLabel}>
                  {t('credential_center.refresh_queue_earliest')}
                </div>
                <div className={styles.refreshQueueStatusCardValue}>
                  {earliestEntry ? formatDueLabel(earliestEntry.deltaMs) : '--'}
                </div>
                {earliestEntry && (
                  <div className={styles.refreshQueueStatusCardMeta}>
                    {getDisplayName(earliestEntry.item)}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.refreshQueueBuckets} ref={bucketAreaRef}>
              {buckets.map((bucket) => {
                const isActive = activeBucketId === bucket.id;
                const isEmpty = bucket.entries.length === 0;
                const bucketCellClassName = [styles.refreshQueueBucketCell, bucket.toneClass]
                  .filter(Boolean)
                  .join(' ');
                const cardAccent = REFRESH_QUEUE_BUCKET_CARD_ACCENTS[bucket.id];
                const buttonClassName = [
                  styles.refreshQueueStatusCard,
                  styles.refreshQueueStatusCardInteractive,
                  isActive ? styles.refreshQueueStatusCardActive : '',
                  isEmpty ? styles.refreshQueueBucketEmpty : ''
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <div key={bucket.id} className={bucketCellClassName}>
                    <button
                      type="button"
                      className={buttonClassName}
                      style={bucketCardAccentStyle(cardAccent)}
                      onClick={() => toggleBucket(bucket.id)}
                      aria-pressed={isActive}
                    >
                      <div className={styles.refreshQueueStatusCardLabel}>{t(bucket.labelKey)}</div>
                      <div className={styles.refreshQueueStatusCardValue}>{bucket.entries.length}</div>
                    </button>
                    {isActive && (
                      <div className={styles.refreshQueueDetails} ref={detailsRef}>
                        <div className={styles.refreshQueueDetailsTitle}>
                          {t('credential_center.refresh_queue_details_title', {
                            bucket: t(bucket.labelKey),
                            count: bucket.entries.length
                          })}
                        </div>
                        {bucket.entries.length === 0 ? (
                          <div className={styles.hint}>{t('credential_center.refresh_queue_bucket_empty')}</div>
                        ) : (
                          <div className={styles.refreshQueueDetailList}>
                            {bucket.entries.map((entry) => (
                              <div key={`${entry.item.id}:${entry.item.auth_index}:${entry.item.next_refresh_at}`} className={styles.refreshQueueDetailRow}>
                                <div className={styles.refreshQueueDetailNameBlock}>
                                  <span className={styles.refreshQueueDetailName}>{getDisplayName(entry.item)}</span>
                                  <span className={styles.credentialType}>{entry.item.provider || '--'}</span>
                                </div>
                                <div className={styles.refreshQueueDetailTime}>{formatClockTime(entry.refreshAtMs)}</div>
                                <div className={styles.refreshQueueDetailCountdown}>{formatDuration(entry.deltaMs)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {error && <div className={styles.refreshQueueError}>{error}</div>}
    </Card>
  );
}
