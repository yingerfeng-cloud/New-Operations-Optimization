// Run under the actual CI Node runtime. Preserve detail even when audit fails.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const frontend = path.resolve(import.meta.dirname, '../frontend');
const output = path.resolve(process.argv[2] || path.join(frontend, '../reports/dependency-audit-ci'));
fs.mkdirSync(output, { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = spawnSync(npm, ['audit', '--json', '--package-lock-only'], { cwd: frontend, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
fs.writeFileSync(path.join(output, 'audit.json'), run.stdout || '{}');
const npmVersion = spawnSync(npm, ['--version'], { encoding: 'utf8' });
const metadata = { observed_at: new Date().toISOString(), node: process.version, npm: npmVersion.stdout?.trim() || 'unknown',
  command: 'npm audit --json --package-lock-only', exit_status: run.status,
  lock_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(frontend, 'package-lock.json'))).digest('hex'), stderr: run.stderr };
fs.writeFileSync(path.join(output, 'metadata.json'), JSON.stringify(metadata, null, 2));
let result;
try { result = JSON.parse(run.stdout); } catch { throw new Error('npm audit did not return valid JSON; evidence retained'); }
if (run.error || result.error || !result.metadata?.vulnerabilities) throw new Error('npm audit unavailable; not a passing scan');
console.log(JSON.stringify({ ...metadata, vulnerabilities: result.metadata.vulnerabilities }, null, 2));
if (result.metadata.vulnerabilities.high || result.metadata.vulnerabilities.critical) process.exitCode = 1;
