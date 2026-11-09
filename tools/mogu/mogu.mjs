// 🐾 モグの保存係（工程 1-6）：パソコンで毎日動く
// ・Projects フォルダのアプリ（Git のリポジトリ）を1つずつ見て、「保存（コミット）していない」「GitHub に送っていない」を知らせる
// ・全部のリポジトリの写し（git bundle）を、家のバックアップ先に置く（GitHub に送らない ともあい・非公開のコロッセオも）
// ・アプリのデータ（data フォルダ。Git に入れていないので bundle には入らない）も、そのまま写す
//   もどし方：アプリを止めて、写しの「<名前>-data」フォルダの中身を、アプリの data フォルダに戻す
// ・したことは mogu-log.jsonl に1行ずつ残す（工程 1-7 の記録）
// モグは「見る・写す・知らせる」だけ。コミットや送信はしない（決めるのは人）
//
// 使い方：node tools/mogu/mogu.mjs
//   MOGU_PROJECTS … アプリが入っているフォルダ（ふだんはこのリポジトリの1つ上）
//   MOGU_BACKUP   … 写しを置く場所（ふだんは ホーム\tomohane-backup。外付けの場所にするのがおすすめ）
//   MOGU_KEEP     … 写しを何日ぶん残すか（ふだんは 7）
// 外部パッケージなし
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECTS = resolve(process.env.MOGU_PROJECTS || join(HERE, '..', '..', '..'));
const BACKUP = resolve(process.env.MOGU_BACKUP || join(homedir(), 'tomohane-backup'));
const KEEP = Math.max(1, Number(process.env.MOGU_KEEP) || 7);

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const today = new Date().toLocaleDateString('sv-SE'); // この国の日付（YYYY-MM-DD）

export function inspect(dir) {
  const name = dir.split(/[\\/]/).pop();
  const changes = git(dir, 'status', '--porcelain').split('\n').filter(Boolean).length;
  const remote = (() => { try { return git(dir, 'remote', 'get-url', 'origin'); } catch { return null; } })();
  // 送っていないコミット：GitHub にあるブランチより先に進んでいるもの
  let unpushed = 0;
  const branches = git(dir, 'for-each-ref', '--format=%(refname:short) %(upstream:short)', 'refs/heads').split('\n').filter(Boolean);
  const noUpstream = [];
  for (const line of branches) {
    const [branch, upstream] = line.split(' ');
    if (!upstream) { noUpstream.push(branch); continue; }
    try { unpushed += Number(git(dir, 'rev-list', '--count', `${upstream}..${branch}`)); } catch { /* noop */ }
  }
  return { name, changes, remote, unpushed, noUpstream };
}

function backup(dir, name) {
  const dest = join(BACKUP, today);
  mkdirSync(dest, { recursive: true });
  const file = join(dest, `${name}.bundle`);
  git(dir, 'bundle', 'create', file, '--all');
  return file;
}

// アプリのデータ（ユーザー・投稿・手紙など）。data フォルダがなければ何もしない
function backupData(dir, name) {
  const src = join(dir, 'data');
  if (!existsSync(src) || !statSync(src).isDirectory()) return null;
  const dest = join(BACKUP, today, `${name}-data`);
  rmSync(dest, { recursive: true, force: true }); // 同じ日に2回動いたら、新しいほうにする
  cpSync(src, dest, { recursive: true });
  return dest;
}

// 古い写しを片づける（KEEP 日ぶん残す）
function prune() {
  if (!existsSync(BACKUP)) return [];
  const days = readdirSync(BACKUP).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const old = days.slice(0, Math.max(0, days.length - KEEP));
  for (const d of old) rmSync(join(BACKUP, d), { recursive: true, force: true });
  return old;
}

function main() {
  const repos = readdirSync(PROJECTS)
    .map((d) => join(PROJECTS, d))
    .filter((d) => { try { return statSync(d).isDirectory() && existsSync(join(d, '.git')); } catch { return false; } });
  const report = [];
  for (const dir of repos) {
    const r = inspect(dir);
    let bundle = null;
    try { bundle = backup(dir, r.name); } catch (e) { r.backupError = e.message; }
    let data = null;
    try { data = backupData(dir, r.name); } catch (e) { r.dataError = e.message; }
    report.push({ ...r, bundle, data });
  }
  const pruned = prune();

  const lines = [`🐾 モグの見回り（${today}）　写しの置き場所：${join(BACKUP, today)}`];
  for (const r of report) {
    const notes = [];
    if (r.changes) notes.push(`保存していない変更 ${r.changes}`);
    if (r.unpushed) notes.push(`送っていないコミット ${r.unpushed}`);
    if (r.remote && r.noUpstream.length) notes.push(`GitHub にないブランチ ${r.noUpstream.join('・')}`);
    if (!r.remote) notes.push('GitHub にはつないでいない（パソコンの中だけ）');
    if (r.backupError) notes.push(`写しを作れなかった：${r.backupError}`);
    if (r.dataError) notes.push(`データを写せなかった：${r.dataError}`);
    const ok = !r.changes && !r.unpushed && !r.backupError && !r.dataError && !(r.remote && r.noUpstream.length);
    const dataNote = r.data ? '（データも写した）' : '';
    lines.push(`  ${ok ? '✅' : '⚠️'} ${r.name}：${notes.length ? notes.join('、') : 'だいじょうぶモグ'}${dataNote}`);
  }
  if (pruned.length) lines.push(`  🧹 古い写しを片づけた：${pruned.join('・')}`);
  const text = lines.join('\n');
  console.log(text);

  mkdirSync(BACKUP, { recursive: true });
  writeFileSync(join(BACKUP, 'mogu-latest.txt'), `${text}\n`);
  appendFileSync(join(BACKUP, 'mogu-log.jsonl'), `${JSON.stringify({
    at: new Date().toISOString(), agent: 'mogu', action: 'patrol-and-backup',
    repos: report.map(({ name, changes, unpushed, remote, noUpstream, bundle, backupError, data, dataError }) => ({
      name, changes, unpushed, onGitHub: Boolean(remote), noUpstream, backedUp: Boolean(bundle), backupError: backupError ?? null,
      dataBackedUp: Boolean(data), dataError: dataError ?? null,
    })),
    pruned,
  })}\n`);
  const warn = lines.some((l) => l.includes('⚠️'));
  process.exitCode = warn ? 2 : 0; // 2 = 知らせたいことがある
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
