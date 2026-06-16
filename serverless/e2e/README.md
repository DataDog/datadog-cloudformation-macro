# CloudFormation macro — AWS Lambda e2e suite

End-to-end test for the Datadog Serverless CloudFormation macro on AWS Lambda. It
proves the macro's mechanism — applying the `DatadogServerless` transform to a
CloudFormation stack — yields a correctly instrumented function with telemetry
flowing into Datadog, and that removing the transform leaves a clean end-state.

Conforms to the shared serverless instrumentation e2e contract
(`serverless-ci/e2e/spec.md`); mirrors the `datadog-ci` reference suite
(`e2e/cloud-run.test.ts` + `e2e/helpers/*`), with runner-agnostic helpers.

## Lifecycle (`lambda.test.ts`)

1. **Provision** — build the macro from source, register it as a CloudFormation
   macro, and deploy an uninstrumented Node.js workload Lambda.
2. **APPLY** — `aws cloudformation deploy` of the workload template *with* the
   `DatadogServerless` transform; verify config (pinned Node + Extension layers,
   `DD_*` env vars, handler redirect, `dd_sls_macro` tag).
3. **TRIGGER** — `aws lambda invoke`; poll Datadog until spans *and* logs appear,
   filtered by the run's identifying tags (`service`, `env`, `version`, run id).
4. **RE-APPLY** — deploy again; assert idempotent (no diff, layers not duplicated).
5. **REMOVE** — deploy the uninstrumented template; assert all Datadog config,
   `DD_*` env vars, and the macro tag are gone.
6. **Teardown** — always deletes both stacks and the macro source bucket.

## What's pinned

Artifact versions are pinned (`constants.ts`) so a failure blames the macro, not an
upstream bump: Node layer (`NODE_LAYER_VERSION`), Extension layer
(`EXTENSION_LAYER_VERSION`), one canonical runtime (`nodejs22.x`). Override via env
when intentionally testing a newer artifact.

## Resource hygiene

Every resource is named `one-e2e-cfnmacro-lambda-<runid>` and tagged
`one_e2e_created:<unix-ts>` at creation. The shared cross-repo sweeper deletes stale
`one-e2e-` resources; in-test teardown is the fast path, the sweeper the backstop.

## Running locally

Prerequisites:

- **AWS auth** with permission to deploy CloudFormation, Lambda, IAM, S3 in a
  **non-production** account (the suite never touches the Datadog layer-publishing
  account `464622532012`). Datadog engineers use:

  ```bash
  aws-vault exec sso-serverless-sandbox-account-admin -- yarn test:e2e
  ```

- **Datadog API + APP keys** for the org telemetry lands in, exported in the
  environment (the extension uses the API key to ship; the suite uses both to query):

  ```bash
  export DD_API_KEY=...      # or DATADOG_API_KEY
  export DD_APP_KEY=...      # or DATADOG_APP_KEY
  ```

  `DD_SITE` defaults to `datadoghq.com`; override for other sites.

Then:

```bash
cd serverless
yarn install
aws-vault exec sso-serverless-sandbox-account-admin -- yarn test:e2e
```

Optional non-secret overrides go in `e2e/.env.local` (see `.env.local.example`).

A full run takes ~10–15 minutes (build + macro registration + workload lifecycle +
telemetry polling). Type-check the suite without deploying anything via
`yarn test:e2e:typecheck`.

## CI

Runs in GitHub Actions (`.github/workflows/e2e.yml`) behind a path
filter, gated by `SKIP_LAMBDA_TESTS`, with AWS access via OIDC federation (no
long-lived keys). Datadog keys come from repository secrets.

The live suite runs only when both (a) relevant paths changed and (b) the OIDC role
var (`AWS_ROLE_ARN_E2E`) is configured. Otherwise it self-skips so the job stays green on forks and
before the e2e infra is wired. To enable the live run, configure in repo settings:

- `vars.AWS_ROLE_ARN_E2E` — OIDC role ARN (deploy perms for CloudFormation,
  Lambda, IAM, S3 in a non-prod account; `lambda:InvokeFunction` on the macro fn).
- `secrets.DATADOG_API_KEY_E2E`, `secrets.DATADOG_APP_KEY_E2E`.
- Optional: `vars.AWS_REGION_E2E` (default `sa-east-1`), `vars.DD_SITE_E2E`.

The type-check step always runs, so the suite is compile-checked on every PR.
