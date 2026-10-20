/// <reference types="node" />
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const source = process.env.OPTIFORGE_LIFECYCLE_EVIDENCE;
// This destructive acceptance is registered only after the explicit native
// observer has produced its fixture. Default suites never manufacture history.
if (source) {
test('cloud review: retry the naturally terminated native attempt through UI without replacing frozen inputs', async ({ page, request }) => {
  const evidence = JSON.parse(await readFile(source!, 'utf-8'));
  const origin = 'http://127.0.0.1:18031';
  const before = await (await request.get(`${origin}/api/tasks/${evidence.task_id}`)).json();
  expect(before.status).toBe(evidence.phase === 'cancel' ? 'CANCELLED' : 'INTERRUPTED');
  await page.goto(`${origin}/tasks?task=${before.id}`);
  await page.getByRole('button', { name: '重试任务', exact: true }).click();
  await expect.poll(async () => (await (await request.get(`${origin}/api/tasks/${before.id}`)).json()).status, { timeout: 120_000 }).toBe('SUCCESS');
  const after = await (await request.get(`${origin}/api/tasks/${before.id}`)).json();
  expect(after.id).toBe(before.id);
  expect(after.attempt_id).not.toBe(before.attempt_id);
  expect(before.runtime_parameters.horizon).toBe(4096);
  expect(before.runtime_parameters.k).toBe(2);
  expect(after.runtime_parameters).toEqual(before.runtime_parameters);
  expect(after.attempt_history.at(-1).request.parameters.horizon).toBe(4096);
  expect(after.attempt_history.at(-1).attempt_id).toBe(before.attempt_id);
  expect(after.attempt_history.at(-1).status).toBe(before.status);
  const result = await (await request.get(`${origin}/api/tasks/${before.id}/result`)).json();
  expect(result.objective_value).toBeCloseTo(102400, 3);
  expect(result.solver_name).toBe('Ipopt');
  for (let t = 0; t < 4096; t += 1) {
    const q = result.variable_values.flow[`flow[${t}]`], h = result.variable_values.head[`head[${t}]`], p = result.variable_values.power[`power[${t}]`];
    expect(q).toBeGreaterThanOrEqual(.999); expect(q).toBeLessThanOrEqual(5.001);
    expect(h).toBeGreaterThanOrEqual(.999); expect(h).toBeLessThanOrEqual(10.001);
    expect(p).toBeLessThanOrEqual(25.001); expect(p).toBeGreaterThanOrEqual(-.001);
    expect(Math.abs(p - 2 * q * h)).toBeLessThan(.001);
  }
  await page.getByRole('tab', { name: '输入参数', exact: true }).click();
  await expect(page.getByText('4096', { exact: true }).first()).toBeVisible();
  evidence.ui_retry = { before, after, objective: result.objective_value, solver: result.solver_name,
    individual_physical_checks: 4096 * 7, unchanged_frozen_inputs: true };
  await writeFile(source!, JSON.stringify(evidence, null, 2));
});
}
