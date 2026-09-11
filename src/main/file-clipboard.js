const { spawn } = require('node:child_process');
const path = require('node:path');

// Windows Forms publishes CF_HDROP plus a copy effect, as Explorer does.
// The path travels over stdin, never through executable PowerShell code.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
  Add-Type -AssemblyName System.Windows.Forms
  $filePath = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $files = New-Object System.Collections.Specialized.StringCollection
  [void]$files.Add($filePath)
  $data = New-Object System.Windows.Forms.DataObject
  $data.SetFileDropList($files)
  $effect = New-Object System.IO.MemoryStream
  $effect.Write([byte[]](1,0,0,0), 0, 4)
  $effect.Position = 0
  $data.SetData('Preferred DropEffect', $effect)
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 5, 100)
  $effect.Dispose()
} catch { exit 1 }
`;
function copyFileToClipboard(filePath) {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const timeout = setTimeout(() => child.kill(), 15000);
    child.on('error', () => { clearTimeout(timeout); reject(new Error('Unable to start Windows file clipboard support.')); });
    child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('Unable to copy the file. The Windows clipboard may be busy; please try again.')); });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(filePath));
  });
}
module.exports = { copyFileToClipboard };
