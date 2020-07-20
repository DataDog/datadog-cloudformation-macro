import { CloudWatchLogs } from "aws-sdk";
import { LambdaFunction } from "./layer";
import { TYPE } from "./index";

const LOG_GROUP_TYPE = "AWS::Logs::LogGroup";
const LOG_GROUP_SUBSCRIPTION_TYPE = "AWS::Logs::SubscriptionFilter";
const LAMBDA_LOG_GROUP_PREFIX = "/aws/lambda/";
const LOG_GROUP = "LogGroup";
const SUBSCRIPTION = "Subscription";
const FN_SUB = "Fn::Sub";
const FN_JOIN = "Fn::Join";
const REF = "Ref";

export interface LogGroupDefinition {
  key: string;
  logGroupResource: {
    Type: string;
    Properties: {
      LogGroupName: string | { [fn: string]: any };
    };
  };
}

export async function addCloudWatchForwarderSubscriptions(
  resources: any,
  lambdas: LambdaFunction[],
  stackName: string | undefined,
  forwarderArn: string,
  cloudWatchLogs: CloudWatchLogs
) {
  let logGroupsOnStack: CloudWatchLogs.LogGroups | undefined;
  let templateDeclaredLogGroups: LogGroupDefinition[] | undefined;

  for (const lambda of lambdas) {
    let logGroup: CloudWatchLogs.LogGroup | undefined;
    let logGroupName: string | { [fn: string]: any } | undefined;

    // Look for existing log group
    if (lambda.properties.FunctionName) {
      logGroup = await findExistingLogGroupWithFunctionName(
        cloudWatchLogs,
        lambda.properties.FunctionName
      );
    } else {
      if (logGroupsOnStack === undefined && stackName !== undefined) {
        logGroupsOnStack = await getExistingLambdaLogGroupsOnStack(
          cloudWatchLogs,
          stackName
        );
      }
      if (logGroupsOnStack !== undefined) {
        logGroup = logGroupsOnStack.find(
          (lg) =>
            lg.logGroupName &&
            lg.logGroupName.startsWith(
              `${LAMBDA_LOG_GROUP_PREFIX}${stackName}-${lambda.key}`
            )
        );
      }
    }

    // If log group exists, check if there are any subsciption filters
    if (logGroup !== undefined) {
      // Given that the log group was found through the logGroupName, this cannot be undefined
      logGroupName = logGroup.logGroupName as string;
      const canSubscribe = await canSubscribeLogGroup(
        cloudWatchLogs,
        logGroupName
      );
      if (!canSubscribe) {
        return;
      }
    } else {
      // Check if user is already explicitly declaring log group resource in template
      if (templateDeclaredLogGroups === undefined) {
        templateDeclaredLogGroups = findLogGroupsInTemplate(resources);
      }
      const declaredLogGroupName = findDeclaredLogGroupName(
        templateDeclaredLogGroups,
        lambda.key,
        lambda.properties.FunctionName
      );
      // Create new log group if it doesn't currently exist and was not declared in template
      logGroupName =
        declaredLogGroupName || declareNewLogGroup(resources, lambda);
    }

    // TODO: check if correct subscription already exists?
    addSubscription(resources, forwarderArn, lambda.key, logGroupName);
  }
}

export async function findExistingLogGroupWithFunctionName(
  cloudWatchLogs: CloudWatchLogs,
  functionName: string
) {
  const logGroupName = `${LAMBDA_LOG_GROUP_PREFIX}${functionName}`;
  const args = {
    logGroupNamePrefix: logGroupName,
  };
  const response = await cloudWatchLogs.describeLogGroups(args).promise();
  const { logGroups } = response;
  if (logGroups === undefined) {
    return;
  }
  return logGroups.find((lg) => lg.logGroupName === logGroupName);
}

export async function getExistingLambdaLogGroupsOnStack(
  cloudWatchLogs: CloudWatchLogs,
  stackName: string
) {
  const logGroupNamePrefix = `${LAMBDA_LOG_GROUP_PREFIX}${stackName}-`;
  const args = { logGroupNamePrefix };
  const response = await cloudWatchLogs.describeLogGroups(args).promise();
  const { logGroups } = response;

  return logGroups ?? [];
}

export async function canSubscribeLogGroup(
  cloudWatchLogs: CloudWatchLogs,
  logGroupName: string
) {
  const request = { logGroupName };
  const response = await cloudWatchLogs
    .describeSubscriptionFilters(request)
    .promise();
  const { subscriptionFilters } = response;

  // Not possible to subscribe if there are existing subscriptions
  return subscriptionFilters === undefined || subscriptionFilters.length === 0;
}

function findLogGroupsInTemplate(resources: any) {
  return Object.entries(resources)
    .filter(([_, resource]: [string, any]) => resource[TYPE] === LOG_GROUP_TYPE)
    .map(([key, resource]: [string, any]) => {
      return {
        key,
        logGroupResource: resource,
      };
    });
}

export function findDeclaredLogGroupName(
  logGroups: LogGroupDefinition[],
  functionKey: string,
  functionName?: string
) {
  for (const [_, resource] of Object.entries(logGroups)) {
    const logGroupName = resource.logGroupResource.Properties.LogGroupName;

    // If in this function, 'FunctionName' property doesn't exist on the lambda,
    // so search through logGroupNames that use intrinsic functions ('Fn::Sub', 'Fn::Join') in definition

    if (typeof logGroupName === "string") {
      if (functionName && logGroupName.includes(functionName)) {
        return logGroupName;
      }
    } else {
      if (logGroupName[FN_SUB] !== undefined) {
        if (logGroupName[FN_SUB].includes(`\$\{${functionKey}\}`)) {
          return logGroupName;
        }
      } else if (logGroupName[FN_JOIN] !== undefined) {
        const params = logGroupName[FN_JOIN];
        for (const value of params[1]) {
          if (value[REF] !== undefined && value[REF] === functionKey) {
            return logGroupName;
          }
        }
      }
    }
  }
}

function declareNewLogGroup(resources: any, lambda: LambdaFunction) {
  const functionKey = lambda.key;
  const logGroupKey = `${functionKey}${LOG_GROUP}`;

  // ${functionKey} will either reference the FunctionName property if it exists,
  // or the dynamically generated name
  const LogGroupName = {
    "Fn::Sub": `${LAMBDA_LOG_GROUP_PREFIX}\${${functionKey}}`,
  };
  resources[logGroupKey] = {
    Type: LOG_GROUP_TYPE,
    Properties: { LogGroupName },
  };
  return LogGroupName;
}

function addSubscription(
  resources: any,
  forwarderArn: string,
  functionKey: string,
  LogGroupName: string | { [fn: string]: any }
) {
  const subscriptionName = `${functionKey}${SUBSCRIPTION}`;
  const subscription = {
    Type: LOG_GROUP_SUBSCRIPTION_TYPE,
    Properties: {
      DestinationArn: forwarderArn,
      FilterPattern: "",
      FilterName: "datadog-macro-filter",
      LogGroupName,
    },
  };
  resources[subscriptionName] = subscription;
}
