import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { apiCallApi, getApiCallErrorMessage, modelsApi } from '@/services/api';
import type { ModelInfo } from '@/utils/models';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import type { GeminiFormState } from '@/components/providers/types';
import {
  buildGeminiGenerateContentEndpoint,
  buildGeminiModelsEndpoint,
} from '@/components/providers/utils';
import styles from './AiProvidersPage.module.scss';

const GEMINI_TEST_TIMEOUT_MS = 30_000;

export type GeminiBatchModelTestRowResult = {
  success: boolean;
  statusCode?: number;
  message?: string;
};

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
  onBatchComplete: (payload: {
    keyIndex: number;
    results: Record<string, GeminiBatchModelTestRowResult>;
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
  onBatchComplete,
}: GeminiBatchModelTestModalProps) {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [testing, setTesting] = useState(false);
  const [testProgress, setTestProgress] = useState('');

  const rowKey = keyIndex !== null ? form.apiKeyEntries[keyIndex]?.apiKey?.trim() : '';

  const fetchModels = useCallback(async () => {
    const trimmedBaseUrl = form.baseUrl?.trim() ?? '';
    if (!trimmedBaseUrl || keyIndex === null) return;

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
  }, [form.baseUrl, form.headers, keyIndex, rowKey, t]);

  useEffect(() => {
    if (!open || keyIndex === null) return;
    if (loading) return;
    setEndpoint(buildGeminiModelsEndpoint(form.baseUrl ?? ''));
    setModels([]);
    setSearch('');
    setSelected(new Set());
    setError('');
    setTestProgress('');
    void fetchModels();
  }, [open, loading, keyIndex, form.baseUrl, fetchModels]);

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

  const runBatchTests = useCallback(
    async (modelNames: string[]) => {
      if (keyIndex === null || !rowKey) {
        return;
      }
      const baseUrl = form.baseUrl?.trim() ?? '';
      if (!baseUrl) {
        setError(t('notification.openai_test_url_required'));
        return;
      }

      if (modelNames.length === 0) return;

      const keyEntry = form.apiKeyEntries[keyIndex];
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
      const results: Record<string, GeminiBatchModelTestRowResult> = {};

      try {
        for (let i = 0; i < modelNames.length; i += 1) {
          const modelName = modelNames[i];
          setTestProgress(
            t('ai_providers.openai_batch_model_test_progress', {
              current: i + 1,
              total: modelNames.length,
              model: modelName,
            })
          );
          const endpointUrl = buildGeminiGenerateContentEndpoint(baseUrl, modelName);
          if (!endpointUrl) {
            results[modelName] = {
              success: false,
              message: t('notification.openai_test_model_required'),
            };
            continue;
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
            results[modelName] = {
              success: ok,
              statusCode: result.statusCode,
              message: ok ? '' : getApiCallErrorMessage(result),
            };
          } catch (err: unknown) {
            const message = getErrorMessage(err);
            const errorCode =
              typeof err === 'object' && err !== null && 'code' in err
                ? String((err as { code?: string }).code)
                : '';
            const isTimeout = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout');
            results[modelName] = {
              success: false,
              message: isTimeout
                ? t('ai_providers.openai_test_timeout', { seconds: GEMINI_TEST_TIMEOUT_MS / 1000 })
                : message,
            };
          }
        }

        onBatchComplete({ keyIndex, results });
        onClose();
      } finally {
        setTesting(false);
        setTestProgress('');
      }
    },
    [form.apiKeyEntries, form.baseUrl, form.headers, keyIndex, onBatchComplete, onClose, rowKey, t]
  );

  const canRun =
    !disableControls &&
    !saving &&
    !fetching &&
    !testing &&
    selected.size > 0 &&
    Boolean(rowKey) &&
    keyIndex !== null;

  if (!open || keyIndex === null) {
    return null;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ai_providers.openai_batch_model_test_title', { index: keyIndex + 1 })}
      width="min(1120px, 94vw)"
      closeDisabled={testing}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={fetching || testing}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => void runBatchTests(Array.from(selected))}
            disabled={!canRun}
            loading={testing}
          >
            {t('ai_providers.openai_batch_model_test_run')}
          </Button>
        </>
      }
    >
      <div className={styles.openaiModelDiscoveryModalBody}>
        <div className={styles.sectionHint}>{t('ai_providers.gemini_batch_model_test_hint')}</div>

        <div className={styles.openaiModelsDiscoveryTopGrid}>
          <div className={styles.openaiModelsEndpointSection}>
            <label className={styles.openaiModelsEndpointLabel}>
              {t('ai_providers.gemini_models_fetch_url_label')}
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
                onClick={() => void fetchModels()}
                loading={fetching}
                disabled={disableControls || saving || testing}
              >
                {t('ai_providers.gemini_models_fetch_refresh')}
              </Button>
            </div>
          </div>
          <Input
            label={t('ai_providers.openai_models_search_label')}
            placeholder={t('ai_providers.openai_models_search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={fetching || testing}
          />
        </div>

        {models.length > 0 && (
          <div className={styles.modelDiscoveryToolbar}>
            <div className={styles.modelDiscoveryToolbarActions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSelectVisible}
                disabled={
                  disableControls ||
                  saving ||
                  fetching ||
                  testing ||
                  filteredModels.length === 0 ||
                  allVisibleSelected
                }
              >
                {t('ai_providers.model_discovery_select_visible')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleClearSelection}
                disabled={disableControls || saving || fetching || testing || selected.size === 0}
              >
                {t('ai_providers.model_discovery_clear_selection')}
              </Button>
            </div>
            <div className={styles.modelDiscoverySelectionSummary}>
              {t('ai_providers.openai_models_discovery_summary', {
                total: models.length,
                selected: selected.size,
              })}
            </div>
          </div>
        )}

        {testProgress ? <div className={styles.sectionHint}>{testProgress}</div> : null}
        {error && <div className="error-box">{error}</div>}

        {fetching ? (
          <div className={styles.sectionHint}>{t('ai_providers.gemini_models_fetch_loading')}</div>
        ) : models.length === 0 ? (
          <div className={styles.sectionHint}>{t('ai_providers.gemini_models_fetch_empty')}</div>
        ) : filteredModels.length === 0 ? (
          <div className={styles.sectionHint}>{t('ai_providers.gemini_models_search_empty')}</div>
        ) : (
          <div className={`${styles.modelDiscoveryList} ${styles.openaiModelDiscoveryGrid}`}>
            {filteredModels.map((model) => {
              const checked = selected.has(model.name);
              return (
                <SelectionCheckbox
                  key={model.name}
                  checked={checked}
                  onChange={() => toggleSelection(model.name)}
                  disabled={disableControls || saving || fetching || testing}
                  ariaLabel={model.name}
                  className={`${styles.modelDiscoveryRow} ${checked ? styles.modelDiscoveryRowSelected : ''}`}
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
  );
}
