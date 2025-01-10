import { Resources, LogGroup } from "../types";
import log from "loglevel";
import { StateMachine } from "./types";
import { Configuration } from "./env";

const unsupportedCaseErrorMessage =
  "Step Function Instrumentation is not supported. \
Please open a feature request in https://github.com/DataDog/datadog-cloudformation-macro.";

const FN_SUB = "Fn::Sub";
export const FN_GET_ATT = "Fn::GetAtt";
// Permissions required for the state machine role to log to CloudWatch Logs
export const ROLE_ACTIONS = [
  "logs:CreateLogDelivery",
  "logs:CreateLogStream",
  "logs:GetLogDelivery",
  "logs:UpdateLogDelivery",
  "logs:DeleteLogDelivery",
  "logs:ListLogDeliveries",
  "logs:PutLogEvents",
  "logs:PutResourcePolicy",
  "logs:DescribeResourcePolicies",
  "logs:DescribeLogGroups",
];

/**
 * Set up logging for the given state machine:
 * 1. Set log level to ALL
 * 2. Set includeExecutionData to true
 * 3. Create a destination log group (if not set already)
 * 4. Add permissions to the state machine role to log to CloudWatch Logs
 */
export function setUpLogging(resources: Resources, config: Configuration, stateMachine: StateMachine): void {
  log.debug(`Setting up logging`);
  if (!stateMachine.properties.LoggingConfiguration) {
    stateMachine.properties.LoggingConfiguration = {};
  }

  const logConfig = stateMachine.properties.LoggingConfiguration;

  logConfig.Level = "ALL";
  logConfig.IncludeExecutionData = true;

  if (!logConfig.Destinations) {
    log.debug(`Log destination not found, creating one`);
    const logGroupKey = createLogGroup(resources, config, stateMachine);
    logConfig.Destinations = [
      {
        CloudWatchLogsLogGroup: {
          LogGroupArn: {
            "Fn::GetAtt": [logGroupKey, "Arn"],
          },
        },
      },
    ];
  } else {
    log.debug(`Log destination already exists, skipping creating one`);
  }
}

function createLogGroup(resources: Resources, config: Configuration, stateMachine: StateMachine): string {
  const logGroupKey = `${stateMachine.resourceKey}LogGroup`;
  resources[logGroupKey] = {
    Type: "AWS::Logs::LogGroup",
    Properties: {
      LogGroupName: buildLogGroupName(stateMachine, config.env),
      RetentionInDays: 7,
    },
  };

  let role;
  if (stateMachine.properties.RoleArn) {
    log.debug(`A role is already defined. Parsing its resource key from the roleArn.`);
    const roleArn = stateMachine.properties.RoleArn;

    // We assume that if a role is set on the state machine, then it is defined in the same
    // CloudFormation stack (and roleArn is likely an object that references the role),
    // so we can add a permission policy to the role. Otherwise, if the roleArn is
    // a hard-coded string, which likely means the role is defined outside the stack, then
    // we will need to explore other ways to add the permission policy.
    if (typeof roleArn !== "object") {
      throw new Error(`RoleArn is not an object: ${roleArn}. ${unsupportedCaseErrorMessage}`);
    }

    // There are many ways a user can specify a state machine role in a CloudFormation template. For now
    // we only support the simple cases. We can support more cases as needed.
    // For each case, extract the role key from roleArn.
    let roleKey;
    if (roleArn[FN_GET_ATT]) {
      // e.g.
      //   Fn::GetAtt: [MyStateMachineRole, "Arn"]
      roleKey = roleArn[FN_GET_ATT][0];
    } else if (roleArn[FN_SUB]) {
      // e.g.
      //   Fn::Sub: ${StatesExecutionRole.Arn}
      const arnMatch = roleArn[FN_SUB].match(/^\${(.*)\.Arn}$/);
      if (arnMatch) {
        roleKey = arnMatch[1];
      } else {
        throw new Error(`Unsupported Fn::Sub format: ${roleArn[FN_SUB]}. ${unsupportedCaseErrorMessage}`);
      }
    } else {
      throw new Error(`Unsupported RoleArn format: ${roleArn}. ${unsupportedCaseErrorMessage}`);
    }
    log.debug(`Found State Machine role Key: ${roleKey}`);
    role = resources[roleKey];
  } else {
    log.debug(`No role is defined. Creating one.`);
    const roleKey = `${stateMachine.resourceKey}Role`;
    role = {
      Type: "AWS::IAM::Role",
      Properties: {
        AssumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: "states.amazonaws.com",
              },
              Action: "sts:AssumeRole",
            },
          ],
        },
        Policies: [],
      },
    };
    resources[roleKey] = role;
    stateMachine.properties.RoleArn = { FN_GET_ATT: [roleKey, "Arn"] };
  }

  log.debug(`Adding a policy to the role to grant permissions to the log group`);
  if (!role.Properties.Policies) {
    role.Properties.Policies = [];
  }
  role.Properties.Policies.push({
    PolicyName: `${stateMachine.resourceKey}LogPolicy`,
    // Copied from https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html#cloudwatch-iam-policy
    PolicyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ROLE_ACTIONS,
          Resource: "*",
        },
      ],
    },
  });

  return logGroupKey;
}

/**
 * Builds log group name for a state machine.
 * @returns log group name like "/aws/vendedlogs/states/MyStateMachine-Logs" (without env)
 *                           or "/aws/vendedlogs/states/MyStateMachine-Logs-dev" (with env)
 */
export const buildLogGroupName = (stateMachine: StateMachine, env: string | undefined): string => {
  return `/aws/vendedlogs/states/${stateMachine.resourceKey}-Logs${env !== undefined ? "-" + env : ""}`;
};

/**
 * Find the log group CloudFormation resource for the given state machine.
 * We require that:
 * 1. The log group is created in the same stack as the state machine.
 * 2. The state machine references the log group using Fn::GetAtt, e.g.
 *    "Fn::GetAtt": ["MyStateMachineLogGroup", "Arn"]
 *    which is the most common way of referencing a log group.
 * We can add support for other cases when users request it.
 */
export function findLogGroup(resources: Resources, stateMachine: StateMachine): LogGroup {
  const logConfig = stateMachine.properties.LoggingConfiguration;

  if (!logConfig?.Destinations) {
    // This should never happen because we should have set up a log group if it doesn't exist.
    throw new Error(`Log config or destination not found for state machine ${stateMachine.resourceKey}`);
  }

  const logGroupArn = logConfig.Destinations[0].CloudWatchLogsLogGroup.LogGroupArn;
  if (typeof logGroupArn === "string") {
    throw new Error(`logGroupArn is a string: ${logGroupArn}. ${unsupportedCaseErrorMessage}`);
  }

  if (!logGroupArn[FN_GET_ATT] || logGroupArn[FN_GET_ATT].length !== 2 || logGroupArn[FN_GET_ATT][1] !== "Arn") {
    throw new Error(
      `logGroupArn is not specified using Fn::GetAtt in the common way: ${JSON.stringify(logGroupArn)}. ${unsupportedCaseErrorMessage}`,
    );
  }
  const logGroupKey = logGroupArn[FN_GET_ATT][0];
  const logGroup = resources[logGroupKey];
  return logGroup;
}
