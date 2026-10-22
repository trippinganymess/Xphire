// Compatibility entry point: delegates to the asserting, fully mocked test suite.
// Never targets a manually started server or performs real signup/dispatch.
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'], {
  cwd: __dirname,
  stdio: 'inherit',
});
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
