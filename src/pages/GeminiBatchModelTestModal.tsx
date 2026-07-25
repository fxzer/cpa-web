import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiCallApi, getApiCallErrorMessage, modelsApi } from '@/services/api';
import type { ModelInfo } from '@/utils/models';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import type { GeminiFormState } from '@/components/providers/types';
import {
  buildGeminiGenerateContentEndpoint,
  buildGeminiModelsEndpoint,
} from '@/components/providers/utils';
import {
  BatchModelTestModalShell,
  type BatchModelTestProgress,
  type BatchModelTestRowResult,
} from './BatchModelTestModalShell';
import { buildBatchModelTestFailure, runBatchModelTestsConcurrent } from './batchModelTestConcurrent';

const GEMINI_TEST_TIMEOUT_MS = 30_000;

export type GeminiBatchModelTestRowResult = BatchModelTestRowResult;

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

export type GeminiBatchModelTestModalProps = {
  open: boolean;
  onClose: () => void;
  keyIndex: number | null;
  loading: boolean;
  saving: boolean;
  disableControls: boolean;
  form: GeminiFormState;
  entryPoint: 'discovery' | 'batch-test';
  onBatchComplete: (payload: {
    keyIndex: number;
    results: Record<string, GeminiBatchModelTestRowResult>;
  }) => void;
  onAddAvailableModels: (payload: {
    keyIndex: number;
    results: Record<string, GeminiBatchModelTestRowResult>;
    models: ModelInfo[];
  }) => void;
};

export function GeminiBatchModelTestModal({
  open,
  onClose,
  keyIndex,
  loading,
  saving,
  disableControls,
  form,
  entryPoint = 'batch-test',
  onBatchComplete,
  onAddAvailableModels,
}: GeminiBatchModelTestModalProps) {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [testing, setTesting] = useState(false);
  const [testProgress, setTestProgress] = useState<BatchModelTestProgress>(null);
  const [testResults, setTestResults] = useState<Record<string, GeminiBatchModelTestRowResult>>(
    {}
  );
  const [selectedKeyIndex, setSelectedKeyIndex] = useState<number | null>(keyIndex);

  useEffect(() => {
    setSelectedKeyIndex(keyIndex);
  }, [keyIndex]);

  const rowKey =
    selectedKeyIndex !== null ? form.apiKeyEntries[selectedKeyIndex]?.apiKey?.trim() : '';

  const keyOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    form.apiKeyEntries.forEach((entry, idx) => {
      const rawKey = entry.apiKey?.trim() ?? '';
      if (!rawKey) return;
      const masked = rawKey.length > 6 ? `${rawKey.slice(0, 3)}...${rawKey.slice(-3)}` : rawKey;
      const remark = entry.remark?.trim();
      const label = remark
        ? t('ai_providers.batch_model_key_option_with_remark', { index: idx + 1, key: masked, remark })
        : t('ai_providers.batch_model_key_option', { index: idx + 1, key: masked });
      options.push({ value: String(idx), label });
    });
    return options;
  }, [form.apiKeyEntries, t]);

  const selectedKey = selectedKeyIndex !== null ? String(selectedKeyIndex) : '';

  const handleKeyChange = useCallback((value: string) => {
    const nextIdx = Number(value);
    if (!Number.isFinite(nextIdx)) return;
    setSelectedKeyIndex(nextIdx);
    setSelected(new Set());
    setTestResults({});
    setTestProgress(null);
    setError('');
  }, []);

  const fetchModels = useCallback(async () => {
    const trimmedBaseUrl = form.baseUrl?.trim() ?? '';
    if (!trimmedBaseUrl) return;

    setFetching(true);
    setError('');
    try {
      const headerObject = buildHeaderObject(form.headers);
      const list = await modelsApi.fetchGeminiModelsViaApiCall(
        trimmedBaseUrl,
        rowKey || undefined,
        headerObject
      );
      setModels(list);
    } catch (err: unknown) {
      setModels([]);
      setError(`${t('ai_providers.gemini_models_fetch_error')}: ${getErrorMessage(err)}`);
    } finally {
      setFetching(false);
    }
  }, [form.baseUrl, form.headers, selectedKeyIndex, rowKey, t]);

  useEffect(() => {
    if (!open) return;
    setEndpoint(buildGeminiModelsEndpoint(form.baseUrl ?? ''));
    setError('');
    setTestProgress(null);
    setTestResults({});
  }, [open, form.baseUrl]);

  useEffect(() => {
    if (!open) return;
    if (loading) return;
    // 等待 selectedKeyIndex 从 keyIndex prop 同步完成，避免初始 null 发一次、同步后又发一次
    if (keyIndex !== null && selectedKeyIndex === null) return;
    setModels([]);
    setSearch('');
    setSelected(new Set());
    void fetchModels();
  }, [open, loading, selectedKeyIndex, keyIndex, fetchModels]);

  useEffect(() => {
    if (!open) return;
    const availableNames = new Set(models.map((model) => model.name));
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((name) => {
        if (availableNames.has(name)) {
          next.add(name);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [open, models]);

  const filteredModels = useMemo(() => {
    const filter = search.trim().toLowerCase();
    if (!filter) return models;
    return models.filter((model) => {
      const name = (model.name || '').toLowerCase();
      const alias = (model.alias || '').toLowerCase();
      const desc = (model.description || '').toLowerCase();
      return name.includes(filter) || alias.includes(filter) || desc.includes(filter);
    });
  }, [models, search]);

  const visibleModelNames = useMemo(
    () => filteredModels.map((model) => model.name),
    [filteredModels]
  );

  const allVisibleSelected = useMemo(
    () => visibleModelNames.length > 0 && visibleModelNames.every((name) => selected.has(name)),
    [selected, visibleModelNames]
  );

  const toggleSelection = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleSelectVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      visibleModelNames.forEach((name) => next.add(name));
      return next;
    });
  }, [visibleModelNames]);

  const handleInvertSelection = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      visibleModelNames.forEach((name) => {
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
      });
      return next;
    });
  }, [visibleModelNames]);

  const availableModelCount = useMemo(
    () => models.filter((m) => testResults[m.name]?.success).length,
    [models, testResults]
  );

  const handleSelectAvailable = useCallback(() => {
    const availableNames = models
      .filter((m) => testResults[m.name]?.success)
      .map((m) => m.name);
    setSelected(new Set(availableNames));
  }, [models, testResults]);

  const handleClearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const runBatchTests = useCallback(async () => {
    if (selectedKeyIndex === null || !rowKey) {
      return;
    }
    const baseUrl = form.baseUrl?.trim() ?? '';
    if (!baseUrl) {
      setError(t('notification.openai_test_url_required'));
      return;
    }

    const modelNames = Array.from(selected);
    if (modelNames.length === 0) return;

    const keyEntry = form.apiKeyEntries[selectedKeyIndex];
    if (!keyEntry?.apiKey?.trim()) {
      setError(t('notification.openai_test_key_required'));
      return;
    }

    const customHeaders = buildHeaderObject(form.headers);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };
    if (!hasHeader(headers, 'x-goog-api-key')) {
      headers['x-goog-api-key'] = keyEntry.apiKey.trim();
    }

    setTesting(true);
    setError('');
    setTestResults({});
    setTestProgress(null);

    try {
      const results = await runBatchModelTestsConcurrent({
        modelNames,
        testModel: async (modelName) => {
          const endpointUrl = buildGeminiGenerateContentEndpoint(baseUrl, modelName);
          if (!endpointUrl) {
            return {
              success: false,
              message: t('notification.openai_test_model_required'),
            };
          }

          try {
            const result = await apiCallApi.request(
              {
                method: 'POST',
                url: endpointUrl,
                header: Object.keys(headers).length ? headers : undefined,
                data: JSON.stringify({
                  contents: [{ parts: [{ text: 'Hi' }] }],
                }),
              },
              { timeout: GEMINI_TEST_TIMEOUT_MS }
            );

            const ok = result.statusCode >= 200 && result.statusCode < 300;
            return {
              success: ok,
              statusCode: result.statusCode,
              message: ok ? '' : getApiCallErrorMessage(result),
            };
          } catch (err: unknown) {
            return buildBatchModelTestFailure(err, GEMINI_TEST_TIMEOUT_MS, (seconds) =>
              t('ai_providers.openai_test_timeout', { seconds })
            );
          }
        },
        onProgress: setTestProgress,
        onResult: setTestResults,
      });

      onBatchComplete({ keyIndex: selectedKeyIndex, results });
    } finally {
      setTesting(false);
      setTestProgress(null);
    }
  }, [form.apiKeyEntries, form.baseUrl, form.headers, selectedKeyIndex, onBatchComplete, rowKey, selected, t]);

  const handleAddAvailableModels = useCallback(() => {
    if (selectedKeyIndex === null) return;
    const selectedModels = models.filter((m) => selected.has(m.name));
    if (selectedModels.length === 0) return;

    const selectedResults: Record<string, GeminiBatchModelTestRowResult> = {};
    selectedModels.forEach((m) => {
      selectedResults[m.name] = testResults[m.name] ?? { success: true };
    });

    onAddAvailableModels({
      keyIndex: selectedKeyIndex,
      results: selectedResults,
      models: selectedModels,
    });
    onClose();
  }, [selectedKeyIndex, models, selected, testResults, onAddAvailableModels, onClose]);

  const canRun =
    !disableControls &&
    !saving &&
    !fetching &&
    !testing &&
    selected.size > 0 &&
    Boolean(rowKey) &&
    selectedKeyIndex !== null;
  const canAddAvailable =
    !disableControls && !saving && !fetching && !testing && selected.size > 0;

  if (!open) {
    return null;
  }

  return (
    <BatchModelTestModalShell
      open={open}
      onClose={onClose}
      keyIndex={selectedKeyIndex}
      entryPoint={entryPoint}
      hint={t('ai_providers.gemini_batch_model_test_hint')}
      modelCount={models.length}
      endpoint={endpoint}
      endpointLabel={t('ai_providers.gemini_models_fetch_url_label')}
      refreshLabel={t('ai_providers.gemini_models_fetch_refresh')}
      onRefresh={() => void fetchModels()}
      fetching={fetching}
      fetchingLoadingText={t('ai_providers.gemini_models_fetch_loading')}
      fetchingEmptyText={t('ai_providers.gemini_models_fetch_empty')}
      searchEmptyText={t('ai_providers.gemini_models_search_empty')}
      error={error}
      search={search}
      onSearchChange={setSearch}
      models={models}
      filteredModels={filteredModels}
      selected={selected}
      onToggleSelection={toggleSelection}
      onSelectVisible={handleSelectVisible}
      onInvertSelection={handleInvertSelection}
      onSelectAvailable={handleSelectAvailable}
      availableModelCount={availableModelCount}
      onClearSelection={handleClearSelection}
      allVisibleSelected={allVisibleSelected}
      disableControls={disableControls}
      saving={saving}
      testing={testing}
      testProgress={testProgress}
      testResults={testResults}
      onRunBatchTests={() => void runBatchTests()}
      onAddAvailableModels={handleAddAvailableModels}
      canRun={canRun}
      canAddAvailable={canAddAvailable}
      keyOptions={keyOptions}
      selectedKey={selectedKey}
      onKeyChange={handleKeyChange}
    />
  );
}
