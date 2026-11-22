/**
 * @jest-environment node
 */

import { extractDetailEpisodes, extractEpisodes } from '../episodes';

describe('extractDetailEpisodes', () => {
  it('优先选择 m3u8 线路，而不是第一组分享页', () => {
    const input =
      '第1集$https://share.example.com/1#第2集$https://share.example.com/2' +
      '$$$' +
      '第1集$https://cdn.example.com/1.m3u8#第2集$https://cdn.example.com/2.m3u8';

    expect(extractDetailEpisodes(input)).toEqual([
      'https://cdn.example.com/1.m3u8',
      'https://cdn.example.com/2.m3u8',
    ]);
  });

  it('没有 m3u8 时选择 mp4 等视频直链', () => {
    const input =
      '第1集$https://share.example.com/1' +
      '$$$' +
      '第1集$https://cdn.example.com/1.mp4';

    expect(extractDetailEpisodes(input)).toEqual([
      'https://cdn.example.com/1.mp4',
    ]);
  });

  it('m3u8 权重高于普通视频直链', () => {
    const input =
      '第1集$https://cdn.example.com/1.mp4#第2集$https://cdn.example.com/2.mp4#第3集$https://cdn.example.com/3.mp4' +
      '$$$' +
      '第1集$https://cdn.example.com/1.m3u8';

    expect(extractDetailEpisodes(input)).toEqual([
      'https://cdn.example.com/1.m3u8',
    ]);
  });

  it('全部是分享页时返回 URL 最多的一组', () => {
    const input =
      '第1集$https://share.example.com/1' +
      '$$$' +
      '第1集$https://share.example.com/a#第2集$https://share.example.com/b';

    expect(extractDetailEpisodes(input)).toEqual([
      'https://share.example.com/a',
      'https://share.example.com/b',
    ]);
  });

  it('去重并保留顺序', () => {
    const input =
      '第1集$https://cdn.example.com/1.m3u8#第1集$https://cdn.example.com/1.m3u8#第2集$https://cdn.example.com/2.m3u8';

    expect(extractDetailEpisodes(input)).toEqual([
      'https://cdn.example.com/1.m3u8',
      'https://cdn.example.com/2.m3u8',
    ]);
  });

  it('空值返回空数组', () => {
    expect(extractDetailEpisodes(undefined)).toEqual([]);
    expect(extractDetailEpisodes('')).toEqual([]);
  });
});

describe('extractEpisodes', () => {
  it('选择 m3u8 最多的一组并清理前缀与画质后缀', () => {
    const input =
      '第1集$https://cdn.example.com/a.m3u8(1080P)' +
      '$$$' +
      '第1集$https://cdn.example.com/1.m3u8#第2集$https://cdn.example.com/2.m3u8';

    expect(extractEpisodes(input)).toEqual([
      'https://cdn.example.com/1.m3u8',
      'https://cdn.example.com/2.m3u8',
    ]);
  });
});
