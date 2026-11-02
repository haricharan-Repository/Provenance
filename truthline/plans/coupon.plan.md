# Coupon Test Plan

| ID | Title | REQ | Risk | Layer | Technique | Preconditions | Steps | Expected (from requirement) | Data | Tags |
|---|---|---|---|---|---|---|---|---|---|---|
| S-1 | Reject expired coupon | REQ-142 | High | UI | Boundary value | Signed in | Apply coupon | "This coupon has expired", total unchanged | Expires yesterday | @negative |
| S-2 | Accept on expiry date | REQ-142 | High | UI | Boundary value | Signed in | Apply coupon | Discount is applied | Expires today | @boundary |
| S-3 | Coupon service failure | REQ-142 | High | UI | Equivalence partitioning | Signed in, API stubbed to 500 | Apply coupon | "Coupons are unavailable. Try again.", total unchanged | Valid coupon | @negative |
| S-4 | Expired contract | REQ-142 | High | API | Equivalence partitioning | Authenticated | POST apply | COUPON_EXPIRED | Expires yesterday | @negative |
| S-5 | Expiry date contract | REQ-142 | High | API | Boundary value | Authenticated | POST apply | Discount is applied | Expires today | @boundary |
| S-6 | Code length limit | REQ-142 | High | API | Boundary value | Authenticated | POST apply | COUPON_TOO_LONG | 21 characters | @boundary |
| S-7 | Valid discount | REQ-143 | Medium | UI | Equivalence partitioning | Signed in | Apply coupon | Total $75.00, "Coupon applied" | 25% coupon | @smoke |
| S-8 | Unknown code | REQ-143 | Medium | UI | Equivalence partitioning | Signed in | Apply coupon | "Coupon not found", total unchanged | Unknown code | @negative |
| S-9 | Discount contract | REQ-143 | Medium | API | Equivalence partitioning | Authenticated | POST apply | Discounted total | 25% coupon | |
| S-10 | Empty code | REQ-143 | Medium | API | Boundary value | Authenticated | POST apply | COUPON_REQUIRED | Blank code | @negative |
| S-11 | Anonymous request | REQ-144 | Low | API | State transition | Anonymous | POST apply | 401 UNAUTHENTICATED | None | @smoke |

## Traceability

| REQ | Scenarios |
|---|---|
| REQ-142 | S-1, S-2, S-3, S-4, S-5, S-6 |
| REQ-143 | S-7, S-8, S-9, S-10 |
| REQ-144 | S-11 |

Requirements with zero scenarios: none.
