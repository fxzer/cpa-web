/**
 * 模型工具函数
 * 迁移自基线 utils/models.js
 */

export interface ModelInfo {
  name: string;
  alias?: string;
  description?: string;
  /**
   * 输入模态列表（来自 API 返回的 architecture.input_modalities）
   * 例如 ["text"]、["text","image"]、["text","image","audio","video"]
   */
  inputModalities?: string[];
  /**
   * 输出模态列表（来自 API 返回的 architecture.output_modalities）
   * 例如 ["text"]、["image"]、["audio"]
   */
  outputModalities?: string[];
}

const MODEL_CATEGORIES = [
  { id: 'gpt', label: 'GPT', patterns: [/gpt/i, /\bo\d\b/i, /\bo\d+\.?/i, /\bchatgpt/i] },
  { id: 'claude', label: 'Claude', patterns: [/claude/i] },
  { id: 'gemini', label: 'Gemini', patterns: [/gemini/i, /\bgai\b/i] },
  { id: 'kimi', label: 'Kimi', patterns: [/kimi/i] },
  { id: 'qwen', label: 'Qwen', patterns: [/qwen/i] },
  { id: 'glm', label: 'GLM', patterns: [/glm/i, /chatglm/i] },
  { id: 'grok', label: 'Grok', patterns: [/grok/i] },
  { id: 'deepseek', label: 'DeepSeek', patterns: [/deepseek/i] },
  { id: 'minimax', label: 'MiniMax', patterns: [/minimax/i, /abab/i] },
];

const matchCategory = (text: string) => {
  for (const category of MODEL_CATEGORIES) {
    if (category.patterns.some((pattern) => pattern.test(text))) {
      return category.id;
    }
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** 将 unknown 值归一化为字符串数组，兼容字符串、字符串数组 */
function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')) {
    return value as string[];
  }
  return undefined;
}

export function normalizeModelList(payload: unknown, { dedupe = false } = {}): ModelInfo[] {
  const toModel = (entry: unknown): ModelInfo | null => {
    if (typeof entry === 'string') {
      return { name: entry };
    }
    if (!isRecord(entry)) {
      return null;
    }
    const name = entry.id || entry.name || entry.model || entry.value;
    if (!name) return null;

    const alias = entry.alias || entry.display_name || entry.displayName;
    const description = entry.description || entry.note || entry.comment;
    const model: ModelInfo = { name: String(name) };
    if (alias && alias !== name) {
      model.alias = String(alias);
    }
    if (description) {
      model.description = String(description);
    }

    // 提取模态信息 —— 优先从 architecture 对象读取（OpenRouter 格式）
    const arch = isRecord(entry.architecture) ? entry.architecture : null;
    if (arch) {
      const inputMods = toStringArray(arch.input_modalities);
      const outputMods = toStringArray(arch.output_modalities);
      if (inputMods) model.inputModalities = inputMods;
      if (outputMods) model.outputModalities = outputMods;
    }

    return model;
  };

  let models: (ModelInfo | null)[] = [];

  if (Array.isArray(payload)) {
    models = payload.map(toModel);
  } else if (isRecord(payload)) {
    if (Array.isArray(payload.data)) {
      models = payload.data.map(toModel);
    } else if (Array.isArray(payload.models)) {
      models = payload.models.map(toModel);
    }
  }

  const normalized = models.filter(Boolean) as ModelInfo[];
  if (!dedupe) {
    return normalized;
  }

  const seen = new Set<string>();
  return normalized.filter((model) => {
    const key = (model?.name || '').toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** 按模型 id（name）是否含 `/` 分区：无前缀的简短名（如 pro、mini）与带路由前缀的（如 openrouter/pro）；各区内 localeCompare 排序 */
export function partitionModelsBySlash<T extends { name: string }>(
  models: T[]
): { standalone: T[]; prefixed: T[] } {
  const cmp = (a: T, b: T) =>
    (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
  const standalone = models.filter((m) => !(m.name || '').includes('/')).sort(cmp);
  const prefixed = models.filter((m) => (m.name || '').includes('/')).sort(cmp);
  return { standalone, prefixed };
}

export function sortModelsForDisplayBySlash<T extends { name: string }>(models: T[]): T[] {
  const { standalone, prefixed } = partitionModelsBySlash(models);
  return [...standalone, ...prefixed];
}

export interface ModelGroup {
  id: string;
  label: string;
  items: ModelInfo[];
}

const COMMON_PREFIX_LABELS: Record<string, string> = {
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'google': 'Google',
  'meta-llama': 'Meta Llama',
  'meta': 'Meta',
  'deepseek-ai': 'DeepSeek',
  'deepseek': 'DeepSeek',
  'mistralai': 'Mistral',
  'cohere': 'Cohere',
  'qwen': 'Qwen',
  'thudm': 'THUDM (GLM)',
  '01-ai': '01.AI (Yi)',
  'baichuan-inc': 'Baichuan',
  'minimax': 'MiniMax',
  'x-ai': 'xAI (Grok)',
  'grok': 'xAI (Grok)',
  'perplexity': 'Perplexity',
  'microsoft': 'Microsoft',
  'databricks': 'Databricks',
  'nousresearch': 'Nous Research',
  'sao10k': 'Sao10K',
  'cognitivecomputations': 'Cognitive Computations',
  'gryphe': 'Gryphe',
  'openchat': 'OpenChat',
  'undi95': 'Undi95',
  'neversleep': 'NeverSleep',
  'togethercomputer': 'Together AI',
  'stabilityai': 'Stability AI',
  'huggingfaceh4': 'Hugging Face',
  'carperai': 'CarperAI',
  'eleutherai': 'EleutherAI',
  'moonshotai': 'Moonshot AI',
  'moonshot': 'Moonshot AI',
};

function formatBrandPrefix(prefix: string): string {
  const hasTilde = prefix.startsWith('~');
  const cleanPrefix = hasTilde ? prefix.slice(1) : prefix;
  const lower = cleanPrefix.toLowerCase();

  let formatted = '';
  if (COMMON_PREFIX_LABELS[lower]) {
    formatted = COMMON_PREFIX_LABELS[lower];
  } else {
    formatted = cleanPrefix
      .split(/[-_/]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  return formatted;
}

export function classifyModels(
  models: ModelInfo[] = [],
  { otherLabel = 'Other' } = {}
): ModelGroup[] {
  const groupsMap = new Map<string, { label: string; items: ModelInfo[] }>();

  // Initialize standard categories
  MODEL_CATEGORIES.forEach((cat) => {
    groupsMap.set(cat.id, { label: cat.label, items: [] });
  });

  const otherItems: ModelInfo[] = [];

  models.forEach((model) => {
    const name = (model?.name || '').toString();
    const alias = (model?.alias || '').toString();

    // Check if it has a slash prefix (e.g. "meta-llama/llama-3")
    if (name.includes('/') && name.indexOf('/') > 0) {
      const prefix = name.split('/')[0];
      const categoryId = prefix.toLowerCase();
      const label = formatBrandPrefix(prefix);

      if (!groupsMap.has(categoryId)) {
        groupsMap.set(categoryId, { label, items: [] });
      }
      groupsMap.get(categoryId)!.items.push(model);
    } else {
      // Fallback to regex category match
      const haystack = `${name} ${alias}`.toLowerCase();
      const matchedId = matchCategory(haystack);
      if (matchedId && groupsMap.has(matchedId)) {
        groupsMap.get(matchedId)!.items.push(model);
      } else {
        otherItems.push(model);
      }
    }
  });

  const result: ModelGroup[] = [];

  // Collect all populated groups
  groupsMap.forEach((val, id) => {
    if (val.items.length > 0) {
      result.push({
        id,
        label: val.label,
        items: val.items,
      });
    }
  });

  if (otherItems.length > 0) {
    result.push({
      id: 'other',
      label: otherLabel,
      items: otherItems,
    });
  }

  // Sort groups: priority categories first, then alphabetical by brand, then "Other" at the end
  const priorityOrder = ['gpt', 'claude', 'gemini', 'deepseek', 'qwen', 'kimi', 'glm', 'grok', 'minimax'];

  result.sort((a, b) => {
    const indexA = priorityOrder.indexOf(a.id);
    const indexB = priorityOrder.indexOf(b.id);

    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;

    if (a.id === 'other') return 1;
    if (b.id === 'other') return -1;

    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });

  return result;
}

export type ModelGroupingMode = 'type' | 'vendor';

// ============================================================
// 按类型分类：优先使用 API 返回的 modality 字段（精确），
// 无 modality 时回退到名称正则匹配（兼容旧格式）。
// ============================================================

/**
 * 根据输入/输出模态列表推断类型 ID
 *
 * 优先级（从高到低）：
 * 1. 输出包含 image              → image-gen （图像生成）
 * 2. 输出包含 audio              → audio-gen  （语音合成 / 音频生成）
 * 3. 名字含 embed               → embeddings
 * 4. 名字含 rerank              → rerank
 * 5. 输入包含 audio 或 video    → multimodal （多模态，含音视频输入）
 * 6. 输入包含 image             → vision     （视觉，仅图像+文本输入）
 * 7. 其余                        → text       （纯文本）
 */
function inferTypeFromModality(model: ModelInfo): string {
  const inputMods = model.inputModalities?.map((m) => m.toLowerCase()) ?? [];
  const outputMods = model.outputModalities?.map((m) => m.toLowerCase()) ?? [];
  const name = (model.name || '').toLowerCase();

  // 嵌入 / 重排：名字优先（这类模型 API 不一定有 modality 字段）
  if (/embed/i.test(name)) return 'embeddings';
  if (/rerank/i.test(name)) return 'rerank';

  // 有精确模态信息时用模态判断
  if (outputMods.length > 0) {
    if (outputMods.includes('image')) return 'image-gen';
    if (outputMods.includes('audio')) return 'audio-gen';
  }

  if (inputMods.length > 0) {
    if (inputMods.includes('audio') || inputMods.includes('video')) return 'multimodal';
    if (inputMods.includes('image') || inputMods.includes('file')) return 'vision';
    return 'text';
  }

  // 无 modality 信息，回退到名字正则
  return inferTypeFromName(name);
}

/** 无 modality 字段时的名字兜底规则（保留兼容旧格式） */
function inferTypeFromName(name: string): string {
  if (/rerank/i.test(name)) return 'rerank';
  if (/embed/i.test(name)) return 'embeddings';
  if (/dall-e|dalle|stable-diffusion|sdxl|flux|midjourney|text-to-image|cogview|kolors/i.test(name)) return 'image-gen';
  if (/sora|kling|runway|luma|cogvideo|text-to-video|hunyuan-video/i.test(name)) return 'video-gen';
  if (/tts|text-to-speech|bark|cosyvoice|fish-speech/i.test(name)) return 'audio-gen';
  if (/whisper|transcribe|transcription|\basr\b|speech-to-text/i.test(name)) return 'transcription';
  if (/audio|vocal|musicgen/i.test(name)) return 'audio-gen';
  return 'text';
}

/**
 * 类型分组顺序（展示顺序）
 * 每个 id 对应一个 i18n key：ai_providers.model_type_<id>
 */
const TYPE_GROUP_ORDER = [
  'text',
  'vision',
  'multimodal',
  'image-gen',
  'audio-gen',
  'transcription',
  'embeddings',
  'rerank',
  'other',
] as const;

const TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  vision: 'Vision',
  multimodal: 'Multimodal',
  'image-gen': 'Image Gen',
  'audio-gen': 'Audio / TTS',
  transcription: 'Transcription',
  embeddings: 'Embeddings',
  rerank: 'Rerank',
  other: 'Other',
};

export function classifyModelsByMode(
  models: ModelInfo[] = [],
  mode: ModelGroupingMode = 'type',
  { otherLabel = 'Other' } = {}
): ModelGroup[] {
  if (mode === 'vendor') {
    return classifyModels(models, { otherLabel });
  }

  // 按类型分组：完全动态，不预设固定分类，有什么显示什么
  const groupsMap = new Map<string, { label: string; items: ModelInfo[] }>();

  models.forEach((model) => {
    const typeId = inferTypeFromModality(model);

    if (!groupsMap.has(typeId)) {
      const label =
        typeId === 'other' ? otherLabel : (TYPE_LABELS[typeId] ?? typeId);
      groupsMap.set(typeId, { label, items: [] });
    }
    groupsMap.get(typeId)!.items.push(model);
  });

  // 按预定顺序排列已出现的分组，未在预定顺序中的排最后
  const ordered: ModelGroup[] = [];
  TYPE_GROUP_ORDER.forEach((id) => {
    const group = groupsMap.get(id);
    if (group && group.items.length > 0) {
      ordered.push({ id, label: id === 'other' ? otherLabel : group.label, items: group.items });
      groupsMap.delete(id);
    }
  });

  // 剩余未预定顺序的类型（按字母顺序）
  const extra = [...groupsMap.entries()]
    .filter(([, g]) => g.items.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, g]) => ({ id, label: g.label, items: g.items }));

  return [...ordered, ...extra];
}
