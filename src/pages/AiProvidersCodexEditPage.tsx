import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HeaderInputList } from '@/components/ui/HeaderInputList';
import { ModelInputList } from '@/components/ui/ModelInputList';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import type { ProviderKeyConfig } from '@/types';
import { buildHeaderObject, headersToEntries, normalizeHeaderEntries } from '@/utils/headers';
import {
  areKeyValueEntriesEqual,
  areModelEntriesEqual,
  areStringArraysEqual,
} from '@/utils/compare';
import { entriesToModels, modelsToEntries } from '@/components/ui/modelInputListUtils';
import { ProviderApiKeyEntriesEditor } from '@/components/providers/ProviderApiKeyEntriesEditor';
import { ProviderPrioritySelector } from '@/components/providers';
import {
  areNormalizedApiKeyEntriesEqual,
  buildApiKeyEntry,
  excludedModelsToText,
  getPrimaryApiKey,
  normalizeApiKeyEntriesForBaseline,
  parseExcludedModels,
  serializeApiKeyEntriesForSave,
} from '@/components/providers/utils';
import type { ModelEntry, ProviderFormState } from '@/components/providers';
import type { ModelInfo } from '@/utils/models';
import {
  CodexBatchModelTestModal,
  type CodexBatchModelTestRowResult,
} from './CodexBatchModelTestModal';
import layoutStyles from './AiProvidersEditLayout.module.scss';
import styles from './AiProvidersPage.module.scss';

type LocationState = { fromAiProviders?: boolean } | null;

const buildEmptyForm = (): ProviderFormState => ({
  apiKeyEntries: [buildApiKeyEntry()],
  priority: undefined,
  name: '',
  prefix: '',
  baseUrl: '',
  websockets: false,
  headers: [],
  models: [],
  excludedModels: [],
  modelEntries: [{ name: '', alias: '' }],
  excludedText: '',
});

const parseIndexParam = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeModelEntries = (entries: Array<{ name: string; alias: string }>) =>
  (entries ?? []).reduce<Array<{ name: string; alias: string }>>((acc, entry) => {
    const name = String(entry?.name ?? '').trim();
    let alias = String(entry?.alias ?? '').trim();
    if (name && alias === name) {
      alias = '';
    }
    if (!name && !alias) return acc;
    acc.push({ name, alias });
    return acc;
  }, []);

type CodexFormBaseline = {
  apiKeyEntries: ReturnType<typeof normalizeApiKeyEntriesForBaseline>;
  priority: number | null;
  name: string;
  prefix: string;
  baseUrl: string;
  websockets: boolean;
  headers: ReturnType<typeof normalizeHeaderEntries>;
  models: ReturnType<typeof normalizeModelEntries>;
  excludedModels: string[];
};

const buildCodexBaseline = (form: ProviderFormState): CodexFormBaseline => ({
  apiKeyEntries: normalizeApiKeyEntriesForBaseline(form.apiKeyEntries),
  priority:
    form.priority !== undefined && Number.isFinite(form.priority)
      ? Math.trunc(form.priority)
      : null,
  name: String(form.name ?? '').trim(),
  prefix: String(form.prefix ?? '').trim(),
  baseUrl: String(form.baseUrl ?? '').trim(),
  websockets: Boolean(form.websockets),
  headers: normalizeHeaderEntries(form.headers),
  models: normalizeModelEntries(form.modelEntries),
  excludedModels: parseExcludedModels(form.excludedText ?? ''),
});

export function AiProvidersCodexEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ index?: string }>();

  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disableControls = connectionStatus !== 'connected';

  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  const [configs, setConfigs] = useState<ProviderKeyConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<ProviderFormState>(() => buildEmptyForm());
  const [baseline, setBaseline] = useState(() => buildCodexBaseline(buildEmptyForm()));

  const [batchTestModalOpen, setBatchTestModalOpen] = useState(false);
  const [batchTestKeyIndex, setBatchTestKeyIndex] = useState<number | null>(null);
  const [batchTestEntryPoint, setBatchTestEntryPoint] = useState<'discovery' | 'batch-test'>('batch-test');

  const openCodexModelDiscovery = () => {
    const baseUrl = (form.baseUrl ?? '').trim();
    if (!baseUrl) {
      showNotification(t('ai_providers.codex_models_fetch_invalid_url'), 'error');
      return;
    }
    const firstValidKeyIdx = form.apiKeyEntries.findIndex((entry) => entry.apiKey?.trim());
    setBatchTestKeyIndex(firstValidKeyIdx !== -1 ? firstValidKeyIdx : null);
    setBatchTestEntryPoint('discovery');
    setBatchTestModalOpen(true);
  };

  const hasIndexParam = typeof params.index === 'string';
  const editIndex = useMemo(() => parseIndexParam(params.index), [params.index]);
  const invalidIndexParam = hasIndexParam && editIndex === null;

  const initialData = useMemo(() => {
    if (editIndex === null) return undefined;
    return configs[editIndex];
  }, [configs, editIndex]);

  const invalidIndex = editIndex !== null && !initialData;

  const title =
    editIndex !== null
      ? t('ai_providers.codex_edit_modal_title')
      : t('ai_providers.codex_add_modal_title');

  const handleBack = useCallback(() => {
    const state = location.state as LocationState;
    if (state?.fromAiProviders) {
      navigate(-1);
      return;
    }
    navigate('/ai-providers', { replace: true });
  }, [location.state, navigate]);

  const swipeRef = useEdgeSwipeBack({ onBack: handleBack });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchConfig('codex-api-key')
      .then((value) => {
        if (cancelled) return;
        setConfigs(Array.isArray(value) ? (value as ProviderKeyConfig[]) : []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : '';
        setError(message || t('notification.refresh_failed'));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchConfig, t]);

  useEffect(() => {
    if (loading) return;

    if (initialData) {
      const nextForm: ProviderFormState = {
        ...initialData,
        apiKeyEntries: initialData.apiKeyEntries?.length
          ? initialData.apiKeyEntries
          : [buildApiKeyEntry()],
        websockets: Boolean(initialData.websockets),
        headers: headersToEntries(initialData.headers),
        modelEntries: modelsToEntries(initialData.models),
        excludedText: excludedModelsToText(initialData.excludedModels),
      };
      setForm(nextForm);
      setBaseline(buildCodexBaseline(nextForm));
      return;
    }
    const nextForm = buildEmptyForm();
    setForm(nextForm);
    setBaseline(buildCodexBaseline(nextForm));
  }, [initialData, loading]);

  const normalizedHeaders = useMemo(() => normalizeHeaderEntries(form.headers), [form.headers]);
  const normalizedModels = useMemo(
    () => normalizeModelEntries(form.modelEntries),
    [form.modelEntries]
  );
  const normalizedExcludedModels = useMemo(
    () => parseExcludedModels(form.excludedText ?? ''),
    [form.excludedText]
  );
  const normalizedPriority = useMemo(() => {
    return form.priority !== undefined && Number.isFinite(form.priority)
      ? Math.trunc(form.priority)
      : null;
  }, [form.priority]);
  const isHeadersDirty = useMemo(
    () => !areKeyValueEntriesEqual(baseline.headers, normalizedHeaders),
    [baseline.headers, normalizedHeaders]
  );
  const isModelsDirty = useMemo(
    () => !areModelEntriesEqual(baseline.models, normalizedModels),
    [baseline.models, normalizedModels]
  );
  const isExcludedModelsDirty = useMemo(
    () => !areStringArraysEqual(baseline.excludedModels, normalizedExcludedModels),
    [baseline.excludedModels, normalizedExcludedModels]
  );
  const normalizedApiKeyEntries = useMemo(
    () => normalizeApiKeyEntriesForBaseline(form.apiKeyEntries),
    [form.apiKeyEntries]
  );
  const isApiKeyEntriesDirty = useMemo(
    () => !areNormalizedApiKeyEntriesEqual(baseline.apiKeyEntries, normalizedApiKeyEntries),
    [baseline.apiKeyEntries, normalizedApiKeyEntries]
  );
  const isDirty =
    isApiKeyEntriesDirty ||
    baseline.priority !== normalizedPriority ||
    baseline.name !== String(form.name ?? '').trim() ||
    baseline.prefix !== String(form.prefix ?? '').trim() ||
    baseline.baseUrl !== String(form.baseUrl ?? '').trim() ||
    baseline.websockets !== Boolean(form.websockets) ||
    isHeadersDirty ||
    isModelsDirty ||
    isExcludedModelsDirty;
  const canGuard = !loading && !saving && !invalidIndexParam && !invalidIndex;

  const { allowNextNavigation } = useUnsavedChangesGuard({
    enabled: canGuard,
    shouldBlock: ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
    dialog: {
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.leave'),
      cancelText: t('common.stay'),
      variant: 'danger',
    },
  });

  const canSave = !disableControls && !saving && !loading && !invalidIndexParam && !invalidIndex;

  const handleBatchTestComplete = useCallback(
    (_payload: { keyIndex: number; results: Record<string, CodexBatchModelTestRowResult> }) => {
      // Codex 暂不在表格行内显示批量测试结果，仅保留回调供后续扩展
    },
    []
  );

  const handleAddBatchAvailableModels = useCallback(
    (payload: {
      keyIndex: number;
      results: Record<string, CodexBatchModelTestRowResult>;
      models: ModelInfo[];
    }) => {
      setForm((prev) => {
        const mergedMap = new Map<string, ModelEntry>();
        prev.modelEntries.forEach((entry) => {
          const name = entry.name.trim();
          if (!name) return;
          mergedMap.set(name.toLowerCase(), { ...entry, name, alias: entry.alias?.trim() || '' });
        });

        let addedCount = 0;
        payload.models.forEach((model) => {
          const name = String(model.name ?? '').trim();
          if (!name) return;
          const key = name.toLowerCase();
          if (mergedMap.has(key)) return;
          const existingEntry = prev.modelEntries.find(
            (e) => e.name.trim().toLowerCase() === key
          );
          mergedMap.set(key, {
            name,
            alias: (existingEntry?.alias || model.alias || '').trim(),
          });
          addedCount += 1;
        });

        const mergedEntries = Array.from(mergedMap.values());
        if (addedCount > 0) {
          showNotification(
            t('ai_providers.codex_models_fetch_added', { count: addedCount }),
            'success'
          );
        }
        return {
          ...prev,
          modelEntries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
        };
      });
    },
    [setForm, showNotification, t]
  );

  const handleSave = useCallback(async () => {
    if (!canSave) return;

    const trimmedBaseUrl = (form.baseUrl ?? '').trim();
    const baseUrl = trimmedBaseUrl || undefined;
    if (!baseUrl) {
      showNotification(t('notification.codex_base_url_required'), 'error');
      return;
    }
    if (!getPrimaryApiKey(form)) {
      showNotification(t('ai_providers.api_key_required'), 'error');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const payload: ProviderKeyConfig = {
        apiKeyEntries: serializeApiKeyEntriesForSave(form.apiKeyEntries),
        priority: form.priority !== undefined ? Math.trunc(form.priority) : undefined,
        name: form.name?.trim() || undefined,
        prefix: form.prefix?.trim() || undefined,
        baseUrl,
        websockets: Boolean(form.websockets),
        headers: buildHeaderObject(form.headers),
        models: entriesToModels(form.modelEntries),
        excludedModels: parseExcludedModels(form.excludedText),
      };

      const nextList =
        editIndex !== null
          ? configs.map((item, idx) => (idx === editIndex ? payload : item))
          : [...configs, payload];

      await providersApi.saveCodexConfigs(nextList);
      updateConfigValue('codex-api-key', nextList);
      clearCache('codex-api-key');
      showNotification(
        editIndex !== null
          ? t('notification.codex_config_updated')
          : t('notification.codex_config_added'),
        'success'
      );
      allowNextNavigation();
      setBaseline(buildCodexBaseline(form));
      handleBack();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(message);
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [
    allowNextNavigation,
    canSave,
    clearCache,
    configs,
    editIndex,
    form,
    handleBack,
    showNotification,
    t,
    updateConfigValue,
  ]);



  return (
    <SecondaryScreenShell
      ref={swipeRef}
      contentClassName={layoutStyles.content}
      title={title}
      onBack={handleBack}
      backLabel={t('common.back')}
      backAriaLabel={t('common.back')}
      hideTopBarBackButton
      hideTopBarRightAction
      floatingAction={
        <div className={layoutStyles.floatingActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleBack}
            className={layoutStyles.floatingBackButton}
          >
            {t('common.back')}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            loading={saving}
            disabled={!canSave}
            className={layoutStyles.floatingSaveButton}
          >
            {t('common.save')}
          </Button>
        </div>
      }
      isLoading={loading}
      loadingLabel={t('common.loading')}
    >
      <Card>
        {error && <div className="error-box">{error}</div>}
        {invalidIndexParam || invalidIndex ? (
          <div className="hint">{t('common.invalid_provider_index')}</div>
        ) : (
          <>
            <div className={styles.openaiEditForm}>
              <div className={styles.providerEditTopGrid}>
                <Input
                  label={t('ai_providers.provider_name_label')}
                  value={form.name ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  hint={t('ai_providers.provider_name_hint')}
                  disabled={disableControls || saving}
                />
                <ProviderPrioritySelector
                  label={t('ai_providers.priority_label')}
                  value={form.priority}
                  onChange={(val) => setForm((prev) => ({ ...prev, priority: val }))}
                  disabled={disableControls || saving}
                />
                <Input
                  label={t('ai_providers.prefix_label')}
                  placeholder={t('ai_providers.prefix_placeholder')}
                  value={form.prefix ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, prefix: e.target.value }))}
                  hint={t('ai_providers.prefix_hint')}
                  disabled={disableControls || saving}
                />
                <Input
                  label={t('ai_providers.codex_add_modal_url_label')}
                  value={form.baseUrl ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  disabled={disableControls || saving}
                />
                <div className={`form-group ${styles.providerEditFullRow}`}>
                  <label>{t('ai_providers.codex_websockets_label')}</label>
                  <ToggleSwitch
                    checked={Boolean(form.websockets)}
                    onChange={(value) => setForm((prev) => ({ ...prev, websockets: value }))}
                    disabled={disableControls || saving}
                    ariaLabel={t('ai_providers.codex_websockets_label')}
                  />
                  <div className="hint">{t('ai_providers.codex_websockets_hint')}</div>
                </div>
              </div>
              <HeaderInputList
                entries={form.headers}
                onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
                addLabel={t('common.custom_headers_add')}
                keyPlaceholder={t('common.custom_headers_key_placeholder')}
                valuePlaceholder={t('common.custom_headers_value_placeholder')}
                removeButtonTitle={t('common.delete')}
                removeButtonAriaLabel={t('common.delete')}
                disabled={disableControls || saving}
              />

              <div className={styles.modelConfigSection}>
                <div className={styles.modelConfigHeader}>
                  <label className={styles.modelConfigTitle}>
                    {t('ai_providers.codex_models_label')}
                  </label>
                  <div className={styles.modelConfigToolbar}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          modelEntries: [...prev.modelEntries, { name: '', alias: '' }],
                        }))
                      }
                      disabled={disableControls || saving}
                    >
                      {t('ai_providers.codex_models_add_btn')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={openCodexModelDiscovery}
                      disabled={disableControls || saving || loading || invalidIndexParam || invalidIndex}
                    >
                      {t('ai_providers.codex_models_fetch_button')}
                    </Button>
                  </div>
                </div>
                <div className={styles.sectionHint}>{t('ai_providers.codex_models_hint')}</div>

                <ModelInputList
                  entries={form.modelEntries}
                  onChange={(entries) => setForm((prev) => ({ ...prev, modelEntries: entries }))}
                  namePlaceholder={t('common.model_name_placeholder')}
                  aliasPlaceholder={t('common.model_alias_placeholder')}
                  disabled={disableControls || saving}
                  hideAddButton
                  className={styles.modelInputList}
                  rowClassName={styles.modelInputRow}
                  inputClassName={styles.modelInputField}
                  removeButtonClassName={styles.modelRowRemoveButton}
                  removeButtonTitle={t('common.delete')}
                  removeButtonAriaLabel={t('common.delete')}
                />
              </div>
              <div className={styles.keyEntriesSection}>
                <div className={styles.keyEntriesHeader}>
                  <label className={styles.keyEntriesLabel}>
                    {t('ai_providers.codex_add_modal_key_label')}
                  </label>
                  <span className={styles.keyEntriesHint}>
                    {t('ai_providers.provider_keys_hint')}
                  </span>
                </div>
                <ProviderApiKeyEntriesEditor
                  entries={form.apiKeyEntries}
                  disabled={disableControls || saving}
                  onChange={(apiKeyEntries) => setForm((prev) => ({ ...prev, apiKeyEntries }))}
                />
              </div>
              <div className="form-group">
                <label>{t('ai_providers.excluded_models_label')}</label>
                <textarea
                  className="input"
                  placeholder={t('ai_providers.excluded_models_placeholder')}
                  value={form.excludedText}
                  onChange={(e) => setForm((prev) => ({ ...prev, excludedText: e.target.value }))}
                  rows={4}
                  disabled={disableControls || saving}
                />
                <div className="hint">{t('ai_providers.excluded_models_hint')}</div>
              </div>
            </div>

            <CodexBatchModelTestModal
              open={batchTestModalOpen}
              onClose={() => {
                setBatchTestModalOpen(false);
                setBatchTestKeyIndex(null);
              }}
              keyIndex={batchTestKeyIndex}
              loading={loading}
              saving={saving}
              disableControls={disableControls}
              form={form}
              entryPoint={batchTestEntryPoint}
              onBatchComplete={handleBatchTestComplete}
              onAddAvailableModels={handleAddBatchAvailableModels}
            />
          </>
        )}
      </Card>
    </SecondaryScreenShell>
  );
}
