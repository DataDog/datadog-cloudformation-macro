import { LambdaFunction } from "./layer";
import { Configuration } from "env";
import { TYPE, PROPERTIES } from "./index";

const FN_GET_ATT = "Fn::GetAtt";
const IAM_ROLE_RESOURCE_TYPE = "AWS::IAM::Role";
const ALLOW = "Allow";
const PUT_TRACE_SEGMENTS = "xray:PutTraceSegments";
const PUT_TELEMETRY_RECORDS = "xray:PutTelemetryRecords";
const POLICY = "policy";
const POLICY_DOCUMENT_VERSION = "2012-10-17";
const ACTIVE = "Active";
const DD_TRACE_ENABLED = "DD_TRACE_ENABLED";
const DD_MERGE_XRAY_TRACES = "DD_MERGE_XRAY_TRACES";

export enum TracingMode {
  XRAY,
  DD_TRACE,
  HYBRID,
  NONE,
}

function findIamRole(resources: any, lambda: LambdaFunction) {
  const role = lambda.properties.Role as any;
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
  lambdas: LambdaFunction[],
  resources: any
) {
  if (tracingMode === TracingMode.XRAY || tracingMode === TracingMode.HYBRID) {
    const xrayPolicies = {
      Effect: ALLOW,
      Action: [PUT_TRACE_SEGMENTS, PUT_TELEMETRY_RECORDS],
      Resource: ["*"],
    };

    // TODO: why does this call need 'Array.from' when similar calls in other files don't?
    Array.from(lambdas).forEach((lambda) => {
      const role = findIamRole(resources, lambda);
      if (role.Policies && role.Policies.length > 0) {
        role.Policies[0].PolicyDocument.Statement.push(xrayPolicies);
      } else {
        const PolicyName = { "Fn::Join": ["-", [lambda.key, POLICY]] };
        const PolicyDocument = {
          Version: POLICY_DOCUMENT_VERSION,
          Statement: [xrayPolicies],
        };
        role.Policies = [{ PolicyName, PolicyDocument }];
      }
      lambda.properties.TracingConfig = { Mode: ACTIVE };
    });
  }
  if (
    tracingMode === TracingMode.HYBRID ||
    tracingMode === TracingMode.DD_TRACE
  ) {
    // TODO: why does this call need 'Array.from' when similar calls in other files don't?
    Array.from(lambdas).forEach((lambda) => {
      const environment = lambda.properties.Environment ?? {};
      const envVariables = environment.Variables ?? {};

      envVariables[DD_TRACE_ENABLED] = true;
      envVariables[DD_MERGE_XRAY_TRACES] = tracingMode === TracingMode.HYBRID;

      environment.Variables = envVariables;
      lambda.properties.Environment = environment;
    });
  }
}
