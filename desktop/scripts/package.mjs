import { spawn } from 'node:child_process';
import { configureNetwork } from './network.mjs';
configureNetwork();
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
async function run(arguments_) {
  const child = spawn(process.execPath, arguments_, { windowsHide: true, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  if (code !== 0) throw new Error('桌面打包失败，退出码 ' + code);
}
try {
  await run(['node_modules/electron/install.js']);
  await run(['node_modules/electron-builder/out/cli/cli.js', '--config', 'desktop/builder.cjs', '--win', '--x64', '--publish', 'never', ...(process.argv.includes('--dir') ? ['--dir'] : [])]);
} catch (error) { console.error(error.message); process.exitCode = 1; }
