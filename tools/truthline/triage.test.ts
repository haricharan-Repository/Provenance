import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, type FailureClass } from './triage';

const cases: [FailureClass, string][] = [
  ['LOCATOR_DRIFT', "TimeoutError: locator.fill: Timeout 10000ms exceeded.\n- waiting for getByLabel('X')"],
  ['LOCATOR_DRIFT', "Error: expect(locator).toBeVisible() failed\nExpected: visible\nReceived: <element(s) not found>"],
  ['LOCATOR_DRIFT', "Error: strict mode violation: getByRole('status') resolved to 3 elements"],
  ['ENVIRONMENT', 'Error: apiRequestContext.post: connect ECONNREFUSED 127.0.0.1:4173'],
  ['ENVIRONMENT', 'Error: page.goto: net::ERR_CONNECTION_REFUSED'],
  ['TEST_DATA', 'Error: Coupon factory failed: 500'],
  ['TIMING', 'Test timeout of 30000ms exceeded.'],
  // Regression: the call log names the locator, but the element was found and the value is wrong.
  // Calling this drift would let a real defect be healed away.
  ['PRODUCT_DEFECT', `Expected: "$90.00"\nReceived: "$100.00"\n- waiting for getByRole('status')`],
];

for (const [expected, error] of cases) {
  test(`${expected}: ${error.split('\n')[0]}`, () => assert.equal(classify(error).cls, expected));
}
