import assert from "node:assert/strict";
import child_process from "node:child_process";
import crypto from "node:crypto";

import { execPromise } from "./exec";
import { type E2ENaming } from "./naming";
import { FRESHNESS_TAG_KEY, RUN_ID_TAG_KEY } from "./naming";
import { type ExpectedLayers, type LambdaVerifierConfig } from "./lambda-verifier";

// Repo-local config feeding the shared, parameterized e2e helpers. This file is NOT
// synced -- it holds everything specific to datadog-cloudformation-macro: resource
// naming, pinned artifact versions, the CFN deploy buffer, and the LambdaVerifierConfig
// the shared verifier reads through its arguments. The shared files (exec/naming/
// lambda-verifier/lambda-telemetry-checker) import nothing from here.

export const NAMING: E2ENaming = { tool: "cfnmacro", platform: "lambda" };

// --- Run identity + resource naming ------------------------------------------
//
// Resources are named `one-e2e-cfnmacro-lambda-<runid>` and tagged
// `one_e2e_created:<unix-ts>` at creation so the cross-repo sweeper can identify
// ownership + staleness. Stable per-process run id; override via E2E_RUN_ID.

export const RUN_ID = process.env.E2E_RUN_ID ?? crypto.randomBytes(4).toString("hex");

// `one-e2e-cfnmacro-lambda-<runid>` -- 24 + 8 = 32 chars, within the 64-char Lambda
// function-name and CloudFormation stack-name limits.
export const RESOURCE_PREFIX = `one-e2e-${NAMING.tool}-${NAMING.platform}-${RUN_ID}`;

export const FUNCTION_NAME = RESOURCE_PREFIX;
export const WORKLOAD_STACK_NAME = RESOURCE_PREFIX;
export const MACRO_STACK_NAME = `${RESOURCE_PREFIX}-macro`;

// S3 bucket holding the freshly-built macro zip. Bucket names are global, lowercase,
// hyphen-allowed; the run id keeps it unique.
export const SOURCE_BUCKET = `${RESOURCE_PREFIX}-src`;

// CloudFormation macro registration name is account+region global, so it must be unique
// per run for parallel CI. Macro names are alphanumeric, so derive it from the (hex) run
// id rather than the hyphenated prefix.
export const MACRO_NAME = `DatadogServerlessE2e${RUN_ID}`;

// Freshness tag -- native creation time isn't usable cross-cloud, so we stamp it.
export const CREATED_TS = Math.floor(Date.now() / 1000);

// Re-export the shared tag keys so repo-local helpers have a single config import.
export { FRESHNESS_TAG_KEY, RUN_ID_TAG_KEY };

// `key=value,...` form for `aws ... --tags` (CloudFormation, Lambda).
export const freshnessTagCli = (): string => `${FRESHNESS_TAG_KEY}=${CREATED_TS}`;

// --- exec: synchronous helper (not in the shared async exec API) -------------
//
// The shared exec.ts is async-only and runner-agnostic. The repo-local aws/macro-stack
// helpers need a synchronous shell-out (config getters, the macro build), so keep that
// here. CFN_MAX_BUFFER (16 MB) matches the shared default's lower bound and is large
// enough for `aws cloudformation` / `get-function-configuration` JSON.
export const CFN_MAX_BUFFER = 16 * 1024 * 1024;

export const execSync = (command: string, env?: Record<string, string | undefined>): string =>
  child_process.execSync(command, {
    encoding: "utf-8",
    env: { ...process.env, ...env },
    maxBuffer: CFN_MAX_BUFFER,
  });

// --- Pinned artifact versions + deployment constants -------------------------
//
// Artifact versions (layer/extension) are PINNED so a failure blames the macro (the tool
// under test), not an upstream layer/extension bump. Override via env to test newer.

export const NODE_LAYER_VERSION = Number(process.env.NODE_LAYER_VERSION ?? "139");
export const EXTENSION_LAYER_VERSION = Number(process.env.EXTENSION_LAYER_VERSION ?? "97");

// One canonical runtime per platform (spec rule). Exhaustiveness lives upstream.
export const LAMBDA_RUNTIME = "nodejs22.x";
const NODE_LAYER_NAME = "Datadog-Node22-x"; // matches LAMBDA_RUNTIME nodejs22.x
const EXTENSION_LAYER_NAME = "Datadog-Extension";

// AWS account that publishes the public Datadog layers in commercial regions.
const DD_LAYER_ACCOUNT_ID = "464622532012";

// Region to deploy ephemeral test resources into. ap-northeast-3 is a less-used
// region, which avoids account limits and contention with other workloads.
export const AWS_REGION = process.env.AWS_REGION ?? "ap-northeast-3";

// Datadog site the extension ships telemetry to and the API client queries.
export const DD_SITE = process.env.DD_SITE ?? "datadoghq.com";

// Fixed identifying tags applied via the macro and asserted on ingested telemetry.
export const ENV_NAME = "one-e2e";
// Version carried on telemetry; the run id makes it unique per run for identity asserts.
export const ENV_VERSION = RUN_ID;

// The macro names the function exactly as we asked (explicit FunctionName param), so the
// run-unique service name *is* the deployed function name.
export const functionName = (serviceName: string): string => serviceName;

// Layer ARNs are derived from the pinned versions + the public Datadog layer account, so
// a mismatch blames the macro/registry, not upstream drift.
const layerArn = (region: string, name: string, version: number): string =>
  `arn:aws:lambda:${region}:${DD_LAYER_ACCOUNT_ID}:layer:${name}:${version}`;

const expectedLayerArns = (region: string): ExpectedLayers => {
  assert.ok(region, "region is required to resolve expected layer ARNs");

  return {
    node: layerArn(region, NODE_LAYER_NAME, NODE_LAYER_VERSION),
    extension: layerArn(region, EXTENSION_LAYER_NAME, EXTENSION_LAYER_VERSION),
  };
};

export const VERIFIER: LambdaVerifierConfig = {
  functionName,
  expectedLayerArns,
  redirectHandler: "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler",
  originalHandler: "index.handler",
  // The macro tags every instrumented function with its own version marker.
  toolTag: { key: "dd_sls_macro", pattern: /^v\d+\.\d+\.\d+/ },
  env: {
    apiKeyVars: ["DD_API_KEY", "DD_API_KEY_SECRET_ARN", "DD_KMS_API_KEY", "DD_API_KEY_SSM_ARN"],
    present: ["DD_SITE"],
    values: (serviceName) => ({
      DD_TRACE_ENABLED: "true",
      DD_SERVERLESS_LOGS_ENABLED: "true",
      DD_SERVICE: serviceName,
      DD_ENV: ENV_NAME,
      DD_VERSION: ENV_VERSION,
    }),
  },
};
