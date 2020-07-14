import { CloudWatchLogs } from "aws-sdk";
import { LambdaFunction } from "./layer";
import { TYPE, PROPERTIES } from "./index";

const LOG_GROUP_TYPE = "AWS::Logs::LogGroup";
const LOG_GROUP_SUBSCRIPTION_TYPE = "AWS::Logs::SubscriptionFilter";
const LAMBDA_LOG_GROUP_PREFIX = "/aws/lambda/";
const LOG_GROUP = "LogGroup";
const LOG_GROUP_NAME = "LogGroupName";
const SUBSCRIPTION = "Subscription";
const FN_SUB = "Fn::Sub";
const FN_JOIN = "Fn::Join";
const REF = "Ref";

interface LogGroup {
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
  region: string
) {
  const cloudWatchLogs = new CloudWatchLogs({ region });
  let logGroupsOnStack: CloudWatchLogs.LogGroups | undefined;
  let templateDeclaredLogGroups: LogGroup[] | undefined;
  // TODO: these could be only in the template, or they could be already created
  // (checking won't hurt, but will be double the work if they were already present
  // - in which case they would be returned by the describeLogGroups call)
  // Actually, not doing double the work, since if was already created we won't do the later check in the template?

  for (const lambda of lambdas) {
    let logGroup: CloudWatchLogs.LogGroup | undefined;
    let logGroupName: string | { [fn: string]: any } | undefined;

    // Look for existing log group
    if (lambda.properties.FunctionName) {
      logGroup = await findLogGroupWithFunctionName(
        cloudWatchLogs,
        lambda.properties.FunctionName
      );
    } else {
      if (logGroupsOnStack === undefined) {
        logGroupsOnStack = await getExistingLambdaLogGroups(
          cloudWatchLogs,
          stackName
        );
      }
      logGroup = logGroupsOnStack.find(
        (lg) =>
          lg.logGroupName &&
          lg.logGroupName.startsWith(
            `${LAMBDA_LOG_GROUP_PREFIX}${stackName}-${lambda.key}-`
          )
      );
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
        lambda.key
      );
      // Create new log group if it doesn't currently exist and was not declared in template
      logGroupName =
        declaredLogGroupName || createNewLogGroup(resources, lambda);
    }

    addSubscription(resources, forwarderArn, lambda.key, logGroupName);
  }
}

async function findLogGroupWithFunctionName(
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

async function getExistingLambdaLogGroups(
  cloudWatchLogs: CloudWatchLogs,
  stackName: string | undefined
) {
  // If no stack name is provided, cannot search through all lambda log groups
  if (stackName === undefined) {
    return [];
  }
  const args = {
    logGroupNamePrefix: `${LAMBDA_LOG_GROUP_PREFIX}${stackName}-`,
  };
  const response = await cloudWatchLogs.describeLogGroups(args).promise();
  const { logGroups } = response;
  return logGroups || [];
}

async function canSubscribeLogGroup(
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
    .filter(([_, resource]: [string, any]) => {
      if (resource[TYPE] === LOG_GROUP_TYPE) {
        const logGroupName: string = resource[PROPERTIES][LOG_GROUP_NAME];
        return logGroupName.startsWith(LAMBDA_LOG_GROUP_PREFIX);
      }
      return false;
    })
    .map(([key, resource]: [string, any]) => {
      return {
        key, // TODO: do we need the key?
        logGroupResource: resource,
      };
    });
}

function findDeclaredLogGroupName(logGroups: LogGroup[], functionKey: string) {
  for (const [_, resource] of Object.entries(logGroups)) {
    const logGroupName = resource.logGroupResource.Properties.LogGroupName;

    if (typeof logGroupName === "string") {
      if (logGroupName.includes(functionKey)) {
        return logGroupName;
      }
    } else {
      // logGroupName is not necessary a string (cases: Fn::Sub, Fn::Join)
      if (logGroupName[FN_SUB] !== undefined) {
        if (logGroupName[FN_SUB].includes(functionKey)) {
          return logGroupName;
        }
      } else if (logGroupName[FN_JOIN] !== undefined) {
        const params = logGroupName[FN_JOIN];
        for (const value of params[1]) {
          if (value[REF] !== undefined && value[REF].includes(functionKey)) {
            return logGroupName;
          }
        }
      }
    }
  }
}

function createNewLogGroup(resources: any, lambda: LambdaFunction) {
  const functionKey = lambda.key;
  const logGroupKey = `${functionKey}${LOG_GROUP}`;

  // The functionKey will either reference the FunctionName property, or the dynamically generated name
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
      LogGroupName,
    },
  };
  resources[subscriptionName] = subscription;
}
