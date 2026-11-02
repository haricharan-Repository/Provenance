import { test, expect } from '../fixtures/base';
import { createCoupon } from '../data/coupons';

const APPLY = '/api/coupons/apply';

test.describe('Coupon API', () => {
  test('REQ-142 returns COUPON_EXPIRED for an expired coupon @REQ-142 @risk-high @api @negative', async ({
    request,
  }) => {
    test.info().annotations.push({ type: 'requirement', description: 'REQ-142' });
    const coupon = await createCoupon(request, { expiresInDays: -1 });

    const res = await test.step('Send the request', () => request.post(APPLY, { data: { code: coupon.code } }));

    await test.step('The response matches the contract', async () => {
      expect(res.status()).toBe(422);
      expect(await res.json()).toEqual({ error: 'COUPON_EXPIRED' });
    });
  });

  test('REQ-142 accepts a coupon expiring today @REQ-142 @risk-high @api @boundary', async ({ request }) => {
    test.info().annotations.push({ type: 'requirement', description: 'REQ-142' });
    const coupon = await createCoupon(request, { expiresInDays: 0, percentOff: 10 });

    const res = await test.step('Send the request', () => request.post(APPLY, { data: { code: coupon.code } }));

    await test.step('The response matches the contract', async () => {
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ totalCents: 9000 });
    });
  });

  test('REQ-142 caps coupon codes at 20 characters @REQ-142 @risk-high @api @boundary', async ({ request }) => {
    test.info().annotations.push({ type: 'requirement', description: 'REQ-142' });

    const res = await test.step('Send the request', () => request.post(APPLY, { data: { code: 'X'.repeat(21) } }));

    await test.step('The response matches the contract', async () => {
      expect(res.status()).toBe(422);
      expect(await res.json()).toEqual({ error: 'COUPON_TOO_LONG' });
    });
  });

  test('REQ-143 returns the discounted total @REQ-143 @risk-medium @api', async ({ request }) => {
    test.info().annotations.push({ type: 'requirement', description: 'REQ-143' });
    const coupon = await createCoupon(request, { percentOff: 25 });

    const res = await test.step('Send the request', () => request.post(APPLY, { data: { code: coupon.code } }));

    await test.step('The response matches the contract', async () => {
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ totalCents: 7500 });
    });
  });

  test('REQ-143 rejects an empty coupon code @REQ-143 @risk-medium @api @negative', async ({ request }) => {
    test.info().annotations.push({ type: 'requirement', description: 'REQ-143' });

    const res = await test.step('Send the request', () => request.post(APPLY, { data: { code: '   ' } }));

    await test.step('The response matches the contract', async () => {
      expect(res.status()).toBe(422);
      expect(await res.json()).toEqual({ error: 'COUPON_REQUIRED' });
    });
  });

  test('REQ-144 refuses anonymous coupon requests @REQ-144 @risk-low @api @smoke', async ({ playwright, baseURL }) => {
    test.info().annotations.push({ type: 'requirement', description: 'REQ-144' });
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });

    const res = await test.step('Send the request', () => anonymous.post(APPLY, { data: { code: 'ANY' } }));

    await test.step('The response matches the contract', async () => {
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ error: 'UNAUTHENTICATED' });
    });
    await anonymous.dispose();
  });
});
