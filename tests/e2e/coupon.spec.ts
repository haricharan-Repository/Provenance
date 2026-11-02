import { test, expect } from '../fixtures/base';
import { createCoupon } from '../data/coupons';

test.describe('Checkout coupons', () => {
  test('REQ-142 rejects coupon after expiry @REQ-142 @risk-high @ui @negative', async ({
    checkout,
    request,
  }) => {
    test.info().annotations.push({ type: 'requirement', description: 'REQ-142' });
    const coupon = await createCoupon(request, { expiresInDays: -1 });

    await test.step('Apply a coupon that expired yesterday', async () => {
      await checkout.applyCoupon(coupon.code);
    });
    await test.step('The coupon is refused and the total is unchanged', async () => {
      await expect(checkout.status).toHaveText('This coupon has expired');
      await expect(checkout.total).toHaveText('$100.00');
    });
  });

  test('REQ-142 accepts coupon on its expiry date @REQ-142 @risk-high @ui @boundary', async ({
    checkout,
    request,
  }) => {
    test.info().annotations.push({ type: 'requirement', description: 'REQ-142' });
    const coupon = await createCoupon(request, { expiresInDays: 0 });

    await test.step('Apply a coupon that expires today', async () => {
      await checkout.applyCoupon(coupon.code);
    });
    await test.step('The discount is applied', async () => {
      await expect(checkout.status).toHaveText('Coupon applied');
      await expect(checkout.total).toHaveText('$90.00');
    });
  });

  test('REQ-142 keeps the total when the coupon service fails @REQ-142 @risk-high @ui @negative @stubbed', async ({
    checkout,
    page,
    request,
  }) => {
    test.info().annotations.push({ type: 'requirement', description: 'REQ-142' });
    const coupon = await createCoupon(request);

    await test.step('The coupon service returns a 500', async () => {
      await page.route('**/api/coupons/apply', (route) =>
        route.fulfill({ status: 500, body: 'upstream failure' }),
      );
    });
    await test.step('Apply a valid coupon', async () => {
      await checkout.applyCoupon(coupon.code);
    });
    await test.step('An error is shown and the total is unchanged', async () => {
      await expect(checkout.status).toHaveText('Coupons are unavailable. Try again.');
      await expect(checkout.total).toHaveText('$100.00');
    });
  });

  test('REQ-143 applies a valid coupon to the total @REQ-143 @risk-medium @ui @smoke', async ({
    checkout,
    request,
  }) => {
    test.info().annotations.push({ type: 'requirement', description: 'REQ-143' });
    const coupon = await createCoupon(request, { percentOff: 25 });

    await test.step('Apply a 25% coupon', async () => {
      await checkout.applyCoupon(coupon.code);
    });
    await test.step('The total reflects the discount', async () => {
      await expect(checkout.status).toHaveText('Coupon applied');
      await expect(checkout.total).toHaveText('$75.00');
    });
  });

  test('REQ-143 explains an unknown coupon @REQ-143 @risk-medium @ui @negative', async ({ checkout }) => {
    test.info().annotations.push({ type: 'requirement', description: 'REQ-143' });

    await test.step('Apply a code that does not exist', async () => {
      await checkout.applyCoupon('NOPE');
    });
    await test.step('The coupon is refused and the total is unchanged', async () => {
      await expect(checkout.status).toHaveText('Coupon not found');
      await expect(checkout.total).toHaveText('$100.00');
    });
  });
});
