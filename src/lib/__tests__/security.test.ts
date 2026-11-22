/**
 * @jest-environment node
 */

// Jest 27 的 node 环境不会自动注入 Web Crypto，这里补上以测试密码摘要
import { webcrypto } from 'node:crypto';

import {
  hashAuthPassword,
  isPublicHttpUrl,
  sanitizeRedirectPath,
  serializeForInlineScript,
  timingSafeEqualString,
  verifyAuthPassword,
} from '../security';

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

describe('sanitizeRedirectPath', () => {
  it('保留站内路径与查询参数', () => {
    expect(sanitizeRedirectPath('/search?q=abc')).toBe('/search?q=abc');
    expect(sanitizeRedirectPath('/play?source=a&id=1#t=10')).toBe(
      '/play?source=a&id=1#t=10'
    );
  });

  it('拒绝站外地址与协议相对地址', () => {
    expect(sanitizeRedirectPath('https://evil.com')).toBe('/');
    expect(sanitizeRedirectPath('//evil.com')).toBe('/');
    expect(sanitizeRedirectPath('/\\evil.com')).toBe('/');
    expect(sanitizeRedirectPath('javascript:alert(1)')).toBe('/');
    expect(sanitizeRedirectPath('search')).toBe('/');
    expect(sanitizeRedirectPath('/path\nheader')).toBe('/');
    expect(sanitizeRedirectPath('/path/%2f%2fevil.com')).toBe('/');
    expect(sanitizeRedirectPath('/path/%5cevil.com')).toBe('/');
  });

  it('空值回退到指定默认值', () => {
    expect(sanitizeRedirectPath(null, '/home')).toBe('/home');
    expect(sanitizeRedirectPath('', '/home')).toBe('/home');
  });
});

describe('isPublicHttpUrl', () => {
  it('允许公网 http/https 图片地址', () => {
    expect(isPublicHttpUrl('https://img1.doubanio.com/view/photo.jpg')).toBe(
      true
    );
    expect(isPublicHttpUrl('http://example.com/a.png')).toBe(true);
    expect(isPublicHttpUrl('https://example.com:443/a.png')).toBe(true);
  });

  it('拒绝非 http(s) 协议和携带凭据的地址', () => {
    expect(isPublicHttpUrl('ftp://example.com/a.png')).toBe(false);
    expect(isPublicHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isPublicHttpUrl('https://user:pass@example.com/a.png')).toBe(false);
  });

  it('拒绝内网、回环与云元数据地址', () => {
    expect(isPublicHttpUrl('http://localhost/a.png')).toBe(false);
    expect(isPublicHttpUrl('http://foo.local/a.png')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1/a.png')).toBe(false);
    expect(isPublicHttpUrl('http://10.1.2.3/a.png')).toBe(false);
    expect(isPublicHttpUrl('http://172.16.0.1/a.png')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.1/a.png')).toBe(false);
    expect(isPublicHttpUrl('http://169.254.169.254/latest/meta-data')).toBe(
      false
    );
    expect(isPublicHttpUrl('http://[::1]/a.png')).toBe(false);
  });

  it('拒绝非常规端口与超长地址', () => {
    expect(isPublicHttpUrl('https://example.com:8080/a.png')).toBe(false);
    expect(isPublicHttpUrl('https://example.com/' + 'a'.repeat(3000))).toBe(
      false
    );
  });
});

describe('serializeForInlineScript', () => {
  it('转义脚本结束标签与 HTML 危险字符', () => {
    const output = serializeForInlineScript({
      name: '</script><script>alert(1)</script>',
      text: 'a & b',
    });
    expect(output).not.toContain('</script>');
    expect(output).toContain('\\u003c/script\\u003e');
    expect(output).toContain('\\u0026');
  });
});

describe('timingSafeEqualString', () => {
  it('仅长度和内容都相同时返回 true', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
    expect(timingSafeEqualString('abc', 'ab')).toBe(false);
  });
});

describe('密码摘要', () => {
  it('生成稳定摘要且不包含明文', async () => {
    const hash = await hashAuthPassword('my-password');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('my-password');
    expect(await verifyAuthPassword(hash, 'my-password')).toBe(true);
    expect(await verifyAuthPassword(hash, 'other-password')).toBe(false);
    expect(await verifyAuthPassword(undefined, 'my-password')).toBe(false);
  });
});
