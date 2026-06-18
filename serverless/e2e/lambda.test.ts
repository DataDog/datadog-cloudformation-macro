import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cfnDeleteAndWait, cfnDeploy, invokeFunction } from "./helpers/aws";
import {
  AWS_REGION,
  CREATED_TS,
  ENV_NAME,
  ENV_VERSION,
  EXTENSION_LAYER_VERSION,
  functionName,
  FUNCTION_NAME,
  LAMBDA_RUNTIME,
  MACRO_NAME,
  NODE_LAYER_VERSION,
  RUN_ID,
  RUN_ID_TAG_KEY,
  VERIFIER,
  WORKLOAD_STACK_NAME,
} from "./helpers/e2e.config";
import { checkTelemetryFlowing } from "./helpers/lambda-telemetry-checker";
import { functionSnapshot, verifyInstrumented, verifyUninstrumented, type FunctionSnapshot } from "./helpers/lambda-verifier";
import { deployMacroStack, teardownMacroStack } from "./helpers/macro-stack";

const describeOrSkip = process.env.SKIP_LAMBDA_TESTS === "true" ? describe.skip : describe;

const UNINSTRUMENTED_TEMPLATE = "e2e/templates/workload-uninstrumented.yml";

// Telemetry identity carried through the whole run.
const SERVICE = FUNCTION_NAME;

// Prepare the instrumented template: the macro registration name is run-unique and
// can't be a CloudFormation parameter, so substitute the literal before deploying.
const prepareInstrumentedTemplate = (): string => {
  const base = readFileSync("e2e/templates/workload-instrumented.yml", "utf-8");
  const out = join(tmpdir(), `workload-instrumented-${RUN_ID}.yml`);
  // `__MACRO_NAME__` is the literal placeholder token in the template, swapped for the run-unique name.
  writeFileSync(out, base.replaceAll("__MACRO_NAME__", MACRO_NAME));
  return out;
};

const baseParams = {
  FunctionName: FUNCTION_NAME,
  RunId: RUN_ID,
  CreatedTs: String(CREATED_TS),
};

const instrumentedParams = {
  ...baseParams,
  DDApiKey: process.env.DD_API_KEY ?? process.env.DATADOG_API_KEY ?? "",
  DDSite: process.env.DD_SITE ?? "datadoghq.com",
  DDService: SERVICE,
  DDEnv: ENV_NAME,
  DDVersion: ENV_VERSION,
  DDTags: `${RUN_ID_TAG_KEY}:${RUN_ID}`,
  NodeLayerVersion: String(NODE_LAYER_VERSION),
  ExtensionLayerVersion: String(EXTENSION_LAYER_VERSION),
};

const MINUTE = 60_000;

describeOrSkip(`cfn-macro lambda e2e (${LAMBDA_RUNTIME})`, () => {
  let instrumentedTemplate: string;
  let firstSnapshot: FunctionSnapshot;

  beforeAll(async () => {
    instrumentedTemplate = prepareInstrumentedTemplate();
    // Build + register the macro (the tool under test) from source.
    await deployMacroStack(AWS_REGION);
    // Provision the uninstrumented workload (ephemeral, uniquely named).
    await cfnDeploy({
      stackName: WORKLOAD_STACK_NAME,
      templateFile: UNINSTRUMENTED_TEMPLATE,
      region: AWS_REGION,
      parameters: baseParams,
    });
  }, 15 * MINUTE);

  afterAll(async () => {
    // Teardown always runs, even on failure. The cross-repo sweeper is the backstop
    // for cancelled CI where this never runs.
    try {
      await cfnDeleteAndWait(WORKLOAD_STACK_NAME, AWS_REGION);
    } catch (error) {
      console.error(`Failed to delete workload stack ${WORKLOAD_STACK_NAME}:`, error);
    }
    await teardownMacroStack(AWS_REGION);
  }, 15 * MINUTE);

  it("APPLY: instruments the function (config present)", async () => {
    await cfnDeploy({
      stackName: WORKLOAD_STACK_NAME,
      templateFile: instrumentedTemplate,
      region: AWS_REGION,
      parameters: instrumentedParams,
    });
    await verifyInstrumented(VERIFIER, SERVICE, AWS_REGION);
    firstSnapshot = await functionSnapshot(VERIFIER, SERVICE, AWS_REGION);
  }, 10 * MINUTE);

  it("TRIGGER: telemetry (traces + logs) flows with identifying tags", async () => {
    const invoke = await invokeFunction(FUNCTION_NAME, AWS_REGION);
    expect(invoke.exitCode).toBe(0);
    await checkTelemetryFlowing({ serviceName: SERVICE, env: ENV_NAME, version: ENV_VERSION, runId: RUN_ID });
  }, 10 * MINUTE);

  it("RE-APPLY: is idempotent (no diff, no duplicate)", async () => {
    const result = await cfnDeploy({
      stackName: WORKLOAD_STACK_NAME,
      templateFile: instrumentedTemplate,
      region: AWS_REGION,
      parameters: instrumentedParams,
    });
    // Still instrumented, and byte-for-byte the same instrumentation as the first apply
    // -- the macro must not stack a second copy of each layer or otherwise drift.
    await verifyInstrumented(VERIFIER, SERVICE, AWS_REGION);
    const secondSnapshot = await functionSnapshot(VERIFIER, SERVICE, AWS_REGION);
    expect(secondSnapshot).toEqual(firstSnapshot);
    console.log(`Re-apply reported noChanges=${result.noChanges}`);
  }, 10 * MINUTE);

  it("REMOVE: reverts to a clean end-state (no residue)", async () => {
    // The CFN-macro remove driver is `delete-stack` (per spec): tearing down the
    // workload stack removes the function and all its DD config. The clean end-state
    // is the function (and its instrumentation) being gone.
    await cfnDeleteAndWait(WORKLOAD_STACK_NAME, AWS_REGION);
    await verifyUninstrumented(VERIFIER, SERVICE, AWS_REGION);
  }, 10 * MINUTE);
});
