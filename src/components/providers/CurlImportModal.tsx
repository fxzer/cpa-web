import { useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useNotificationStore } from '@/stores';
import { parseCurl } from './parseCurl';
import type { OpenAIFormState } from './types';

interface CurlImportModalProps {
  open: boolean;
  onClose: () => void;
  setForm: Dispatch<SetStateAction<OpenAIFormState>>;
}

export function CurlImportModal({ open, onClose, setForm }: CurlImportModalProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [text, setText] = useState('');

  const handleImport = () => {
    const parsed = parseCurl(text);
    const hasAnything = parsed.baseUrl || parsed.apiKey || parsed.model;
    if (!hasAnything) {
      showNotification(t('ai_providers.openai_curl_import_failed'), 'error');
      return;
    }

    setForm((prev) => {
      const next = { ...prev };
      // 仅覆盖当前为空的字段
      if (!prev.name.trim() && parsed.name) {
        next.name = parsed.name;
      }
      if (!prev.baseUrl.trim() && parsed.baseUrl) {
        next.baseUrl = parsed.baseUrl;
      }
      if (parsed.apiKey) {
        const firstEmptyIdx = prev.apiKeyEntries.findIndex((entry) => !entry.apiKey?.trim());
        if (firstEmptyIdx !== -1) {
          const updated = prev.apiKeyEntries.map((entry, idx) =>
            idx === firstEmptyIdx ? { ...entry, apiKey: parsed.apiKey } : entry
          );
          next.apiKeyEntries = updated;
        }
      }
      const hasFilledModel = prev.modelEntries.some((entry) => entry.name.trim());
      if (!hasFilledModel && parsed.model) {
        next.modelEntries = [{ name: parsed.model, alias: '' }];
      }
      return next;
    });

    if (parsed.apiKeyIsPlaceholder) {
      showNotification(t('ai_providers.openai_curl_import_key_placeholder'), 'warning');
    } else {
      showNotification(t('ai_providers.openai_curl_import_done'), 'success');
    }
    setText('');
    onClose();
  };

  const handleClear = () => setText('');

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={620}
      title={t('ai_providers.openai_curl_import_title')}
      footer={
        <>
          <Button variant="secondary" onClick={handleClear} disabled={!text}>
            {t('common.clear', { defaultValue: '清空' })}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel', { defaultValue: '取消' })}
          </Button>
          <Button onClick={handleImport} disabled={!text.trim()}>
            {t('ai_providers.openai_curl_import_button')}
          </Button>
        </>
      }
    >
      <textarea
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('ai_providers.openai_curl_import_placeholder')}
        aria-label={t('ai_providers.openai_curl_import_title')}
        rows={10}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
        autoFocus
      />
    </Modal>
  );
}
