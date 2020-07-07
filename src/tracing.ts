import { FunctionInfo } from "./layer";
import { Configuration } from "env";
import { TYPE, PROPERTIES } from "./index";

const ALLOW = "Allow";
const PUT_TRACE_SEGMENTS = "xray:PutTraceSegments";
const PUT_TELEMETRY_RECORDS = "xray:PutTelemetryRecords";
const ddTraceEnabledEnvVar = "DD_TRACE_ENABLED";
const ddMergeXrayTracesEnvVar = "DD_MERGE_XRAY_TRACES";
const IAM_ROLE_RESOURCE_TYPE = "AWS::IAM::Role";
const FN_GET_ATT = "Fn::GetAtt";
const ACTIVE = "Active";
const POLICY_DOCUMENT_VERSION = "2012-10-17";

export enum TracingMode {
  XRAY,
  DD_TRACE,
  HYBRID,
  NONE,
}

function findIamRole(resources: any, func: FunctionInfo) {
  const role = func.lambda.Role as any;
  const roleComponents: string[] = role[FN_GET_ATT];
  if (roleComponents !== undefined) {
    const iamRoleResource = resources[roleComponents[0]];
    if (iamRoleResource[TYPE] === IAM_ROLE_RESOURCE_TYPE) {
      return iamRoleResource[PROPERTIES];
    }
  }
}

export function getTracingMode(config: Configuration) {
  if (config.enableXrayTracing && config.enableDDTracing) {
    return TracingMode.HYBRID;
  } else if (config.enableDDTracing) {
    return TracingMode.DD_TRACE;
  } else if (config.enableXrayTracing) {
    return TracingMode.XRAY;
  }
  return TracingMode.NONE;
}
export function enableTracing(
  tracingMode: TracingMode,
  funcs: FunctionInfo[],
  resources: any
) {
  if (tracingMode === TracingMode.XRAY || tracingMode === TracingMode.HYBRID) {
    const xrayPolicies = {
      Effect: ALLOW,
      Action: [PUT_TRACE_SEGMENTS, PUT_TELEMETRY_RECORDS],
      Resource: ["*"],
    };

    Array.from(funcs).forEach((func) => {
      const role = findIamRole(resources, func);
      if (role.Policies && role.Policies.length > 0) {
        role.Policies[0].PolicyDocument.Statement.push(xrayPolicies);
      } else {
        const policyName = {
          "Fn::Join": ["-", [func.name, "policy"]],
        };
        const policyDocument = {
          Version: POLICY_DOCUMENT_VERSION,
          Statement: [xrayPolicies],
        };
        role.Policies = [
          { PolicyName: policyName, PolicyDocument: policyDocument },
        ];
      }
      func.lambda.TracingConfig = { Mode: ACTIVE };
    });
  }
  if (
    tracingMode === TracingMode.HYBRID ||
    tracingMode === TracingMode.DD_TRACE
  ) {
    Array.from(funcs).forEach((func) => {
      const environment = func.lambda.Environment ?? {};
      const envVariables = environment.Variables ?? {};

      envVariables[ddTraceEnabledEnvVar] = true;
      envVariables[ddMergeXrayTracesEnvVar] =
        tracingMode === TracingMode.HYBRID;

      environment.Variables = envVariables;
      func.lambda.Environment = environment;
    });
  }
}
