# Photo Manager CLI

`ptmgr.exe` provides terminal access to local libraries. `ptmgr-gui.exe` is the desktop application. Both use the same schemas, query rules, registry services, backups, and persistence operations.

Keep the entire `release/cli-win-x64-unpacked/` folder together. It contains the executable, runtime dependencies, FFmpeg/FFprobe, and this documentation. It runs independently of the GUI and does not require installed Node.js. Add this folder to PATH or use the executable's full path.

Close the target library in the GUI before running any CLI command, including reads. Every command except help/version requires an explicit `--library` folder. The CLI never uses the GUI's last-opened library and does not open an Electron profile.

```powershell
ptmgr --help
ptmgr --version
ptmgr library info --library "D:\Media\Test Library"
ptmgr media list --library "D:\Media\Test Library" --privacy 1 --format json
ptmgr registry tag list --library "D:\Media\Test Library" --format json
ptmgr maintenance update --library "D:\Media\Test Library"
```

All privacy levels are included by default. Use `--privacy 1` to reproduce the GUI default. Edits target media UUIDs; technical fields and original files are not editable. Permanent media deletion, chat, and GUI launch commands are outside this CLI release.

- [Command reference](commands.md): filters, editing, registries, and maintenance.
- [Automation](automation.md): output, exit codes, confirmation, cancellation, and recovery.

## Development and builds

Use `npm run cli -- <command> --library <folder>` from the repository. The same arguments apply to the executable. Legacy standalone maintenance scripts have been replaced by these commands.

`npm run pack:cli` creates `release/cli-win-x64-unpacked/`; `npm run pack:gui` creates `release/gui-win-x64-unpacked/`. `npm run pack:win` builds both, and `npm run dist:win` tests before building both. CLI packaging requires Windows x64 Node.js **24.19.0** and uses its single-executable application support. Application version comes from `package.json`.
