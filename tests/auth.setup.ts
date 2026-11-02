import { test as setup, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

const shard = process.env.TRUTHLINE_SHARD ?? '0';

setup('authenticate', async ({ page }) => {
  const { TEST_USER_EMAIL, TEST_USER_PASSWORD } = process.env;
  if (!TEST_USER_EMAIL || !TEST_USER_PASSWORD) {
    throw new Error('TEST_USER_EMAIL and TEST_USER_PASSWORD are required (see .env.example).');
  }
  const login = new LoginPage(page);
  await login.open();
  await login.signIn(TEST_USER_EMAIL, TEST_USER_PASSWORD);
  await expect(page).toHaveURL(/\/checkout/);
  await page.context().storageState({ path: `playwright/.auth/user-${shard}.json` });
});
