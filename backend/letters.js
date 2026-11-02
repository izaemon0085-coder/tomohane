// 手紙キット：ビデオレターの動画ファイルを保存する・配信する・消す。
// 動画は data/letters/videos/ に置く（data/ は git に入らない）。手紙の情報そのものは store.js（db.json）が持つ
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './store.js';

// 受け取る動画の種類（スマホで撮った動画はたいていこのどれか）
export const VIDEO_TYPES = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 3分くらいのスマホ動画が入る大きさ
const VIDEO_FILE = /^[\w-]+\.(mp4|mov|webm)$/;

const mb = (bytes) => Math.floor(bytes / 1024 / 1024);

// リクエストの本文（動画そのもの）をファイルに保存する。途中で大きすぎたら止めて消す
export async function saveVideo(req, { dir, letterId, maxBytes = MAX_VIDEO_BYTES }) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = VIDEO_TYPES[type];
  if (!ext) throw new HttpError(415, 'ビデオは mp4・mov・webm のどれかにしてください');
  if (Number(req.headers['content-length']) > maxBytes) {
    throw new HttpError(413, `ビデオは${mb(maxBytes)}MBまでにしてください`);
  }

  await mkdir(dir, { recursive: true });
  const file = `${letterId}-${Date.now()}${ext}`;
  const part = join(dir, `${file}.part`);
  let size = 0;
  const counter = new Transform({
    transform(chunk, _enc, done) {
      size += chunk.length;
      if (size > maxBytes) done(new HttpError(413, `ビデオは${mb(maxBytes)}MBまでにしてください`));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(req, counter, createWriteStream(part));
  } catch (err) {
    await rm(part, { force: true });
    throw err instanceof HttpError ? err : new HttpError(400, 'ビデオを受け取れませんでした。もう一度ためしてください');
  }
  if (size === 0) {
    await rm(part, { force: true });
    throw new HttpError(400, 'ビデオが空っぽです');
  }
  await rename(part, join(dir, file));
  return { file, type, size, uploadedAt: new Date().toISOString() };
}

export async function removeVideo(dir, video) {
  if (!video || !VIDEO_FILE.test(video.file)) return;
  await rm(join(dir, video.file), { force: true });
}

// 動画を配信する。スマホ（とくに iPhone）は動画を少しずつ取りに来る（Range）ので、それに応える
export async function serveVideo(req, res, { dir, video }) {
  if (!VIDEO_FILE.test(video.file)) throw new HttpError(404, 'ビデオが見つかりません');
  const path = join(dir, video.file);
  let size;
  try {
    ({ size } = await stat(path));
  } catch {
    throw new HttpError(404, 'ビデオが見つかりません');
  }
  const headers = {
    'Content-Type': video.type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };

  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    return pipeline(createReadStream(path), res).catch(() => {});
  }

  let start;
  let end;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] || m[2])) {
    if (m[1] === '') {
      start = Math.max(0, size - Number(m[2])); // 「最後の n バイト」
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
  }
  if (start === undefined || start > end || start >= size) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  return pipeline(createReadStream(path, { start, end }), res).catch(() => {});
}
