import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { configureNetwork } from './network.mjs';
configureNetwork();
const install = spawn(process.execPath, ['node_modules/electron/install.js'], { windowsHide: true, stdio: 'inherit' });
const code = await new Promise((resolve, reject) => { install.once('exit', resolve); install.once('error', reject); });
if (code !== 0) process.exitCode = code || 1;
else {
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(resolve('node_modules/electron/dist/electron.exe'), ['.'], { env: environment, windowsHide: true, stdio: 'inherit' });
  child.once('exit', code => { process.exitCode = code || 0; });
  child.once('error', () => { console.error('无法打开 Electron，请检查桌面运行库。'); process.exitCode = 1; });
}
