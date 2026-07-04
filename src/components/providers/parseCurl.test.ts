import { describe, expect, it } from 'vitest';
import { deriveProviderName, looksLikePlaceholder, parseCurl } from './parseCurl';

// 用户提供的真实示例
const BABELTOWN_CURL = `curl -X POST "https://api.babel.town/v1/chat/completions" \\
-H "Content-Type: application/json" \\
-H "Authorization: Bearer babeltown-ij393x4eps2m7ncdk4s9muy9knv4dugf" \\
-d '{
  "model": "glm-5.2",
  "messages": [
    {
      "role": "user",
      "content": "Why is the sky blue?"
    }
  ]
}'`;

describe('parseCurl', () => {
  it('解析用户提供的 babeltown 标准 cURL（三字段全中）', () => {
    const result = parseCurl(BABELTOWN_CURL);
    expect(result.baseUrl).toBe('https://api.babel.town/v1');
    expect(result.apiKey).toBe('babeltown-ij393x4eps2m7ncdk4s9muy9knv4dugf');
    expect(result.model).toBe('glm-5.2');
    expect(result.apiKeyIsPlaceholder).toBe(false);
    expect(result.name).toBe('babel');
  });

  it('URL 不含 /chat/completions 时原样保留为 baseUrl', () => {
    const curl = `curl https://api.example.com/v1 -H "Authorization: Bearer sk-real"`;
    expect(parseCurl(curl).baseUrl).toBe('https://api.example.com/v1');
  });

  it('支持 api-key 头变体', () => {
    const curl = `curl https://api.x.com/v1/chat/completions -H "api-key: sk-abc123def"`;
    expect(parseCurl(curl).apiKey).toBe('sk-abc123def');
  });

  it('支持 x-api-key 头变体', () => {
    const curl = `curl https://api.x.com/v1/chat/completions -H "x-api-key: sk-xyz789"`;
    expect(parseCurl(curl).apiKey).toBe('sk-xyz789');
  });

  it('支持双引号包裹的 -d body（内部转义）', () => {
    // 模拟真实 shell：-d "{\"model\":\"gpt-4o\"}"
    // JS 字符串里 \\\" 表示字面的 \"，最终字符序列为 -d "{\"model\":\"gpt-4o\"}"
    const curl =
      'curl https://api.x.com/v1/chat/completions -H "Authorization: Bearer sk-real" -d "{\\"model\\":\\"gpt-4o\\"}"';
    expect(parseCurl(curl).model).toBe('gpt-4o');
  });

  it('缺少 -d 时 model 为空，不报错', () => {
    const curl = `curl https://api.x.com/v1/chat/completions -H "Authorization: Bearer sk-real"`;
    expect(parseCurl(curl).model).toBe('');
  });

  it('缺少鉴权头时 apiKey 为空', () => {
    const curl = `curl https://api.x.com/v1/chat/completions -d '{"model":"gpt"}'`;
    expect(parseCurl(curl).apiKey).toBe('');
    expect(parseCurl(curl).apiKeyIsPlaceholder).toBe(false);
  });

  it('乱码输入返回空值，不抛异常', () => {
    const result = parseCurl('这不是一个 curl 命令');
    expect(result.baseUrl).toBe('');
    expect(result.apiKey).toBe('');
    expect(result.model).toBe('');
    expect(result.apiKeyIsPlaceholder).toBe(false);
  });

  it('空字符串返回空值', () => {
    const result = parseCurl('');
    expect(result.baseUrl).toBe('');
    expect(result.apiKey).toBe('');
    expect(result.model).toBe('');
  });
});

describe('parseCurl 占位符检测', () => {
  const cases: Array<[string, string]> = [
    ['尖括号', 'curl https://x/v1/chat/completions -H "Authorization: Bearer <your-api-key>"'],
    ['$ENV', 'curl https://x/v1/chat/completions -H "Authorization: Bearer $OPENAI_API_KEY"'],
    ['${ENV}', 'curl https://x/v1/chat/completions -H "Authorization: Bearer ${API_KEY}"'],
    ['纯大写token', 'curl https://x/v1/chat/completions -H "Authorization: Bearer YOUR_API_KEY"'],
    ['x打码', 'curl https://x/v1/chat/completions -H "Authorization: Bearer sk-xxxx"'],
    ['replace_me', 'curl https://x/v1/chat/completions -H "Authorization: Bearer replace_me"'],
    ['your-api-key文案', 'curl https://x/v1/chat/completions -H "Authorization: Bearer your-api-key"'],
  ];

  for (const [name, curl] of cases) {
    it(`${name}：apiKey 为空且 apiKeyIsPlaceholder=true`, () => {
      const result = parseCurl(curl);
      expect(result.apiKey).toBe('');
      expect(result.apiKeyIsPlaceholder).toBe(true);
    });
  }

  it('占位符时 baseUrl 和 model 仍正常解析', () => {
    const curl = `curl https://api.example.com/v1/chat/completions -H "Authorization: Bearer <YOUR_KEY>" -d '{"model":"glm-5.2"}'`;
    const result = parseCurl(curl);
    expect(result.baseUrl).toBe('https://api.example.com/v1');
    expect(result.model).toBe('glm-5.2');
    expect(result.apiKey).toBe('');
    expect(result.apiKeyIsPlaceholder).toBe(true);
  });

  it('真实 key（babeltown）不被误判为占位符', () => {
    const curl = `curl https://api.babel.town/v1/chat/completions -H "Authorization: Bearer babeltown-ij393x4eps2m7ncdk4s9muy9knv4dugf"`;
    const result = parseCurl(curl);
    expect(result.apiKey).toBe('babeltown-ij393x4eps2m7ncdk4s9muy9knv4dugf');
    expect(result.apiKeyIsPlaceholder).toBe(false);
  });
});

describe('looksLikePlaceholder', () => {
  it('空串与短串不算占位符', () => {
    expect(looksLikePlaceholder('')).toBe(false);
    expect(looksLikePlaceholder('ab')).toBe(false);
  });

  it('真实 key 不算占位符', () => {
    expect(looksLikePlaceholder('babeltown-ij393x4eps2m7ncdk4s9muy9knv4dugf')).toBe(false);
    expect(looksLikePlaceholder('sk-proj-abc123defGHI')).toBe(false);
  });
});

describe('deriveProviderName', () => {
  it('3级域名取中间词', () => {
    expect(deriveProviderName('https://api.babel.town/v1')).toBe('babel');
    expect(deriveProviderName('https://api.deepseek.com')).toBe('deepseek');
    expect(deriveProviderName('https://api.openai.com/v1')).toBe('openai');
  });

  it('4级以上去首尾、中间用-拼接', () => {
    // generativelanguage.googleapis.com → 去 generativelanguage 与 com → googleapis
    expect(deriveProviderName('https://generativelanguage.googleapis.com/v1beta')).toBe('googleapis');
    // a.b.deepseek.com → 去 a 与 com → b-deepseek
    expect(deriveProviderName('https://a.b.deepseek.com/v1')).toBe('b-deepseek');
  });

  it('2段域名用 host 兜底', () => {
    expect(deriveProviderName('https://example.com/v1')).toBe('example.com');
    expect(deriveProviderName('https://myapi.cn')).toBe('myapi.cn');
  });

  it('localhost 与 IP 用 host 兜底', () => {
    expect(deriveProviderName('http://localhost:8317/v1')).toBe('localhost');
    expect(deriveProviderName('http://127.0.0.1:8080/v1')).toBe('127.0.0.1');
    expect(deriveProviderName('http://192.168.1.10/v1')).toBe('192.168.1.10');
  });

  it('空串或无法解析返回空串', () => {
    expect(deriveProviderName('')).toBe('');
    expect(deriveProviderName('not a url')).toBe('');
  });

  it('含端口时不影响取名（端口被剥离）', () => {
    expect(deriveProviderName('https://api.babel.town:9000/v1')).toBe('babel');
  });
});
