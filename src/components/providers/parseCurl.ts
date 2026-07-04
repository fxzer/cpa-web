/**
 * 从 cURL 命令解析出 OpenAI 兼容供应商所需的配置。
 * 纯函数，无副作用，便于单测。
 */

export interface ParsedCurl {
  /** 去掉结尾 /chat/completions 后的 base，如 https://api.example.com/v1 */
  baseUrl: string;
  /** 从 Authorization / api-key / x-api-key 头提取的 token；占位符或缺失时为空串 */
  apiKey: string;
  /** 从 -d body 的 JSON.model 字段提取的模型名 */
  model: string;
  /** token 看起来是占位符（如 <your-api-key>、$ENV_VAR）时为 true，此时 apiKey 为空串 */
  apiKeyIsPlaceholder: boolean;
  /** 根据 baseUrl host 自动推导的供应商名称；无法推导时为空串 */
  name: string;
}

export const EMPTY_PARSED_CURL: ParsedCurl = {
  baseUrl: '',
  apiKey: '',
  model: '',
  apiKeyIsPlaceholder: false,
  name: '',
};

/** 判断字符串是否为 IPv4 地址 */
function isIPv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((p) => Number.isInteger(Number(p)) && Number(p) >= 0 && Number(p) <= 255);
}

/**
 * 根据 base URL 的 host 推导供应商名称：
 * - 多级域名（≥3段，且非 IP）：去掉首段（通常是 api/www 等前缀）和末段（TLD），中间用 - 拼接
 *   例：api.babel.town → babel；a.b.deepseek.com → b-deepseek
 * - 兜底：localhost、IP、只有 2 段的域名（如 example.com）→ 直接用 host 本身
 * - 无法解析 host 时返回空串
 */
export function deriveProviderName(baseUrl: string): string {
  const raw = String(baseUrl ?? '').trim();
  // 必须是 http(s) 开头，否则不当作有效 URL 处理
  const matched = raw.match(/^https?:\/\/([^/?#]+)/i);
  if (!matched) return '';
  // host 段可能含端口，剥掉端口
  const host = matched[1].split(':')[0].toLowerCase();
  if (!host) return '';

  if (host === 'localhost' || isIPv4(host)) return host;

  const parts = host.split('.');
  // 不含点（非域名）→ 无法推导
  if (parts.length < 2) return '';
  // 只有 2 段（如 example.com）→ 直接用 host 兜底
  if (parts.length === 2) return host;

  const middle = parts.slice(1, -1);
  return middle.length ? middle.join('-') : host;
}

/** 提取 cURL 里的第一个 http(s) URL，去掉结尾的 /chat/completions */
function extractBaseUrl(input: string): string {
  const match = input.match(/https?:\/\/[^\s'"\\]+/i);
  if (!match) return '';
  let url = match[0];
  // 去掉 query/hash，避免 base 被污染
  url = url.split(/[?#]/)[0];
  url = url.replace(/\/chat\/completions\/?$/i, '');
  url = url.replace(/\/+$/g, '');
  return url;
}

/** 去掉字符串两端的匹配引号（单引号或双引号） */
function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/** 从所有 -H / --header 参数里提取鉴权 token */
function extractApiKey(input: string): { apiKey: string; isPlaceholder: boolean } {
  // 匹配 -H / --header 后面紧跟的引号字符串或裸 token
  const headerPattern = /(?:-H|--header)\s+('[^']*'|"[^"]*"|[^\s'"\\]+)/g;
  let rawToken = '';
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = headerPattern.exec(input)) !== null) {
    const header = stripMatchingQuotes(m[1]);
    const colonIdx = header.indexOf(':');
    if (colonIdx === -1) continue;
    const name = header.slice(0, colonIdx).trim().toLowerCase();
    const value = header.slice(colonIdx + 1).trim();

    if (name === 'authorization') {
      const bearer = value.match(/^bearer\s+(.+)$/i);
      if (bearer) rawToken = bearer[1].trim();
    } else if (name === 'api-key' || name === 'x-api-key') {
      rawToken = value;
    } else {
      continue;
    }
    seen.add(name);
    if (rawToken) break;
  }

  if (!rawToken) return { apiKey: '', isPlaceholder: false };

  if (looksLikePlaceholder(rawToken)) {
    return { apiKey: '', isPlaceholder: true };
  }
  return { apiKey: rawToken, isPlaceholder: false };
}

/** 把 shell 双引号字符串里的转义还原：\" → "，\\ → \ */
function unescapeShellDoubleQuoted(value: string): string {
  return value.replace(/\\(.)/g, (_, ch: string) => ch);
}

/** 从 -d / --data / --data-raw body 里提取 model 字段 */
function extractModel(input: string): string {
  // 双引号字符串支持内部转义引号（shell 里 -d "{\"model\":\"x\"}" 的写法）
  const dataPattern = /(?:-d|--data|--data-raw|--data-binary)\s+('[^']*'|"(?:[^"\\]|\\.)*"|[^\s'"\\]+)/g;
  let m: RegExpExecArray | null;
  while ((m = dataPattern.exec(input)) !== null) {
    const quoted = m[1];
    const isDouble = quoted.length >= 2 && quoted[0] === '"' && quoted[quoted.length - 1] === '"';
    // 双引号 body 需要 shell 反转义后再去引号；单引号/裸串直接去引号
    const raw = isDouble
      ? unescapeShellDoubleQuoted(quoted.slice(1, -1))
      : stripMatchingQuotes(quoted);
    // 优先用 JSON 解析，失败则退回正则提取
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.model === 'string') {
        const model = parsed.model.trim();
        if (model) return model;
      }
    } catch {
      /* fallthrough 到正则兜底 */
    }
    // 正则兜底：容忍非 JSON 文本，匹配 "model": "xxx"
    const modelMatch = raw.match(/"model"\s*:\s*"([^"]+)"/);
    if (modelMatch && modelMatch[1].trim()) return modelMatch[1].trim();
  }
  return '';
}

/** 明显的占位文案（归一化后比对：转小写、去掉 - _. 与空白） */
const PLACEHOLDER_WORDS = new Set([
  'yourapikey',
  'yourkey',
  'yourtoken',
  'yoursecret',
  'yourapi key',
  'replace me',
  'replaceme',
  'placeholder',
  'pastehere',
  'paste here',
  'changeme',
  'change me',
  'insertkey',
  'your key here',
]);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[-_.\s]/g, '')
    .trim();

/**
 * 判断 token 是否像占位符而非真实 key。
 * 采用保守规则，只拦截明显特征，避免误伤真实 key
 * （真实 key 几乎都含小写字母 + 数字混合）。
 */
export function looksLikePlaceholder(token: string): boolean {
  const value = String(token ?? '').trim();
  if (!value) return false;

  // 1. 尖括号包裹：<your-api-key>
  if (/^<.+>$/.test(value)) return true;

  // 2. 环境变量引用：$VAR 或 ${VAR}
  if (/^\$\{?[A-Za-z_][\w]*\}?$/.test(value)) return true;

  // 3. 命中占位文案白名单
  if (PLACEHOLDER_WORDS.has(normalize(value))) return true;

  // 4. 打码占位：去掉分隔符与常见 key 前缀后，剩余字符全是 x
  //    如 xxxx、sk-xxxx、xxxx-xxxx
  const dePrefixed = value.replace(/[-_.\s]/g, '').replace(/^(sk|Bearer|bearer)/i, '');
  if (dePrefixed.length >= 3 && /^[xX]+$/.test(dePrefixed)) return true;

  // 5. 不含小写字母、不含数字，且长度 >= 4：纯大写符号串，如 YOUR_API_KEY、API_KEY
  if (value.length >= 4 && !/[a-z]/.test(value) && !/[0-9]/.test(value)) {
    return true;
  }

  return false;
}

export function parseCurl(input: string): ParsedCurl {
  const source = String(input ?? '').trim();
  if (!source) return { ...EMPTY_PARSED_CURL };

  const baseUrl = extractBaseUrl(source);
  const { apiKey, isPlaceholder } = extractApiKey(source);
  const model = extractModel(source);

  return {
    baseUrl,
    apiKey,
    model,
    apiKeyIsPlaceholder: isPlaceholder,
    name: deriveProviderName(baseUrl),
  };
}
