import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HeaderInputList } from '@/components/ui/HeaderInputList';
import { ModelInputList } from '@/components/ui/ModelInputList';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { apiCallApi, getApiCallErrorMessage, modelsApi, providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import type { KeyTestStatus } from '@/stores/useOpenAIEditDraftStore';
import type { GeminiKeyConfig } from '@/types';
import {
  buildHeaderObject,
  hasHeader,
  headersToEntries,
  normalizeHeaderEntries,
} from '@/utils/headers';
import {
  areKeyValueEntriesEqual,
  areModelEntriesEqual,
  areStringArraysEqual,
} from '@/utils/compare';
import type { ModelInfo } from '@/utils/models';
import { entriesToModels, modelsToEntries } from '@/components/ui/modelInputListUtils';
import { ProviderApiKeyEntriesEditor } from '@/components/providers/ProviderApiKeyEntriesEditor';
import {
  areNormalizedApiKeyEntriesEqual,
  buildApiKeyEntry,
  buildGeminiGenerateContentEndpoint,
  excludedModelsToText,
  getPrimaryApiKey,
  normalizeApiKeyEntriesForBaseline,
  parseExcludedModels,
  serializeApiKeyEntriesForSave,
} from '@/components/providers/utils';
import type { GeminiFormState } from '@/components/providers';
import {
  GeminiBatchModelTestModal,
  type GeminiBatchModelTestRowResult,
} from './GeminiBatchModelTestModal';
import {
  normalizeGeminiModelEntries,
  stripGeminiModelResourceName,
} from './AiProvidersGeminiEditUtils';
import layoutStyles from './AiProvidersEditLayout.module.scss';
import styles from './AiProvidersPage.module.scss';

type LocationState = { fromAiProviders?: boolean } | null;

const GEMINI_TEST_TIMEOUT_MS = 30_000;

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

const createIdleKeyTestStatuses = (count: number): KeyTestStatus[] =>
  Array.from({ length: Math.max(count, 1) }, () => ({ status: 'idle', message: '' }));

type KeyTestResult = {
  ok: boolean;
  message?: string;
};

const buildEmptyForm = (): GeminiFormState => ({
  apiKeyEntries: [buildApiKeyEntry()],
  priority: undefined,
  name: '',
  prefix: '',
  baseUrl: '',
  headers: [],
  modelEntries: [{ name: '', alias: '' }],
  excludedModels: [],
  excludedText: '',
});

const parseIndexParam = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

type GeminiFormBaseline = {
  apiKeyEntries: ReturnType<typeof normalizeApiKeyEntriesForBaseline>;
  priority: number | null;
  name: string;
  prefix: string;
  baseUrl: string;
  headers: ReturnType<typeof normalizeHeaderEntries>;
  models: ReturnType<typeof normalizeGeminiModelEntries>;
  excludedModels: string[];
};

const buildGeminiBaseline = (form: GeminiFormState): GeminiFormBaseline => ({
  apiKeyEntries: normalizeApiKeyEntriesForBaseline(form.apiKeyEntries),
  priority:
    form.priority !== undefined && Number.isFinite(form.priority)
      ? Math.trunc(form.priority)
      : null,
  name: String(form.name ?? '').trim(),
  prefix: String(form.prefix ?? '').trim(),
  baseUrl: String(form.baseUrl ?? '').trim(),
  headers: normalizeHeaderEntries(form.headers),
  models: normalizeGeminiModelEntries(form.modelEntries),
  excludedModels: parseExcludedModels(form.excludedText ?? ''),
});

export function AiProvidersGeminiEditPage() {
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

  const [configs, setConfigs] = useState<GeminiKeyConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<GeminiFormState>(() => buildEmptyForm());
  const [baseline, setBaseline] = useState(() => buildGeminiBaseline(buildEmptyForm()));

  const [modelDiscoveryOpen, setModelDiscoveryOpen] = useState(false);
  const [modelDiscoveryEndpoint, setModelDiscoveryEndpoint] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<ModelInfo[]>([]);
  const [modelDiscoveryFetching, setModelDiscoveryFetching] = useState(false);
  const [modelDiscoveryError, setModelDiscoveryError] = useState('');
  const [modelDiscoverySearch, setModelDiscoverySearch] = useState('');
  const [modelDiscoverySelected, setModelDiscoverySelected] = useState<Set<string>>(new Set());
  const autoFetchSignatureRef = useRef<string>('');
  const modelDiscoveryRequestIdRef = useRef(0);

  const [isTestingKeys, setIsTestingKeys] = useState(false);
  const [testModel, setTestModel] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [keyTestStatuses, setKeyTestStatuses] = useState<KeyTestStatus[]>(() =>
    createIdleKeyTestStatuses(1)
  );
  const [batchTestModalOpen, setBatchTestModalOpen] = useState(false);
  const [batchTestKeyIndex, setBatchTestKeyIndex] = useState<number | null>(null);
  const [batchModelTestByKey, setBatchModelTestByKey] = useState<
    Record<number, Record<string, GeminiBatchModelTestRowResult>>
  >({});

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
      ? t('ai_providers.gemini_edit_modal_title')
      : t('ai_providers.gemini_add_modal_title');

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

    fetchConfig('gemini-api-key')
      .then((value) => {
        if (cancelled) return;
        setConfigs(Array.isArray(value) ? (value as GeminiKeyConfig[]) : []);
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
      const { headers, models, ...rest } = initialData;
      const nextForm: GeminiFormState = {
        ...rest,
        apiKeyEntries: rest.apiKeyEntries?.length ? rest.apiKeyEntries : [buildApiKeyEntry()],
        headers: headersToEntries(headers),
        modelEntries: modelsToEntries(models).map((entry) => ({
          ...entry,
          name: stripGeminiModelResourceName(entry.name),
        })),
        excludedText: excludedModelsToText(initialData.excludedModels),
      };
      setForm(nextForm);
      setBaseline(buildGeminiBaseline(nextForm));
      return;
    }
    const nextForm = buildEmptyForm();
    setForm(nextForm);
    setBaseline(buildGeminiBaseline(nextForm));
  }, [initialData, loading]);

  const hasConfiguredModels = form.modelEntries.some((entry) => entry.name.trim());
  const hasTestableKeys = form.apiKeyEntries.some((entry) => entry.apiKey?.trim());
  const availableModels = useMemo(
    () =>
      form.modelEntries
        .map((entry) => entry.name.trim())
        .filter((name, index, list) => name && list.indexOf(name) === index),
    [form.modelEntries]
  );
  const modelSelectOptions = useMemo(() => {
    const seen = new Set<string>();
    return form.modelEntries.reduce<Array<{ value: string; label: string }>>((acc, entry) => {
      const name = entry.name.trim();
      if (!name || seen.has(name)) return acc;
      seen.add(name);
      const alias = entry.alias.trim();
      acc.push({
        value: name,
        label: alias && alias !== name ? `${name} (${alias})` : name,
      });
      return acc;
    }, []);
  }, [form.modelEntries]);

  const resetKeyTestStatuses = useCallback((count: number) => {
    setKeyTestStatuses(createIdleKeyTestStatuses(count));
  }, []);

  const setKeyTestStatus = useCallback((keyIndex: number, status: KeyTestStatus) => {
    setKeyTestStatuses((prev) => {
      const next = [...prev];
      while (next.length <= keyIndex) {
        next.push({ status: 'idle', message: '' });
      }
      next[keyIndex] = status;
      return next;
    });
  }, []);

  const connectivityConfigSignature = useMemo(() => {
    const headersSignature = form.headers
      .map((entry) => `${entry.key.trim()}:${entry.value.trim()}`)
      .join('|');
    const modelsSignature = form.modelEntries
      .map((entry) => `${entry.name.trim()}:${entry.alias.trim()}`)
      .join('|');
    return [form.baseUrl?.trim() ?? '', testModel.trim(), headersSignature, modelsSignature].join(
      '||'
    );
  }, [form.baseUrl, form.headers, form.modelEntries, testModel]);
  const previousConnectivityConfigRef = useRef(connectivityConfigSignature);

  useEffect(() => {
    if (previousConnectivityConfigRef.current === connectivityConfigSignature) {
      return;
    }
    previousConnectivityConfigRef.current = connectivityConfigSignature;
    resetKeyTestStatuses(form.apiKeyEntries.length);
    setTestStatus('idle');
    setTestMessage('');
    setBatchModelTestByKey({});
  }, [connectivityConfigSignature, form.apiKeyEntries.length, resetKeyTestStatuses]);

  const apiKeysSignature = useMemo(
    () =>
      form.apiKeyEntries.map((entry) => `${entry.apiKey ?? ''}|${entry.proxyUrl ?? ''}`).join(';'),
    [form.apiKeyEntries]
  );

  useEffect(() => {
    setBatchModelTestByKey({});
  }, [apiKeysSignature]);

  const handleBatchTestComplete = useCallback(
    ({
      keyIndex: ki,
      results,
    }: {
      keyIndex: number;
      results: Record<string, GeminiBatchModelTestRowResult>;
    }) => {
      setBatchModelTestByKey((prev) => ({
        ...prev,
        [ki]: { ...(prev[ki] ?? {}), ...results },
      }));
      showNotification(
        t('ai_providers.openai_batch_model_test_done', { count: Object.keys(results).length }),
        'success'
      );
    },
    [showNotification, t]
  );

  const handleAddBatchAvailableModels = useCallback(
    ({
      keyIndex: ki,
      results,
      models,
    }: {
      keyIndex: number;
      results: Record<string, GeminiBatchModelTestRowResult>;
      models: ModelInfo[];
    }) => {
      const availableNames = new Set(
        Object.entries(results)
          .filter(([, result]) => result.success)
          .map(([name]) => stripGeminiModelResourceName(name).trim())
          .filter(Boolean)
      );

      if (availableNames.size === 0) {
        showNotification(t('ai_providers.openai_batch_model_add_available_empty'), 'warning');
        return;
      }

      setBatchModelTestByKey((prev) => ({
        ...prev,
        [ki]: { ...results },
      }));

      let addedCount = 0;
      let removedCount = 0;

      setForm((prev) => {
        // 取交集逻辑：
        // 1. 原有模型若不可用 → 清理掉
        // 2. 原有模型若可用且有别名 → 保留其别名
        // 3. 添加新勾选的可用模型
        const mergedMap = new Map<string, { name: string; alias: string }>();

        prev.modelEntries.forEach((entry) => {
          const name = stripGeminiModelResourceName(entry.name).trim();
          if (!name) return;
          if (availableNames.has(name)) {
            // 可用 → 保留（保持别名）
            mergedMap.set(name, { name, alias: entry.alias?.trim() || '' });
          } else {
            // 不可用 → 移除
            removedCount += 1;
          }
        });

        models.forEach((model) => {
          const name = stripGeminiModelResourceName(model.name).trim();
          if (!name || !availableNames.has(name) || mergedMap.has(name)) return;
          mergedMap.set(name, { name, alias: model.alias ?? '' });
          addedCount += 1;
        });

        const mergedEntries = Array.from(mergedMap.values());
        return {
          ...prev,
          modelEntries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
        };
      });

      if (addedCount === 0 && removedCount === 0) {
        showNotification(t('ai_providers.openai_batch_model_add_available_none_new'), 'warning');
        return;
      }

      showNotification(
        t('ai_providers.openai_batch_model_add_available_done', { count: addedCount }),
        'success'
      );
    },
    [setForm, showNotification, t]
  );

  const openBatchModelTest = useCallback(
    (keyIdx: number) => {
      if (!form.baseUrl?.trim()) {
        showNotification(t('notification.openai_test_url_required'), 'error');
        return;
      }
      if (!form.apiKeyEntries[keyIdx]?.apiKey?.trim()) {
        showNotification(t('notification.openai_test_key_required'), 'error');
        return;
      }
      setBatchTestKeyIndex(keyIdx);
      setBatchTestModalOpen(true);
    },
    [form.apiKeyEntries, form.baseUrl, showNotification, t]
  );

  const renderBatchModelRowStatus = useCallback(
    (rowModelName: string) => {
      const n = rowModelName.trim();
      if (!n) return null;
      const lines: string[] = [];
      let any = false;
      let allOk = true;
      let firstFailCode: number | undefined;
      for (let ki = 0; ki < form.apiKeyEntries.length; ki += 1) {
        const r = batchModelTestByKey[ki]?.[n];
        if (!r) continue;
        any = true;
        if (!r.success) {
          allOk = false;
          if (r.statusCode != null && firstFailCode === undefined) {
            firstFailCode = r.statusCode;
          }
        }
        lines.push(
          t('ai_providers.openai_batch_model_tooltip_line', {
            keyIndex: ki + 1,
            status: r.success
              ? t('ai_providers.openai_batch_status_ok')
              : t('ai_providers.openai_batch_status_fail'),
            code: r.statusCode != null ? ` HTTP ${r.statusCode}` : '',
            message: r.message ? ` ${r.message}` : '',
          })
        );
      }
      if (!any) return null;
      const tagText = allOk
        ? t('ai_providers.openai_batch_model_tag_ok')
        : firstFailCode != null
          ? `${t('ai_providers.openai_batch_model_tag_fail')} ${firstFailCode}`
          : t('ai_providers.openai_batch_model_tag_fail');
      return (
        <div className={styles.modelBatchStatusRow}>
          <span
            className={`${styles.modelBatchTag} ${allOk ? styles.modelBatchTagOk : styles.modelBatchTagErr}`}
            title={lines.join('\n')}
          >
            {tagText}
          </span>
        </div>
      );
    },
    [batchModelTestByKey, form.apiKeyEntries.length, t]
  );

  const runSingleKeyTest = useCallback(
    async (keyIndex: number): Promise<KeyTestResult> => {
      const baseUrl = form.baseUrl?.trim() ?? '';
      if (!baseUrl) {
        const message = t('notification.openai_test_url_required');
        showNotification(message, 'error');
        return { ok: false, message };
      }

      const endpoint = buildGeminiGenerateContentEndpoint(
        baseUrl,
        testModel.trim() || availableModels[0] || ''
      );
      if (!endpoint) {
        const message = t('notification.openai_test_model_required');
        showNotification(message, 'error');
        return { ok: false, message };
      }

      const keyEntry = form.apiKeyEntries[keyIndex];
      if (!keyEntry?.apiKey?.trim()) {
        const message = t('notification.openai_test_key_required');
        setKeyTestStatus(keyIndex, { status: 'error', message });
        return { ok: false, message };
      }

      const customHeaders = buildHeaderObject(form.headers);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...customHeaders,
      };
      if (!hasHeader(headers, 'x-goog-api-key')) {
        headers['x-goog-api-key'] = keyEntry.apiKey.trim();
      }

      setKeyTestStatus(keyIndex, { status: 'loading', message: '' });

      try {
        const result = await apiCallApi.request(
          {
            method: 'POST',
            url: endpoint,
            header: Object.keys(headers).length ? headers : undefined,
            data: JSON.stringify({
              contents: [{ parts: [{ text: 'Hi' }] }],
            }),
          },
          { timeout: GEMINI_TEST_TIMEOUT_MS }
        );

        if (result.statusCode < 200 || result.statusCode >= 300) {
          throw new Error(getApiCallErrorMessage(result));
        }

        setKeyTestStatus(keyIndex, { status: 'success', message: '' });
        return { ok: true };
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        const errorCode =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: string }).code)
            : '';
        const isTimeout = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout');
        const errorMessage = isTimeout
          ? t('ai_providers.openai_test_timeout', { seconds: GEMINI_TEST_TIMEOUT_MS / 1000 })
          : message;
        setKeyTestStatus(keyIndex, { status: 'error', message: errorMessage });
        return { ok: false, message: errorMessage };
      }
    },
    [
      availableModels,
      form.apiKeyEntries,
      form.baseUrl,
      form.headers,
      setKeyTestStatus,
      showNotification,
      t,
      testModel,
    ]
  );

  const testSingleKey = useCallback(
    async (keyIndex: number): Promise<boolean> => {
      if (isTestingKeys) return false;
      setIsTestingKeys(true);
      try {
        const result = await runSingleKeyTest(keyIndex);
        if (result.ok) {
          const modelName = testModel.trim() || availableModels[0] || '';
          const rawKey = form.apiKeyEntries[keyIndex]?.apiKey?.trim() ?? '';
          const maskedKey =
            rawKey.length > 6
              ? `${rawKey.slice(0, 3)}...${rawKey.slice(-3)}`
              : rawKey;
          showNotification(
            t('ai_providers.openai_test_single_success', { model: modelName, key: maskedKey }),
            'success'
          );
        } else if (result.message) {
          showNotification(t('ai_providers.openai_test_single_failed'), 'error');
        }
        return result.ok;
      } finally {
        setIsTestingKeys(false);
      }
    },
    [isTestingKeys, runSingleKeyTest, showNotification, t, testModel, availableModels, form.apiKeyEntries]
  );

  const testAllKeys = useCallback(async () => {
    if (isTestingKeys) return;

    const baseUrl = form.baseUrl?.trim() ?? '';
    if (!baseUrl) {
      const message = t('notification.openai_test_url_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const modelName = testModel.trim() || availableModels[0] || '';
    if (!modelName) {
      const message = t('notification.openai_test_model_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const validKeyIndexes = form.apiKeyEntries
      .map((entry, index) => (entry.apiKey?.trim() ? index : -1))
      .filter((index) => index >= 0);
    if (validKeyIndexes.length === 0) {
      const message = t('notification.openai_test_key_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    setIsTestingKeys(true);
    setTestStatus('loading');
    setTestMessage(t('ai_providers.openai_test_running'));
    resetKeyTestStatuses(form.apiKeyEntries.length);

    try {
      const results = await Promise.all(validKeyIndexes.map((index) => runSingleKeyTest(index)));

      const successCount = results.filter((result) => result.ok).length;
      const failCount = validKeyIndexes.length - successCount;

      if (failCount === 0) {
        const message = t('ai_providers.openai_test_all_success', { count: successCount });
        setTestStatus('success');
        setTestMessage(message);
        showNotification(message, 'success');
      } else if (successCount === 0) {
        const message = t('ai_providers.openai_test_all_failed', { count: failCount });
        setTestStatus('error');
        setTestMessage(message);
        showNotification(message, 'error');
      } else {
        const message = t('ai_providers.openai_test_all_partial', {
          success: successCount,
          failed: failCount,
        });
        setTestStatus('error');
        setTestMessage(message);
        showNotification(message, 'warning');
      }
    } finally {
      setIsTestingKeys(false);
    }
  }, [
    availableModels,
    form.apiKeyEntries,
    form.baseUrl,
    isTestingKeys,
    resetKeyTestStatuses,
    runSingleKeyTest,
    showNotification,
    t,
    testModel,
  ]);

  const canSave =
    !disableControls &&
    !saving &&
    !loading &&
    !invalidIndexParam &&
    !invalidIndex &&
    !isTestingKeys;

  const discoveredModelsFiltered = useMemo(() => {
    const filter = modelDiscoverySearch.trim().toLowerCase();
    if (!filter) return discoveredModels;
    return discoveredModels.filter((model) => {
      const name = (model.name || '').toLowerCase();
      const alias = (model.alias || '').toLowerCase();
      const description = (model.description || '').toLowerCase();
      return name.includes(filter) || alias.includes(filter) || description.includes(filter);
    });
  }, [discoveredModels, modelDiscoverySearch]);
  const visibleDiscoveredModelNames = useMemo(
    () => discoveredModelsFiltered.map((model) => model.name),
    [discoveredModelsFiltered]
  );
  const allVisibleDiscoveredSelected = useMemo(
    () =>
      visibleDiscoveredModelNames.length > 0 &&
      visibleDiscoveredModelNames.every((name) => modelDiscoverySelected.has(name)),
    [modelDiscoverySelected, visibleDiscoveredModelNames]
  );

  const mergeDiscoveredModels = useCallback(
    (selectedModels: ModelInfo[]) => {
      if (!selectedModels.length) return;

      let addedCount = 0;
      setForm((prev) => {
        const mergedMap = new Map<string, { name: string; alias: string }>();
        prev.modelEntries.forEach((entry) => {
          const name = stripGeminiModelResourceName(entry.name);
          if (!name) return;
          mergedMap.set(name, { name, alias: entry.alias?.trim() || '' });
        });

        selectedModels.forEach((model) => {
          const name = stripGeminiModelResourceName(model.name);
          if (!name || mergedMap.has(name)) return;
          mergedMap.set(name, { name, alias: model.alias ?? '' });
          addedCount += 1;
        });

        const mergedEntries = Array.from(mergedMap.values());
        return {
          ...prev,
          modelEntries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
        };
      });

      if (addedCount > 0) {
        showNotification(
          t('ai_providers.gemini_models_fetch_added', { count: addedCount }),
          'success'
        );
      }
    },
    [setForm, showNotification, t]
  );

  const fetchGeminiModelDiscovery = useCallback(async () => {
    const requestId = (modelDiscoveryRequestIdRef.current += 1);
    setModelDiscoveryFetching(true);
    setModelDiscoveryError('');
    const headerObject = buildHeaderObject(form.headers);
    try {
      const list = await modelsApi.fetchGeminiModelsViaApiCall(
        form.baseUrl ?? '',
        getPrimaryApiKey(form) || undefined,
        headerObject
      );
      if (modelDiscoveryRequestIdRef.current !== requestId) return;
      setDiscoveredModels(list);
    } catch (err: unknown) {
      if (modelDiscoveryRequestIdRef.current !== requestId) return;
      setDiscoveredModels([]);
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      const hasCustomXGoogApiKey = Object.keys(headerObject).some(
        (key) => key.toLowerCase() === 'x-goog-api-key'
      );
      const hasAuthorization = Object.keys(headerObject).some(
        (key) => key.toLowerCase() === 'authorization'
      );
      const shouldAttachDiag = message.toLowerCase().includes('api key') || message.includes('401');
      const diag = shouldAttachDiag
        ? ` [diag: apiKeyField=${getPrimaryApiKey(form) ? 'yes' : 'no'}, customXGoogApiKey=${
            hasCustomXGoogApiKey ? 'yes' : 'no'
          }, customAuthorization=${hasAuthorization ? 'yes' : 'no'}]`
        : '';
      setModelDiscoveryError(`${t('ai_providers.gemini_models_fetch_error')}: ${message}${diag}`);
    } finally {
      if (modelDiscoveryRequestIdRef.current === requestId) {
        setModelDiscoveryFetching(false);
      }
    }
  }, [form.apiKeyEntries, form.baseUrl, form.headers, t]);

  useEffect(() => {
    if (!modelDiscoveryOpen) {
      autoFetchSignatureRef.current = '';
      modelDiscoveryRequestIdRef.current += 1;
      setModelDiscoveryFetching(false);
      return;
    }

    const nextEndpoint = modelsApi.buildGeminiModelsEndpoint(form.baseUrl ?? '');
    setModelDiscoveryEndpoint(nextEndpoint);
    setDiscoveredModels([]);
    setModelDiscoverySearch('');
    setModelDiscoverySelected(new Set());
    setModelDiscoveryError('');

    const headerObject = buildHeaderObject(form.headers);
    const hasCustomXGoogApiKey = Object.keys(headerObject).some(
      (key) => key.toLowerCase() === 'x-goog-api-key'
    );
    const hasAuthorization = Object.keys(headerObject).some(
      (key) => key.toLowerCase() === 'authorization'
    );
    const hasApiKeyField = Boolean(getPrimaryApiKey(form));
    const canAutoFetch = hasApiKeyField || hasCustomXGoogApiKey || hasAuthorization;

    if (!canAutoFetch) return;

    const headerSignature = Object.entries(headerObject)
      .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(([key, value]) => `${key}:${value}`)
      .join('|');
    const signature = `${nextEndpoint}||${getPrimaryApiKey(form)}||${headerSignature}`;
    if (autoFetchSignatureRef.current === signature) return;
    autoFetchSignatureRef.current = signature;

    void fetchGeminiModelDiscovery();
  }, [
    fetchGeminiModelDiscovery,
    form.apiKeyEntries,
    form.baseUrl,
    form.headers,
    modelDiscoveryOpen,
  ]);

  useEffect(() => {
    const availableNames = new Set(discoveredModels.map((model) => model.name));
    setModelDiscoverySelected((prev) => {
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
  }, [discoveredModels]);

  const toggleModelDiscoverySelection = (name: string) => {
    setModelDiscoverySelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleSelectVisibleDiscoveredModels = useCallback(() => {
    setModelDiscoverySelected((prev) => {
      const next = new Set(prev);
      visibleDiscoveredModelNames.forEach((name) => next.add(name));
      return next;
    });
  }, [visibleDiscoveredModelNames]);

  const handleClearDiscoveredModelSelection = useCallback(() => {
    setModelDiscoverySelected(new Set());
  }, []);

  const handleApplyDiscoveredModels = () => {
    const selectedModels = discoveredModels.filter((model) =>
      modelDiscoverySelected.has(model.name)
    );
    if (selectedModels.length) {
      mergeDiscoveredModels(selectedModels);
    }
    setModelDiscoveryOpen(false);
  };

  const normalizedHeaders = useMemo(() => normalizeHeaderEntries(form.headers), [form.headers]);
  const normalizedModels = useMemo(
    () => normalizeGeminiModelEntries(form.modelEntries),
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

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    if (!getPrimaryApiKey(form)) {
      showNotification(t('ai_providers.api_key_required'), 'error');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const normalizedModelEntries = form.modelEntries.map((entry) => ({
        ...entry,
        name: stripGeminiModelResourceName(entry.name),
      }));

      const payload: GeminiKeyConfig = {
        apiKeyEntries: serializeApiKeyEntriesForSave(form.apiKeyEntries),
        priority: form.priority !== undefined ? Math.trunc(form.priority) : undefined,
        name: form.name?.trim() || undefined,
        prefix: form.prefix?.trim() || undefined,
        baseUrl: form.baseUrl?.trim() || undefined,
        headers: buildHeaderObject(form.headers),
        models: entriesToModels(normalizedModelEntries),
        excludedModels: parseExcludedModels(form.excludedText),
      };

      const nextList =
        editIndex !== null
          ? configs.map((item, idx) => (idx === editIndex ? payload : item))
          : [...configs, payload];

      await providersApi.saveGeminiKeys(nextList);
      updateConfigValue('gemini-api-key', nextList);
      clearCache('gemini-api-key');
      showNotification(
        editIndex !== null
          ? t('notification.gemini_key_updated')
          : t('notification.gemini_key_added'),
        'success'
      );
      allowNextNavigation();
      setBaseline(buildGeminiBaseline(form));
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

  const canOpenModelDiscovery =
    !disableControls && !saving && !loading && !invalidIndexParam && !invalidIndex;
  const canApplyModelDiscovery =
    !disableControls && !saving && !modelDiscoveryFetching && modelDiscoverySelected.size > 0;

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
                <Input
                  label={t('ai_providers.priority_label')}
                  hint={t('ai_providers.priority_hint')}
                  type="number"
                  step={1}
                  min={0}
                  value={form.priority ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const parsed = raw.trim() === '' ? undefined : Number(raw);
                    setForm((prev) => ({
                      ...prev,
                      priority:
                        parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
                    }));
                  }}
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
                  label={t('ai_providers.gemini_base_url_label')}
                  placeholder={t('ai_providers.gemini_base_url_placeholder')}
                  value={form.baseUrl ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  disabled={disableControls || saving}
                />
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
                    {t('ai_providers.gemini_models_label', { count: availableModels.length })}
                  </label>
                  <div className={styles.modelConfigToolbar}>
                    <Button
                      variant="secondary"
                      size="sm"
                      className={styles.modelClearButton}
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          modelEntries: [{ name: '', alias: '' }],
                        }))
                      }
                      disabled={
                        disableControls ||
                        saving ||
                        isTestingKeys ||
                        availableModels.length === 0
                      }
                    >
                      {t('ai_providers.models_clear_btn')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          modelEntries: [...prev.modelEntries, { name: '', alias: '' }],
                        }))
                      }
                      disabled={disableControls || saving || isTestingKeys}
                    >
                      {t('ai_providers.gemini_models_add_btn')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setModelDiscoveryOpen(true)}
                      disabled={!canOpenModelDiscovery || isTestingKeys}
                    >
                      {t('ai_providers.gemini_models_fetch_button')}
                    </Button>
                    <div className={styles.modelToolbarTestCluster}>
                      <Select
                        value={testModel}
                        options={modelSelectOptions}
                        onChange={(value) => {
                          setTestModel(value);
                          setTestStatus('idle');
                          setTestMessage('');
                        }}
                        placeholder={
                          availableModels.length
                            ? t('ai_providers.openai_test_select_placeholder')
                            : t('ai_providers.openai_test_select_empty')
                        }
                        className={styles.openaiTestSelect}
                        ariaLabel={t('ai_providers.openai_test_title')}
                        disabled={
                          disableControls ||
                          saving ||
                          isTestingKeys ||
                          testStatus === 'loading' ||
                          availableModels.length === 0
                        }
                      />
                      <Button
                        variant={testStatus === 'error' ? 'danger' : 'secondary'}
                        size="sm"
                        onClick={() => void testAllKeys()}
                        loading={testStatus === 'loading'}
                        disabled={
                          disableControls ||
                          saving ||
                          isTestingKeys ||
                          testStatus === 'loading' ||
                          !hasConfiguredModels ||
                          !hasTestableKeys
                        }
                        title={t('ai_providers.openai_test_all_hint')}
                        className={styles.modelTestAllButton}
                      >
                        {t('ai_providers.openai_test_all_action')}
                      </Button>
                    </div>
                  </div>
                </div>
                <div className={styles.sectionHint}>{t('ai_providers.gemini_models_hint')}</div>

                <ModelInputList
                  entries={form.modelEntries}
                  onChange={(entries) => setForm((prev) => ({ ...prev, modelEntries: entries }))}
                  namePlaceholder={t('common.model_name_placeholder')}
                  aliasPlaceholder={t('common.model_alias_placeholder')}
                  disabled={disableControls || saving || isTestingKeys}
                  hideAddButton
                  className={styles.modelInputList}
                  rowClassName={styles.modelInputRow}
                  inputClassName={styles.modelInputField}
                  removeButtonClassName={styles.modelRowRemoveButton}
                  removeButtonTitle={t('common.delete')}
                  removeButtonAriaLabel={t('common.delete')}
                  renderAfterRow={(_idx, entry) => renderBatchModelRowStatus(entry.name)}
                />

                {testMessage && (
                  <div
                    className={`status-badge ${
                      testStatus === 'error'
                        ? 'error'
                        : testStatus === 'success'
                          ? 'success'
                          : 'muted'
                    }`}
                  >
                    {testMessage}
                  </div>
                )}
              </div>

              <div className={styles.keyEntriesSection}>
                <div className={styles.keyEntriesHeader}>
                  <label className={styles.keyEntriesLabel}>
                    {t('ai_providers.gemini_add_modal_key_label')}
                  </label>
                  <span className={styles.keyEntriesHint}>
                    {t('ai_providers.provider_keys_hint')}
                  </span>
                </div>
                <ProviderApiKeyEntriesEditor
                  entries={form.apiKeyEntries}
                  disabled={disableControls || saving}
                  onChange={(apiKeyEntries) => {
                    setForm((prev) => ({ ...prev, apiKeyEntries }));
                    resetKeyTestStatuses(apiKeyEntries.length);
                    setTestStatus('idle');
                    setTestMessage('');
                  }}
                  keyTestStatuses={keyTestStatuses}
                  isTestingKeys={isTestingKeys}
                  hasConfiguredModels={hasConfiguredModels}
                  baseUrl={form.baseUrl ?? ''}
                  onBatchTest={openBatchModelTest}
                  onSingleTest={(index) => void testSingleKey(index)}
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

            <Modal
              open={modelDiscoveryOpen}
              title={t('ai_providers.gemini_models_fetch_title')}
              onClose={() => setModelDiscoveryOpen(false)}
              width={720}
              footer={
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setModelDiscoveryOpen(false)}
                    disabled={modelDiscoveryFetching}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApplyDiscoveredModels}
                    disabled={!canApplyModelDiscovery}
                  >
                    {t('ai_providers.gemini_models_fetch_apply')}
                  </Button>
                </>
              }
            >
              <div className={styles.openaiModelsContent}>
                <div className={styles.sectionHint}>
                  {t('ai_providers.gemini_models_fetch_hint')}
                </div>
                <div className={styles.openaiModelsEndpointSection}>
                  <label className={styles.openaiModelsEndpointLabel}>
                    {t('ai_providers.gemini_models_fetch_url_label')}
                  </label>
                  <div className={styles.openaiModelsEndpointControls}>
                    <input
                      className={`input ${styles.openaiModelsEndpointInput}`}
                      readOnly
                      value={modelDiscoveryEndpoint}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void fetchGeminiModelDiscovery()}
                      loading={modelDiscoveryFetching}
                      disabled={disableControls || saving}
                    >
                      {t('ai_providers.gemini_models_fetch_refresh')}
                    </Button>
                  </div>
                </div>
                <Input
                  label={t('ai_providers.gemini_models_search_label')}
                  placeholder={t('ai_providers.gemini_models_search_placeholder')}
                  value={modelDiscoverySearch}
                  onChange={(e) => setModelDiscoverySearch(e.target.value)}
                  disabled={modelDiscoveryFetching}
                />
                {discoveredModels.length > 0 && (
                  <div className={styles.modelDiscoveryToolbar}>
                    <div className={styles.modelDiscoveryToolbarActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleSelectVisibleDiscoveredModels}
                        disabled={
                          disableControls ||
                          saving ||
                          modelDiscoveryFetching ||
                          discoveredModelsFiltered.length === 0 ||
                          allVisibleDiscoveredSelected
                        }
                      >
                        {t('ai_providers.model_discovery_select_visible')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClearDiscoveredModelSelection}
                        disabled={
                          disableControls ||
                          saving ||
                          modelDiscoveryFetching ||
                          modelDiscoverySelected.size === 0
                        }
                      >
                        {t('ai_providers.model_discovery_clear_selection')}
                      </Button>
                    </div>
                    <div className={styles.modelDiscoverySelectionSummary}>
                      {t('ai_providers.model_discovery_selected_count', {
                        count: modelDiscoverySelected.size,
                      })}
                    </div>
                  </div>
                )}
                {modelDiscoveryError && <div className="error-box">{modelDiscoveryError}</div>}
                {modelDiscoveryFetching ? (
                  <div className={styles.sectionHint}>
                    {t('ai_providers.gemini_models_fetch_loading')}
                  </div>
                ) : discoveredModels.length === 0 ? (
                  <div className={styles.sectionHint}>
                    {t('ai_providers.gemini_models_fetch_empty')}
                  </div>
                ) : discoveredModelsFiltered.length === 0 ? (
                  <div className={styles.sectionHint}>
                    {t('ai_providers.gemini_models_search_empty')}
                  </div>
                ) : (
                  <div className={styles.modelDiscoveryList}>
                    {discoveredModelsFiltered.map((model) => {
                      const checked = modelDiscoverySelected.has(model.name);
                      return (
                        <SelectionCheckbox
                          key={model.name}
                          checked={checked}
                          onChange={() => toggleModelDiscoverySelection(model.name)}
                          disabled={disableControls || saving || modelDiscoveryFetching}
                          ariaLabel={model.name}
                          className={`${styles.modelDiscoveryRow} ${
                            checked ? styles.modelDiscoveryRowSelected : ''
                          }`}
                          labelClassName={styles.modelDiscoverySelectionLabel}
                          label={
                            <div className={styles.modelDiscoveryMeta}>
                              <div className={styles.modelDiscoveryName}>
                                {model.name}
                                {model.alias && (
                                  <span className={styles.modelDiscoveryAlias}>{model.alias}</span>
                                )}
                              </div>
                              {model.description && (
                                <div className={styles.modelDiscoveryDesc}>{model.description}</div>
                              )}
                            </div>
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </Modal>

            <GeminiBatchModelTestModal
              open={batchTestModalOpen}
              onClose={() => setBatchTestModalOpen(false)}
              keyIndex={batchTestKeyIndex}
              loading={loading}
              saving={saving}
              disableControls={disableControls}
              form={form}
              onBatchComplete={handleBatchTestComplete}
              onAddAvailableModels={handleAddBatchAvailableModels}
            />
          </>
        )}
      </Card>
    </SecondaryScreenShell>
  );
}
