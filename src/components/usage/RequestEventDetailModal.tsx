import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { JsonTreeView } from '@/components/usage/JsonTreeView';
import { requestEventsApi, type RequestEventItem } from '@/services/api/requestEvents';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { copyToClipboard } from '@/utils/clipboard';
import styles from '@/pages/UsagePage.module.scss';

interface RequestEventDetailModalProps {
  eventId: string | null;
  onClose: () => void;
}

type TabKey = 'request' | 'response';

export function RequestEventDetailModal({ eventId, onClose }: RequestEventDetailModalProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [activeTab, setActiveTab] = useState<TabKey>('request');
  const [detail, setDetail] = useState<RequestEventItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!eventId) {
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    setActiveTab('request');
    requestEventsApi
      .get(eventId)
      .then((res) => {
        if (!cancelled) {
          setDetail(res);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : '';
          setError(message || t('usage_stats.request_events_detail_error'));
          showNotification(t('usage_stats.request_events_detail_error'), 'error');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, showNotification, t]);

  const parseJson = useCallback((text: string): unknown | null => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }, []);

  const requestBody = detail?.request_body ?? '';
  const responseBody = detail?.response_body ?? '';
  const hasRequestBody = requestBody.length > 0;
  const hasResponseBody = responseBody.length > 0;
  const requestJson = useMemo(() => parseJson(requestBody), [requestBody, parseJson]);
  const responseJson = useMemo(() => parseJson(responseBody), [responseBody, parseJson]);

  const handleCopy = useCallback(async (text: string) => {
    const ok = await copyToClipboard(text);
    showNotification(
      ok ? t('usage_stats.request_events_detail_copy_success') : t('notification.copy_failed'),
      ok ? 'success' : 'error'
    );
  }, [showNotification, t]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'request', label: t('usage_stats.request_events_detail_tab_request') },
    { key: 'response', label: t('usage_stats.request_events_detail_tab_response') },
  ];

  return (
    <Modal
      open={eventId !== null}
      title={t('usage_stats.request_events_detail_title')}
      onClose={onClose}
      width={1200}
    >
      {loading && <div className={styles.hint}>{t('common.loading')}</div>}
      {error && !loading && <div className={styles.hint}>{error}</div>}

      {detail && !loading && (
        <div className={styles.requestEventsDetailBody}>
          <div className={styles.requestEventsDetailMeta}>
            <div className={styles.requestEventsDetailMetaRow}>
              <span className={styles.requestEventsFailureMetaLabel}>
                {t('usage_stats.request_events_failure_log_model')}
              </span>
              <span className={styles.requestEventsFailureMetaValue}>
                {detail.model}{detail.alias ? ` → ${detail.alias}` : ''}
              </span>
            </div>
            <div className={styles.requestEventsDetailMetaRow}>
              <span className={styles.requestEventsFailureMetaLabel}>
                {t('usage_stats.request_events_failure_log_timestamp')}
              </span>
              <span className={styles.requestEventsFailureMetaValue}>
                {detail.timestamp ? new Date(detail.timestamp).toLocaleString() : '-'}
              </span>
            </div>
            {detail.provider && (
              <div className={styles.requestEventsDetailMetaRow}>
                <span className={styles.requestEventsFailureMetaLabel}>
                  {t('usage_stats.request_events_failure_log_source')}
                </span>
                <span className={styles.requestEventsFailureMetaValue}>{detail.provider}</span>
              </div>
            )}
            {detail.latency_ms != null && (
              <div className={styles.requestEventsDetailMetaRow}>
                <span className={styles.requestEventsFailureMetaLabel}>Latency</span>
                <span className={styles.requestEventsFailureMetaValue}>
                  {detail.latency_ms >= 1000
                    ? `${(detail.latency_ms / 1000).toFixed(2)}s`
                    : `${detail.latency_ms}ms`}
                </span>
              </div>
            )}
            {detail.tokens && (
              <div className={styles.requestEventsDetailMetaRow}>
                <span className={styles.requestEventsFailureMetaLabel}>Tokens</span>
                <span className={styles.requestEventsFailureMetaValue}>
                  ↑{detail.tokens.input_tokens} ↓{detail.tokens.output_tokens}
                  {detail.tokens.total_tokens > 0 && <> · Σ{detail.tokens.total_tokens}</>}
                </span>
              </div>
            )}
          </div>

          {detail.failed && detail.fail_body && (
            <div className={styles.requestEventsDetailFailure}>
              {detail.fail_status_code ? (
                <div className={styles.requestEventsDetailFailureHeader}>
                  <span className={styles.requestEventsFailureMetaLabel}>HTTP {detail.fail_status_code}</span>
                </div>
              ) : null}
              <pre className={styles.requestEventsDetailFailureBody}>
                <code>{detail.fail_body}</code>
              </pre>
            </div>
          )}

          <div className={styles.requestEventsDetailTabs}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`${styles.requestEventsDetailTab} ${activeTab === tab.key ? styles.requestEventsDetailTabActive : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className={styles.requestEventsDetailContent}>
            {activeTab === 'request' && (
              <div className={styles.requestEventsDetailSection}>
                <div className={styles.requestEventsDetailSectionHeader}>
                  <span className={styles.requestEventsDetailSectionTitle}>
                    {t('usage_stats.request_events_detail_request_body')}
                  </span>
                  {hasRequestBody && (
                    <button
                      type="button"
                      className={styles.requestEventsCompactBadge}
                      onClick={() => handleCopy(requestBody)}
                    >
                      {t('common.copy', { defaultValue: '复制' })}
                    </button>
                  )}
                </div>
                {hasRequestBody ? (
                    requestJson ? (
                    <div className={styles.requestEventsDetailJsonTree}>
                      <JsonTreeView data={requestJson} />
                    </div>
                  ) : (
                    <pre className={styles.requestEventsDetailCodeBlock}>
                      <code>{requestBody}</code>
                    </pre>
                  )
                ) : (
                  <div className={styles.hint}>{t('usage_stats.request_events_detail_not_available')}</div>
                )}
              </div>
            )}

            {activeTab === 'response' && (
              <div className={styles.requestEventsDetailSection}>
                <div className={styles.requestEventsDetailSectionHeader}>
                  <span className={styles.requestEventsDetailSectionTitle}>
                    {t('usage_stats.request_events_detail_response_body')}
                  </span>
                  {hasResponseBody && (
                    <button
                      type="button"
                      className={styles.requestEventsCompactBadge}
                      onClick={() => handleCopy(responseBody)}
                    >
                      {t('common.copy', { defaultValue: '复制' })}
                    </button>
                  )}
                </div>
                {hasResponseBody ? (
                    responseJson ? (
                    <div className={styles.requestEventsDetailJsonTree}>
                      <JsonTreeView data={responseJson} />
                    </div>
                  ) : (
                    <pre className={styles.requestEventsDetailCodeBlock}>
                      <code>{responseBody}</code>
                    </pre>
                  )
                ) : (
                  <div className={styles.hint}>
                    {detail.failed
                      ? t('usage_stats.request_events_detail_not_available')
                      : t('usage_stats.request_events_detail_streaming_hint')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
