import { useState } from 'react';
import styles from '@/pages/AiProvidersPage.module.scss';

interface ProviderPrioritySelectorProps {
  label?: string;
  value?: number | null;
  onChange: (value: number | undefined) => void;
  disabled?: boolean;
}

const TOTAL_BLOCKS = 10;

function getPriorityToneClass(val: number) {
  if (val >= 10) return styles.priorityBlockPurpleStrong;
  if (val >= 6) return styles.priorityBlockPurple;
  if (val >= 3) return styles.priorityBlockBlue;
  if (val >= 1) return styles.priorityBlockSlate;
  return styles.priorityBlockEmpty;
}

export function ProviderPrioritySelector({
  label,
  value,
  onChange,
  disabled = false,
}: ProviderPrioritySelectorProps) {
  const [hoveredValue, setHoveredValue] = useState<number | null>(null);

  const numericValue =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(10, Math.trunc(value)))
      : 0;

  const activeValue = hoveredValue !== null ? hoveredValue : numericValue;
  const activeToneClass = getPriorityToneClass(activeValue);

  // 只有当未悬浮且已选中、或悬浮到正好是已选中的那个档位时，才展示深色/加粗的选中状态文字颜色；
  // 当悬浮到其他任意非选中档位进行 preview 预览时，展示淡淡的悬浮文字颜色。
  const isShowingSelectedValue =
    (hoveredValue === null && numericValue > 0) ||
    (hoveredValue !== null && hoveredValue === numericValue && numericValue > 0);

  const valueClassName = `${styles.prioritySelectorValue} ${
    isShowingSelectedValue
      ? styles.prioritySelectorValueSelected
      : hoveredValue !== null
        ? styles.prioritySelectorValueHover
        : styles.prioritySelectorValueEmpty
  }`;

  return (
    <div className="form-group">
      {label && <label>{label}</label>}
      <div
        className={`input ${styles.prioritySelectorContainer} ${
          disabled ? styles.prioritySelectorDisabled : ''
        }`}
        onMouseLeave={() => setHoveredValue(null)}
      >
        <div className={styles.prioritySelectorBlocks}>
          {Array.from({ length: TOTAL_BLOCKS }, (_, i) => {
            const blockLevel = i + 1;
            const isFilled = blockLevel <= activeValue;

            return (
              <button
                key={blockLevel}
                type="button"
                className={`${styles.prioritySelectorBlock} ${
                  isFilled ? activeToneClass : styles.priorityBlockEmpty
                }`}
                onClick={() => {
                  if (disabled) return;
                  const nextVal = numericValue === blockLevel ? 0 : blockLevel;
                  onChange(nextVal === 0 ? undefined : nextVal);
                }}
                onMouseEnter={() => {
                  if (!disabled) setHoveredValue(blockLevel);
                }}
                disabled={disabled}
                title={`优先级: ${blockLevel}`}
                aria-label={`Priority ${blockLevel}`}
              />
            );
          })}
        </div>
        <span className={valueClassName}>{activeValue}</span>
      </div>
    </div>
  );
}
