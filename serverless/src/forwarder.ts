import { CloudWatchLogs } from "aws-sdk";
import { LambdaFunction } from "./layer";
import { Resources } from "./index";

const LOG_GROUP_TYPE = "AWS::Logs::LogGroup";
const SUBSCRIPTION_FILTER_TYPE = "AWS::Logs::SubscriptionFilter";
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

interface SubscriptionResource {
  Type: string;
  DependsOn?: string;
  Properties: {
    DestinationArn: string;
    FilterPattern: string;
    LogGroupName: string | { [fn: string]: any };
    RoleArn?: string;
  };
}

export interface SubscriptionDefinition {
  key: string;
  subscriptionResource: SubscriptionResource;
}

/**
 * To add the subscriptions for the provided forwarder ARN, we need the corresponding
 * log group for each lambda function.
 *
 * We first check if there's an existing log group. If it exists, we then check if there are any
 * existing subscriptions. We can go ahead and add the subscription to the forwarder ARN if no
 * other unknown subscriptions exist.
 *
 * If no log group exists, then check if any are declared in the template (but not yet created).
 * If none are declared, we add a log group for the given lambda. In both cases, we also declare a
 * new subscription filter for the forwarder ARN on this log group.
 */
export async function addCloudWatchForwarderSubscriptions(
  resources: Resources,
  lambdas: LambdaFunction[],
  stackName: string | undefined,
  forwarderArn: string,
  cloudWatchLogs: CloudWatchLogs,
) {
  let logGroupsOnStack: CloudWatchLogs.LogGroups | undefined;
  let logGroupsInTemplate: LogGroupDefinition[] | undefined;
  let subscriptionsInTemplate: SubscriptionDefinition[] | undefined;
  let functionNamePrefix: string;
  let addSubscription: boolean;

  for (const lambda of lambdas) {
    let logGroup: CloudWatchLogs.LogGroup | undefined;
    let logGroupName: string | { [fn: string]: any } | undefined;

    // If the lambda function has been run before, then a log group will already
    // exist, with a logGroupName property in the format '/aws/lambda/<function name>'
    // The function name could come from the 'FunctionName' property if the user explicitly named
    // their resource, or it could be dynamically generated.

    // Check if the 'FunctionName' property exists, and if it does, use that name
    // to search for existing log groups.
    if (lambda.properties.FunctionName) {
      functionNamePrefix = lambda.properties.FunctionName;
      logGroup = await findExistingLogGroupWithFunctionName(cloudWatchLogs, lambda.properties.FunctionName);
    } else {
      // If the lambda function is not explicity named, we search for existing log groups
      // by using the known patterns for dynamically generated names.
      // For SAM and CDK, the logGroupName will start with: '/aws/lambda/<stack name>-<lambda resource logical id>'
      functionNamePrefix = `${stackName}-${lambda.key}`;

      // To avoid making one call through the AWS SDK for each lambda, first find all the lambda
      // related log groups on this stack, and search through that list after for a given lambda name.
      if (logGroupsOnStack === undefined && stackName !== undefined) {
        logGroupsOnStack = await getExistingLambdaLogGroupsOnStack(cloudWatchLogs, stackName);
      }
      if (logGroupsOnStack !== undefined) {
        logGroup = logGroupsOnStack.find(
          (lg) => lg.logGroupName && lg.logGroupName.startsWith(`${LAMBDA_LOG_GROUP_PREFIX}${stackName}-${lambda.key}`),
        );
      }
    }

    // If there is a user declared log group/if this macro adds a log group declaration, save the logical id
    // to add as a dependency. This prevents the subscription filter being created before the log group is.
    // (Will stay undefined if a log group already exists, and will not be used.)
    let logGroupKey: string | undefined;

    // If log group exists, we need to check if there are any existing subsciption filters.
    // We will only add a new subscription to the provided forwarder ARN if no current subscriptions exist.
    if (logGroup !== undefined) {
      // Since the log group exists in this case, the logGroupName must also be defined, since
      // that's the property we used to find this log group.
      logGroupName = logGroup.logGroupName as string;
      addSubscription = await canSubscribeLogGroup(cloudWatchLogs, logGroupName, functionNamePrefix);
    } else {
      // If we were unable to find an existing log group, there are two more cases:
      // Either the user has declared a log group in their template explicitly, but has never
      // initialized it, or the user's template has no log group resource declared, and they
      // are relying on the implicit creation of log groups once they run their lambdas.

      // First check if user is already explicitly declaring log group resource in template,
      // so we avoid duplicate declarations (which would cause the deployment to fail).
      if (logGroupsInTemplate === undefined) {
        logGroupsInTemplate = findLogGroupsInTemplate(resources);
      }
      const declaredLogGroup = findDeclaredLogGroup(logGroupsInTemplate, lambda.key, lambda.properties.FunctionName);

      if (declaredLogGroup) {
        logGroupName = declaredLogGroup.logGroupResource.Properties.LogGroupName;
        logGroupKey = declaredLogGroup.key;
        if (subscriptionsInTemplate === undefined) {
          subscriptionsInTemplate = findSubscriptionsInTemplate(resources);
        }
        // If a log group has already been declared but not yet initialized, check if any
        // subscriptions are declared, so we don't overwrite them.
        addSubscription = !isSubscriptionAlreadyDeclared(subscriptionsInTemplate, logGroupName, declaredLogGroup.key);
      } else {
        // If there's no existing log group and none were declared in the template for this lambda,
        // then we create a new log group by declaring one in the template.
        logGroupKey = `${lambda.key}${LOG_GROUP}`;
        logGroupName = addLogGroupToTemplate(resources, lambda, logGroupKey);
        addSubscription = true;
      }
    }

    if (addSubscription) {
      addSubscriptionToTemplate(resources, forwarderArn, lambda.key, logGroupName, logGroupKey);
    }
  }
}

export async function findExistingLogGroupWithFunctionName(cloudWatchLogs: CloudWatchLogs, functionName: string) {
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

export async function getExistingLambdaLogGroupsOnStack(cloudWatchLogs: CloudWatchLogs, stackName: string) {
  const logGroupNamePrefix = `${LAMBDA_LOG_GROUP_PREFIX}${stackName}-`;
  const args = { logGroupNamePrefix };
  const response = await cloudWatchLogs.describeLogGroups(args).promise();
  const { logGroups } = response;

  return logGroups ?? [];
}

export async function canSubscribeLogGroup(
  cloudWatchLogs: CloudWatchLogs,
  logGroupName: string,
  expectedSubName: string,
) {
  const subscriptionFilters = await describeSubscriptionFilters(cloudWatchLogs, logGroupName);
  let hasUnknownSubscriptions = false;

  for (const subscription of subscriptionFilters) {
    const filterName = subscription.filterName;
    if (filterName && filterName.startsWith(expectedSubName)) {
      // If this is a subscription filter this macro previously created for this lambda,
      // it needs to be kept in the template so the SubscriptionFilter resource is not
      // removed from the template and deleted.
      return true;
    }
    // If there are any unknown subscriptions, it's possible we cannot add a subscription
    // for the forwarder.
    hasUnknownSubscriptions = true;
  }
  // If no unknown subscriptions exist, possible to subscribe.
  return !hasUnknownSubscriptions;
}

async function describeSubscriptionFilters(cloudWatchLogs: CloudWatchLogs, logGroupName: string) {
  const request = { logGroupName };
  const response = await cloudWatchLogs.describeSubscriptionFilters(request).promise();
  return response.subscriptionFilters ?? [];
}

function findLogGroupsInTemplate(resources: Resources) {
  return Object.entries(resources)
    .filter(([_, resource]) => resource.Type === LOG_GROUP_TYPE)
    .map(([key, logGroupResource]) => {
      return { key, logGroupResource };
    });
}

export function findDeclaredLogGroup(logGroups: LogGroupDefinition[], functionKey: string, functionName?: string) {
  for (const resource of Object.values(logGroups)) {
    const logGroupName = resource.logGroupResource.Properties.LogGroupName;

    // If in this function, 'FunctionName' property doesn't exist on the lambda,
    // so search through logGroupNames that use intrinsic functions ('Fn::Sub', 'Fn::Join') in definition

    if (typeof logGroupName === "string") {
      if (functionName && logGroupName.includes(functionName)) {
        return resource;
      }
    } else {
      if (logGroupName[FN_SUB] !== undefined) {
        if (logGroupName[FN_SUB].includes(`$\{${functionKey}}`)) {
          return resource;
        }
      } else if (logGroupName[FN_JOIN] !== undefined) {
        const params = logGroupName[FN_JOIN];
        for (const value of params[1]) {
          if (value[REF] !== undefined && value[REF] === functionKey) {
            return resource;
          }
        }
      }
    }
  }
}

function findSubscriptionsInTemplate(resources: Resources) {
  return Object.entries(resources)
    .filter(([_, resource]) => resource.Type === SUBSCRIPTION_FILTER_TYPE)
    .map(([key, subscriptionResource]) => {
      return { key, subscriptionResource };
    });
}

function isSubscriptionAlreadyDeclared(
  subscriptions: SubscriptionDefinition[],
  logGroupName: string | { [fn: string]: any },
  logGroupKey: string,
) {
  for (const subscription of subscriptions) {
    const subscribedLogGroupName = subscription.subscriptionResource.Properties.LogGroupName;
    if (typeof subscribedLogGroupName === "string" && subscribedLogGroupName.includes(logGroupKey)) {
      return true;
    }
    if (subscribedLogGroupName === logGroupName) {
      return true;
    }
  }
  return false;
}

function addLogGroupToTemplate(resources: Resources, lambda: LambdaFunction, logGroupKey: string) {
  // '${functionKey}' will either reference the FunctionName property if it exists,
  // or the dynamically generated name
  const logGroupName = {
    "Fn::Sub": `${LAMBDA_LOG_GROUP_PREFIX}\${${lambda.key}}`,
  };
  resources[logGroupKey] = {
    Type: LOG_GROUP_TYPE,
    Properties: { LogGroupName: logGroupName },
  };
  return logGroupName;
}

function addSubscriptionToTemplate(
  resources: Resources,
  forwarderArn: string,
  functionKey: string,
  logGroupName: string | { [fn: string]: any },
  logGroupKey: string | undefined,
) {
  const subscriptionName = `${functionKey}${LOG_GROUP}${SUBSCRIPTION}`;
  const subscription: SubscriptionResource = {
    Type: SUBSCRIPTION_FILTER_TYPE,
    Properties: {
      DestinationArn: forwarderArn,
      FilterPattern: "",
      LogGroupName: logGroupName,
    },
  };
  // If a log group is declared in the template, reference the logical id of the log group
  // to ensure that the subscription filter is created after the log group.
  if (logGroupKey) {
    subscription.DependsOn = logGroupKey;
  }
  resources[subscriptionName] = subscription;
}
