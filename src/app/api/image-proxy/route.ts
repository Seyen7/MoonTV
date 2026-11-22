/* eslint-disable no-console */

import { NextResponse } from 'next/server';

import { isPublicHttpUrl } from '@/lib/security';

export const runtime = 'edge';

// OrionTV 兼容接口
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  // 只允许代理公网 http(s) 图片，避免该接口变成任意 URL / 内网探测代理
  if (!isPublicHttpUrl(imageUrl)) {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let currentUrl = imageUrl;
    let imageResponse: Response | null = null;

    // 手动处理重定向，逐跳校验目标地址，防止 302 到内网地址绕过校验
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      if (!isPublicHttpUrl(currentUrl)) {
        return NextResponse.json(
          { error: 'Invalid image URL' },
          { status: 400 }
        );
      }

      const response = await fetch(currentUrl, {
        headers: {
          Referer: 'https://movie.douban.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
        redirect: 'manual',
      });

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          return NextResponse.json(
            { error: 'Invalid redirect response' },
            { status: 502 }
          );
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      imageResponse = response;
      break;
    }

    if (!imageResponse) {
      return NextResponse.json(
        { error: 'Too many redirects' },
        { status: 502 }
      );
    }

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch image' },
        { status: 502 }
      );
    }

    const contentType = imageResponse.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return NextResponse.json(
        { error: 'Unsupported content type' },
        { status: 415 }
      );
    }

    const contentLength = Number(
      imageResponse.headers.get('content-length') || 0
    );
    if (contentLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Image too large' }, { status: 413 });
    }

    const body = await imageResponse.arrayBuffer();
    if (body.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Image too large' }, { status: 413 });
    }

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
        'X-Content-Type-Options': 'nosniff',
        // 缓存半年
        'Cache-Control': 'public, max-age=15720000, s-maxage=15720000',
        'CDN-Cache-Control': 'public, s-maxage=15720000',
        'Vercel-CDN-Cache-Control': 'public, s-maxage=15720000',
      },
    });
  } catch (error) {
    console.error('图片代理请求失败:', error);
    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
