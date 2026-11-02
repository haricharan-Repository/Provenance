# Clarification Ledger

Status is one of OPEN, ANSWERED or ASSUMED. An OPEN item on a high-risk requirement blocks test design.

| ID | REQ | Question | Status | Answer |
|---|---|---|---|---|
| C-1 | REQ-142 | Which time zone decides the expiry date? | ASSUMED | UTC, as implemented by the demo app. |
| C-2 | REQ-142 | Is a coupon valid on its expiry date? | ANSWERED | Yes, through the end of that day (AC2). |
