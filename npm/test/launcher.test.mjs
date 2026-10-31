import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const launcher = fileURLToPath(new URL('../bin/reader.mjs', import.meta.url));

test('help works before platform checks and creates no runtime or data', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'reader-cli-'));
  try {
    const result = spawnSync(process.execPath, [launcher, '--help'], {
      env: {...process.env, DEEPSEEK_READER_HOME: home}, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /start\|setup\|status\|stop/);
    assert.match(result.stdout, /macOS 14\+, Node.js 20\+/);
    assert.deepEqual(readdirSync(home), []);
  } finally {
    rmSync(home, {recursive: true, force: true});
  }
});

test('status on a fresh supported Mac does not provision the runtime', {
  skip: process.platform !== 'darwin',
}, () => {
  const home = mkdtempSync(path.join(tmpdir(), 'reader-status-'));
  try {
    const result = spawnSync(process.execPath, [launcher, 'status'], {
      env: {...process.env, DEEPSEEK_READER_HOME: home}, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Not running/);
    assert.deepEqual(readdirSync(home), []);
  } finally {
    rmSync(home, {recursive: true, force: true});
  }
});
