import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`responsive shell ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockApi(page);
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: '任务调度中心' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    if (viewport.width < 1024) {
      await expect(page.getByRole('complementary', { name: '主导航' })).toHaveCount(0);
      await page.getByRole('button', { name: '打开主导航' }).click();
      await expect(page.getByRole('complementary', { name: '主导航' })).toBeVisible();
      await expect(page.getByTitle('求解任务')).toBeVisible();
    } else {
      await expect(page.getByRole('complementary', { name: '主导航' })).toBeVisible();
      if (viewport.width < 1440) await expect(page.getByRole('button', { name: /侧栏/ })).toBeVisible();
      else await expect(page.getByText('安全生产运筹优化平台')).toBeVisible();
    }
    const brandCopy = page.locator('.brand-copy:visible');
    if (await brandCopy.count()) {
      await expect(brandCopy).toHaveCSS('white-space', 'nowrap');
      const brandFits = await brandCopy.evaluate(element => {
        const copy = element.getBoundingClientRect();
        const brand = element.closest('.brand')?.getBoundingClientRect();
        return Boolean(brand && copy.left >= brand.left && copy.right <= brand.right + 1 && element.scrollWidth <= element.clientWidth + 1);
      });
      expect(brandFits).toBe(true);
    }
    await page.screenshot({ path: `test-results/responsive-${viewport.width}x${viewport.height}.png`, fullPage: true });
  });
}
