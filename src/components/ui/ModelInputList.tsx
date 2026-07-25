import { Fragment, type ReactNode } from 'react';
import { Button } from './Button';
import { IconX } from './icons';
import type { ModelEntry } from './modelInputListUtils';

interface ModelInputListProps {
  entries: ModelEntry[];
  onChange: (entries: ModelEntry[]) => void;
  addLabel?: string;
  disabled?: boolean;
  namePlaceholder?: string;
  aliasPlaceholder?: string;
  hideAddButton?: boolean;
  onAdd?: () => void;
  className?: string;
  rowClassName?: string;
  inputClassName?: string;
  removeButtonClassName?: string;
  removeButtonTitle?: string;
  removeButtonAriaLabel?: string;
  /** 渲染在每行输入区域下方（如批量连通状态） */
  renderAfterRow?: (index: number, entry: ModelEntry) => ReactNode;
  /** 获取某行输入框额外 CSS 类名，例如高亮刚新增的模型 */
  getRowInputClassName?: (index: number, entry: ModelEntry) => string;
  /** 渲染在行内操作之前（如新添加标识） */
  renderRowExtra?: (index: number, entry: ModelEntry) => ReactNode;
}

export function ModelInputList({
  entries,
  onChange,
  addLabel,
  disabled = false,
  namePlaceholder = 'model-name',
  aliasPlaceholder = 'alias (optional)',
  hideAddButton = false,
  onAdd,
  className = '',
  rowClassName = '',
  inputClassName = '',
  removeButtonClassName = '',
  removeButtonTitle = 'Remove',
  removeButtonAriaLabel = 'Remove',
  renderAfterRow,
  getRowInputClassName,
  renderRowExtra,
}: ModelInputListProps) {
  const currentEntries = entries.length ? entries : [{ name: '', alias: '' }];
  const containerClassName = ['header-input-list', className].filter(Boolean).join(' ');
  const rowClassNames = ['header-input-row', rowClassName].filter(Boolean).join(' ');

  const updateEntry = (index: number, field: 'name' | 'alias', value: string) => {
    const next = currentEntries.map((entry, idx) =>
      idx === index ? { ...entry, [field]: value } : entry
    );
    onChange(next);
  };

  const addEntry = () => {
    if (onAdd) {
      onAdd();
    } else {
      onChange([...currentEntries, { name: '', alias: '' }]);
    }
  };

  const removeEntry = (index: number) => {
    const next = currentEntries.filter((_, idx) => idx !== index);
    onChange(next.length ? next : [{ name: '', alias: '' }]);
  };

  return (
    <div className={containerClassName}>
      {currentEntries.map((entry, index) => {
        const extraInputClassName = getRowInputClassName?.(index, entry) || '';
        const rowInputClassNames = ['input', inputClassName, extraInputClassName]
          .filter(Boolean)
          .join(' ');

        return (
          <Fragment key={index}>
            <div className={rowClassNames}>
              <input
                className={rowInputClassNames}
                placeholder={namePlaceholder}
                value={entry.name}
                onChange={(e) => updateEntry(index, 'name', e.target.value)}
                disabled={disabled}
              />
              <span className="header-separator">→</span>
              <input
                className={rowInputClassNames}
                placeholder={aliasPlaceholder}
                value={entry.alias}
                onChange={(e) => updateEntry(index, 'alias', e.target.value)}
                disabled={disabled}
              />
              {renderRowExtra?.(index, entry)}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeEntry(index)}
                disabled={disabled || currentEntries.length <= 1}
                className={removeButtonClassName}
                title={removeButtonTitle}
                aria-label={removeButtonAriaLabel}
              >
                <IconX size={14} />
              </Button>
            </div>
            {renderAfterRow?.(index, entry)}
          </Fragment>
        );
      })}
      {!hideAddButton && addLabel && (
        <Button
          variant="secondary"
          size="sm"
          onClick={addEntry}
          disabled={disabled}
          className="align-start"
        >
          {addLabel}
        </Button>
      )}
    </div>
  );
}
