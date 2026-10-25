import { readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

// Only disposable build directories are accepted; never user profiles or MVP data.
export async function clearGenerated(root, target) {
  const allowed = ['.runtime/desktop-bundle/services', '.runtime/desktop-bundle/dotnet', '.runtime/desktop-services-publish'].map(path => resolve(root, path));
  const absolute = resolve(target);
  if (!allowed.includes(absolute)) throw new Error('拒绝清理非构建目录。');
  if (!existsSync(absolute)) return;
  const actual = await realpath(absolute), base = await realpath(join(root, '.runtime'));
  const expected = resolve(await realpath(root), relative(resolve(root), absolute));
  const canonical = path => process.platform === 'win32' ? path.toLowerCase() : path;
  if (canonical(actual) !== canonical(expected)) throw new Error('构建目录存在链接跳转，拒绝清理。');
  const inside = relative(base, actual);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('构建目录解析到了工作区以外。');
  await rm(actual, { recursive: true, force: true });
}

export async function prepareDotnet({ root, bundle, downloads, metadata, run, environment }) {
  const version = metadata['latest-runtime'];
  if (!/^8\.0\.\d+$/.test(version)) throw new Error('.NET 版本信息无效');
  const release = metadata.releases.find(item => item.runtime?.version === version);
  const components = ['runtime', 'aspnetcore-runtime', 'windowsdesktop'].map(name => {
    const file = release?.[name]?.files?.find(item => item.rid === 'win-x64' && item.url.endsWith('.zip'));
    if (!file || !/^[a-f0-9]{128}$/i.test(file.hash)) throw new Error('.NET 官方运行库信息不完整：' + name);
    const url = new URL(file.url);
    if (url.protocol !== 'https:' || !['builds.dotnet.microsoft.com', 'download.visualstudio.microsoft.com'].includes(url.hostname)) throw new Error('.NET 运行库下载地址无效。');
    return { ...file, archive: join(downloads, `${name}-${version}-win-x64.zip`) };
  });
  await Promise.all(components.map(async component => {
    if (!existsSync(component.archive)) {
      console.log('Downloading private .NET component: ' + component.name);
      const response = await fetch(component.url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error('.NET 运行库下载失败：' + response.status);
      await writeFile(component.archive, new Uint8Array(await response.arrayBuffer()));
    }
    const hash = createHash('sha512').update(await readFile(component.archive)).digest('hex');
    if (hash !== component.hash.toLowerCase()) throw new Error('.NET 运行库校验失败：' + component.name);
  }));
  const dotnet = join(bundle, 'dotnet');
  await clearGenerated(root, dotnet);
  await mkdir(dotnet, { recursive: true });
  for (const component of components) {
    environment.BETWEENLY_RUNTIME_ZIP = component.archive;
    environment.BETWEENLY_RUNTIME_DEST = dotnet;
    await run(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:BETWEENLY_RUNTIME_ZIP -DestinationPath $env:BETWEENLY_RUNTIME_DEST -Force']);
  }
  for (const framework of ['Microsoft.NETCore.App', 'Microsoft.AspNetCore.App', 'Microsoft.WindowsDesktop.App']) {
    if (!existsSync(join(dotnet, 'shared', framework, version))) throw new Error('.NET 运行库不完整：' + framework);
  }
  if (!existsSync(join(dotnet, 'dotnet.exe'))) throw new Error('.NET 本地主机缺失。');
  return { version, components: components.map(({ name, hash }) => ({ name, sha512: hash })) };
}
