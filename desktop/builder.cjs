module.exports = {
  appId: 'com.betweenly.desktop',
  productName: 'Betweenly',
  artifactName: 'Betweenly-Setup-${version}-${arch}.${ext}',
  directories: { output: 'release', buildResources: 'desktop/assets' },
  files: ['desktop/*.mjs', 'desktop/startup.html', 'frontend/dist/**/*', 'package.json'],
  extraResources: [{ from: '.runtime/desktop-bundle', to: 'backend', filter: ['**/*', '!**/*.pdb', '!**/__pycache__/**'] }],
  asar: true,
  npmRebuild: false,
  win: { target: ['nsis'], icon: 'frontend/public/brand/betweenly-icon.png' },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Betweenly',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    installerLanguages: ['zh_CN', 'en_US']
  }
};
