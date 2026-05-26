/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuthStore } from '@/stores';
import { authFilesApi, configFileApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

const QUOTA_TAB_CONFIGS = [
  CODEX_CONFIG,
  CLAUDE_CONFIG,
  ANTIGRAVITY_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
] as const;

type QuotaTabType = 'all' | (typeof QUOTA_TAB_CONFIGS)[number]['type'];

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<QuotaTabType>('all');
  const [globalRefreshTrigger, setGlobalRefreshTrigger] = useState(0);

  const disableControls = connectionStatus !== 'connected';

  const hasCodex = files.some(CODEX_CONFIG.filterFn);
  const hasClaude = files.some(CLAUDE_CONFIG.filterFn);
  const hasAntigravity = files.some(ANTIGRAVITY_CONFIG.filterFn);
  const hasGeminiCli = files.some(GEMINI_CLI_CONFIG.filterFn);
  const hasKimi = files.some(KIMI_CONFIG.filterFn);
  const hasAnyQuota = hasCodex || hasClaude || hasAntigravity || hasGeminiCli || hasKimi;

  const loadConfig = useCallback(async () => {
    try {
      await configFileApi.fetchConfigYaml();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError((prev) => prev || errorMessage);
    }
  }, [t]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadFiles()]);
  }, [loadConfig, loadFiles]);

  const handleGlobalRefresh = useCallback(() => {
    setGlobalRefreshTrigger((prev) => prev + 1);
    void handleHeaderRefresh();
  }, [handleHeaderRefresh]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    loadFiles();
    loadConfig();
  }, [loadFiles, loadConfig]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.pageTitleRow}>
          <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
          {activeTab === 'all' && hasAnyQuota && (
            <Button
              variant="secondary"
              size="sm"
              className={styles.globalRefreshButton}
              onClick={handleGlobalRefresh}
              disabled={loading}
              loading={loading}
            >
              {!loading && <IconRefreshCw size={16} />}
              {t('quota_management.refresh_all_credentials')}
            </Button>
          )}
        </div>
        <p className={styles.description}>{t('quota_management.description')}</p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.tabBar} role="tablist" aria-label={t('quota_management.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'all'}
          className={`${styles.tabItem} ${activeTab === 'all' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('all')}
        >
          {t('auth_files.filter_all')}
        </button>
        {QUOTA_TAB_CONFIGS.map((cfg) => (
          <button
            key={cfg.type}
            type="button"
            role="tab"
            aria-selected={activeTab === cfg.type}
            className={`${styles.tabItem} ${activeTab === cfg.type ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(cfg.type)}
          >
            {t(`${cfg.i18nPrefix}.title`)}
          </button>
        ))}
      </div>

      <div className={styles.tabPanel} role="tabpanel">
        {activeTab === 'all' ? (
          hasAnyQuota ? (
            <div className={styles.allSectionsWrapper}>
              {hasCodex && (
                <QuotaSection
                  config={CODEX_CONFIG}
                  files={files}
                  loading={loading}
                  disabled={disableControls}
                  globalRefreshTrigger={globalRefreshTrigger}
                />
              )}
              {hasClaude && (
                <QuotaSection
                  config={CLAUDE_CONFIG}
                  files={files}
                  loading={loading}
                  disabled={disableControls}
                  globalRefreshTrigger={globalRefreshTrigger}
                />
              )}
              {hasAntigravity && (
                <QuotaSection
                  config={ANTIGRAVITY_CONFIG}
                  files={files}
                  loading={loading}
                  disabled={disableControls}
                  globalRefreshTrigger={globalRefreshTrigger}
                />
              )}
              {hasGeminiCli && (
                <QuotaSection
                  config={GEMINI_CLI_CONFIG}
                  files={files}
                  loading={loading}
                  disabled={disableControls}
                  globalRefreshTrigger={globalRefreshTrigger}
                />
              )}
              {hasKimi && (
                <QuotaSection
                  config={KIMI_CONFIG}
                  files={files}
                  loading={loading}
                  disabled={disableControls}
                  globalRefreshTrigger={globalRefreshTrigger}
                />
              )}
            </div>
          ) : (
            <EmptyState
              title={t('quota_management.empty_title')}
              description={t('quota_management.empty_desc')}
            />
          )
        ) : (
          <>
            {activeTab === 'codex' && (
              <QuotaSection
                config={CODEX_CONFIG}
                files={files}
                loading={loading}
                disabled={disableControls}
              />
            )}
            {activeTab === 'claude' && (
              <QuotaSection
                config={CLAUDE_CONFIG}
                files={files}
                loading={loading}
                disabled={disableControls}
              />
            )}
            {activeTab === 'antigravity' && (
              <QuotaSection
                config={ANTIGRAVITY_CONFIG}
                files={files}
                loading={loading}
                disabled={disableControls}
              />
            )}
            {activeTab === 'gemini-cli' && (
              <QuotaSection
                config={GEMINI_CLI_CONFIG}
                files={files}
                loading={loading}
                disabled={disableControls}
              />
            )}
            {activeTab === 'kimi' && (
              <QuotaSection
                config={KIMI_CONFIG}
                files={files}
                loading={loading}
                disabled={disableControls}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
