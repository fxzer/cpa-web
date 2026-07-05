import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { modelsApi } from '@/services/api';
import type { ModelInfo } from '@/utils/models';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import {
  buildOpenAIModelsEndpoint,
  buildOpenAIChatCompletionsEndpoint,
} from '@/components/providers/utils';
import type { OpenAIFormState } from '@/components/providers/types';
import {
  BatchModelTestModalShell,
  type BatchModelTestProgress,
  type BatchModelTestRowResult,
} from './BatchModelTestModalShell';
import { buildBatchModelTestFailure, runBatchModelTestsConcurrent } from './batchModelTestConcurrent';

const OPENAI_TEST_TIMEOUT_MS = 30_000;

export type OpenAIBatchModelTestRowResult = BatchModelTestRowResult;

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

export type OpenAIBatchModelTestModalProps = {
  open: boolean;
  onClose: () => void;
  keyIndex: number | null;
  loading: boolean;
  saving: boolean;
  disableControls: boolean;
  form: OpenAIFormState;
  entryPoint: 'discovery' | 'batch-test';
  onBatchComplete: (payload: {
    keyIndex: number;
    results: Record<string, OpenAIBatchModelTestRowResult>;
  }) => void;
  onAddAvailableModels: (payload: {
    keyIndex: number;
    results: Record<string, OpenAIBatchModelTestRowResult>;
    models: ModelInfo[];
  }) => void;
};

export function OpenAIBatchModelTestModal({
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
}: OpenAIBatchModelTestModalProps) {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [testing, setTesting] = useState(false);
  const [testProgress, setTestProgress] = useState<BatchModelTestProgress>(null);
  const [testResults, setTestResults] = useState<Record<string, OpenAIBatchModelTestRowResult>>(
    {}
  );
  // 弹窗内部维护当前选中的 key 索引（初始用父组件传入的 keyIndex）
  const [selectedKeyIndex, setSelectedKeyIndex] = useState<number | null>(keyIndex);

  // 同步外部 keyIndex 变化（首次打开或换入口）
  useEffect(() => {
    setSelectedKeyIndex(keyIndex);
  }, [keyIndex]);

  const rowKey =
    selectedKeyIndex !== null ? form.apiKeyEntries[selectedKeyIndex]?.apiKey?.trim() : '';

  // 构造 key 下拉选项：仅含有 apiKey 的条目，label 显示「密钥N: 掩码 (备注)」
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

  const handleKeyChange = useCallback(
    (value: string) => {
      const nextIdx = Number(value);
      if (!Number.isFinite(nextIdx)) return;
      setSelectedKeyIndex(nextIdx);
      // 切换 key → 重置测试结果与选中，触发重新拉取
      setSelected(new Set());
      setTestResults({});
      setTestProgress(null);
      setError('');
    },
    []
  );

  const fetchModels = useCallback(
    async ({ allowFallback = true }: { allowFallback?: boolean } = {}) => {
      const trimmedBaseUrl = form.baseUrl.trim();
      if (!trimmedBaseUrl) return;

      setFetching(true);
      setError('');
      try {
        const headerObject = buildHeaderObject(form.headers);
        const bearerKey = rowKey;
        const hasAuthHeader = hasHeader(headerObject, 'authorization');
        const list = await modelsApi.fetchModelsViaApiCall(
          trimmedBaseUrl,
          hasAuthHeader ? undefined : bearerKey || undefined,
          headerObject
        );
        setModels(list);
      } catch (err: unknown) {
        if (allowFallback && rowKey) {
          try {
            const list = await modelsApi.fetchModelsViaApiCall(trimmedBaseUrl);
            setModels(list);
            return;
          } catch (fallbackErr: unknown) {
            const message = getErrorMessage(fallbackErr) || getErrorMessage(err);
            setModels([]);
            setError(`${t('ai_providers.openai_models_fetch_error')}: ${message}`);
          }
        } else {
          setModels([]);
          setError(`${t('ai_providers.openai_models_fetch_error')}: ${getErrorMessage(err)}`);
        }
      } finally {
        setFetching(false);
      }
    },
    [form.baseUrl, form.headers, selectedKeyIndex, rowKey, t]
  );

  useEffect(() => {
    if (!open) return;
    setEndpoint(buildOpenAIModelsEndpoint(form.baseUrl));
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

  const handleClearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const runBatchTests = useCallback(async () => {
    if (selectedKeyIndex === null || !rowKey) {
      return;
    }
    const baseUrl = form.baseUrl.trim();
    const chatEndpoint = buildOpenAIChatCompletionsEndpoint(baseUrl);
    if (!chatEndpoint) {
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
    if (!hasHeader(headers, 'authorization')) {
      headers.Authorization = `Bearer ${keyEntry.apiKey.trim()}`;
    }

    setTesting(true);
    setError('');
    setTestResults({});
    setTestProgress(null);

    try {
      const results = await runBatchModelTestsConcurrent({
        modelNames,
        testModel: async (modelName) => {
          try {
            const result = await apiCallApi.request(
              {
                method: 'POST',
                url: chatEndpoint,
                header: Object.keys(headers).length ? headers : undefined,
                data: JSON.stringify({
                  model: modelName,
                  messages: [{ role: 'user', content: 'Hi' }],
                  stream: false,
                  max_tokens: 5,
                }),
              },
              { timeout: OPENAI_TEST_TIMEOUT_MS }
            );

            const ok = result.statusCode >= 200 && result.statusCode < 300;
            return {
              success: ok,
              statusCode: result.statusCode,
              message: ok ? '' : getApiCallErrorMessage(result),
            };
          } catch (err: unknown) {
            return buildBatchModelTestFailure(err, OPENAI_TEST_TIMEOUT_MS, (seconds) =>
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

  const selectedAvailableCount = useMemo(
    () => models.filter((m) => selected.has(m.name) && testResults[m.name]?.success).length,
    [models, selected, testResults]
  );

  const handleAddAvailableModels = useCallback(() => {
    if (selectedKeyIndex === null) return;
    const selectedAvailable = models.filter(
      (m) => selected.has(m.name) && testResults[m.name]?.success
    );
    if (selectedAvailable.length === 0) return;

    const selectedResults: Record<string, OpenAIBatchModelTestRowResult> = {};
    selectedAvailable.forEach((m) => {
      selectedResults[m.name] = testResults[m.name];
    });

    onAddAvailableModels({
      keyIndex: selectedKeyIndex,
      results: selectedResults,
      models: selectedAvailable,
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
    !disableControls && !saving && !fetching && !testing && selectedAvailableCount > 0;

  if (!open) {
    return null;
  }

  return (
    <BatchModelTestModalShell
      open={open}
      onClose={onClose}
      keyIndex={selectedKeyIndex}
      entryPoint={entryPoint}
      hint={t('ai_providers.openai_batch_model_test_hint')}
      modelCount={models.length}
      endpoint={endpoint}
      endpointLabel={t('ai_providers.openai_models_fetch_url_label')}
      refreshLabel={t('ai_providers.openai_models_fetch_refresh')}
      onRefresh={() => void fetchModels({ allowFallback: true })}
      fetching={fetching}
      fetchingLoadingText={t('ai_providers.openai_models_fetch_loading')}
      fetchingEmptyText={t('ai_providers.openai_models_fetch_empty')}
      searchEmptyText={t('ai_providers.openai_models_search_empty')}
      error={error}
      search={search}
      onSearchChange={setSearch}
      models={models}
      filteredModels={filteredModels}
      selected={selected}
      onToggleSelection={toggleSelection}
      onSelectVisible={handleSelectVisible}
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
