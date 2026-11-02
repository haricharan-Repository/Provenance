# Jenkins Setup

The agent needs Docker. Everything else runs inside the pinned Playwright image.

## 1. Plugins

Install from **Manage Jenkins → Plugins**:

- Pipeline
- Docker Pipeline
- JUnit
- HTML Publisher
- Credentials Binding
- Timestamper
- Workspace Cleanup

## 2. Credentials

In **Manage Jenkins → Credentials**, add one credential:

| Field | Value |
|---|---|
| Kind | Username with password |
| ID | `truthline-test-user` |
| Username | Test user email |
| Password | Test user password |

## 3. Environment URLs

For each non-demo target, add a global variable in **Manage Jenkins → System → Global properties**.
Example: `BASE_URL_STAGING=https://your-staging-host`. To add a target, also add it to the `ENV` choices in the `Jenkinsfile`.

## 4. Job

1. Create a **Multibranch Pipeline** (or Pipeline) job pointing at this repository, with script path `Jenkinsfile`.
2. For smart selection, disable shallow clone and fetch the target branch. Without that diff, `tl select` falls back to a full run.
3. Run the job once. Jenkins only shows the parameters after the first run.

## 5. Parameters

| Parameter | Meaning |
|---|---|
| `ENV` | `demo` starts the sample app. Other values use `BASE_URL_<ENV>`. |
| `TAGS` | Grep that overrides `RUN_MODE`. |
| `SHARDS` | Parallel shard count. Default 4. |
| `RUN_MODE` | `smart`, `full` or `smoke`. |

## 6. Build status

`tl gate` sets the status, not the test exit code or the JUnit step.

| Result | Status |
|---|---|
| Any blocking failure, setup failure, missing shard, or nothing passed | FAILURE |
| Only `@flaky` quarantine tests failed | UNSTABLE |
| Everything else | SUCCESS |

The spec only names the `@risk-high` product defect case. Treating every blocking failure as FAILURE is deliberately stricter.
