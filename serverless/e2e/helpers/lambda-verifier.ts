import { getFunctionConfiguration, getFunctionTags } from "./aws";
import { DD_LAYER_ACCOUNT_ID } from "../constants";
import { FRESHNESS_TAG_KEY, RUN_ID_TAG_KEY } from "./naming";

// Config verifier for the AWS Lambda contract. Asserts IDENTITY (the specific
// layers, env values and tags the macro wires) -- not mere existence -- and
// asserts explicit ABSENCE after removal. Uses the global `expect` so it works
// under any runner; no jest/vitest import.

// Handler the macro redirects Node functions to when layers are added.
const DD_NODE_HANDLER = "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler";

export interface InstrumentedExpectations {
  functionName: string;
  region: string;
  originalHandler: string; // e.g. "index.handler"
  nodeLayerName: string; // e.g. "Datadog-Node22-x"
  nodeLayerVersion: number;
  extensionLayerVersion: number;
  service: string;
  env: string;
  version: string;
  site: string;
  runId: string;
}

const layerArn = (region: string, name: string, version: number): string =>
  `arn:aws:lambda:${region}:${DD_LAYER_ACCOUNT_ID}:layer:${name}:${version}`;

// Lambda returns env var values as strings; the macro emits some as booleans which
// CloudFormation stringifies. Normalize for comparison.
const truthy = (value: string | undefined): boolean => String(value) === "true";

export const verifyInstrumented = (exp: InstrumentedExpectations): void => {
  const config = getFunctionConfiguration(exp.functionName, exp.region);
  const layers = (config.Layers ?? []).map((l) => l.Arn);
  const vars = config.Environment?.Variables ?? {};
  const tags = getFunctionTags(config.FunctionArn, exp.region);

  // Layers: the pinned tracer layer + the pinned extension layer (identity).
  expect(layers).toContain(layerArn(exp.region, exp.nodeLayerName, exp.nodeLayerVersion));
  expect(layers).toContain(layerArn(exp.region, "Datadog-Extension", exp.extensionLayerVersion));

  // Handler redirect: original handler preserved in DD_LAMBDA_HANDLER, entrypoint
  // pointed at the Datadog wrapper.
  expect(config.Handler).toBe(DD_NODE_HANDLER);
  expect(vars.DD_LAMBDA_HANDLER).toBe(exp.originalHandler);

  // Required DD_* wiring: API key, site, tracing + log injection.
  expect(vars.DD_API_KEY).toBeTruthy();
  expect(vars.DD_SITE).toBe(exp.site);
  expect(truthy(vars.DD_TRACE_ENABLED)).toBe(true);
  expect(truthy(vars.DD_SERVERLESS_LOGS_ENABLED)).toBe(true);
  // With the extension, logs flow over the Telemetry API, not the Forwarder.
  expect(truthy(vars.DD_FLUSH_TO_LOG)).toBe(false);

  // Identifying tags carried on ingested telemetry.
  expect(vars.DD_SERVICE).toBe(exp.service);
  expect(vars.DD_ENV).toBe(exp.env);
  expect(vars.DD_VERSION).toBe(exp.version);
  expect(vars.DD_TAGS).toContain(`${RUN_ID_TAG_KEY}:${exp.runId}`);

  // Macro version tag is always applied; the freshness tag must survive instrumentation.
  expect(tags.dd_sls_macro).toMatch(/^v\d+\.\d+\.\d+/);
  expect(tags[FRESHNESS_TAG_KEY]).toBeDefined();
};

export interface UninstrumentedExpectations {
  functionName: string;
  region: string;
  originalHandler: string;
}

export const verifyUninstrumented = (exp: UninstrumentedExpectations): void => {
  const config = getFunctionConfiguration(exp.functionName, exp.region);
  const layers = (config.Layers ?? []).map((l) => l.Arn);
  const vars = config.Environment?.Variables ?? {};
  const tags = getFunctionTags(config.FunctionArn, exp.region);

  // No Datadog layers remain.
  expect(layers.some((arn) => arn.includes(":layer:Datadog-"))).toBe(false);

  // Handler restored.
  expect(config.Handler).toBe(exp.originalHandler);

  // Every DD_* env var is gone (explicit absence).
  const ddVars = Object.keys(vars).filter((k) => k.startsWith("DD_"));
  expect(ddVars).toEqual([]);

  // Macro-added tag is gone; the freshness tag (template-owned) remains.
  expect(tags.dd_sls_macro).toBeUndefined();
  expect(tags[FRESHNESS_TAG_KEY]).toBeDefined();
};
