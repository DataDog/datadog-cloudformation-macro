import { Resources } from "../types";
import log from "loglevel";
import { StateMachine } from "step_function/types";

const unsupportedCaseErrorMessage =
  "Step Function Instrumentation is not supported. \
Please open a feature request in https://github.com/DataDog/datadog-cdk-constructs.";

const FN_SUB = "Fn::Sub";
const FN_GET_ATT = "Fn::GetAtt";

/**
 * Set up logging for the given state machine:
 * 1. Set log level to ALL
 * 2. Set includeExecutionData to true
 * 3. Create a destination log group (if not set already)
 * 4. Add permissions to the state machine role to log to CloudWatch Logs
 */
export function setUpLogging(resources: Resources, stateMachine: StateMachine): void {
  log.debug(`Setting up logging`);
  if (!stateMachine.properties.LoggingConfiguration) {
    stateMachine.properties.LoggingConfiguration = {};
  }

  const logConfig = stateMachine.properties.LoggingConfiguration;

  logConfig.Level = "ALL";
  logConfig.IncludeExecutionData = true;
  if (!logConfig.Destinations) {
    log.debug(`Log destination not found, creating one`);
    const logGroupKey = createLogGroup(resources, stateMachine);
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

function createLogGroup(resources: Resources, stateMachine: StateMachine): string {
  const logGroupKey = `${stateMachine.resourceKey}LogGroup`;
  resources[logGroupKey] = {
    Type: "AWS::Logs::LogGroup",
    Properties: {
      LogGroupName: buildLogGroupName(stateMachine, undefined),
      RetentionInDays: 7,
    },
  };

  let role;
  if (stateMachine.properties.RoleArn) {
    log.debug(`A role is already defined. Parsing its resource key from the roleArn.`);
    const roleArn = stateMachine.properties.RoleArn;

    if (typeof roleArn !== "object") {
      throw new Error(`RoleArn is not an object. ${unsupportedCaseErrorMessage}`);
    }

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
  }

  log.debug(`Add a policy to the role to grant permissions to the log group`);
  if (!role.Properties.Policies) {
    role.Properties.Policies = [];
  }
  role.Properties.Policies.push({
    PolicyName: `${stateMachine.resourceKey}LogPolicy`,
    PolicyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
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
          ],
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
