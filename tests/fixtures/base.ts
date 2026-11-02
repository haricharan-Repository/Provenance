import { test as base, expect } from '@playwright/test';
import { CheckoutPage } from '../pages/CheckoutPage';

export type Mutation =
  | { kind: 'api-tamper'; url: string; status?: number; body?: unknown }
  | { kind: 'element-remove'; selector: string };

interface Fixtures {
  checkout: CheckoutPage;
  // Set only by `tl falsify` through test.use() in generated mutants.
  mutation: Mutation | undefined;
}

export const test = base.extend<Fixtures>({
  mutation: [undefined, { option: true }],

  page: async ({ page, mutation }, use) => {
    if (mutation?.kind === 'api-tamper') {
      const { url, status = 200, body = {} } = mutation;
      await page.route(url, (route) => route.fulfill({ status, json: body }));
    }
    if (mutation?.kind === 'element-remove') {
      await page.addInitScript((selector) => {
        const sweep = () => document.querySelectorAll(selector).forEach((el) => el.remove());
        new MutationObserver(sweep).observe(document, { childList: true, subtree: true });
      }, mutation.selector);
    }
    await use(page);
  },

  checkout: async ({ page }, use) => {
    const checkout = new CheckoutPage(page);
    await checkout.open();
    await use(checkout);
  },
});

export { expect };
