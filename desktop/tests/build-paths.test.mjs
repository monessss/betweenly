import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { clearGenerated } from '../scripts/runtime-bundle.mjs';

test('build cleanup rejects source directories and user data', async () => {
  const root = resolve('.');
  for (const path of [root, join(root, '.runtime'), join(root, '.runtime/mvp'), join(root, '.runtime/desktop-profile'), join(root, 'Backend')]) await assert.rejects(clearGenerated(root, path), /非构建目录/);
});

test('build cleanup cannot follow a directory link into a profile', async () => {
  await mkdir(resolve('.runtime'), { recursive: true });
  const root = await mkdtemp(resolve('.runtime/desktop-size-path-test-'));
  const profile = join(root, '.runtime/mvp');
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, 'keep.json'), '{"fixture":true}');
  await mkdir(join(root, '.runtime/desktop-bundle'), { recursive: true });
  const linked = join(root, '.runtime/desktop-bundle/dotnet');
  await symlink(profile, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(clearGenerated(root, linked), /链接跳转/);
  assert.equal(await readFile(join(profile, 'keep.json'), 'utf8'), '{"fixture":true}');
});
