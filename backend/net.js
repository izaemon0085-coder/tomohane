// 回線のようすを調べる道具（回線番のモグが使う）
import os from 'node:os';
import { promises as dns } from 'node:dns';

// ローカル回線（同じ Wi-Fi）で、ほかの端末から入るためのアドレス
export function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

// インターネットにつながるか（名前を引けるか）を、短い時間で確かめる
export async function checkInternet(host = process.env.NET_CHECK_HOST || 'www.google.com', timeoutMs = 3000) {
  try {
    await Promise.race([
      dns.resolve(host),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

// 使う回線を決める：インターネット→Wi-Fi ／ だめでも同じ Wi-Fi の中なら→ローカル回線 ／ どちらもだめ→この端末だけ
export function chooseLine({ internet, lan }) {
  if (internet) return 'wifi';
  if (lan.length) return 'local';
  return 'offline';
}
