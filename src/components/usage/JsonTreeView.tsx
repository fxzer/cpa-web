import { useState } from 'react';
import styles from '@/pages/UsagePage.module.scss';

interface JsonTreeViewProps {
  data: unknown;
  initialExpanded?: boolean;
}

export function JsonTreeView({ data, initialExpanded = true }: JsonTreeViewProps) {
  return (
    <div className={styles.jsonTreeContainer}>
      <JsonNode value={data} depth={0} initialExpanded={initialExpanded} />
    </div>
  );
}

interface JsonNodeProps {
  value: unknown;
  depth: number;
  keyName?: string;
  lastElement?: boolean;
  initialExpanded: boolean;
}

function JsonNode({ value, depth, keyName, initialExpanded }: JsonNodeProps) {
  if (value === null) {
    return (
      <div className={styles.jsonTreeLine}>
        {keyName !== undefined && <span className={styles.jsonTreeKey}>{quote(keyName)}: </span>}
        <span className={styles.jsonTreeNull}>null</span>
      </div>
    );
  }
  if (value === undefined) {
    return (
      <div className={styles.jsonTreeLine}>
        {keyName !== undefined && <span className={styles.jsonTreeKey}>{quote(keyName)}: </span>}
        <span className={styles.jsonTreeNull}>undefined</span>
      </div>
    );
  }
  if (typeof value === 'string') {
    return (
      <div className={styles.jsonTreeLine}>
        {keyName !== undefined && <span className={styles.jsonTreeKey}>{quote(keyName)}: </span>}
        <span className={styles.jsonTreeString}>{quote(value)}</span>
      </div>
    );
  }
  if (typeof value === 'number') {
    return (
      <div className={styles.jsonTreeLine}>
        {keyName !== undefined && <span className={styles.jsonTreeKey}>{quote(keyName)}: </span>}
        <span className={styles.jsonTreeNumber}>{value}</span>
      </div>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <div className={styles.jsonTreeLine}>
        {keyName !== undefined && <span className={styles.jsonTreeKey}>{quote(keyName)}: </span>}
        <span className={styles.jsonTreeBoolean}>{value ? 'true' : 'false'}</span>
      </div>
    );
  }
  if (Array.isArray(value)) {
    return <JsonArrayNode value={value} depth={depth} keyName={keyName} initialExpanded={initialExpanded} />;
  }
  if (typeof value === 'object') {
    return <JsonObjectNode value={value as Record<string, unknown>} depth={depth} keyName={keyName} initialExpanded={initialExpanded} />;
  }
  return (
    <div className={styles.jsonTreeLine}>
      {keyName !== undefined && <span className={styles.jsonTreeKey}>{quote(keyName)}: </span>}
      <span className={styles.jsonTreeOther}>{String(value)}</span>
    </div>
  );
}

function JsonObjectNode({ value, depth, keyName, initialExpanded }: {
  value: Record<string, unknown>;
  depth: number;
  keyName?: string;
  initialExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const entries = Object.entries(value);

  return (
    <div>
      <div className={styles.jsonTreeLine}>
        {depth > 0 && keyName !== undefined && (
          <span className={styles.jsonTreeKey}>{quote(keyName)}: </span>
        )}
        <span className={styles.jsonTreeBracket} onClick={() => setExpanded(!expanded)}>
          <span className={styles.jsonTreePointer}>{expanded ? '▼' : '▶'}</span>
          {'{'}
        </span>
        {!expanded && (
          <span className={styles.jsonTreeCollapsed} onClick={() => setExpanded(true)}>
            {' ... '}
          </span>
        )}
        {!expanded && <span className={styles.jsonTreeBracket}>{'}'}</span>}
        {entries.length === 0 && expanded && <span className={styles.jsonTreeBracket}>{'}'}</span>}
      </div>
      {expanded && entries.length > 0 && (
        <div className={styles.jsonTreeChildren}>
          {entries.map(([k, v], i) => (
            <JsonNode
              key={k}
              value={v}
              depth={depth + 1}
              keyName={k}
              lastElement={i === entries.length - 1}
              initialExpanded={depth < 2}
            />
          ))}
        </div>
      )}
      {expanded && entries.length > 0 && (
        <div className={styles.jsonTreeLine}>
          <span className={styles.jsonTreeBracket}>{'}'}</span>
        </div>
      )}
    </div>
  );
}

function JsonArrayNode({ value, depth, keyName, initialExpanded }: {
  value: unknown[];
  depth: number;
  keyName?: string;
  initialExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);

  return (
    <div>
      <div className={styles.jsonTreeLine}>
        {depth > 0 && keyName !== undefined && (
          <span className={styles.jsonTreeKey}>{quote(keyName)}: </span>
        )}
        <span className={styles.jsonTreeBracket} onClick={() => setExpanded(!expanded)}>
          <span className={styles.jsonTreePointer}>{expanded ? '▼' : '▶'}</span>
          {'['}
        </span>
        {!expanded && (
          <span className={styles.jsonTreeCollapsed} onClick={() => setExpanded(true)}>
            {' ... '}
          </span>
        )}
        {!expanded && <span className={styles.jsonTreeBracket}>{']'}</span>}
        {value.length === 0 && expanded && <span className={styles.jsonTreeBracket}>{']'}</span>}
      </div>
      {expanded && value.length > 0 && (
        <div className={styles.jsonTreeChildren}>
          {value.map((v, i) => (
            <JsonNode
              key={i}
              value={v}
              depth={depth + 1}
              initialExpanded={depth < 2}
            />
          ))}
        </div>
      )}
      {expanded && value.length > 0 && (
        <div className={styles.jsonTreeLine}>
          <span className={styles.jsonTreeBracket}>{']'}</span>
        </div>
      )}
    </div>
  );
}

function quote(s: string): string {
  return `"${s}"`;
}
