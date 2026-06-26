import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { IconCheck, IconCopy } from '@/components/ui/icons';
import { maskApiKey } from '@/utils/format';
import styles from './UsageExampleModal.module.scss';

interface UsageExampleModalProps {
  open: boolean;
  onClose: () => void;
  baseUrl: string;
  apiKeys: string[];
  models: string[];
  defaultModel?: string;
}

export function UsageExampleModal({
  open,
  onClose,
  baseUrl,
  apiKeys,
  models,
  defaultModel,
}: UsageExampleModalProps) {
  const { t } = useTranslation();

  const firstKey = apiKeys.find(Boolean) || 'sk-your-api-key';
  const modelOptions = useMemo(
    () => models.filter(Boolean).map((m) => ({ value: m, label: m })),
    [models]
  );
  const [selectedModel, setSelectedModel] = useState(defaultModel || modelOptions[0]?.value || '');
  const [selectedKey, setSelectedKey] = useState(firstKey);
  const [exampleTab, setExampleTab] = useState<'curl' | 'codex' | 'claude'>('curl');
  const [copied, setCopied] = useState(false);

  const baseUrlNorm = baseUrl.replace(/\/+$/, '');
  const apiBase = baseUrlNorm || 'http://localhost:8317';

  const curlExample = `curl -sS -X POST '${apiBase}/v1/chat/completions' \\
  -H 'Authorization: Bearer ${selectedKey}' \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"${selectedModel}","messages":[{"role":"user","content":"hello"}],"max_tokens":64}'`;

  const codexExample = `# ~/.codex/config.toml
model = "${selectedModel}"

[model_providers.local]
  name = "local"
  base_url = "${apiBase}"
  env_key = "LOCAL_API_KEY"`;

  const claudeExample = `# ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "${selectedKey}",
    "ANTHROPIC_BASE_URL": "${apiBase.replace(/\/v1\/?$/, '')}",
    "ANTHROPIC_MODEL": "${selectedModel}"
  }
}`;

  const activeCode =
    exampleTab === 'curl' ? curlExample : exampleTab === 'codex' ? codexExample : claudeExample;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [activeCode]);

  const keyOptions = useMemo(
    () => apiKeys.filter(Boolean).map((k) => ({ value: k, label: maskApiKey(k) })),
    [apiKeys]
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={660}
      title={t('ai_providers.usage_example_title', { defaultValue: '使用示例' })}
      footer={
        <Button onClick={onClose}>
          {t('config_management.visual.common.close', { defaultValue: '关闭' })}
        </Button>
      }
    >
      <div className={styles.body}>
        <div className={styles.configRow}>
          <div className={styles.configField}>
            <label className={styles.configLabel}>
              {t('ai_providers.usage_example_api_key', { defaultValue: 'API Key' })}
            </label>
            <Select
              value={selectedKey}
              options={keyOptions}
              onChange={setSelectedKey}
            />
          </div>
          <div className={styles.configField}>
            <label className={styles.configLabel}>
              {t('ai_providers.usage_example_model', { defaultValue: 'Model' })}
            </label>
            <Select
              value={selectedModel}
              options={modelOptions}
              onChange={setSelectedModel}
            />
          </div>
        </div>

        <div className={styles.tabBar} role="tablist">
          <button
            type="button"
            className={`${styles.tabItem} ${exampleTab === 'curl' ? styles.tabActive : ''}`}
            onClick={() => setExampleTab('curl')}
          >
            CURL
          </button>
          <button
            type="button"
            className={`${styles.tabItem} ${exampleTab === 'codex' ? styles.tabActive : ''}`}
            onClick={() => setExampleTab('codex')}
          >
            Codex
          </button>
          <button
            type="button"
            className={`${styles.tabItem} ${exampleTab === 'claude' ? styles.tabActive : ''}`}
            onClick={() => setExampleTab('claude')}
          >
            Claude Code
          </button>
        </div>

        <div className={styles.codeContainer}>
          <div className={styles.codeHeader}>
            <span className={styles.codeType}>
              {exampleTab === 'curl' ? 'Shell' : exampleTab === 'codex' ? 'TOML' : 'JSON'}
            </span>
            <button
              type="button"
              className={styles.copyButton}
              onClick={handleCopy}
              title={t('common.copy')}
              aria-label={t('common.copy')}
            >
              {copied ? (
                <IconCheck size={16} className={styles.copiedIcon} />
              ) : (
                <IconCopy size={16} />
              )}
            </button>
          </div>
          <pre className={styles.codeBlock}>
            <code>{activeCode}</code>
          </pre>
        </div>
      </div>
    </Modal>
  );
}
