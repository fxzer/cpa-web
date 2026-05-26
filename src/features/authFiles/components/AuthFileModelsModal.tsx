import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { getTypeColor, getTypeLabel } from '@/features/authFiles/constants';
import { useNotificationStore, useThemeStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import type { AuthFileModelConfigRow, AuthFileModelsConfigResponse } from '@/types/oauth';
import styles from '@/pages/AuthFilesPage.module.scss';

export type AuthFileModelsModalProps = {
  open: boolean;
  fileName: string;
  loading: boolean;
  error: 'unsupported' | null;
  config: AuthFileModelsConfigResponse | null;
  disableControls: boolean;
  onClose: () => void;
  onCopyText: (text: string) => void;
  onModelsConfigSaved: () => Promise<void>;
};

export function AuthFileModelsModal(props: AuthFileModelsModalProps) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const {
    open,
    fileName,
    loading,
    error,
    config,
    disableControls,
    onClose,
    onCopyText,
    onModelsConfigSaved,
  } = props;

  const [rows, setRows] = useState<AuthFileModelConfigRow[]>([]);
  const [formSeed, setFormSeed] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const providerKey = config?.provider ?? '';
  const providerLabel = useMemo(
    () => (providerKey ? getTypeLabel(t, providerKey) : ''),
    [providerKey, t]
  );

  const providerBadgeStyle = useMemo(() => {
    if (!providerKey) return undefined;
    const color = getTypeColor(providerKey, resolvedTheme);
    return {
      backgroundColor: color.bg,
      color: color.text,
      ...(color.border ? { border: color.border } : {}),
    } as CSSProperties;
  }, [providerKey, resolvedTheme]);

  const summary = useMemo(() => {
    const total = rows.length;
    const aliased = rows.filter((row) => String(row.alias ?? '').trim()).length;
    const disabled = rows.filter((row) => row.disabled).length;
    return {
      total,
      aliased,
      passthrough: total - aliased,
      disabled,
    };
  }, [rows]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setFormSeed('');
      return;
    }
    if (!config || loading) return;
    const seed = `${config.provider}::${config.rows.map((row) => `${row.id}:${row.alias}:${row.fork}:${row.disabled}`).join('|')}`;
    if (seed === formSeed) return;
    setRows(config.rows.map((row) => ({ ...row })));
    setFormSeed(seed);
  }, [config, formSeed, loading, open]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) => {
      const id = String(row.id ?? '')
        .trim()
        .toLowerCase();
      const alias = String(row.alias ?? '')
        .trim()
        .toLowerCase();
      return id.includes(keyword) || alias.includes(keyword);
    });
  }, [rows, search]);

  const updateRow = useCallback((index: number, patch: Partial<AuthFileModelConfigRow>) => {
    setRows((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  }, []);

  const handleSave = useCallback(async () => {
    if (!fileName) return;
    setSaving(true);
    try {
      await authFilesApi.saveAuthFileModelsConfig(fileName, rows);
      await onModelsConfigSaved();
      showNotification(t('oauth_model_alias.save_success'), 'success');
      onClose();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [fileName, onClose, onModelsConfigSaved, rows, showNotification, t]);

  const canEdit = !disableControls && Boolean(providerKey);
  const canSave = canEdit && !saving && !loading;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="min(980px, 96vw)"
      className={styles.modelsAliasModal}
      title={
        <span className={styles.modalTitleInline}>
          <span className={styles.modalTitleText}>
            {t('auth_files.models_title', { defaultValue: '支持的模型' })}
          </span>
          {fileName && (
            <span className={styles.modalTitleFileName} title={fileName}>
              {fileName}
            </span>
          )}
          {providerKey && (
            <span className={styles.typeBadge} style={providerBadgeStyle}>
              {providerLabel}
            </span>
          )}
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.close')}
          </Button>
          {canEdit && (
            <Button onClick={() => void handleSave()} loading={saving} disabled={!canSave}>
              {t('oauth_model_alias.save')}
            </Button>
          )}
        </>
      }
    >
      {loading ? (
        <div className={styles.hint}>
          {t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}
        </div>
      ) : error === 'unsupported' ? (
        <EmptyState
          title={t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
          description={t('auth_files.models_unsupported_desc', {
            defaultValue: '请更新 CLI Proxy API 到最新版本后重试',
          })}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
          description={t('auth_files.models_empty_desc', {
            defaultValue: '该认证凭证可能尚未被服务器加载或没有绑定任何模型',
          })}
        />
      ) : (
        <>
          {canEdit && (
            <>
              <div className={styles.modelsModalMeta}>
                <p className={styles.modelsModalHint}>
                  {t('oauth_model_alias.mapping_passthrough_hint')}
                  <span className={styles.modelsModalHintSecondary}>
                    {t('oauth_model_alias.mapping_global_exclude_hint')}
                  </span>
                </p>
                <div className={styles.modelsModalSummary}>
                  {t('oauth_model_alias.mapping_summary', {
                    total: summary.total,
                    aliased: summary.aliased,
                    passthrough: summary.passthrough,
                    disabled: summary.disabled,
                  })}
                </div>
              </div>
              <input
                className={`input ${styles.modelsModalSearch}`}
                placeholder={t('oauth_model_alias.mapping_search_placeholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={saving}
              />
            </>
          )}

          <div className={styles.modelsModalTable}>
            <div className={styles.modelsModalTableHead}>
              <span>{t('oauth_model_alias.diagram_source_models')}</span>
              <span>{t('oauth_model_alias.alias_label')}</span>
              <span>{t('oauth_model_alias.alias_fork_label')}</span>
              <span>{t('oauth_model_alias.disable_label')}</span>
            </div>

            {filteredRows.length === 0 ? (
              <div className={styles.hint}>{t('oauth_model_alias.mapping_filter_empty')}</div>
            ) : (
              filteredRows.map((row) => {
                const rowIndex = rows.findIndex((item) => item.id === row.id);
                if (rowIndex < 0) return null;

                const name = String(row.id ?? '').trim();
                const alias = String(row.alias ?? '').trim();
                const hasAlias = Boolean(alias);

                return (
                  <div
                    key={row.id}
                    className={`${styles.modelsModalRow} ${hasAlias ? styles.modelsModalRowAliased : ''} ${row.available ? '' : styles.modelsModalRowUnavailable}`}
                  >
                    <div className={styles.modelsModalNameCell}>
                      <button
                        type="button"
                        className={styles.modelsModalNameButton}
                        onClick={() => onCopyText(name)}
                        title={t('common.copy', { defaultValue: '点击复制' })}
                      >
                        <code className={styles.modelsModalModelId}>{name}</code>
                      </button>
                      {!row.available && (
                        <span
                          className={styles.modelsModalUnavailableHint}
                          title={t('oauth_model_alias.model_unavailable_for_auth_hint')}
                        >
                          {t('oauth_model_alias.model_unavailable_for_auth')}
                        </span>
                      )}
                    </div>

                    {canEdit ? (
                      <input
                        className={`input ${styles.modelsModalAliasInput}`}
                        placeholder={t('oauth_model_alias.alias_empty_passthrough_placeholder')}
                        value={row.alias}
                        onChange={(event) => updateRow(rowIndex, { alias: event.target.value })}
                        disabled={saving || !name}
                      />
                    ) : (
                      <span className={styles.modelsModalAliasReadonly}>
                        {alias || t('oauth_model_alias.status_passthrough')}
                      </span>
                    )}

                    <div className={styles.modelsModalStatusCell}>
                      {canEdit ? (
                        <ToggleSwitch
                          ariaLabel={t('oauth_model_alias.alias_fork_label')}
                          checked={Boolean(row.fork)}
                          onChange={(value) => updateRow(rowIndex, { fork: value })}
                          disabled={saving || !hasAlias}
                        />
                      ) : (
                        <span className={styles.modelsModalMuted}>—</span>
                      )}
                    </div>

                    <div className={styles.modelsModalStatusCell}>
                      {canEdit ? (
                        <ToggleSwitch
                          ariaLabel={t('oauth_model_alias.disable_label')}
                          checked={Boolean(row.disabled)}
                          onChange={(value) => updateRow(rowIndex, { disabled: value })}
                          disabled={saving || !name}
                          tone="danger"
                        />
                      ) : row.disabled ? (
                        <span className={styles.modelExcludedBadge}>
                          {t('auth_files.models_excluded_badge', { defaultValue: '已禁用' })}
                        </span>
                      ) : (
                        <span className={styles.modelsModalMuted}>—</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
