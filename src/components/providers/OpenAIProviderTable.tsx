import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { OpenAIProviderConfig } from '@/types';
import { CopyableUrlValue } from './CopyableUrlValue';
import { ProviderApiKeysPreview } from './ProviderApiKeysPreview';
import { ProviderConfigToggle } from './ProviderConfigToggle';
import { ProviderModelsPreview } from './ProviderModelsPreview';
import { ProviderPrioritySignal } from './ProviderPrioritySignal';
import { ProviderStatusBar } from './ProviderStatusBar';
import {
  buildProviderOverviewLabel,
  getOpenAIProviderKey,
  getOpenAIProviderRecentStatusData,
  getOpenAIProviderTotalStats,
  type ProviderRecentUsageMap,
} from './utils';
import type { ProviderAliasOverviewRequest } from './types';
import styles from '@/pages/AiProvidersPage.module.scss';

interface IndexedOpenAIProvider {
  config: OpenAIProviderConfig;
  originalIndex: number;
}

interface OpenAIProviderTableProps {
  items: IndexedOpenAIProvider[];
  usageByProvider: ProviderRecentUsageMap;
  loading: boolean;
  emptyTitle: string;
  emptyDescription: string;
  filteredEmptyAction?: React.ReactNode;
  actionsDisabled: boolean;
  toggleDisabled: boolean;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
  onAliasOverview?: (request: ProviderAliasOverviewRequest) => void;
}

export function OpenAIProviderTable({
  items,
  usageByProvider,
  loading,
  emptyTitle,
  emptyDescription,
  filteredEmptyAction,
  actionsDisabled,
  toggleDisabled,
  onEdit,
  onDelete,
  onToggle,
  onAliasOverview,
}: OpenAIProviderTableProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      items.map(({ config, originalIndex }) => ({
        provider: config,
        originalIndex,
        key: getOpenAIProviderKey(config, originalIndex),
        label: buildProviderOverviewLabel(config, t('ai_providers.openai_item_title')),
        stats: getOpenAIProviderTotalStats(config, usageByProvider),
        statusData: getOpenAIProviderRecentStatusData(config, usageByProvider),
        primaryKey: config.apiKeyEntries?.find((entry) => entry.apiKey)?.apiKey,
        headerCount: Object.keys(config.headers || {}).length,
      })),
    [items, t, usageByProvider]
  );

  if (loading && rows.length === 0) {
    return <div className="hint">{t('common.loading')}</div>;
  }

  if (!rows.length) {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} action={filteredEmptyAction} />
    );
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
          {rows.map((row) => {
            const disabled = row.provider.disabled === true;
            return (
              <tr key={row.key} className={disabled ? styles.providerTableRowDisabled : ''}>
                <td>
                  <div className={styles.providerTableCellStack}>
                    <div className={styles.providerTablePrimary}>{row.label}</div>
                    <span>
                      <span className={styles.providerTableLabel}>{t('common.prefix')}:</span>{' '}
                      {row.provider.prefix || '-'}
                    </span>
                    <ProviderPrioritySignal value={row.provider.priority} />
                  </div>
                </td>
                <td>
                  <div className={styles.providerTableCellStack}>
                    <ProviderApiKeysPreview
                      entries={row.provider.apiKeyEntries}
                      moreLabel={(count) => t('ai_providers.models_show_more', { count })}
                      modalTitle={`${row.label} — ${t('ai_providers.api_keys_modal_title')}`}
                    />
                  </div>
                </td>
                <td>
                  <div className={styles.providerTableCellStack}>
                    <div className={`${styles.providerTableCellGroup} ${styles.providerTableEndpoint}`}>
                      <span className={styles.providerTableLabel}>{t('common.base_url')}:</span>
                      <CopyableUrlValue value={row.provider.baseUrl} />
                    </div>
                    {row.headerCount > 0 ? (
                      <span>
                        {t('ai_providers.table_headers_count', { count: row.headerCount })}
                      </span>
                    ) : null}
                    {row.provider.testModel ? (
                      <span>
                        {t('ai_providers.openai_test_model')}: {row.provider.testModel}
                      </span>
                    ) : null}
                    {row.provider.models?.length ? (
                      <ProviderModelsPreview
                        models={row.provider.models}
                        modalTitle={row.label}
                        previewCount={2}
                      />
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
                            providerKey: String(
                              row.provider.name ?? row.provider.baseUrl ?? 'openai'
                            )
                              .trim()
                              .toLowerCase(),
                            providerLabel: row.label,
                            models: row.provider.models,
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
                      onClick={() => onEdit(row.originalIndex)}
                      disabled={actionsDisabled}
                    >
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className={styles.providerCardDeleteButton}
                      onClick={() => onDelete(row.originalIndex)}
                      disabled={actionsDisabled}
                    >
                      {t('common.delete')}
                    </Button>
                    <ProviderConfigToggle
                      checked={!disabled}
                      disabled={toggleDisabled}
                      onChange={(value) => void onToggle(row.originalIndex, value)}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
