import type { Locator, Page } from '@playwright/test';

export class CheckoutPage {
  readonly total: Locator;
  readonly status: Locator;
  readonly couponField: Locator;

  constructor(private readonly page: Page) {
    this.total = page.getByLabel('Total', { exact: true });
    this.status = page.getByRole('status', { name: 'Coupon message' });
    this.couponField = page.getByLabel('Coupon code');
  }

  async open() {
    await this.page.goto('/checkout');
  }

  async applyCoupon(code: string) {
    await this.couponField.fill(code);
    await this.page.getByRole('button', { name: 'Apply coupon' }).click();
  }
}
