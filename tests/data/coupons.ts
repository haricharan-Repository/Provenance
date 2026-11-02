import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';

const isoDate = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

export interface Coupon {
  code: string;
  percentOff: number;
  expiresOn: string;
}

// Each coupon gets a unique code so parallel tests never share state.
export async function createCoupon(
  request: APIRequestContext,
  { percentOff = 10, expiresInDays = 30 }: { percentOff?: number; expiresInDays?: number } = {},
): Promise<Coupon> {
  const coupon = {
    code: `TL${randomUUID().slice(0, 8)}`,
    percentOff,
    expiresOn: isoDate(expiresInDays),
  };
  const res = await request.post('/api/test/coupons', { data: coupon });
  if (!res.ok()) throw new Error(`Coupon factory failed: ${res.status()}`);
  return coupon;
}
