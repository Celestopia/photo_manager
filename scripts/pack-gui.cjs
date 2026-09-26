const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const { WinPackager } = require('app-builder-lib/out/winPackager');

// electron-builder's directory target otherwise hard-codes "win-unpacked".
class GuiPackager extends WinPackager {
  computeAppOutDir(outDir) { return path.resolve(outDir, 'gui-win-x64-unpacked'); }
}
build({ targets: Platform.WINDOWS.createTarget('dir', Arch.x64),
  platformPackagerFactory: packager => new GuiPackager(packager) })
  .catch(error => { console.error(error); process.exitCode = 1; });
