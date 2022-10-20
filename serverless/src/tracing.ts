import { LambdaFunction } from "./layer";
import { Configuration } from "./env";
import { Resources } from "./index";
import log from "loglevel";

const FN_GET_ATT = "Fn::GetAtt";
const FN_JOIN = "Fn::Join";
const IAM_ROLE_RESOURCE_TYPE = "AWS::IAM::Role";
const ALLOW = "Allow";
const PUT_TRACE_SEGMENTS = "xray:PutTraceSegments";
const PUT_TELEMETRY_RECORDS = "xray:PutTelemetryRecords";
const POLICY = "Policy";
const POLICY_DOCUMENT_VERSION = "2012-10-17";
const ACTIVE = "Active";
const DD_TRACE_ENABLED = "DD_TRACE_ENABLED";
const DD_MERGE_XRAY_TRACES = "DD_MERGE_XRAY_TRACES";

interface Statement {
  Sid?: string;
  Effect: string;
  Action: string[];
  Resource?: string | string[];
}

export interface IamRoleProperties {
  AssumeRolePolicyDocument: any;
  ManagedPolicyArns?: string[];
  Policies?: {
    PolicyDocument: {
      Version: string;
      Statement: Statement | Statement[];
    };
    PolicyName: string | { [fn: string]: any };
  }[];
}

export class MissingIamRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingIamRoleError";
  }
}

export enum TracingMode {
  XRAY,
  DD_TRACE,
  HYBRID,
  NONE,
}

function findIamRole(resources: Resources, lambda: LambdaFunction) {
  const role = lambda.properties.Role;
  let roleKey;
  if (typeof role !== "string") {
    const roleComponents: string[] = role[FN_GET_ATT];
    if (roleComponents !== undefined) {
      roleKey = roleComponents[0];
    }
  }

  if (roleKey) {
    const iamRoleResource = resources[roleKey];
    if (iamRoleResource.Type === IAM_ROLE_RESOURCE_TYPE) {
      return iamRoleResource.Properties as IamRoleProperties;
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

export function enableTracing(tracingMode: TracingMode, lambdas: LambdaFunction[], resources: Resources) {
  if (tracingMode === TracingMode.XRAY || tracingMode === TracingMode.HYBRID) {
    log.debug("Enabling Xray tracing...");
    const xrayPolicies = {
      Effect: ALLOW,
      Action: [PUT_TRACE_SEGMENTS, PUT_TELEMETRY_RECORDS],
      Resource: ["*"],
    };
    log.debug(`Xray policies: ${xrayPolicies}`);

    lambdas.forEach((lambda) => {
      const role = findIamRole(resources, lambda);

      if (role === undefined) {
        throw new MissingIamRoleError(
          `No AWS::IAM::Role resource was found for the function ${lambda.key} when adding xray tracing policies`,
        );
      }

      log.debug(`Using IAM role: ${role}`);

      if (role.Policies && role.Policies.length > 0) {
        const policy = role.Policies[0];
        const policyDocument = policy.PolicyDocument;
        if (policyDocument.Statement instanceof Array) {
          policyDocument.Statement.push(xrayPolicies);
        } else {
          const statement = policyDocument.Statement;
          policyDocument.Statement = [statement, xrayPolicies];
        }
      } else {
        const policyName = { [FN_JOIN]: ["-", [lambda.key, POLICY]] };
        const policyDocument = {
          Version: POLICY_DOCUMENT_VERSION,
          Statement: xrayPolicies,
        };
        role.Policies = [{ PolicyName: policyName, PolicyDocument: policyDocument }];
      }
      lambda.properties.TracingConfig = { Mode: ACTIVE };
    });
  }
  if (tracingMode === TracingMode.HYBRID || tracingMode === TracingMode.DD_TRACE) {
    log.debug("Enabling ddtrace for all Lambda functions...");
    lambdas.forEach((lambda) => {
      const environment = lambda.properties.Environment ?? {};
      const envVariables = environment.Variables ?? {};
      if (!envVariables.hasOwnProperty(DD_TRACE_ENABLED)) {
        envVariables[DD_TRACE_ENABLED] = true;
        log.debug(`${lambda.properties.FunctionName} skipped as DD_TRACE_ENABLED was defined on a function level`);
      }
      envVariables[DD_MERGE_XRAY_TRACES] = tracingMode === TracingMode.HYBRID;

      environment.Variables = envVariables;
      lambda.properties.Environment = environment;
    });
  }
}
