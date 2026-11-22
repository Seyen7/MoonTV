/**
 * 通用安全工具函数。
 *
 * 这里的实现必须同时兼容 Edge Runtime（Vercel / Cloudflare）与 Node.js，
 * 因此只依赖 Web 标准 API（URL / TextEncoder / crypto.subtle），不要引入
 * node:fs、node:crypto 等 Node 专属模块。
 */

const AUTH_HASH_PREFIX = 'moontv:auth:v1:';

/**
 * 校验登录后的跳转地址，避免开放重定向。
 *
 * 只允许站内相对路径（以单个 `/` 开头），`//evil.com`、`/\evil.com`、
 * `https://evil.com`、`javascript:` 等一律回退到 fallback。
 */
export function sanitizeRedirectPath(
  input: string | null | undefined,
  fallback = '/'
): string {
  if (typeof input !== 'string' || input.length === 0) {
    return fallback;
  }

  // 控制字符可能被用于绕过前缀判断
  for (const char of Array.from(input)) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      return fallback;
    }
  }

  // 编码后的斜杠/反斜杠/空字符可能在后续解码时改变路径语义
  if (/%(?:2f|5c|00)/i.test(input)) {
    return fallback;
  }

  // 必须是站内绝对路径，且不能是协议相对地址
  if (
    !input.startsWith('/') ||
    input.startsWith('//') ||
    input.startsWith('/\\')
  ) {
    return fallback;
  }

  try {
    // 以固定站内源解析，任何解析出站外源的情况都视为非法
    const url = new URL(input, 'http://moontv.local');
    if (url.origin !== 'http://moontv.local') {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * 判断 URL 是否可以作为服务端代理的目标。
 *
 * 限制：
 * - 仅 http/https；
 * - 不允许携带用户名密码；
 * - 不允许 localhost、*.local、*.internal 等内网域名；
 * - 不允许回环、私有、链路本地、CGNAT、组播等 IPv4/IPv6 字面量地址；
 * - 仅允许 80/443 端口，降低被当作通用代理滥用的风险。
 *
 * 说明：Edge Runtime 无法做 DNS 解析，因此域名解析到内网地址（DNS rebinding）
 * 无法在这里完全防御，需要配合网络层 egress 策略。
 */
export function isPublicHttpUrl(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  if (url.username || url.password) {
    return false;
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    return false;
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  ) {
    return false;
  }

  // IPv6 字面量统一拒绝：图片 CDN 基本用域名，拒绝可以避免绕过 IPv4 判断
  if (host.startsWith('[') || host.includes(':')) {
    return false;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split('.').map(Number);
    if (
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return false;
    }
    const [a, b] = parts;
    if (
      a === 0 || // 0.0.0.0/8
      a === 10 || // 10.0.0.0/8
      a === 127 || // 回环
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // 链路本地 / 云元数据
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      a >= 224 // 组播 / 保留
    ) {
      return false;
    }
  }

  return true;
}

/** 常量时间字符串比较，避免签名/密码比较泄露时序信息。 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * 计算写入 auth cookie 的密码摘要。
 *
 * 仅用于「localStorage 单密码模式」下 middleware 校验，避免把明文密码
 * 放进客户端可读的 cookie。摘要带固定域前缀，不能直接用于登录。
 */
export async function hashAuthPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(`${AUTH_HASH_PREFIX}${password}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** 校验 cookie 中的密码摘要是否与当前环境变量密码匹配。 */
export async function verifyAuthPassword(
  stored: string | undefined,
  password: string
): Promise<boolean> {
  if (!stored || !password) {
    return false;
  }
  const expected = await hashAuthPassword(password);
  return timingSafeEqualString(stored, expected);
}

/**
 * 把对象序列化后嵌入内联 <script>。
 *
 * JSON.stringify 不会转义 `</script>`，当站点名称/公告等配置由管理员控制时
 * 可能造成脚本注入，这里统一转义危险字符。
 */
export function serializeForInlineScript(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
