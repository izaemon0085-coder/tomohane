// やりくり献立との連結：やりくり献立が保存した「最新の献立」（kondate_latest.json）を読むだけ。
// ともはねからは書きこまない（同じファイルに2つのアプリが書くと、こわれることがあるため）。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

// やりくり献立のフォルダ。ちがう場所にあるときは環境変数 YARIKURI_DIR で変えられる
export const YARIKURI_DIR = process.env.YARIKURI_DIR
  || join(os.homedir(), 'OneDrive', 'Documents', 'yarikuri-kondate');
// やりくり献立（Streamlit）の画面のアドレス
export const YARIKURI_URL = process.env.YARIKURI_URL || 'http://localhost:8501/';

// 最新の献立を読む。ファイルがない・読めない（OneDrive の同期中など）ときは null
export async function readLatestMenu(dir = YARIKURI_DIR) {
  try {
    const data = JSON.parse(await readFile(join(dir, 'kondate_latest.json'), 'utf8'));
    if (!data || !Array.isArray(data.days) || !data.createdAt) return null;
    return data;
  } catch {
    return null;
  }
}

// 献立の中から「きょうの分」を選ぶ（なければ最初の日）
export function todayMenu(menu, today = new Date()) {
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return menu.days.find((d) => d.date === key) || menu.days[0] || null;
}

// 料理名から「（材料）」を取って短くする
export function dishName(text = '') {
  return String(text).replace(/[（(][^）)]*[）)]/g, '').trim() || String(text);
}

// いくつかの料理が並んでいるときは、主な料理（最初の1つ）だけにして「など」を付ける
export function mainDish(text = '') {
  const dishes = dishName(text).split(/[、,，]/).map((d) => d.trim()).filter(Boolean);
  if (!dishes.length) return '';
  return dishes.length > 1 ? `${dishes[0]} など` : dishes[0];
}
