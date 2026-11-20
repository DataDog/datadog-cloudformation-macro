import log from "loglevel";
import { LambdaFunction } from "./layer";

// Functions configured below this amount of memory (in MB) are considered low-memory.
// The Datadog Lambda Extension and tracer layers add memory overhead (about 70 MB for Python),
// which can cause out-of-memory errors and timeouts on small functions.
export const LOW_MEMORY_THRESHOLD_MB = 256;
export const LOW_MEMORY_REASON = "lambda_low_memory";
// AWS default MemorySize when the property is not set.
export const AWS_DEFAULT_MEMORY_SIZE_MB = 128;

const LAMBDA_FUNCTION_RESOURCE_TYPE = "AWS::Lambda::Function";
const SERVERLESS_FUNCTION_RESOURCE_TYPE = "AWS::Serverless::Function";

/**
 * Returns the numeric value of a MemorySize property, or undefined if it is not a number
 * (e.g. an intrinsic function like Ref or Fn::If, or a non-numeric string).
 * Numeric strings like "128" are treated as numbers.
 */
function parseMemorySize(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Returns the effective memory size (in MB) of a function:
 *   the function's MemorySize
 *   ?? (for AWS::Serverless::Function) SAM Globals.Function.MemorySize
 *   ?? the AWS default of 128 MB.
 * Returns undefined when the effective MemorySize is set but is not a number (e.g. an intrinsic),
 * since its value can't be determined at transform time.
 */
export function getEffectiveMemorySize(
  properties: { MemorySize?: unknown } | undefined,
  resourceType: string = LAMBDA_FUNCTION_RESOURCE_TYPE,
  globals?: any,
): number | undefined {
  let memorySize = properties?.MemorySize;
  if (memorySize === undefined && resourceType === SERVERLESS_FUNCTION_RESOURCE_TYPE) {
    memorySize = globals?.Function?.MemorySize;
  }
  if (memorySize === undefined) {
    return AWS_DEFAULT_MEMORY_SIZE_MB;
  }
  return parseMemorySize(memorySize);
}

export function getLowMemoryWarningMessage(logicalId: string, memorySize: number): string {
  return (
    `Function ${logicalId} has ${memorySize} MB of memory, below the recommended minimum of ${LOW_MEMORY_THRESHOLD_MB} MB (${LOW_MEMORY_REASON}). ` +
    "The Datadog Lambda Extension and tracer add memory overhead (about 70 MB for Python), which can cause out-of-memory errors and timeouts. " +
    `Increase the function's memory to at least ${LOW_MEMORY_THRESHOLD_MB} MB, or set suppressLowMemoryWarning to true to silence this warning.`
  );
}

/**
 * Logs a warning for each instrumented function whose effective memory is below
 * LOW_MEMORY_THRESHOLD_MB. This is warn-only: functions are still instrumented as before.
 * Returns the warning messages that were logged.
 */
export function warnOnLowMemoryLambdas(
  lambdas: LambdaFunction[],
  suppressLowMemoryWarning: boolean | string | undefined,
  resourceTypes: { [logicalId: string]: string } = {},
  globals?: any,
): string[] {
  if (String(suppressLowMemoryWarning).toLowerCase() === "true") {
    return [];
  }
  const warnings: string[] = [];
  for (const lambda of lambdas) {
    const resourceType = resourceTypes[lambda.key] ?? LAMBDA_FUNCTION_RESOURCE_TYPE;
    const memorySize = getEffectiveMemorySize(lambda.properties, resourceType, globals);
    if (memorySize !== undefined && memorySize < LOW_MEMORY_THRESHOLD_MB) {
      const message = getLowMemoryWarningMessage(lambda.key, memorySize);
      log.warn(message);
      warnings.push(message);
    }
  }
  return warnings;
}
