import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { Select } from '@/components/ui/Select';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { ProviderConfigToggle } from '../ProviderConfigToggle';
import {
  IconChevronDown,
  IconChevronUp,
  IconSlidersHorizontal,
  IconX,
} from '@/components/ui/icons';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import type { OpenAIProviderConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import styles from '@/pages/AiProvidersPage.module.scss';
import { ProviderModelsPreview } from '../ProviderModelsPreview';
import { CopyableUrlValue } from '../CopyableUrlValue';
import { ProviderSectionCardTitle } from '../ProviderSectionCardTitle';
import { ProviderPrefixPriorityRow } from '../ProviderPrefixPriorityRow';
import { ProviderStatusBar } from '../ProviderStatusBar';
import { OpenAIProviderTable } from '../OpenAIProviderTable';
import {
  getOpenAIProviderRecentStatusData,
  getOpenAIProviderTotalStats,
  getOpenAIProviderKey,
  getProviderTotalStats,
  buildProviderOverviewLabel,
  type ProviderRecentUsageMap,
} from '../utils';
import type { ProviderAliasOverviewRequest } from '../types';

type SortOption = 'name' | 'priority' | 'success-rate';
type SortDirection = 'asc' | 'desc';
type DisabledFilter = 'all' | 'enabled' | 'disabled';

const EMPTY_STATUS_BAR = statusBarDataFromRecentRequests([]);

function getSuccessRate(stats: { success: number; failure: number } | undefined): number | null {
  const success = stats?.success ?? 0;
  const failure = stats?.failure ?? 0;
  const total = success + failure;
  if (total === 0) {
    return null;
  }
  return (success / total) * 100;
}

interface OpenAISectionProps {
  configs: OpenAIProviderConfig[];
  usageByProvider: ProviderRecentUsageMap;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  resolvedTheme: string;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
  onAliasOverview?: (request: ProviderAliasOverviewRequest) => void;
  viewMode?: 'card' | 'table';
}

interface IndexedOpenAIProvider {
  config: OpenAIProviderConfig;
  originalIndex: number;
}

const getApiKeyEntryRenderKey = (
  entry: NonNullable<OpenAIProviderConfig['apiKeyEntries']>[number],
  entryIndex: number
) => {
  const authIndex = entry.authIndex == null ? '' : String(entry.authIndex).trim();
  return authIndex ? `auth-index-${authIndex}` : `api-key-entry-${entryIndex}`;
};

export function OpenAISection({
  configs,
  usageByProvider,
  loading,
  disableControls,
  isSwitching,
  resolvedTheme,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  onAliasOverview,
  viewMode = 'card',
}: OpenAISectionProps) {
  const { t } = useTranslation();
  const actionsDisabled = disableControls || loading || isSwitching;
  const toggleDisabled = disableControls || loading || isSwitching;
  const [sortOption, setSortOption] = useState<SortOption>('priority');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [disabledFilter, setDisabledFilter] = useLocalStorage<DisabledFilter>(
    'openai-disabled-filter',
    'all'
  );
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownLayout, setDropdownLayout] = useState({ openAbove: false, maxHeight: 300 });
  const topDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDropdownOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedTop = topDropdownRef.current?.contains(target);

      if (!clickedTop) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  useEffect(() => {
    if (!isDropdownOpen) {
      return;
    }

    const updateDropdownLayout = () => {
      const wrapper = topDropdownRef.current;

      if (!wrapper) {
        return;
      }

      const rect = wrapper.getBoundingClientRect();
      const viewportPadding = 12;
      const dropdownGap = 4;
      const preferredMaxHeight = 300;
      const minimumMaxHeight = 120;
      const availableBelow = Math.max(
        0,
        window.innerHeight - rect.bottom - viewportPadding - dropdownGap
      );
      const availableAbove = Math.max(0, rect.top - viewportPadding - dropdownGap);
      const openAbove = availableBelow < preferredMaxHeight && availableAbove > availableBelow;
      const availableSpace = openAbove ? availableAbove : availableBelow;
      const maxHeight = Math.max(minimumMaxHeight, Math.min(preferredMaxHeight, availableSpace));

      setDropdownLayout((prev) => {
        if (prev.openAbove === openAbove && prev.maxHeight === maxHeight) {
          return prev;
        }

        return { openAbove, maxHeight };
      });
    };

    updateDropdownLayout();
    window.addEventListener('resize', updateDropdownLayout);
    window.addEventListener('scroll', updateDropdownLayout, true);

    return () => {
      window.removeEventListener('resize', updateDropdownLayout);
      window.removeEventListener('scroll', updateDropdownLayout, true);
    };
  }, [isDropdownOpen]);

  const allModelNames = useMemo(() => {
    const modelSet = new Set<string>();
    configs.forEach((provider) => {
      provider.models?.forEach((model) => {
        if (model.name) {
          modelSet.add(model.name);
        }
      });
    });
    return Array.from(modelSet).sort();
  }, [configs]);
  const selectedModelNames = useMemo(() => Array.from(selectedModels).sort(), [selectedModels]);
  const modelFilterActive = selectedModelNames.length > 0;
  const modelFilterLabel = modelFilterActive
    ? t('ai_providers.model_discovery_selected_count', { count: selectedModelNames.length })
    : t('ai_providers.model_search_placeholder');
  const modelFilterTitle = modelFilterActive
    ? selectedModelNames.join(', ')
    : t('ai_providers.model_search_placeholder');

  const statusBarCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof statusBarDataFromRecentRequests>>();

    configs.forEach((provider, index) => {
      const providerKey = getOpenAIProviderKey(provider, index);
      cache.set(providerKey, getOpenAIProviderRecentStatusData(provider, usageByProvider));
    });

    return cache;
  }, [configs, usageByProvider]);

  const sortOptions = useMemo(
    () => [
      { value: 'priority', label: t('ai_providers.sort_by_priority') },
      { value: 'name', label: t('ai_providers.sort_by_name') },
      { value: 'success-rate', label: t('ai_providers.sort_by_success_rate') },
    ],
    [t]
  );

  const sortedConfigs = useMemo<IndexedOpenAIProvider[]>(() => {
    const indexed = configs.map((config, originalIndex) => ({ config, originalIndex }));
    const filtered = indexed.filter(({ config }) => {
      if (disabledFilter === 'enabled' && config.disabled) return false;
      if (disabledFilter === 'disabled' && !config.disabled) return false;
      if (selectedModels.size === 0) return true;
      return config.models?.some((model) => selectedModels.has(model.name));
    });

    const sorted = [...filtered];
    const direction = sortDirection === 'desc' ? -1 : 1;
    const providerStats =
      sortOption === 'success-rate'
        ? new Map(
            sorted.map(({ config }) => [
              config,
              getOpenAIProviderTotalStats(config, usageByProvider),
            ])
          )
        : null;

    switch (sortOption) {
      case 'name':
        sorted.sort((a, b) => direction * a.config.name.localeCompare(b.config.name));
        break;
      case 'priority':
        sorted.sort((a, b) => {
          const priorityA = a.config.priority ?? 0;
          const priorityB = b.config.priority ?? 0;
          const priorityDiff = priorityA - priorityB;

          if (priorityDiff !== 0) {
            return direction * priorityDiff;
          }

          return direction * a.config.name.localeCompare(b.config.name);
        });
        break;
      case 'success-rate':
        sorted.sort((a, b) => {
          const rateA = getSuccessRate(providerStats?.get(a.config));
          const rateB = getSuccessRate(providerStats?.get(b.config));

          if (rateA === null && rateB === null) {
            return direction * a.config.name.localeCompare(b.config.name);
          }
          if (rateA === null) {
            return 1;
          }
          if (rateB === null) {
            return -1;
          }

          const rateDiff = rateA - rateB;
          if (rateDiff !== 0) {
            return direction * rateDiff;
          }

          return direction * a.config.name.localeCompare(b.config.name);
        });
        break;
      default:
        break;
    }

    return sorted;
  }, [configs, sortOption, sortDirection, usageByProvider, selectedModels, disabledFilter]);

  const toggleModelSelection = (modelName: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelName)) {
        next.delete(modelName);
      } else {
        next.add(modelName);
      }
      return next;
    });
  };

  const clearAllModels = () => {
    setSelectedModels(new Set());
  };

  const handleSortOptionChange = (value: SortOption) => {
    setSortOption(value);
  };

  const toggleSortDirection = () => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  const toggleDropdown = () => setIsDropdownOpen((prev) => !prev);

  const renderSortControls = () => (
    <div className={styles.sortControls}>
      <Select
        value={sortOption}
        options={sortOptions}
        onChange={(value) => handleSortOptionChange(value as SortOption)}
        className={styles.sortSelect}
        disabled={actionsDisabled}
        ariaLabel={t('ai_providers.sort_by_priority')}
        fullWidth={false}
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={toggleSortDirection}
        className={styles.sortDirectionButton}
        disabled={actionsDisabled}
        title={
          sortDirection === 'asc'
            ? t('ai_providers.sort_ascending')
            : t('ai_providers.sort_descending')
        }
        aria-label={
          sortDirection === 'asc'
            ? t('ai_providers.sort_ascending')
            : t('ai_providers.sort_descending')
        }
      >
        <span className={styles.sortDirectionIcon}>
          {sortDirection === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </span>
        <span>
          {sortDirection === 'asc'
            ? t('ai_providers.sort_asc_short')
            : t('ai_providers.sort_desc_short')}
        </span>
      </Button>
    </div>
  );

  const renderToolbar = () => {
    const dropdownClassName = dropdownLayout.openAbove
      ? `${styles.modelDropdownList} ${styles.modelDropdownListAbove}`
      : styles.modelDropdownList;

    return (
      <div className={styles.cardHeaderActions}>
        <div className={styles.modelMultiSelectWrapper} ref={topDropdownRef}>
          <div
            className={[
              styles.modelFilterControl,
              modelFilterActive ? styles.modelFilterControlActive : '',
              actionsDisabled ? styles.modelFilterControlDisabled : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              className={styles.modelFilterTrigger}
              onClick={toggleDropdown}
              disabled={actionsDisabled}
              title={modelFilterTitle}
              aria-label={modelFilterTitle}
              aria-haspopup="true"
              aria-expanded={isDropdownOpen}
            >
              <span className={styles.modelFilterIcon} aria-hidden="true">
                <IconSlidersHorizontal size={14} />
              </span>
              <span className={styles.modelFilterText}>{modelFilterLabel}</span>
              {modelFilterActive && (
                <span className={styles.modelFilterCount}>{selectedModelNames.length}</span>
              )}
              <span className={styles.modelFilterChevron} aria-hidden="true">
                <IconChevronDown size={14} />
              </span>
            </button>
            {modelFilterActive && (
              <button
                type="button"
                className={styles.modelFilterInlineClear}
                onClick={clearAllModels}
                disabled={actionsDisabled}
                aria-label={t('ai_providers.model_search_clear')}
                title={t('ai_providers.model_search_clear')}
              >
                <IconX size={14} />
              </button>
            )}
          </div>

          {isDropdownOpen && (
            <div
              className={dropdownClassName}
              style={{ maxHeight: `${dropdownLayout.maxHeight}px` }}
            >
              <div className={styles.modelDropdownHeader}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedModels(new Set(allModelNames))}
                  className={styles.modelDropdownSelectAll}
                  disabled={actionsDisabled || allModelNames.length === 0}
                >
                  {t('ai_providers.model_select_all')}
                </Button>
                {modelFilterActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllModels}
                    className={styles.modelDropdownClear}
                    disabled={actionsDisabled}
                  >
                    {t('ai_providers.model_search_clear')}
                  </Button>
                )}
              </div>
              <div
                className={styles.modelDropdownItems}
                role="group"
                aria-label={t('ai_providers.model_search_placeholder')}
              >
                {allModelNames.length === 0 ? (
                  <div className={styles.modelDropdownEmpty}>
                    {t('ai_providers.model_filter_empty')}
                  </div>
                ) : (
                  allModelNames.map((name) => (
                    <SelectionCheckbox
                      key={`top-option-${name}`}
                      checked={selectedModels.has(name)}
                      onChange={() => toggleModelSelection(name)}
                      disabled={actionsDisabled}
                      className={styles.modelDropdownItem}
                      labelClassName={styles.modelDropdownItemLabel}
                      label={<span title={name}>{name}</span>}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        {renderSortControls()}
        <div className={styles.disabledFilterSwitch}>
          {(['all', 'enabled', 'disabled'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.disabledFilterItem} ${disabledFilter === value ? `${styles.disabledFilterItemActive} ${value === 'enabled' ? styles.disabledFilterItemEnabled : value === 'disabled' ? styles.disabledFilterItemDisabled : ''}` : ''}`}
              onClick={() => setDisabledFilter(value)}
              disabled={actionsDisabled}
            >
              {t(`ai_providers.disabled_filter_${value}`)}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          onClick={onAdd}
          disabled={actionsDisabled}
          className={styles.openaiAddButton}
        >
          {t('ai_providers.openai_add_button')}
        </Button>
      </div>
    );
  };

  const renderStaticTitle = () => (
    <ProviderSectionCardTitle
      icon={
        <img
          src={resolvedTheme === 'dark' ? iconOpenaiDark : iconOpenaiLight}
          alt=""
          className={styles.cardTitleIcon}
        />
      }
      title={t('ai_providers.openai_title')}
      count={sortedConfigs.length}
    />
  );

  const renderProviderCard = ({ config: provider, originalIndex }: IndexedOpenAIProvider) => {
    const stats = getOpenAIProviderTotalStats(provider, usageByProvider);
    const headerEntries = Object.entries(provider.headers || {});
    const apiKeyEntries = provider.apiKeyEntries || [];
    const statusData =
      statusBarCache.get(getOpenAIProviderKey(provider, originalIndex)) || EMPTY_STATUS_BAR;
    const providerDisabled = provider.disabled === true;

    return (
      <div
        key={`openai-provider-${originalIndex}`}
        className={styles.openaiProviderCard}
        style={actionsDisabled ? { opacity: 0.6 } : undefined}
      >
        <div className={styles.openaiProviderMeta}>
          <div className={styles.providerCardHeader}>
            <div className={styles.providerCardHeaderRow}>
              <div
                className={`${styles.openaiProviderTitle} ${providerDisabled ? styles.providerCardTitleDisabled : ''}`}
              >
                {provider.name}
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
          <ProviderPrefixPriorityRow prefix={provider.prefix} priority={provider.priority} />
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
            <CopyableUrlValue value={provider.baseUrl} />
          </div>
          {headerEntries.length > 0 && (
            <div className={styles.headerBadgeList}>
              {headerEntries.map(([key, value]) => (
                <span key={key} className={styles.headerBadge}>
                  <strong>{key}:</strong> {value}
                </span>
              ))}
            </div>
          )}
          {apiKeyEntries.length > 0 && (
            <div className={styles.apiKeyEntriesSection}>
              <div className={styles.apiKeyEntriesLabel}>
                {t('ai_providers.openai_keys_count')}: {apiKeyEntries.length}
              </div>
              <div className={styles.apiKeyEntryList}>
                {apiKeyEntries.map((entry, entryIndex) => {
                  const entryStats = getProviderTotalStats(
                    usageByProvider,
                    provider.name,
                    entry.apiKey,
                    provider.baseUrl
                  );
                  return (
                    <div
                      key={getApiKeyEntryRenderKey(entry, entryIndex)}
                      className={styles.apiKeyPill}
                      title={
                        [
                          entry.proxyUrl ? `${t('common.proxy_url')}: ${entry.proxyUrl}` : '',
                          `${t('common.status')}: ${t('common.success')}: ${entryStats.success} / ${t('common.failure')}: ${entryStats.failure}`,
                        ]
                          .filter(Boolean)
                          .join(' | ') || undefined
                      }
                    >
                      <span className={styles.apiKeyPillKey}>{maskApiKey(entry.apiKey)}</span>
                      {((entryStats.success || 0) > 0 || (entryStats.failure || 0) > 0) && (
                        <span className={styles.apiKeyPillStats}>
                          {(entryStats.success || 0) > 0 ? (
                            <span className={styles.apiKeyPillSuccess}>✓{entryStats.success}</span>
                          ) : (
                            <span
                              className={styles.apiKeyPillSuccess}
                              style={{ visibility: 'hidden' }}
                            >
                              ✓0
                            </span>
                          )}
                          {(entryStats.failure || 0) > 0 ? (
                            <span className={styles.apiKeyPillFailure}>✗{entryStats.failure}</span>
                          ) : (
                            <span
                              className={styles.apiKeyPillFailure}
                              style={{ visibility: 'hidden' }}
                            >
                              ✗0
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className={styles.fieldRow} style={{ marginTop: '8px' }}>
            <span className={styles.fieldLabel}>{t('ai_providers.openai_models_count')}:</span>
            <span className={styles.fieldValue}>{provider.models?.length || 0}</span>
          </div>
          {provider.models?.length ? (
            <ProviderModelsPreview
              models={provider.models}
              modalTitle={provider.name || provider.baseUrl || t('ai_providers.openai_item_title')}
            />
          ) : null}
          {provider.testModel && (
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('ai_providers.openai_test_model')}:</span>
              <span className={styles.fieldValue}>{provider.testModel}</span>
            </div>
          )}
        </div>
        <div className={styles.openaiProviderActions}>
          <div className="provider-card-action-buttons">
            {onAliasOverview ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  onAliasOverview({
                    providerKey: String(provider.name ?? provider.baseUrl ?? 'openai')
                      .trim()
                      .toLowerCase(),
                    providerLabel: buildProviderOverviewLabel(
                      provider,
                      t('ai_providers.openai_item_title')
                    ),
                    models: provider.models,
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
              onClick={() => onEdit(originalIndex)}
              disabled={actionsDisabled}
            >
              {t('common.edit')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={styles.providerCardDeleteButton}
              onClick={() => onDelete(originalIndex)}
              disabled={actionsDisabled}
            >
              {t('common.delete')}
            </Button>
          </div>
          <ProviderConfigToggle
            checked={!providerDisabled}
            disabled={toggleDisabled}
            onChange={(value) => void onToggle(originalIndex, value)}
          />
        </div>
      </div>
    );
  };

  return (
    <Card title={renderStaticTitle()} extra={renderToolbar()}>
      {loading && sortedConfigs.length === 0 ? (
        <div className="hint">{t('common.loading')}</div>
      ) : configs.length > 0 && sortedConfigs.length === 0 ? (
        <EmptyState
          title={t('ai_providers.openai_filtered_empty_title')}
          description={t('ai_providers.openai_filtered_empty_desc')}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={clearAllModels}
              disabled={actionsDisabled}
            >
              {t('ai_providers.model_search_clear')}
            </Button>
          }
        />
      ) : sortedConfigs.length === 0 ? (
        <EmptyState
          title={t('ai_providers.openai_empty_title')}
          description={t('ai_providers.openai_empty_desc')}
        />
      ) : viewMode === 'table' ? (
        <OpenAIProviderTable
          items={sortedConfigs}
          usageByProvider={usageByProvider}
          loading={loading}
          emptyTitle={t('ai_providers.openai_empty_title')}
          emptyDescription={t('ai_providers.openai_empty_desc')}
          actionsDisabled={actionsDisabled}
          toggleDisabled={toggleDisabled}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggle={onToggle}
          onAliasOverview={onAliasOverview}
        />
      ) : (
        <div className={styles.openaiProviderList}>{sortedConfigs.map(renderProviderCard)}</div>
      )}
    </Card>
  );
}
