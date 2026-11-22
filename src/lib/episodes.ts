/**
 * 资源站播放地址解析工具。
 *
 * 苹果 CMS 的 `vod_play_url` 用 `$$$` 分隔多条线路，每条线路内用 `#` 分隔集数，
 * 集数格式通常是 `名称$URL`。不同站点对线路顺序的约定并不统一，因此这里统一
 * 选择“最可播放”的一组，避免把网页分享页当成视频地址。
 */

const M3U8_PATTERN = /(https?:\/\/[^"'\s]+?\.m3u8)/g;
const VIDEO_FILE_PATTERN = /\.(?:m3u8|mp4|mkv|flv|ts)(?:[?#]|$)/i;

function cleanEpisodeLink(link: string): string {
  const trimmed = link.replace(/^\$/, '');
  const parenIndex = trimmed.indexOf('(');
  return parenIndex > 0 ? trimmed.substring(0, parenIndex) : trimmed;
}

/**
 * 从 vod_play_url 中提取集数最多的一组 m3u8 链接。
 * 用于搜索结果预览，只关心 m3u8 直链。
 */
export function extractEpisodes(vodPlayUrl?: string): string[] {
  if (typeof vodPlayUrl !== 'string' || vodPlayUrl.length === 0) {
    return [];
  }

  let best: string[] = [];
  for (const group of vodPlayUrl.split('$$$')) {
    const matches = group.match(M3U8_PATTERN) || [];
    if (matches.length > best.length) {
      best = matches;
    }
  }

  return Array.from(new Set(best.map(cleanEpisodeLink)));
}

/**
 * 从任意文本（例如资源站简介）中提取 m3u8 直链。
 */
export function extractM3U8Links(text?: string): string[] {
  if (typeof text !== 'string' || text.length === 0) {
    return [];
  }

  const matches = text.match(M3U8_PATTERN) || [];
  return Array.from(new Set(matches.map(cleanEpisodeLink)));
}

/**
 * 从详情接口的多组播放线路中选出更适合直接播放的一组。
 *
 * 部分资源站的第一组是网页分享页（HTML），第二组才是 m3u8；如果盲目取第一组，
 * 播放器会拿到 403 的 HTML 页面。这里优先选择 m3u8/视频文件最多的线路。
 */
export function extractDetailEpisodes(vodPlayUrl?: string): string[] {
  if (typeof vodPlayUrl !== 'string' || vodPlayUrl.length === 0) {
    return [];
  }

  let bestUrls: string[] = [];
  let bestScore = -1;

  for (const group of vodPlayUrl.split('$$$')) {
    const urls = group
      .split('#')
      .map((episode) => {
        const parts = episode.split('$');
        return (parts.length > 1 ? parts[1] : '').trim();
      })
      .filter((url) => url.startsWith('http://') || url.startsWith('https://'));

    if (urls.length === 0) {
      continue;
    }

    const m3u8Count = urls.filter((url) =>
      /\.m3u8(?:[?#]|$)/i.test(url)
    ).length;
    const videoCount = urls.filter((url) =>
      VIDEO_FILE_PATTERN.test(url)
    ).length;
    // m3u8 权重更高，其次才是 mp4/flv 等直链
    const score = m3u8Count * 10 + videoCount;

    if (
      score > bestScore ||
      (score === bestScore && urls.length > bestUrls.length)
    ) {
      bestScore = score;
      bestUrls = urls;
    }
  }

  return Array.from(new Set(bestUrls));
}
