import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ProviderConfigToggle } from '../ProviderConfigToggle';
import iconCodex from '@/assets/icons/codex.svg';
import type { ProviderKeyConfig } from '@/types';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import { ProviderConfigApiKeyEntriesList } from '../ProviderConfigApiKeyEntriesList';
import styles from '@/pages/AiProvidersPage.module.scss';
import { ProviderList } from '../ProviderList';
import { ProviderModelsPreview } from '../ProviderModelsPreview';
import { CopyableUrlValue } from '../CopyableUrlValue';
import { ProviderSectionCardTitle } from '../ProviderSectionCardTitle';
import { ProviderPrefixPriorityRow } from '../ProviderPrefixPriorityRow';
import { ProviderStatusBar } from '../ProviderStatusBar';
import {
  collectProviderKeyConfigRecentBuckets,
  getProviderConfigKey,
  getProviderKeyConfigRecentStats,
  hasDisableAllModelsRule,
  buildProviderOverviewLabel,
  type ProviderRecentUsageMap,
} from '../utils';
import type { ProviderAliasOverviewRequest } from '../types';
import { AI_PROVIDER_ALIAS_CHANNEL } from '@/utils/providerModelAliasCatalog';

interface CodexSectionProps {
  configs: ProviderKeyConfig[];
  usageByProvider: ProviderRecentUsageMap;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
  onAliasOverview?: (request: ProviderAliasOverviewRequest) => void;
}

export function CodexSection({
  configs,
  usageByProvider,
  loading,
  disableControls,
  isSwitching,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  onAliasOverview,
}: CodexSectionProps) {
  const { t } = useTranslation();
  const actionsDisabled = disableControls || loading || isSwitching;
  const toggleDisabled = disableControls || loading || isSwitching;

  const statusBarCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof statusBarDataFromRecentRequests>>();

    configs.forEach((config, index) => {
      
      const configKey = getProviderConfigKey(config, index);
      cache.set(
        configKey,
        statusBarDataFromRecentRequests(
          collectProviderKeyConfigRecentBuckets('codex', config, usageByProvider)
        )
      );
    });

    return cache;
  }, [configs, usageByProvider]);

  return (
    <>
      <Card
        title={
          <ProviderSectionCardTitle
            icon={<img src={iconCodex} alt="" className={styles.cardTitleIcon} />}
            title={t('ai_providers.codex_title')}
            count={configs.length}
          />
        }
        extra={
          <Button size="sm" onClick={onAdd} disabled={actionsDisabled}>
            {t('ai_providers.codex_add_button')}
          </Button>
        }
      >
        <ProviderList<ProviderKeyConfig>
          items={configs}
          loading={loading}
          keyField={(item, index) => getProviderConfigKey(item, index)}
          emptyTitle={t('ai_providers.codex_empty_title')}
          emptyDescription={t('ai_providers.codex_empty_desc')}
          onEdit={(_, index) => onEdit(index)}
          onDelete={(_, index) => onDelete(index)}
          onAliasOverview={
            onAliasOverview
              ? (item, index) =>
                  onAliasOverview({
                    providerKey: AI_PROVIDER_ALIAS_CHANNEL.codex,
                    providerLabel: buildProviderOverviewLabel(
                      item,
                      `${t('ai_providers.codex_item_title')} #${index + 1}`
                    ),
                    models: item.models,
                  })
              : undefined
          }
          actionsDisabled={actionsDisabled}
          listClassName={styles.openaiProviderList}
          rowClassName={styles.openaiProviderCard}
          metaClassName={styles.openaiProviderMeta}
          getRowDisabled={(item) => hasDisableAllModelsRule(item.excludedModels)}
          renderExtraActions={(item, index) => (
            <ProviderConfigToggle
              checked={!hasDisableAllModelsRule(item.excludedModels)}
              disabled={toggleDisabled}
              onChange={(value) => void onToggle(index, value)}
            />
          )}
          actionsClassName={styles.openaiProviderActions}
          renderContent={(item, index) => {
            const stats = getProviderKeyConfigRecentStats('codex', item, usageByProvider);
            const headerEntries = Object.entries(item.headers || {});
            const configDisabled = hasDisableAllModelsRule(item.excludedModels);
            const excludedModels = item.excludedModels ?? [];
            const statusData =
              statusBarCache.get(getProviderConfigKey(item, index)) ||
              statusBarDataFromRecentRequests([]);

            return (
              <Fragment>
                <div className={styles.providerCardHeader}>
                  <div className={styles.providerCardHeaderRow}>
                    <div className={`item-title ${styles.providerCardTitle}`}>
                      {buildProviderOverviewLabel(
                        item,
                        `${t('ai_providers.codex_item_title')} #${index + 1}`
                      )}
                    </div>
                    <div className={styles.cardStats}>
                      <span className={`${styles.statPill} ${styles.statSuccess}`}>
                        {t('stats.success')}: {stats.success}
                      </span>
                      <span className={`${styles.statPill} ${styles.statFailure}`}>
                        {t('stats.failure')}: {stats.failure}
                      </span>
                    </div>
                  </div>
                  <ProviderStatusBar statusData={statusData} />
                </div>
                <ProviderConfigApiKeyEntriesList
                  provider="codex"
                  baseUrl={item.baseUrl}
                  entries={item.apiKeyEntries}
                  usageByProvider={usageByProvider}
                />
                <ProviderPrefixPriorityRow prefix={item.prefix} priority={item.priority} />
                {item.baseUrl && (
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
                    <CopyableUrlValue value={item.baseUrl} />
                  </div>
                )}
                {item.websockets !== undefined && (
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('ai_providers.codex_websockets_label')}:</span>
                    <span className={styles.fieldValue}>{item.websockets ? t('common.yes') : t('common.no')}</span>
                  </div>
                )}
                {headerEntries.length > 0 && (
                  <div className={styles.headerBadgeList}>
                    {headerEntries.map(([key, value]) => (
                      <span key={key} className={styles.headerBadge}>
                        <strong>{key}:</strong> {value}
                      </span>
                    ))}
                  </div>
                )}
                {configDisabled && (
                  <div className="status-badge warning" style={{ marginTop: 8, marginBottom: 0 }}>
                    {t('ai_providers.config_disabled_badge')}
                  </div>
                )}
                {item.models?.length ? (
                  <ProviderModelsPreview
                    models={item.models}
                    countLabel={`${t('ai_providers.codex_models_count')}: ${item.models.length}`}
                    modalTitle={`${t('ai_providers.codex_item_title')} #${index + 1}`}
                  />
                ) : null}
                {excludedModels.length ? (
                  <div className={styles.excludedModelsSection}>
                    <div className={styles.excludedModelsLabel}>
                      {t('ai_providers.excluded_models_count', { count: excludedModels.length })}
                    </div>
                    <div className={styles.modelTagList}>
                      {excludedModels.map((model) => (
                        <span key={model} className={`${styles.modelTag} ${styles.excludedModelTag}`}>
                          <span className={styles.modelName}>{model}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Fragment>
            );
          }}
        />
      </Card>
    </>
  );
}
