import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { GeminiKeyConfig, ProviderKeyConfig } from '@/types';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import { AI_PROVIDER_ALIAS_CHANNEL } from '@/utils/providerModelAliasCatalog';
import { CopyableUrlValue } from './CopyableUrlValue';
import { ProviderApiKeysPreview } from './ProviderApiKeysPreview';
import { ProviderConfigToggle } from './ProviderConfigToggle';
import { ProviderModelsPreview } from './ProviderModelsPreview';
import { ProviderPrioritySignal } from './ProviderPrioritySignal';
import { ProviderStatusBar } from './ProviderStatusBar';
import {
  buildProviderOverviewLabel,
  collectProviderKeyConfigRecentBuckets,
  getProviderConfigKey,
  getProviderKeyConfigRecentStats,
  hasDisableAllModelsRule,
  type ProviderRecentUsageMap,
} from './utils';
import type { ProviderAliasOverviewRequest } from './types';
import styles from '@/pages/AiProvidersPage.module.scss';

type ProviderTableKind = 'gemini' | 'codex' | 'claude' | 'vertex';

type ProviderTableConfig = GeminiKeyConfig | ProviderKeyConfig;

interface ProviderKeyConfigTableProps<T extends ProviderTableConfig> {
  provider: ProviderTableKind;
  configs: T[];
  usageByProvider: ProviderRecentUsageMap;
  loading: boolean;
  emptyTitle: string;
  emptyDescription: string;
  itemTitle: string;
  actionsDisabled: boolean;
  toggleDisabled: boolean;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
  onAliasOverview?: (request: ProviderAliasOverviewRequest) => void;
}

export function ProviderKeyConfigTable<T extends ProviderTableConfig>({
  provider,
  configs,
  usageByProvider,
  loading,
  emptyTitle,
  emptyDescription,
  itemTitle,
  actionsDisabled,
  toggleDisabled,
  onEdit,
  onDelete,
  onToggle,
  onAliasOverview,
}: ProviderKeyConfigTableProps<T>) {
  const { t } = useTranslation();

  const rows = useMemo(
    () =>
      configs.map((item, index) => {
        const label = buildProviderOverviewLabel(item, `${itemTitle} #${index + 1}`);
        const stats = getProviderKeyConfigRecentStats(provider, item, usageByProvider);
        const disabled = hasDisableAllModelsRule(item.excludedModels);
        const statusData = statusBarDataFromRecentRequests(
          collectProviderKeyConfigRecentBuckets(provider, item, usageByProvider)
        );
        const primaryKey = item.apiKeyEntries?.find((entry) => entry.apiKey)?.apiKey;
        const headerCount = Object.keys(item.headers || {}).length;
        const excludedCount = item.excludedModels?.length || 0;
        const websockets =
          provider === 'codex' ? (item as ProviderKeyConfig).websockets : undefined;

        return {
          item,
          index,
          key: getProviderConfigKey(item, index),
          label,
          stats,
          disabled,
          statusData,
          primaryKey,
          headerCount,
          excludedCount,
          websockets,
        };
      }),
    [configs, itemTitle, provider, usageByProvider]
  );

  if (loading && rows.length === 0) {
    return <div className="hint">{t('common.loading')}</div>;
  }

  if (!rows.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className={styles.providerTableScroll}>
      <table className={styles.providerTable}>
        <colgroup>
          <col className={styles.providerTableNameCol} />
          <col className={styles.providerTableKeysCol} />
          <col className={styles.providerTableEndpointModelsCol} />
          <col className={styles.providerTableRecentCol} />
          <col className={styles.providerTableActionsCol} />
        </colgroup>
        <thead>
          <tr>
            <th>{t('ai_providers.table_column_name')}</th>
            <th>{t('ai_providers.table_column_keys')}</th>
            <th>{t('ai_providers.table_column_endpoint_models')}</th>
            <th>{t('ai_providers.table_column_recent')}</th>
            <th>{t('ai_providers.table_column_actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.disabled ? styles.providerTableRowDisabled : ''}>
              <td>
                <div className={styles.providerTableCellStack}>
                  <div className={styles.providerTablePrimary}>{row.label}</div>
                  <span>
                    <span className={styles.providerTableLabel}>{t('common.prefix')}:</span>{' '}
                    {row.item.prefix || '-'}
                  </span>
                  <ProviderPrioritySignal value={row.item.priority} />
                </div>
              </td>
              <td>
                <ProviderApiKeysPreview
                  entries={row.item.apiKeyEntries}
                  moreLabel={(count) => t('ai_providers.models_show_more', { count })}
                  modalTitle={`${row.label} — ${t('ai_providers.api_keys_modal_title')}`}
                />
              </td>
              <td>
                <div className={styles.providerTableCellStack}>
                  <div className={styles.providerTableCellGroup}>
                    <span className={styles.providerTableLabel}>{t('common.base_url')}:</span>
                    {row.item.baseUrl ? <CopyableUrlValue value={row.item.baseUrl} /> : '-'}
                  </div>
                  {row.headerCount > 0 ? (
                    <span>{t('ai_providers.table_headers_count', { count: row.headerCount })}</span>
                  ) : null}
                  {row.websockets !== undefined ? (
                    <span>
                      {t('ai_providers.codex_websockets_label')}:{' '}
                      {row.websockets ? t('common.yes') : t('common.no')}
                    </span>
                  ) : null}
                  {row.item.models?.length ? (
                    <ProviderModelsPreview
                      models={row.item.models}
                      modalTitle={row.label}
                      previewCount={2}
                    />
                  ) : null}
                  {row.excludedCount > 0 ? (
                    <span className={styles.providerTableMuted}>
                      {t('ai_providers.excluded_models_count', { count: row.excludedCount })}
                    </span>
                  ) : null}
                </div>
              </td>
              <td>
                <div className={styles.providerTableRecentCell}>
                  <ProviderStatusBar statusData={row.statusData} size="small" />
                  <div className={styles.providerTableStats}>
                    <span className={`${styles.statPill} ${styles.statSuccess}`}>
                      {t('stats.success')}: {row.stats.success}
                    </span>
                    <span className={`${styles.statPill} ${styles.statFailure}`}>
                      {t('stats.failure')}: {row.stats.failure}
                    </span>
                  </div>
                </div>
              </td>
              <td>
                <div className={styles.providerTableActions}>
                  {onAliasOverview ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        onAliasOverview({
                          providerKey: AI_PROVIDER_ALIAS_CHANNEL[provider],
                          providerLabel: row.label,
                          models: row.item.models,
                        })
                      }
                      disabled={actionsDisabled}
                    >
                      {t('ai_providers.alias_overview_button')}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onEdit(row.index)}
                    disabled={actionsDisabled}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className={styles.providerCardDeleteButton}
                    onClick={() => onDelete(row.index)}
                    disabled={actionsDisabled}
                  >
                    {t('common.delete')}
                  </Button>
                  <ProviderConfigToggle
                    checked={!row.disabled}
                    disabled={toggleDisabled}
                    onChange={(value) => void onToggle(row.index, value)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
