import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  useAuthStore,
  useModelsStore,
  useThemeStore,
  useNotificationStore,
  useConfigStore,
} from '@/stores';
import { apiKeysApi } from '@/services/api/apiKeys';
import { classifyModels, partitionModelsBySlash } from '@/utils/models';
import { RoutingMindMapModal } from '@/components/modelAlias';
import iconGemini from '@/assets/icons/gemini.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconGlm from '@/assets/icons/glm.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconDeepseek from '@/assets/icons/deepseek.svg';
import iconMinimax from '@/assets/icons/minimax.svg';
import styles from './ModelsPage.module.scss';

const MODEL_CATEGORY_ICONS: Record<string, string | { light: string; dark: string }> = {
  gpt: { light: iconOpenaiLight, dark: iconOpenaiDark },
  claude: iconClaude,
  gemini: iconGemini,
  qwen: iconQwen,
  kimi: { light: iconKimiLight, dark: iconKimiDark },
  glm: iconGlm,
  grok: iconGrok,
  deepseek: iconDeepseek,
  minimax: iconMinimax,
};

export function ModelsPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { showNotification } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const auth = useAuthStore();
  const config = useConfigStore((state) => state.config);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [modelStatus, setModelStatus] = useState<{
    type: 'success' | 'warning' | 'error' | 'muted';
    message: string;
  }>();
  const [mindMapOpen, setMindMapOpen] = useState(false);
  const apiKeysCache = useRef<string[]>([]);

  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '其他' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);

  const getIconForCategory = (categoryId: string): string | null => {
    const iconEntry = MODEL_CATEGORY_ICONS[categoryId];
    if (!iconEntry) return null;
    if (typeof iconEntry === 'string') return iconEntry;
    return resolvedTheme === 'dark' ? iconEntry.dark : iconEntry.light;
  };

  const normalizeApiKeyList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const keys: string[] = [];

    input.forEach((item) => {
      const record =
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      const value =
        typeof item === 'string'
          ? item
          : record
            ? (record['api-key'] ?? record['apiKey'] ?? record.key ?? record.Key)
            : '';
      const trimmed = String(value ?? '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      keys.push(trimmed);
    });

    return keys;
  };

  const resolveApiKeysForModels = useCallback(async () => {
    if (apiKeysCache.current.length) {
      return apiKeysCache.current;
    }

    const configKeys = normalizeApiKeyList(config?.apiKeys);
    if (configKeys.length) {
      apiKeysCache.current = configKeys;
      return configKeys;
    }

    try {
      const list = await apiKeysApi.list();
      const normalized = normalizeApiKeyList(list);
      if (normalized.length) {
        apiKeysCache.current = normalized;
      }
      return normalized;
    } catch (err) {
      console.warn('Auto loading API keys for models failed:', err);
      return [];
    }
  }, [config?.apiKeys]);

  const fetchModels = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
    if (auth.connectionStatus !== 'connected') {
      setModelStatus({
        type: 'warning',
        message: t('notification.connection_required'),
      });
      return;
    }

    if (!auth.apiBase) {
      showNotification(t('notification.connection_required'), 'warning');
      return;
    }

    if (forceRefresh) {
      apiKeysCache.current = [];
    }

    setModelStatus({ type: 'muted', message: t('system_info.models_loading') });
    try {
      const apiKeys = await resolveApiKeysForModels();
      const primaryKey = apiKeys[0];
      const list = await fetchModelsFromStore(auth.apiBase, primaryKey, forceRefresh);
      const hasModels = list.length > 0;
      setModelStatus({
        type: hasModels ? 'success' : 'warning',
        message: hasModels
          ? t('system_info.models_count', { count: list.length })
          : t('system_info.models_empty'),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      const suffix = message ? `: ${message}` : '';
      const text = `${t('system_info.models_error')}${suffix}`;
      setModelStatus({ type: 'error', message: text });
    }
  };

  useEffect(() => {
    if (location.pathname !== '/models') return;
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.connectionStatus, auth.apiBase, location.pathname]);

  return (
    <div className={styles.container}>
      <div className={styles.pageTitleRow}>
        <div className={styles.titleMain}>
          <h1 className={styles.pageTitle}>{t('nav.models')}</h1>
          {modelStatus?.type === 'success' && (
            <span className={`status-badge success ${styles.titleRowStatus}`}>
              {modelStatus.message}
            </span>
          )}
        </div>
        <div className={styles.titleRowActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMindMapOpen(true)}
          >
            {t('models.routing_mindmap_button')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchModels({ forceRefresh: true })}
            loading={modelsLoading}
          >
            {t('common.refresh')}
          </Button>
        </div>
      </div>
      <div className={styles.content}>
        {modelStatus && modelStatus.type !== 'success' && !modelsLoading && (
          <div className={`status-badge ${modelStatus.type}`}>{modelStatus.message}</div>
        )}
        {modelsLoading ? (
          <div className="hint">{t('common.loading')}</div>
        ) : models.length > 0 ? (
          <div className={styles.providerList}>
            {groupedModels.map((group) => {
              const iconSrc = getIconForCategory(group.id);
              return (
                <section key={group.id} className={styles.providerSection}>
                  <div className={styles.providerHeader}>
                    <div className={styles.groupTitle}>
                      {iconSrc && <img src={iconSrc} alt="" className={styles.groupIcon} />}
                      <span className={styles.providerName}>{group.label}</span>
                    </div>
                    <div className={styles.providerCount}>
                      {t('system_info.models_count', { count: group.items.length })}
                    </div>
                  </div>
                  <div className={styles.modelTags}>
                    {(() => {
                      const { standalone, prefixed } = partitionModelsBySlash(group.items);
                      const showGroupLabels = standalone.length > 0 && prefixed.length > 0;
                      const renderTag = (model: (typeof group.items)[0]) => (
                        <span
                          key={`${model.name}-${model.alias ?? 'default'}`}
                          className={styles.modelTag}
                          title={model.description || ''}
                        >
                          <span className={styles.modelName}>{model.name}</span>
                          {model.alias && <span className={styles.modelAlias}>{model.alias}</span>}
                        </span>
                      );
                      return (
                        <>
                          {standalone.length > 0 ? (
                            <div className={styles.modelTagsGroup}>
                              {showGroupLabels ? (
                                <div className={styles.modelTagsSubLabel}>
                                  {t('system_info.models_group_standalone')}
                                </div>
                              ) : null}
                              <div className={styles.modelTagsRow}>{standalone.map(renderTag)}</div>
                            </div>
                          ) : null}
                          {prefixed.length > 0 ? (
                            <div className={styles.modelTagsGroup}>
                              {showGroupLabels ? (
                                <div className={styles.modelTagsSubLabel}>
                                  {t('system_info.models_group_prefixed')}
                                </div>
                              ) : null}
                              <div className={styles.modelTagsRow}>{prefixed.map(renderTag)}</div>
                            </div>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </div>

      <RoutingMindMapModal
        open={mindMapOpen}
        config={config}
        onClose={() => setMindMapOpen(false)}
      />
    </div>
  );
}
