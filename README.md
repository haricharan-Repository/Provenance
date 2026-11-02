# Truthline

**Requirement → Risk → Test → Proof → Pipeline → Verdict**

Truthline is a test framework built on Playwright, TypeScript and Jenkins. It takes a requirement all the way to a release decision, and it refuses to call a test good until that test has been shown to fail when it should.

It has two parts:

- **The agent** does the judgment work: questioning requirements, designing tests and confirming failures.
- **The `tl` command-line tool** does the work that must not depend on judgment: risk scores, mutation runs, build status and the release verdict.

## Contents

1. [What you need](#1-what-you-need)
2. [Install](#2-install)
3. [Run the demo](#3-run-the-demo)
4. [See a failure on purpose](#4-see-a-failure-on-purpose)
5. [Point it at your own app](#5-point-it-at-your-own-app)
6. [Test a feature, step by step](#6-test-a-feature-step-by-step)
7. [Use the agent](#7-use-the-agent)
8. [Set up Jenkins](#8-set-up-jenkins)
9. [Audit a live website](#9-audit-a-live-website)
10. [Command reference](#10-command-reference)
11. [How falsification works](#11-how-falsification-works)
12. [How the verdict is decided](#12-how-the-verdict-is-decided)
13. [Project layout](#13-project-layout)
14. [Troubleshooting](#14-troubleshooting)

## 1. What you need

| Tool | Needed for | Check with |
|---|---|---|
| Node.js 24 (20.12 or later should also work) | Everything | `node -v` |
| npm | Installing packages | `npm -v` |
| Git | Smart test selection and heal checks | `git --version` |
| Docker and Jenkins | CI only | `docker info` |

This project has been run on Node 24.

## 2. Install

From the project folder:

```bash
# 1. Install the exact package versions
npm ci

# 2. Download Chromium, Firefox and WebKit
npx playwright install

# 3. Create your local settings file
cp .env.example .env
```

`.env` is ignored by Git. The values in `.env.example` are only for the local demo app.

Confirm the setup:

```bash
npm run tl -- doctor
```

You should see `OK: Playwright 1.64.1, image pinned, code rules clean.`

## 3. Run the demo

The project includes a small checkout app in `demo-app/`, so you can see the whole flow before connecting anything. Playwright starts it for you.

```bash
# 1. Run every test on every browser
npx playwright test

# 2. Prove each test can fail, then repeat it 5 times per browser
npm run tl -- falsify

# 3. Decide the build status
npm run tl -- gate reports/results.json

# 4. Write the release decision
npm run tl -- verdict
```

Expected final output:

```text
GO  Truth Score 100/100
VERIFIED    REQ-142 6 test(s), 12 run(s)
VERIFIED    REQ-143 4 test(s), 4 run(s)
VERIFIED    REQ-144 1 test(s), 1 run(s)
```

Open the results:

| File | Shows |
|---|---|
| `truthline/truth-report.md` | Release verdict and Truth Score |
| `truthline/falsification.md` | Every mutation and its result |
| `playwright-report/index.html` | Full test report, opened with `npx playwright show-report` |

## 4. See a failure on purpose

The demo app has a planted bug that accepts expired coupons.

```bash
# 1. Run the tests against the buggy app
DEMO_BUG=expiry npx playwright test

# 2. Classify the failures and draft bug reports
npm run tl -- triage reports/results.json --build demo

# 3. Check the build status
npm run tl -- gate reports/results.json

# 4. Get the verdict
npm run tl -- verdict
```

You should see `PRODUCT_DEFECT` for each failing test, a `FAILURE` build status, and `NO-GO`. The draft bugs are in `truthline/triage/demo.md`.

To return to a passing state, run `npx playwright test` and `npm run tl -- verdict` again.

## 5. Point it at your own app

**Step 1. Remove the demo content.** Delete:

- `demo-app/`
- `tests/e2e/coupon.spec.ts`, `tests/api/coupon.api.spec.ts`
- `tests/pages/CheckoutPage.ts`, `tests/data/coupons.ts`
- `truthline/requirements/REQ-*.md`, `truthline/plans/coupon.plan.md`
- `truthline/falsification.json`, `truthline/falsification.md`

Then:

- Remove the `CheckoutPage` import and `checkout` fixture from `tests/fixtures/base.ts`.
- Clear the rows in `truthline/clarifications.md` and `truthline/assumptions.md`.
- Replace the contents of `truthline/mutations.json` with `[]`.

**Step 2. Set your app's address and test login.** Edit `.env`:

```bash
BASE_URL=https://staging.your-app.example
TEST_USER_EMAIL=your-test-user@example.com
TEST_USER_PASSWORD=your-test-password
```

Use a test account on a staging site, not your production login.

**Step 3. Remove the demo server.** Delete the `webServer` block from `playwright.config.ts`.

**Step 4. Update the login steps.** Change `tests/pages/LoginPage.ts` and `tests/auth.setup.ts` to match your login page.

**Step 5. Map your source code to requirements.** Edit `truthline/impact-map.json`:

```json
[
  { "glob": "src/checkout/**", "reqs": ["REQ-001"] }
]
```

A changed file with no matching rule triggers a full test run, so missing rules are slow rather than unsafe.

**Step 6. Set your release thresholds.** `truthline/config.json` holds the risk bands, stability repeats and GO/NO-GO scores.

**Step 7. Connect your requirement source.** Add your Jira, Rally or Azure DevOps MCP server to `.vscode/mcp.json`.

## 6. Test a feature, step by step

Follow these stages for each feature. The agent can run them for you ([section 7](#7-use-the-agent)), but each one also works by hand.

### Stage 0: Check the project

```bash
npm run tl -- doctor
```

### Stage 1: Write and question the requirement

```bash
npm run tl -- new-req "Reject expired coupons at checkout"
```

Open the new file in `truthline/requirements/` and:

1. Replace the `TODO` text with Given/When/Then acceptance criteria.
2. Set `impact` and `likelihood` from 1 to 5, and `change_frequency` from 1 to 3. The defaults are placeholders.
3. Run the lint:

   ```bash
   npm run tl -- lint
   ```

4. Add each open question to `truthline/clarifications.md` as `OPEN`, `ANSWERED` or `ASSUMED`.

An `OPEN` question on a high-risk requirement stops the process until someone answers it.

### Stage 2: Score the risk

```bash
npm run tl -- risk
```

This writes `truthline/risk-model.md`. Score = Impact × Likelihood × Change Frequency.

| Score | Risk | Tests required |
|---|---|---|
| 40 or more | High | UI happy path, negatives, boundaries, API contract, cross-browser |
| 15 to 39 | Medium | UI happy path, key negatives, API checks |
| Under 15 | Low | API test or one UI smoke test |

### Stage 3: Design the tests

Create `truthline/plans/<feature>.plan.md`. Use `coupon.plan.md` as a pattern if you kept a copy. Each scenario needs an expected result quoted from the requirement.

### Stage 4: Explore the real app

Walk through each scenario in the app. If the app disagrees with the requirement, do not change the plan. Add a row to `truthline/drift.md` as `POSSIBLE_DEFECT` or `REQUIREMENT_GAP`.

### Stage 5: Write the tests

Put tests in `tests/e2e/` or `tests/api/`. Import from the project fixtures, tag the title, and use `test.step()`:

```ts
import { test, expect } from '../fixtures/base';

test('REQ-001 rejects coupon after expiry @REQ-001 @risk-high @ui @negative', async ({ page }) => {
  test.info().annotations.push({ type: 'requirement', description: 'REQ-001' });

  await test.step('Apply an expired coupon', async () => {
    // Actions go here
  });
  await test.step('The coupon is refused', async () => {
    await expect(page.getByRole('status')).toHaveText('This coupon has expired');
  });
});
```

Rules that `doctor` checks:

- No `waitForTimeout`, XPath or committed `.only`.
- Every test has a requirement annotation and `test.step()`.
- Assertions stay in tests, never in page objects.
- No hardcoded passwords or tokens.

Then check coverage:

```bash
npm run tl -- doctor
npm run tl -- trace
```

`trace` reports tests with no requirement, requirements with no tests, and tests missing the depth their risk requires.

### Stage 6: Prove the tests can fail

```bash
npx playwright test
npm run tl -- falsify
```

| Verdict | Meaning | What to do |
|---|---|---|
| `PROVEN` | All mutations caught, all runs stable | Nothing |
| `HOLLOW` | A mutation went unnoticed | Strengthen the test and rerun |
| `HOLLOW→FIXED` | Was hollow, now proven | Nothing |
| `FLAKY` | Failed at least one repeat | Tag `@flaky`, find the cause |
| `BROKEN` | Never passed | Fix the test or the app |

To rerun only part of the suite, use `npm run tl -- falsify --grep "REQ-001"`.

### Stage 7: Handle failures

```bash
npm run tl -- triage reports/results.json --build local
```

Triage proposes a class from the error text. Confirm it against the trace with `npx playwright show-trace <path-to-trace.zip>`.

| Class | Action |
|---|---|
| `LOCATOR_DRIFT` | Fix the locator |
| `TIMING` | Use a web-first assertion or wait for state |
| `TEST_DATA` | Fix the factory or test isolation |
| `ENVIRONMENT` | Do not change the test. Report it and retry once |
| `PRODUCT_DEFECT` | Do not change the test. File the bug |
| `REQUIREMENT_CHANGE` | Do not change the test. Ask for confirmation first |

Before accepting a test fix, confirm it did not weaken the test:

```bash
npm run tl -- heal-check tests/e2e/my.spec.ts --before HEAD
```

`--before` takes a Git ref or a file path. Log every fix or refusal in `truthline/healing.md`, using `HEALED` or `REFUSED` in the Action column.

### Stage 8: Run it in Jenkins

See [section 8](#8-set-up-jenkins).

### Stage 9: Get the verdict

```bash
npm run tl -- verdict
```

This writes `truthline/truth-report.md`.

### After a production incident

Turn each escaped defect into a new requirement, then start again from Stage 1:

```bash
npm run tl -- new-req "Discount applied twice on refresh" --incident
```

## 7. Use the agent

The full instructions are in `.github/agents/truthline.agent.md`.

| Client | How to start |
|---|---|
| Claude Code | Ask: "Use the truthline agent: truthline start REQ-001" |
| VS Code Copilot | Select **truthline**, then type `truthline start REQ-001` |

| Type this | To do this |
|---|---|
| `truthline start <REQ, file or pasted story>` | Run the full workflow |
| `truthline interrogate <REQ>` | Run Stage 1 only |
| `truthline plan`, `generate`, `falsify`, `heal`, `pipeline`, `verdict` | Run one stage |
| `truthline triage <build URL or junit file>` | Classify a CI failure |
| `truthline autonomous` | Run all stages without stopping, logging assumptions |

The agent stops at each gate and waits for approval, unless you choose autonomous mode.

The agent workflow has not been run end to end yet, including its live browser exploration through `.vscode/mcp.json`. The `tl` commands have been tested.

## 8. Set up Jenkins

> The `Jenkinsfile` has not yet been run on a real Jenkins server. The shard, merge, quarantine and gate commands were tested by hand, so expect possible fixes on the first build.

**Step 1. Install plugins:** Pipeline, Docker Pipeline, JUnit, HTML Publisher, Credentials Binding, Timestamper and Workspace Cleanup.

**Step 2. Add a credential.** Create a *Username with password* credential with the ID `truthline-test-user`.

**Step 3. Set environment URLs.** For staging, add the global variable `BASE_URL_STAGING`. Add any other target to the `ENV` choices in the `Jenkinsfile`.

**Step 4. Create the job.** Create a Multibranch Pipeline with script path `Jenkinsfile`. Disable shallow clone so smart selection can compare branches.

**Step 5. Run it once.** Jenkins only shows the parameters after the first run.

| Parameter | Meaning |
|---|---|
| `ENV` | `demo` or your target environment |
| `RUN_MODE` | `smart`, `full` or `smoke` |
| `TAGS` | Optional grep that overrides `RUN_MODE` |
| `SHARDS` | Number of parallel shards, 4 by default |

| Result | Build status |
|---|---|
| Any blocking failure, setup failure or missing shard, or no passing tests | FAILURE |
| Only `@flaky` tests failed | UNSTABLE |
| Anything else | SUCCESS |

If you upgrade Playwright, update the image tag in the `Jenkinsfile` to the same version. `doctor` fails if they differ.

More detail is in `docs/jenkins-setup.md`.

## 9. Audit a live website

`tools/live-audit/` checks a deployed site without changing it. Browser requests other than GET are blocked, so it cannot place orders or submit forms. These scripts are separate from the Truth Score.

**Full audit: links, SEO, accessibility, mobile layout and performance**

```bash
npx tsx tools/live-audit/audit.ts https://your-site.example/ my-site 150
```

The arguments are the URL, a report name and the maximum number of pages. Results go to `reports/live/my-site.json`.

**Customer journeys and admin**

```bash
npx tsx tools/live-audit/journeys.ts
TL_ADMIN_EMAIL=... TL_ADMIN_PASSWORD=... npx tsx tools/live-audit/admin.ts
```

These scripts are written for ChaCha Bakes and Two Souls and Three Tails, so change their URLs and steps for another site. `admin.ts` allows sign-in requests and prints only counts and field names. Never put admin credentials in a file.

Audit reports are saved as `truthline/live-audit-*`. Git ignores them because they describe security weaknesses.

## 10. Command reference

| Stage | Command | What it does |
|---|---|---|
| 0 | `npm run tl -- doctor` | Checks version pins, the Jenkins image, code rules and secrets |
| 1 | `npm run tl -- new-req "<title>" [--incident]` | Creates the next requirement file |
| 1 | `npm run tl -- lint [--strict]` | Runs the Testability Lint and the high-risk gate |
| 2 | `npm run tl -- risk` | Writes the risk model |
| 3, 5 | `npm run tl -- trace` | Finds orphan tests, uncovered requirements and depth gaps |
| 6 | `npm run tl -- falsify [--grep <regex>]` | Runs mutations and stability repeats |
| 7 | `npm run tl -- triage <results.json or junit.xml> [--build N]` | Classifies failures and drafts bugs |
| 7 | `npm run tl -- heal-check <spec> --before <ref or file>` | Refuses fixes that weaken assertions |
| 8 | `npm run tl -- select [--base <ref>] [--files a,b]` | Prints the smart-selection grep |
| 8 | `npm run tl -- gate <results.json> [--quarantine <json>]` | Returns 0 for SUCCESS, 1 for FAILURE, 2 for UNSTABLE |
| 9 | `npm run tl -- verdict [--results <json>]` | Writes the Truth Report |

| Other command | What it does |
|---|---|
| `npm test` | Runs the Playwright suite |
| `npm run typecheck` | Checks TypeScript types |
| `npm run test:tools` | Tests the `tl` tool itself |
| `npm run demo` | Starts the demo app on port 4173 |

## 11. How falsification works

`tl falsify` makes a temporary copy of each spec with one change, runs only the changed test, and deletes the copy. A mutation is caught when the test turns red.

| Mutation | Set up by | Applied to |
|---|---|---|
| Flip an expected value | Automatic | Each assertion in the test |
| Skip a step | Automatic | Each top-level `test.step` with no assertions, unless named cleanup or teardown |
| Tamper with an API response | `truthline/mutations.json` | UI tests matching the tags |
| Remove an element | `truthline/mutations.json` | UI tests matching the tags |

Example `truthline/mutations.json` entry:

```json
[
  {
    "match": "@REQ-001 @negative",
    "except": "@stubbed",
    "kind": "api-tamper",
    "url": "**/api/coupons/apply",
    "status": 200,
    "body": { "totalCents": 1 }
  }
]
```

Things to know:

- **Keep assertions in tests.** The mutator cannot see assertions in page objects.
- **Keep actions and assertions in separate steps.** A step containing an assertion is never skipped.
- **Use `except` when a test stubs the same URL.** The test's own `page.route` overrides the tamper, so the mutation would do nothing. Tag those tests, such as with `@stubbed`.
- **API tests only get value flips.** They have no page to tamper with.

## 12. How the verdict is decided

```text
Truth Score = 50 × risk-weighted coverage + 30 × proven rate + 20 × stability rate
```

Requirements are weighted by their risk score, so high-risk gaps cost the most.

| Requirement status | Meaning |
|---|---|
| `VERIFIED` | All runs passed and all its tests are proven |
| `FAILED` | At least one run failed |
| `BLOCKED` | Green but unproven, skipped, or has an open high-risk question |
| `NOT_COVERED` | No test results |

| Recommendation | Rule |
|---|---|
| `NO-GO` | A high-risk requirement is not verified, a failure is classified `PRODUCT_DEFECT`, or the score is under 60 |
| `GO` | No risks listed and the score is at least 90 |
| `GO WITH RISKS` | Anything else |

Playwright retries are set to 0 on purpose, because a retry would hide a flaky test.

## 13. Project layout

```text
.github/agents/        Agent instructions
.claude/agents/        Claude Code pointer to those instructions
.vscode/mcp.json       Browser and requirement-source connections
demo-app/              Sample app, safe to delete
docs/                  Jenkins setup
tests/
  e2e/  api/           Test specs
  pages/               Page objects
  fixtures/            Shared setup and mutation hooks
  data/                Test data factories
  auth.setup.ts        Signs in once for all tests
tools/
  truthline/           The tl command-line tool
  live-audit/          Read-only live site checks
truthline/
  config.json          Thresholds
  mutations.json       Tamper and removal mutations
  impact-map.json      Source path to requirement rules
  requirements/        REQ-xxx.md files
  plans/               Test plans
  clarifications.md    Question ledger
  risk-model.md        Generated risk scores
  drift.md             App vs requirement differences
  falsification.md     Mutation evidence
  healing.md           Fixes made and refused
  assumptions.md       Assumptions from autonomous runs
  triage/              Failure classification per build
  truth-report.md      Final verdict
playwright.config.ts        Test settings
playwright.merge.config.ts  Combines shard reports
Jenkinsfile                 CI pipeline
```

## 14. Troubleshooting

| Problem | Fix |
|---|---|
| `Set TEST_USER_EMAIL and TEST_USER_PASSWORD` | Run `cp .env.example .env` |
| `Executable doesn't exist` | Run `npx playwright install` |
| `No results at reports/results.json` | Run `npx playwright test` before `verdict` |
| UI tests land on the login page when using `--no-deps` | Remove `--no-deps`. The demo app keeps sessions in memory, so each new server needs a fresh login |
| A test is `HOLLOW` but looks correct | Check whether its own `page.route` hides the tamper. Use `except` |
| Every test shows `BROKEN` | The tests fail before any mutation matters. Run `npx playwright test` and fix that first |
| `FAILURE: no blocking test passed` | The grep matched nothing, or every test failed |
| `tl select` prints nothing | That means a full run. No Git diff was available, or a changed file has no impact rule |
| Leftover `*.mutant-*.spec.ts` files | An interrupted run left them. Delete them. Git ignores them |
