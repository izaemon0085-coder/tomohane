import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOGU = fileURLToPath(new URL('../../tools/mogu/mogu.mjs', import.meta.url));
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });

test('モグ：保存していない変更を知らせて、全部のリポジトリの写しを作る（コミットや送信はしない）', () => {
  const root = mkdtempSync(join(tmpdir(), 'mogu-'));
  const projects = join(root, 'Projects');
  const backup = join(root, 'backup');
  try {
    for (const name of ['clean-app', 'dirty-app']) {
      const dir = join(projects, name);
      execFileSync('git', ['init', '-q', dir]);
      run(dir, 'config', 'user.email', 'mogu@example.com');
      run(dir, 'config', 'user.name', 'mogu');
      writeFileSync(join(dir, 'a.txt'), 'a');
      run(dir, 'add', '-A');
      run(dir, 'commit', '-q', '-m', 'first');
    }
    writeFileSync(join(projects, 'dirty-app', 'b.txt'), 'まだ保存していない');
    let out;
    let code = 0;
    try {
      out = execFileSync(process.execPath, [MOGU], { env: { ...process.env, MOGU_PROJECTS: projects, MOGU_BACKUP: backup }, encoding: 'utf8' });
    } catch (e) {
      out = e.stdout;
      code = e.status;
    }
    assert.equal(code, 2);
    assert.match(out, /⚠️ dirty-app：保存していない変更 1/);
    assert.match(out, /✅ clean-app：GitHub にはつないでいない/);
    const day = readdirSync(backup).find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    assert.ok(existsSync(join(backup, day, 'clean-app.bundle')));
    assert.ok(existsSync(join(backup, day, 'dirty-app.bundle')));
    const log = readFileSync(join(backup, 'mogu-log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(log[0].agent, 'mogu');
    assert.equal(log[0].repos.find((r) => r.name === 'dirty-app').changes, 1);
    // モグはコミットしない
    assert.match(execFileSync('git', ['status', '--porcelain'], { cwd: join(projects, 'dirty-app'), encoding: 'utf8' }), /b\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
