import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { configureNetwork } from './network.mjs';
import { clearGenerated, prepareDotnet } from './runtime-bundle.mjs';

configureNetwork();

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const bundle = join(root, '.runtime', 'desktop-bundle');
const downloads = join(root, '.runtime', 'desktop-downloads');
const pythonVersion = '3.13.17';
const pythonHash = '9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38';
const environment = { ...process.env, APPDATA: join(root, '.runtime', 'build-appdata'), DOTNET_CLI_HOME: join(root, '.runtime', 'dotnet'), DOTNET_CLI_TELEMETRY_OPTOUT: '1', NUGET_PACKAGES: join(root, '.runtime', 'nuget-packages') };
function run(executable, arguments_, cwd = root) {
  return new Promise((yes, no) => {
    const process = spawn(executable, arguments_, { cwd, env: environment, windowsHide: true, stdio: 'inherit' });
    process.once('error', no); process.once('exit', code => code === 0 ? yes() : no(new Error('构建步骤失败，退出码 ' + code)));
  });
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('第一版桌面构建面向 Windows x64。');
  await Promise.all([mkdir(bundle, { recursive: true }), mkdir(downloads, { recursive: true })]);
  await run(process.execPath, [join(root, 'frontend/node_modules/typescript/bin/tsc'), '--noEmit'], join(root, 'frontend'));
  await run(process.execPath, [join(root, 'frontend/node_modules/vite/bin/vite.js'), 'build'], join(root, 'frontend'));
  const zip = join(downloads, `python-${pythonVersion}-embed-amd64.zip`);
  if (!existsSync(zip)) {
    console.log('Downloading official embedded Python ' + pythonVersion);
    const response = await fetch(`https://www.python.org/ftp/python/${pythonVersion}/python-${pythonVersion}-embed-amd64.zip`, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('Python 下载失败：' + response.status);
    await writeFile(zip, new Uint8Array(await response.arrayBuffer()));
  }
  if (createHash('sha256').update(await readFile(zip)).digest('hex') !== pythonHash) throw new Error('Python 下载校验失败，请移除缓存后重试。');
  await mkdir(join(bundle, 'python'), { recursive: true });
  // Fixed workspace paths are passed through env, not interpolated as shell code.
  environment.BETWEENLY_PYTHON_ZIP = zip;
  environment.BETWEENLY_PYTHON_DEST = join(bundle, 'python');
  await run(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:BETWEENLY_PYTHON_ZIP -DestinationPath $env:BETWEENLY_PYTHON_DEST -Force']);
  await writeFile(join(bundle, 'python/python313._pth'), 'python313.zip\n.\n../analysis\n');
  await mkdir(join(bundle, 'analysis'), { recursive: true });
  for (const file of ['server.py', 'jev.py', 'vision.py', 'validation.py', 'style_learning.py', 'credentials.py', 'system-prompt.txt']) await cp(join(root, 'Backend/AnalysisService', file), join(bundle, 'analysis', file));
  await mkdir(join(bundle, 'contracts'), { recursive: true });
  await cp(join(root, 'Backend/contracts/analysis-output.schema.json'), join(bundle, 'contracts/analysis-output.schema.json'));
  await cp(join(root, 'desktop/runtime-host.py'), join(bundle, 'runtime-host.py'));
  const response = await fetch('https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json', { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('.NET 版本信息下载失败');
  const dotnet = await prepareDotnet({ root, bundle, downloads, metadata: await response.json(), run, environment });
  const runtimeVersion = dotnet.version;
  if (!process.argv.includes('--skip-publish')) {
    const published = join(root, '.runtime/desktop-services-publish');
    await clearGenerated(root, published);
    await mkdir(published, { recursive: true });
    const projects = [['Backend/ExpressionStyleService/ExpressionStyleService.csproj', 'ExpressionStyleService'], ['Backend/ContactContextService/ContactContextService.csproj', 'ContactContextService'], ['Backend/AdviceService/AdviceService.csproj', 'AdviceService'], ['Backend/WeChatAssistant/WeChatAssistant.csproj', 'WeChatAssistant'], ['Gateway/Gateway.csproj', 'Gateway']];
    for (const [project, name] of projects) {
      console.log('Publishing ' + name + ' for shared private .NET ' + runtimeVersion);
      await run('dotnet', ['publish', join(root, project), '-c', 'Release', '-r', 'win-x64', '--self-contained', 'false', '--nologo', '-p:RuntimeFrameworkVersion=' + runtimeVersion, '-p:NuGetAudit=false', '-p:DebugType=None', '-p:RestoreConfigFile=' + join(root, 'desktop/scripts/NuGet.Config'), '-o', join(published, name)]);
    }
    await clearGenerated(root, join(bundle, 'services'));
    await rename(published, join(bundle, 'services'));
  } else if (existsSync(join(bundle, 'services/Gateway/coreclr.dll'))) {
    throw new Error('旧版独立运行库布局需要先执行一次完整的 desktop:prepare。');
  }
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify({ platform: 'win-x64', layout: 'private-dotnet-v1', python: pythonVersion, pythonSha256: pythonHash, dotnet: runtimeVersion, dotnetComponents: dotnet.components, createdAt: new Date().toISOString() }, null, 2));
  console.log('Desktop resources prepared: ' + bundle);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
