import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

export default async function realGlobalSetup() {
  const runtimePath = process.env.RUNTIME_STORE_PATH;
  if (!runtimePath) throw new Error('RUNTIME_STORE_PATH is required for controlled Real E2E');
  const resolved = path.resolve(runtimePath);
  const workspace = path.resolve('..');
  const temporaryRoot = path.resolve(process.env.TEMP || process.env.TMP || workspace);
  if (!resolved.includes('test-results') && !resolved.startsWith(temporaryRoot)) {
    throw new Error(`Refusing to use a non-temporary Real E2E runtime store: ${resolved}`);
  }
  await mkdir(path.dirname(resolved), { recursive: true });
  await rm(resolved, { force: true });
}
