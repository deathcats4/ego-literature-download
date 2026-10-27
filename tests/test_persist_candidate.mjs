import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';
import {persistCandidate} from '../scripts/persist_candidate.mjs';

const data = Buffer.from('%PDF-1.7\nlocal storage fixture; identity deliberately unverified\n');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ego-portability-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const source = join(root, '浏览器 自定义目录 #100%', 'arbitrary name.bin');
  await mkdir(dirname(source), {recursive: true});
  await writeFile(source, data);
  return {root, source, output: join(root, '论文 输出', 'pool')};
}

test('persists the exact receipt path into a supplied Unicode/space output without assuming Downloads or a .pdf source name', async t => {
  const {source, output} = await fixture(t);
  const result = await persistCandidate(source, output, {expectedBytes: data.length});
  assert.equal(dirname(result.candidate_path), output);
  assert.deepEqual(await readFile(result.candidate_path), data);
  assert.deepEqual(await readFile(source), data);
  assert.equal(result.sha256, createHash('sha256').update(data).digest('hex'));
  assert.equal(result.identity_match, null);
});

test('repeated collection retains both candidates without overwriting an existing file', async t => {
  const {source, output} = await fixture(t);
  const first = await persistCandidate(source, output, {expectedBytes: data.length});
  const second = await persistCandidate(source, output, {expectedBytes: data.length});
  assert.notEqual(first.candidate_path, second.candidate_path);
  assert.equal((await readdir(output)).length, 2);
  assert.deepEqual(await readFile(first.candidate_path), data);
});

test('a missing receipt path fails instead of searching another folder or reusing an old candidate', async t => {
  const {source, output} = await fixture(t);
  await persistCandidate(source, output, {expectedBytes: data.length});
  await assert.rejects(persistCandidate(join(dirname(source), 'missing.pdf'), output,
    {expectedBytes: data.length}), {code: 'ENOENT'});
  assert.equal((await readdir(output)).length, 1);
});

test('relative paths and missing completion byte count fail before creating output', async t => {
  const {source, output} = await fixture(t);
  await assert.rejects(persistCandidate('relative.pdf', output, {expectedBytes: data.length}), /absolute/);
  await assert.rejects(persistCandidate(source, 'relative-pool', {expectedBytes: data.length}), /absolute/);
  await assert.rejects(persistCandidate(source, output), /expectedBytes/);
  await assert.rejects(persistCandidate(source, output, {expectedBytes: 0}), /expectedBytes/);
  await assert.rejects(readdir(output), {code: 'ENOENT'});
});

test('an incomplete file or non-PDF is not copied into the pool', async t => {
  const {source, output} = await fixture(t);
  await assert.rejects(persistCandidate(source, output, {expectedBytes: data.length + 1}), /size_mismatch/);
  const html = Buffer.from('<html>Sign in</html>');
  await writeFile(source, html);
  await assert.rejects(persistCandidate(source, output, {expectedBytes: html.length}), /not_pdf/);
  await assert.rejects(readdir(output), {code: 'ENOENT'});
});

test('relocated skill modules work from an unrelated cwd and share their relocated default lock', async t => {
  const {root, source, output} = await fixture(t);
  const scripts = join(root, '技能 安装 #100%', 'scripts');
  const cwd = join(root, '不相关 工作目录');
  await mkdir(scripts, {recursive: true});
  await mkdir(cwd);
  for (const name of ['persist_candidate.mjs']) {
    await copyFile(fileURLToPath(new URL('../scripts/' + name, import.meta.url)), join(scripts, name));
  }
  // File URLs are generated, so Unicode, spaces, # and % are encoded correctly.
  const script = `
    import {persistCandidate} from ${JSON.stringify(pathToFileURL(join(scripts, 'persist_candidate.mjs')).href)};
    const result = await persistCandidate(${JSON.stringify(source)}, ${JSON.stringify(output)}, {expectedBytes:${data.length}});
    console.log(JSON.stringify({result}));
  `;
  const entry = join(root, 'portable-entry.mjs');
  await writeFile(entry, script);
  const child = spawnSync(process.execPath, [entry], {cwd, encoding:'utf8', timeout:10000});
  assert.equal(child.status, 0, child.stderr);
  const {result} = JSON.parse(child.stdout);
  assert.equal(dirname(result.candidate_path), output);
  assert.deepEqual(await readFile(result.candidate_path), data);
});
