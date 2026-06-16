// Pinned artifact versions and fixed deployment parameters for the e2e suite.
//
// Per the e2e spec, artifact versions (layer/extension) are PINNED so a failure
// blames the macro (the tool under test), not an upstream layer/extension bump.
// Override via env when intentionally testing against a newer artifact.

// The Datadog Node.js tracer layer version (datadog-lambda-js).
// https://github.com/DataDog/datadog-lambda-js/releases
export const NODE_LAYER_VERSION = Number(process.env.NODE_LAYER_VERSION ?? "139");

// The Datadog Lambda Extension layer version (datadog-lambda-extension).
// https://github.com/DataDog/datadog-lambda-extension/releases
export const EXTENSION_LAYER_VERSION = Number(process.env.EXTENSION_LAYER_VERSION ?? "97");

// One canonical runtime per platform (spec rule). Exhaustiveness lives upstream.
export const LAMBDA_RUNTIME = "nodejs22.x";
export const LAMBDA_ARCHITECTURE = "x86_64";

// AWS account that publishes the public Datadog layers in commercial regions.
export const DD_LAYER_ACCOUNT_ID = "464622532012";

// Region to deploy ephemeral test resources into. sa-east-1 matches the repo's
// existing installation_test convention (a less-used region, avoids account limits).
export const AWS_REGION = process.env.AWS_REGION ?? "sa-east-1";

// Datadog site the extension ships telemetry to and the API client queries.
export const DD_SITE = process.env.DD_SITE ?? "datadoghq.com";

// Fixed identifying tags applied via the macro and asserted on ingested telemetry.
export const DD_ENV = "one-e2e";

// The macro runtime used to register the macro Lambda (matches template.yml).
export const MACRO_RUNTIME = "nodejs24.x";
