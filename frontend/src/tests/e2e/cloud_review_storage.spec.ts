import { expect, test } from '@playwright/test';

for (const [efficiency, expected] of [[1, 75], [.8, 57.75]]) {
  test(`cloud review: storage native version keeps editable SOC equations and independently yields ${expected}`, async ({ page, request }, info) => {
    const source = await (await request.get('/api/models/MODEL-POWER-STORAGE-DISPATCH')).json();
    // Reconstructed synthetic known-answer fixture; original report raw inputs
    // were not supplied. Initial energy 12.75 MWh; charge <= 2.5 MW at 0.5;
    // sell at 5. Two trailing zero-price periods cannot increase profit.
    // Profit = 5*eta*(12.75+2.5*eta)-0.5*2.5.
    const parameters = { ...source.parameters, horizon: 4, delta_t: 1, electricity_price: [.5, 5, 0, 0],
      storage_capacity: { B1: 20 }, soc_min: { B1: 0 }, charge_power_max: { B1: 2.5 }, discharge_power_max: { B1: 20 },
      initial_soc: { B1: 12.75 }, charge_efficiency: { B1: efficiency }, discharge_efficiency: { B1: efficiency } };
    expect(5 * efficiency * (12.75 + 2.5 * efficiency) - .5 * 2.5).toBeCloseTo(expected, 6);
    await page.goto('/models/create?mode=version&source=MODEL-POWER-STORAGE-DISPATCH');
    await page.getByRole('button', { name: /1 基础信息/ }).click();
    await page.locator('[data-field-code="name"] input').fill(`合成储能效率 ${efficiency} ${Date.now()}`);
    await page.getByRole('button', { name: /4 运行参数/ }).click();
    await page.getByText('高级调试：JSON 导入 / 运行参数结构预览', { exact: true }).click();
    await page.getByLabel('运行参数 JSON', { exact: true }).fill(JSON.stringify(parameters));
    await page.getByRole('button', { name: '导入并校验', exact: true }).click();
    await page.getByRole('button', { name: /5 校验发布/ }).click();
    const submitted = page.waitForResponse(response => response.url().endsWith('/test-jobs') && response.request().method() === 'POST');
    await page.getByTestId('model-test-run-button').click();
    const response = await submitted; expect(response.ok(), await response.text()).toBeTruthy();
    const task = await response.json();
    await expect(page.getByRole('button', { name: '发布模型', exact: true })).toBeEnabled();
    const asset = await (await request.get(`/api/models/${task.model_id}`)).json();
    const soc = asset.model_draft.formulas.filter((row: Record<string, any>) => row.dsl_formula?.includes('storage_soc') && row.dsl_formula.includes('=='));
    expect(soc).toHaveLength(2);
    for (const equation of soc) expect(equation.dsl_formula).toContain('==');
    const result = await (await request.get(`/api/tasks/${task.id}/result`)).json();
    expect(result.objective_value).toBeCloseTo(expected, 6);
    let previous = 12.75;
    for (let t = 0; t < 4; t += 1) {
      const ch = result.variable_values.storage_charge[`storage_charge[B1,${t}]`];
      const dis = result.variable_values.storage_discharge[`storage_discharge[B1,${t}]`];
      const energy = result.variable_values.storage_soc[`storage_soc[B1,${t}]`];
      expect(energy).toBeCloseTo(previous + ch * efficiency - dis / efficiency, 6);
      expect(ch * dis).toBeCloseTo(0, 6);
      expect(energy).toBeGreaterThanOrEqual(-1e-6); expect(energy).toBeLessThanOrEqual(20.000001);
      previous = energy;
    }
    await page.getByRole('button', { name: '发布模型', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/models/${task.model_id}$`));
    await info.attach('storage-physical-known-answer', { body: JSON.stringify({ synthetic: true, original_raw_fixture_available: false, model_id: task.model_id, task_id: task.id, expected, parameters }), contentType: 'application/json' });
  });
}
