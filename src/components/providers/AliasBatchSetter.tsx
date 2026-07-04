import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconChevronDown } from '@/components/ui/icons';

interface AliasBatchSetterProps {
  /** 系统已设置过的别名候选 */
  options: string[];
  /** 整体禁用（如保存中、无模型可设置） */
  disabled?: boolean;
  /** 一键设置回调，传入选定的别名 */
  onApply: (alias: string) => void;
  /** 输入框/按钮的容器 className（用于对接页面级样式） */
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
}

/**
 * 「输入或选择别名 + 一键设置」组合控件。
 * 用在 OpenAI / Gemini 兼容供应商编辑页的模型工具栏，
 * 把同一个别名批量填到当前所有模型行的 alias 字段。
 */
export function AliasBatchSetter({
  options,
  disabled = false,
  onApply,
  className = '',
  inputClassName = '',
  buttonClassName = '',
}: AliasBatchSetterProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const filteredOptions = options.filter((opt) =>
    opt.toLowerCase().includes(value.trim().toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (selectedValue: string) => {
    setValue(selectedValue);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        e.preventDefault();
        handleSelect(filteredOptions[highlightedIndex]);
      } else if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  const trimmed = value.trim();
  const canApply = !disabled && trimmed.length > 0;

  const handleApply = () => {
    if (!canApply) return;
    onApply(trimmed);
    setValue('');
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  return (
    <div className={className} ref={containerRef}>
      <div className={inputClassName} style={{ position: 'relative' }}>
        <input
          className="input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={t('ai_providers.alias_batch_set_placeholder')}
          disabled={disabled}
          autoComplete="off"
          style={{ paddingRight: 32 }}
        />
        <div
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            pointerEvents: disabled ? 'none' : 'auto',
            cursor: 'pointer',
            height: '100%',
          }}
          onClick={() => !disabled && setIsOpen(!isOpen)}
        >
          <IconChevronDown size={16} style={{ opacity: 0.5 }} />
        </div>

        {isOpen && filteredOptions.length > 0 && !disabled && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: 1000,
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              maxHeight: 200,
              overflowY: 'auto',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            }}
          >
            {filteredOptions.map((opt, index) => (
              <div
                key={`${opt}-${index}`}
                onClick={() => handleSelect(opt)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  backgroundColor: index === highlightedIndex ? 'var(--bg-tertiary)' : 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                {opt}
              </div>
            ))}
          </div>
        )}
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleApply}
        disabled={!canApply}
        className={buttonClassName}
      >
        {t('ai_providers.alias_batch_set_button')}
      </Button>
    </div>
  );
}
