import crypto from "node:crypto";

// Resource naming + freshness-tag hygiene (e2e spec "Resource Hygiene").
//
// Accounts are shared across teams and in-test teardown skips on cancelled CI,
// so a cross-repo sweeper is the real guarantee -- and it only touches resources
// whose name starts with `one-e2e-`. Every resource this suite creates is named
// `one-e2e-<tool>-<platform>-<runid>` and tagged `one_e2e_created:<unix-ts>` at
// creation, set atomically so the sweeper can identify ownership + staleness.

const TOOL = "cfnmacro";
const PLATFORM = "lambda";

// Stable per-process run id. Override via E2E_RUN_ID to correlate a known run.
export const RUN_ID = process.env.E2E_RUN_ID ?? crypto.randomBytes(4).toString("hex");

// `one-e2e-cfnmacro-lambda-<runid>` -- 24 + 8 = 32 chars, well within the 64-char
// Lambda function-name and CloudFormation stack-name limits.
export const RESOURCE_PREFIX = `one-e2e-${TOOL}-${PLATFORM}-${RUN_ID}`;

export const FUNCTION_NAME = RESOURCE_PREFIX;
export const WORKLOAD_STACK_NAME = RESOURCE_PREFIX;
export const MACRO_STACK_NAME = `${RESOURCE_PREFIX}-macro`;

// S3 bucket holding the freshly-built macro zip. Bucket names are global,
// lowercase, hyphen-allowed; the run id keeps it unique.
export const SOURCE_BUCKET = `${RESOURCE_PREFIX}-src`;

// CloudFormation macro registration name is account+region global, so it must be
// unique per run to allow parallel CI. Macro names are alphanumeric, so derive it
// from the (hex) run id rather than the hyphenated prefix.
export const MACRO_NAME = `DatadogServerlessE2e${RUN_ID}`;

// Freshness tag -- native creation time isn't usable cross-cloud, so we stamp it.
export const FRESHNESS_TAG_KEY = "one_e2e_created";
export const CREATED_TS = Math.floor(Date.now() / 1000);

// Run-id marker carried on ingested telemetry (via DD_TAGS) for identity assertions.
export const RUN_ID_TAG_KEY = "one_e2e_run_id";

// `key=value,...` form for `aws ... --tags` (CloudFormation, Lambda).
export const freshnessTagCli = (): string => `${FRESHNESS_TAG_KEY}=${CREATED_TS}`;
