import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AWS_REGION,
  DD_ENV,
  DD_SITE,
  EXTENSION_LAYER_VERSION,
  LAMBDA_RUNTIME,
  NODE_LAYER_VERSION,
} from "./constants";
import { cfnDeleteAndWait, cfnDeploy, getFunctionConfiguration, invokeFunction } from "./helpers/aws";
import { verifyInstrumented, verifyUninstrumented } from "./helpers/lambda-verifier";
import { checkTelemetryFlowing, TelemetryIdentity } from "./helpers/lambda-telemetry-checker";
import { deployMacroStack, teardownMacroStack } from "./helpers/macro-stack";
import {
  CREATED_TS,
  FUNCTION_NAME,
  MACRO_NAME,
  RUN_ID,
  RUN_ID_TAG_KEY,
  WORKLOAD_STACK_NAME,
} from "./helpers/naming";

const describeOrSkip = process.env.SKIP_LAMBDA_TESTS === "true" ? describe.skip : describe;

const ORIGINAL_HANDLER = "index.handler";
const NODE_LAYER_NAME = "Datadog-Node22-x"; // matches LAMBDA_RUNTIME nodejs22.x
const UNINSTRUMENTED_TEMPLATE = "e2e/templates/workload-uninstrumented.yml";

// Telemetry identity carried through the whole run.
const SERVICE = FUNCTION_NAME;
const VERSION = RUN_ID;
const IDENTITY: TelemetryIdentity = { service: SERVICE, env: DD_ENV, version: VERSION, runId: RUN_ID };

// Prepare the instrumented template: the macro registration name is run-unique and
// can't be a CloudFormation parameter, so substitute the literal before deploying.
const prepareInstrumentedTemplate = (): string => {
  const base = readFileSync("e2e/templates/workload-instrumented.yml", "utf-8");
  const out = join(tmpdir(), `workload-instrumented-${RUN_ID}.yml`);
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
  DDSite: DD_SITE,
  DDService: SERVICE,
  DDEnv: DD_ENV,
  DDVersion: VERSION,
  DDTags: `${RUN_ID_TAG_KEY}:${RUN_ID}`,
  NodeLayerVersion: String(NODE_LAYER_VERSION),
  ExtensionLayerVersion: String(EXTENSION_LAYER_VERSION),
};

const instrumentedExpectations = {
  functionName: FUNCTION_NAME,
  region: AWS_REGION,
  originalHandler: ORIGINAL_HANDLER,
  nodeLayerName: NODE_LAYER_NAME,
  nodeLayerVersion: NODE_LAYER_VERSION,
  extensionLayerVersion: EXTENSION_LAYER_VERSION,
  service: SERVICE,
  env: DD_ENV,
  version: VERSION,
  site: DD_SITE,
  runId: RUN_ID,
};

const MINUTE = 60_000;

describeOrSkip(`cfn-macro lambda e2e (${LAMBDA_RUNTIME})`, () => {
  let instrumentedTemplate: string;

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
    verifyInstrumented(instrumentedExpectations);
  }, 10 * MINUTE);

  it("TRIGGER: telemetry (traces + logs) flows with identifying tags", async () => {
    const invoke = await invokeFunction(FUNCTION_NAME, AWS_REGION);
    expect(invoke.exitCode).toBe(0);
    await checkTelemetryFlowing(IDENTITY);
  }, 10 * MINUTE);

  it("RE-APPLY: is idempotent (no diff, no duplicate)", async () => {
    const result = await cfnDeploy({
      stackName: WORKLOAD_STACK_NAME,
      templateFile: instrumentedTemplate,
      region: AWS_REGION,
      parameters: instrumentedParams,
    });
    // Either CloudFormation reports an empty changeset, or the re-expanded template
    // is a no-op. Re-verify the config is unchanged and, crucially, layers aren't
    // duplicated -- the macro must not stack a second copy of each layer.
    verifyInstrumented(instrumentedExpectations);
    const config = getFunctionConfiguration(FUNCTION_NAME, AWS_REGION);
    expect((config.Layers ?? []).length).toBe(2);
    console.log(`Re-apply reported noChanges=${result.noChanges}`);
  }, 10 * MINUTE);

  it("REMOVE: reverts to a clean, uninstrumented end-state", async () => {
    await cfnDeploy({
      stackName: WORKLOAD_STACK_NAME,
      templateFile: UNINSTRUMENTED_TEMPLATE,
      region: AWS_REGION,
      parameters: baseParams,
    });
    verifyUninstrumented({ functionName: FUNCTION_NAME, region: AWS_REGION, originalHandler: ORIGINAL_HANDLER });
  }, 10 * MINUTE);
});
