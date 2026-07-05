import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { classifyModelsByMode, type ModelGroupingMode, type ModelInfo } from '@/utils/models';
import styles from './AiProvidersPage.module.scss';

export type BatchModelTestRowResult = {
  success: boolean;
  statusCode?: number;
  message?: string;
};

export type BatchModelTestProgress = {
  completed: number;
  total: number;
  runningModels: string[];
} | null;

export type BatchModelTestModalShellProps = {
  open: boolean;
  onClose: () => void;
  keyIndex: number | null;
  hint: string;
  entryPoint: 'discovery' | 'batch-test';
  modelCount: number;
  endpoint: string;
  endpointLabel: string;
  refreshLabel: string;
  onRefresh: () => void;
  fetching: boolean;
  fetchingLoadingText: string;
  fetchingEmptyText: string;
  searchEmptyText: string;
  error: string;
  search: string;
  onSearchChange: (value: string) => void;
  models: ModelInfo[];
  filteredModels: ModelInfo[];
  selected: Set<string>;
  onToggleSelection: (name: string) => void;
  onSelectVisible: () => void;
  onClearSelection: () => void;
  allVisibleSelected: boolean;
  disableControls: boolean;
  saving: boolean;
  testing: boolean;
  testProgress: BatchModelTestProgress;
  testResults: Record<string, BatchModelTestRowResult>;
  onRunBatchTests: () => void;
  onAddAvailableModels: () => void;
  canRun: boolean;
  canAddAvailable: boolean;
  // API 密钥下拉选择（用于切换"拉取列表 + 测试"所用的 key）
  keyOptions: { value: string; label: string }[];
  selectedKey: string;
  onKeyChange: (value: string) => void;
};

function BatchModelTestModalTitleBlock({
  keyIndex,
  modelCount,
  hint,
  testProgress,
  entryPoint,
}: {
  keyIndex: number | null;
  modelCount: number;
  hint: string;
  testProgress: BatchModelTestProgress;
  entryPoint: 'discovery' | 'batch-test';
}) {
  const { t } = useTranslation();
  const hintContent = testProgress
    ? t('ai_providers.openai_batch_model_test_progress', {
        completed: testProgress.completed,
        total: testProgress.total,
        models: testProgress.runningModels.join(', '),
      })
    : hint;

  return (
    <div className={styles.batchModelTestModalHeader}>
      <div className={styles.batchModelTestModalTitle}>
        {entryPoint === 'discovery'
          ? (keyIndex !== null
              ? t('ai_providers.openai_models_fetch_title_with_count', {
                  index: keyIndex + 1,
                  count: modelCount,
                })
              : t('ai_providers.openai_models_fetch_title'))
          : (keyIndex !== null
              ? t('ai_providers.openai_batch_model_test_title_with_count', {
                  index: keyIndex + 1,
                  count: modelCount,
                })
              : t('ai_providers.openai_models_fetch_title'))}
      </div>
      <div
        className={`${styles.batchModelTestModalHint} ${
          testProgress ? styles.batchModelTestModalHintProgress : ''
        }`}
      >
        {hintContent}
      </div>
    </div>
  );
}

function BatchModelTestResultSummary({
  success,
  failed,
}: {
  success: number;
  failed: number;
}) {
  const { t } = useTranslation();
  return (
    <span className={styles.batchModelTestFooterResults}>
      <span className={styles.batchModelTestFooterResultsLabel}>
        {t('ai_providers.openai_batch_model_results_summary_prefix')}
      </span>
      <span className={styles.batchModelTestFooterResultsAvailable}>
        {t('ai_providers.openai_batch_model_results_available', { count: success })}
      </span>
      <span className={styles.batchModelTestFooterResultsSep}>，</span>
      <span className={styles.batchModelTestFooterResultsUnavailable}>
        {t('ai_providers.openai_batch_model_results_unavailable', { count: failed })}
      </span>
    </span>
  );
}

function BatchModelTestFooterStatus({
  resultSummary,
}: {
  resultSummary: { success: number; failed: number; total: number };
}) {
  if (resultSummary.total === 0) {
    return null;
  }

  return (
    <div className={styles.batchModelTestFooterStatus}>
      <BatchModelTestResultSummary success={resultSummary.success} failed={resultSummary.failed} />
    </div>
  );
}

function BatchModelTestModelCard({
  model,
  checked,
  result,
  disabled,
  onToggleSelection,
}: {
  model: ModelInfo;
  checked: boolean;
  result?: BatchModelTestRowResult;
  disabled: boolean;
  onToggleSelection: (name: string) => void;
}) {
  const { t } = useTranslation();
  const resultClassName = result
    ? result.success
      ? styles.openaiBatchModelResultOk
      : styles.openaiBatchModelResultFail
    : '';
  const resultText = result
    ? result.success
      ? t('ai_providers.openai_batch_model_tag_ok')
      : result.statusCode != null
        ? `${t('ai_providers.openai_batch_model_tag_fail')} ${result.statusCode}`
        : t('ai_providers.openai_batch_model_tag_fail')
    : '';

  return (
    <SelectionCheckbox
      key={model.name}
      checked={checked}
      onChange={() => onToggleSelection(model.name)}
      disabled={disabled}
      ariaLabel={model.name}
      className={`${styles.modelDiscoveryRow} ${checked ? styles.modelDiscoveryRowSelected : ''} ${resultClassName}`}
      labelClassName={styles.modelDiscoverySelectionLabel}
      label={
        <div className={styles.modelDiscoveryMeta}>
          <div className={styles.modelDiscoveryName} title={model.description}>
            {model.name}
            {model.alias && <span className={styles.modelDiscoveryAlias}>{model.alias}</span>}
            {result && (
              <span
                className={`${styles.openaiBatchModelResultPill} ${
                  result.success
                    ? styles.openaiBatchModelResultPillOk
                    : styles.openaiBatchModelResultPillFail
                }`}
              >
                {resultText}
              </span>
            )}
          </div>
          {result?.message && (
            <div className={styles.openaiBatchModelResultMessage}>{result.message}</div>
          )}
        </div>
      }
    />
  );
}

function BatchModelTestModalBody({
  endpoint,
  endpointLabel,
  refreshLabel,
  onRefresh,
  fetching,
  fetchingLoadingText,
  fetchingEmptyText,
  searchEmptyText,
  error,
  search,
  onSearchChange,
  models,
  filteredModels,
  selected,
  onToggleSelection,
  onSelectVisible,
  onClearSelection,
  allVisibleSelected,
  disableControls,
  saving,
  testing,
  testResults,
}: Pick<
  BatchModelTestModalShellProps,
  | 'endpoint'
  | 'endpointLabel'
  | 'refreshLabel'
  | 'onRefresh'
  | 'fetching'
  | 'fetchingLoadingText'
  | 'fetchingEmptyText'
  | 'searchEmptyText'
  | 'error'
  | 'search'
  | 'onSearchChange'
  | 'models'
  | 'filteredModels'
  | 'selected'
  | 'onToggleSelection'
  | 'onSelectVisible'
  | 'onClearSelection'
  | 'allVisibleSelected'
  | 'disableControls'
  | 'saving'
  | 'testing'
  | 'testResults'
>) {
  const { t, i18n } = useTranslation();
  const [groupMode, setGroupMode] = useState<ModelGroupingMode>('type');
  const controlsDisabled = disableControls || saving || fetching || testing;

  const groups = useMemo(() => {
    return classifyModelsByMode(filteredModels, groupMode, {
      otherLabel: t('common.other') || 'Other',
    });
  }, [filteredModels, groupMode, t]);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [activeGroupId, setActiveGroupId] = useState<string>('');

  useEffect(() => {
    const nextActiveGroupId =
      groups.length > 0 && activeGroupId && groups.some((g) => g.id === activeGroupId)
        ? activeGroupId
        : (groups[0]?.id ?? '');
    if (nextActiveGroupId === activeGroupId) {
      return;
    }
    const raf = requestAnimationFrame(() => setActiveGroupId(nextActiveGroupId));
    return () => cancelAnimationFrame(raf);
  }, [groups, activeGroupId]);

  const handleCategoryClick = (groupId: string) => {
    setActiveGroupId(groupId);
    const el = groupRefs.current[groupId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  let listContent: ReactNode;
  if (fetching) {
    listContent = (
      <div className={`${styles.modelDiscoveryList} ${styles.modelDiscoveryListLoading}`}>
        <div className={styles.loadingWrapper}>
          <span className="loading-spinner" />
          <span className={styles.sectionHint}>{fetchingLoadingText}</span>
        </div>
      </div>
    );
  } else if (models.length === 0) {
    listContent = (
      <div className={`${styles.modelDiscoveryList} ${styles.modelDiscoveryListEmpty}`}>
        <span className={styles.sectionHint}>{fetchingEmptyText}</span>
      </div>
    );
  } else if (filteredModels.length === 0) {
    listContent = (
      <div className={`${styles.modelDiscoveryList} ${styles.modelDiscoveryListEmpty}`}>
        <span className={styles.sectionHint}>{searchEmptyText}</span>
      </div>
    );
  } else {
    listContent = (
      <div className={styles.modelDiscoveryContainer} data-group-mode={groupMode}>
        <div className={styles.modelDiscoverySidebar}>
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`${styles.sidebarNavButton} ${
                activeGroupId === group.id ? styles.sidebarNavButtonActive : ''
              }`}
              onClick={() => handleCategoryClick(group.id)}
            >
              <span className={styles.sidebarNavLabel}>
                {i18n.exists(`ai_providers.model_type_${group.id}`)
                  ? t(`ai_providers.model_type_${group.id}`)
                  : group.label}
              </span>
              <span className={styles.sidebarNavBadge}>{group.items.length}</span>
            </button>
          ))}
        </div>
        <div ref={scrollContainerRef} className={styles.modelDiscoveryList}>
          {groups.map((group) => (
            <div
              key={group.id}
              ref={(el) => {
                groupRefs.current[group.id] = el;
              }}
              className={`${styles.modelDiscoveryGroup} ${
                activeGroupId === group.id ? styles.modelDiscoveryGroupActive : ''
              }`}
            >
              <div className={styles.modelDiscoveryGroupHeader}>
                <span className={styles.modelDiscoveryGroupTitle}>
                  {i18n.exists(`ai_providers.model_type_${group.id}`)
                    ? t(`ai_providers.model_type_${group.id}`)
                    : group.label}
                </span>
                <span className={styles.modelDiscoveryGroupCount}>({group.items.length})</span>
              </div>
              <div className={styles.modelDiscoveryGroupGrid}>
                {group.items.map((model) => (
                  <BatchModelTestModelCard
                    key={model.name}
                    model={model}
                    checked={selected.has(model.name)}
                    result={testResults[model.name]}
                    disabled={controlsDisabled}
                    onToggleSelection={onToggleSelection}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.openaiModelDiscoveryModalBody}>
      <div className={styles.openaiModelsDiscoveryTopGrid}>
        <div className={styles.openaiModelsEndpointSection}>
          <label className={styles.openaiModelsEndpointLabel}>
            {endpointLabel}
          </label>
          <div className={styles.openaiModelsEndpointControls}>
            <input
              className={`input ${styles.openaiModelsEndpointInput}`}
              readOnly
              value={endpoint}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              loading={fetching}
              disabled={controlsDisabled}
            >
              {refreshLabel}
            </Button>
          </div>
        </div>
        <Input
          label={t('ai_providers.openai_models_search_label')}
          placeholder={t('ai_providers.openai_models_search_placeholder')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          disabled={fetching || testing}
        />
      </div>

      {models.length > 0 && (
        <div className={styles.modelDiscoveryToolbar}>
          <div className={styles.segmentBar}>
            <button
              type="button"
              className={`${styles.segmentItem} ${groupMode === 'type' ? styles.segmentItemActive : ''}`}
              onClick={() => setGroupMode('type')}
            >
              {t('ai_providers.group_by_type')}
            </button>
            <button
              type="button"
              className={`${styles.segmentItem} ${groupMode === 'vendor' ? styles.segmentItemActive : ''}`}
              onClick={() => setGroupMode('vendor')}
            >
              {t('ai_providers.group_by_vendor')}
            </button>
          </div>
          <div className={styles.modelDiscoveryToolbarActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={onSelectVisible}
              disabled={controlsDisabled || filteredModels.length === 0 || allVisibleSelected}
            >
              {t('ai_providers.model_discovery_select_all')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onClearSelection}
              disabled={controlsDisabled || selected.size === 0}
            >
              {t('ai_providers.model_discovery_clear_selection_with_count', { count: selected.size })}
            </Button>
          </div>
        </div>
      )}

      {error ? <div className="error-box">{error}</div> : null}
      {listContent}
    </div>
  );
}

export function BatchModelTestModalShell({
  open,
  onClose,
  keyIndex,
  hint,
  modelCount,
  endpoint,
  endpointLabel,
  refreshLabel,
  onRefresh,
  fetching,
  fetchingLoadingText,
  fetchingEmptyText,
  searchEmptyText,
  error,
  search,
  onSearchChange,
  models,
  filteredModels,
  selected,
  onToggleSelection,
  onSelectVisible,
  onClearSelection,
  allVisibleSelected,
  disableControls,
  saving,
  testing,
  testProgress,
  testResults,
  onRunBatchTests,
  onAddAvailableModels,
  canRun,
  canAddAvailable,
  keyOptions,
  selectedKey,
  onKeyChange,
  entryPoint = 'batch-test',
}: BatchModelTestModalShellProps) {
  const { t } = useTranslation();

  const resultSummary = (() => {
    const values = Object.values(testResults);
    const success = values.filter((item) => item.success).length;
    const failed = values.length - success;
    return { success, failed, total: values.length };
  })();

  const selectedAvailableCount = useMemo(() => {
    let count = 0;
    for (const name of selected) {
      if (testResults[name]?.success) count++;
    }
    return count;
  }, [selected, testResults]);

  if (!open) {
    return null;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <BatchModelTestModalTitleBlock
          keyIndex={keyIndex}
          modelCount={modelCount}
          hint={hint}
          testProgress={testProgress}
          entryPoint={entryPoint}
        />
      }
      width="96vw"
      closeDisabled={testing}
      className={styles.batchModelTestModal}
      footer={
        <div className={styles.batchModelTestFooter}>
          <BatchModelTestFooterStatus resultSummary={resultSummary} />
          <div className={styles.batchModelTestFooterActions}>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={fetching || testing}>
              {t('common.cancel')}
            </Button>
            <Select
              value={selectedKey}
              options={keyOptions}
              onChange={onKeyChange}
              placeholder={t('ai_providers.batch_model_key_select_placeholder')}
              className={styles.batchModelTestKeySelect}
              ariaLabel={t('ai_providers.batch_model_key_select_label')}
              disabled={disableControls || saving || fetching || testing || keyOptions.length === 0}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={onRunBatchTests}
              disabled={!canRun}
              loading={testing}
            >
              {t('ai_providers.openai_batch_model_test_run')}
            </Button>
            <Button size="sm" onClick={onAddAvailableModels} disabled={!canAddAvailable}>
              {selectedAvailableCount > 0
                ? t('ai_providers.openai_batch_model_add_selected', { count: selectedAvailableCount })
                : t('ai_providers.openai_batch_model_add_available')}
            </Button>
          </div>
        </div>
      }
    >
      <BatchModelTestModalBody
        endpoint={endpoint}
        endpointLabel={endpointLabel}
        refreshLabel={refreshLabel}
        onRefresh={onRefresh}
        fetching={fetching}
        fetchingLoadingText={fetchingLoadingText}
        fetchingEmptyText={fetchingEmptyText}
        searchEmptyText={searchEmptyText}
        error={error}
        search={search}
        onSearchChange={onSearchChange}
        models={models}
        filteredModels={filteredModels}
        selected={selected}
        onToggleSelection={onToggleSelection}
        onSelectVisible={onSelectVisible}
        onClearSelection={onClearSelection}
        allVisibleSelected={allVisibleSelected}
        disableControls={disableControls}
        saving={saving}
        testing={testing}
        testResults={testResults}
      />
    </Modal>
  );
}
