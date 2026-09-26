const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inject } = require('postject');
const ResEdit = require('resedit');
const { version } = require('../package.json');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'release', 'cli-win-x64-unpacked');
const TEMP = path.join(ROOT, 'tmp', 'cli-package');
const NODE_VERSION = '24.19.0';

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64' || process.versions.node !== NODE_VERSION) {
    throw new Error(`CLI packaging requires Windows x64 Node.js ${NODE_VERSION}; current runtime is ${process.platform}/${process.arch}/${process.versions.node}`);
  }
  // Only these fixed generated directories can be replaced. Never take cleanup paths from argv.
  for (const directory of [OUTPUT, TEMP]) {
    if (path.relative(ROOT, directory).startsWith('..') || directory === ROOT) throw new Error('Unsafe build directory');
    if (sync.existsSync(directory) && sync.lstatSync(directory).isSymbolicLink()) throw new Error('Build directory cannot be a link');
    await fs.rm(directory, { recursive: true, force: true });
    await fs.mkdir(directory, { recursive: true });
  }
  const app = path.join(OUTPUT, 'resources', 'app');
  await fs.mkdir(app, { recursive: true });
  for (const folder of ['core', 'shared', 'cli']) await fs.cp(path.join(ROOT, 'src', folder), path.join(app, 'src', folder), { recursive: true });
  await fs.copyFile(path.join(ROOT, 'package.json'), path.join(app, 'package.json'));
  await fs.cp(path.join(ROOT, 'docs', 'cli'), path.join(OUTPUT, 'docs', 'cli'), { recursive: true });
  const visited = new Set();
  async function copyDependency(name, from, optional = false) {
    let directory = from, source;
    while (directory.startsWith(ROOT)) {
      const candidate = path.join(directory, 'node_modules', name);
      if (sync.existsSync(path.join(candidate, 'package.json'))) { source = candidate; break; }
      const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
    }
    if (!source) { if (optional) return; throw new Error(`Missing dependency: ${name}`); }
    if (visited.has(source)) return;
    visited.add(source);
    const manifest = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
    if ((manifest.os && !manifest.os.includes('win32')) || (manifest.cpu && !manifest.cpu.includes('x64'))) {
      if (optional) return; throw new Error(`Incompatible dependency: ${name}`);
    }
    await fs.cp(source, path.join(app, path.relative(ROOT, source)), { recursive: true });
    for (const dep of Object.keys(manifest.dependencies || {})) await copyDependency(dep, source);
    for (const dep of Object.keys(manifest.optionalDependencies || {})) await copyDependency(dep, source, true);
  }
  for (const name of ['sharp', 'exifr', 'geo-tz', 'js-yaml']) await copyDependency(name, ROOT);
  await fs.cp(path.join(ROOT, 'tools', 'ffmpeg'), path.join(OUTPUT, 'resources', 'tools', 'ffmpeg'), { recursive: true });
  const configFile = path.join(TEMP, 'sea.json'), blob = path.join(TEMP, 'sea.blob');
  await fs.writeFile(configFile, JSON.stringify({ main: path.join(__dirname, 'cli-bootstrap.cjs'), output: blob, disableExperimentalSEAWarning: true }));
  execFileSync(process.execPath, ['--experimental-sea-config', configFile], { stdio: 'inherit', cwd: ROOT });
  const executable = path.join(OUTPUT, 'ptmgr.exe');
  // Remove the source Node signature and publish our own version/icon resources
  // before SEA injection. Changing a signed Node binary invalidates its signature.
  const pe = ResEdit.NtExecutable.from(await fs.readFile(process.execPath), { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(pe);
  const info = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)[0];
  const numbers = [...version.split('.').map(Number), 0];
  info.setFileVersion(...numbers, 1033);
  info.setProductVersion(...numbers, 1033);
  info.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: 'Photo Manager CLI',
    ProductName: 'Photo Manager', CompanyName: 'Photo Manager', OriginalFilename: 'ptmgr.exe',
    InternalName: 'ptmgr', LegalCopyright: '' });
  info.outputToResourceEntries(resources.entries);
  const icon = ResEdit.Data.IconFile.from(await fs.readFile(path.join(ROOT, 'build', 'icon.ico')));
  for (const entry of resources.entries.filter(entry => entry.type === 14)) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, entry.id, entry.lang, icon.icons.map(item => item.data));
  }
  const directories = pe.newHeader.optionalHeaderDataDirectory;
  const relocationSize = directories.get(5).size;
  const resourceSize = pe.getSectionByEntry(2).info.virtualSize;
  resources.outputResource(pe, true, false);
  // Preserve Node's resource allocation: shrinking only the virtual size while
  // retaining raw padding makes the following relocation section overlap it.
  const section = pe.getSectionByEntry(2);
  pe.setSectionByEntry(2, { data: section.data, info: { ...section.info, virtualSize: resourceSize } });
  directories.set(5, { ...directories.get(5), size: relocationSize });
  await fs.writeFile(executable, Buffer.from(pe.generate()));
  await inject(executable, 'NODE_SEA_BLOB', await fs.readFile(blob), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
  await fs.copyFile(path.join(ROOT, 'build', 'licenses', `node-${NODE_VERSION}.txt`), path.join(OUTPUT, 'LICENSE.node.txt'));
  await fs.writeFile(path.join(OUTPUT, 'NOTICE.txt'), `Photo Manager CLI\nNode.js ${NODE_VERSION}: https://github.com/nodejs/node/blob/v${NODE_VERSION}/LICENSE\nDependency licenses are included under resources/app/node_modules. FFmpeg notices are under resources/tools/ffmpeg.\n`);
  execFileSync(executable, ['--version'], { cwd: TEMP, stdio: 'inherit' });
  console.log(`CLI package: ${OUTPUT}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
