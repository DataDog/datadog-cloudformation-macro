import { CloudWatchLogs } from "aws-sdk";
import { LambdaFunction } from "./layer";
import { Resources, LogGroup } from "../types";
import log from "loglevel";

const LOG_GROUP_TYPE = "AWS::Logs::LogGroup";
const SUBSCRIPTION_FILTER_TYPE = "AWS::Logs::SubscriptionFilter";
const LAMBDA_LOG_GROUP_PREFIX = "/aws/lambda/";
const FN_SUB = "Fn::Sub";
const FN_JOIN = "Fn::Join";
const REF = "Ref";
const MAX_ALLOWABLE_LOG_GROUP_SUBSCRIPTIONS = 2;
export const SUBSCRIPTION_FILTER_NAME = "datadog-serverless-macro-filter";

export interface LogGroupDefinition {
  key: string;
  logGroupResource: LogGroup;
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

export class MissingFunctionNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingFunctionNameError";
  }
}

export class MissingSubDeclarationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingSubDeclarationError";
  }
}

/**
 * To add the subscriptions for the provided forwarder ARN, we need the corresponding
 * log group for each lambda function.
 *
 * We first check if a log group exists for a given lambda. If it does, we then check if there
 * are existing subscriptions. If we do not find an existing datadog-cloudformation-macro subscription and
 * the number of existing subscription filters is less than the MAX_ALLOWABLE_LOG_GROUP_SUBSCRIPTIONS then
 * we will go ahead and add the subscription to the forwarder ARN (using AWS SDK). Otherwise we do not add
 * the subscription.
 *
 * If no log group exists and none are declared in the customer template, we will create one
 * through AWS SDK. We will also add a subscription to the forwarder ARN on this newly created
 * log group through AWS SDK.
 *
 * If a log group has been declared explicitly by the customer but has not been initialized,
 * we will not be able to add the subscription to the forwarder ARN. In this case, we throw an
 * error and ask the user to remove the log group declaration. (Details on why we cannot
 * create a subscription for this case below.)
 */
export async function addCloudWatchForwarderSubscriptions(
  resources: Resources,
  lambdas: LambdaFunction[],
  stackName: string | undefined,
  forwarderArn: string,
  cloudWatchLogs: CloudWatchLogs,
): Promise<void> {
  let logGroupsOnStack: CloudWatchLogs.LogGroups | undefined;
  let logGroupsInTemplate: LogGroupDefinition[] | undefined;
  let subscriptionsInTemplate: SubscriptionDefinition[] | undefined;
  let functionNamePrefix: string;

  for (const lambda of lambdas) {
    let logGroup: CloudWatchLogs.LogGroup | undefined;
    let logGroupName: string | { [fn: string]: any } | undefined;
    let logGroupKey: string | undefined;

    // If the lambda function has been run before, then a log group will already
    // exist, with a logGroupName property in the format '/aws/lambda/<function name>'
    // The function name could come from the 'FunctionName' property if the user explicitly named
    // their resource, or it could be dynamically generated.

    // Check if the 'FunctionName' property exists, and if it does, use that name
    // to search for existing log groups.
    if (lambda.properties.FunctionName) {
      functionNamePrefix = lambda.properties.FunctionName;
      log.debug(`Searching log groups using: ${functionNamePrefix}`);
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

      log.debug(`Searching log groups using: ${functionNamePrefix}`);
      if (logGroupsOnStack) {
        logGroup = logGroupsOnStack.find(
          (lg) => lg.logGroupName && lg.logGroupName.startsWith(`${LAMBDA_LOG_GROUP_PREFIX}${stackName}-${lambda.key}`),
        );
      }
    }

    if (logGroup) {
      // The log group exists in this case, so the logGroupName must also be defined, since
      // that's the property we used to find this log group.
      logGroupName = logGroup.logGroupName as string;
      log.debug(`Using existing log group: ${logGroupName}`);
      const shouldSub = await shouldSubscribeLogGroup(cloudWatchLogs, logGroupName);
      if (shouldSub) {
        log.debug(`Adding subscription filter for: ${logGroupName}`);
        await putSubscriptionFilter(cloudWatchLogs, forwarderArn, logGroupName);
      }
    } else {
      // If we were unable to find an existing log group, there are two more cases:
      // Either the user has declared a log group in their template explicitly, but has never
      // initialized it, or the user's template has no log group resource declared, and they
      // are relying on the implicit creation of log groups once they run their lambdas.

      // First check if user is already explicitly declaring log group resource in template,
      // so we avoid duplicate declarations (which would cause the deployment to fail).
      log.debug("Unable to find an existing log group");

      if (logGroupsInTemplate === undefined) {
        log.debug("Looking for log groups in CloudFormation template");
        logGroupsInTemplate = findLogGroupsInTemplate(resources);
      }
      const declaredLogGroup = findDeclaredLogGroup(logGroupsInTemplate, lambda.key, lambda.properties.FunctionName);

      if (declaredLogGroup) {
        logGroupName = declaredLogGroup.logGroupResource.Properties.LogGroupName;
        logGroupKey = declaredLogGroup.key;

        log.debug(`Found log group in CloudFormation template: ${logGroupName}`);

        if (subscriptionsInTemplate === undefined) {
          subscriptionsInTemplate = findSubscriptionsInTemplate(resources);
        }

        log.debug("Making sure log group subscription is defined in CloudFormation template");
        const declaredSub = findDeclaredSub(subscriptionsInTemplate, logGroupName, logGroupKey);
        if (declaredSub === undefined) {
          // In this case, we cannot use the 'putSubscriptionFilter' function from AWS SDK to add
          // a subscription because the log group has to be initialized first.

          // (A logical alternative is to add a subscription filter declaration to the template
          // instead of using AWS SDK. However, we will have to add the same subscription filter
          // to the template each time the macro runs, in order to ensure that the subscription
          // will not be removed in the change set. This requires some way of identifying which
          // subscriptions were created by our macro. Currently, the 'putSubscriptionFilter'
          // function in AWS SDK supports a 'filterName' parameter that would allow us to add a
          // Datadog specific filter name for this purpose, but the CloudFormation type for
          // subscriptions does not support this parameter. If the 'AWS::Logs::SubscriptionFilter'
          // type is updated with a 'filterName' param in the future, then we can implement this.)
          // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-logs-subscriptionfilter.html

          throw new MissingSubDeclarationError(
            `Found a declared log group for ${lambda.key} but no subscription filter declared for ${forwarderArn}. ` +
              `To allow the macro to automatically create a log group and subscription, please remove the log group declaration.`,
          );
        }
      } else {
        // If there's no existing log group and none were declared in the template for this lambda,
        // and the 'FunctionName' property exists, then we create a log group and subscription filter using AWS SDK.
        // If the function name is dynamically generated, we cannot predict the randomly generated
        // component, and will throw an error for the user to either add a function name or
        // declare a log group in their CloudFormation stack.

        log.debug("No declared log group description found in the CloudFormation template");
        if (lambda.properties.FunctionName) {
          logGroupName = `${LAMBDA_LOG_GROUP_PREFIX}${lambda.properties.FunctionName}`;
          log.debug(`Creating log group for: ${lambda.properties.FunctionName}`);
          await createLogGroup(cloudWatchLogs, logGroupName);

          log.debug(`Adding subscription filter for: ${logGroupName}`);
          await putSubscriptionFilter(cloudWatchLogs, forwarderArn, logGroupName);
        } else {
          throw new MissingFunctionNameError(
            `'FunctionName' property is undefined for ${lambda.key}, cannot create log group for CloudWatch subscriptions. ` +
              `Please add 'FunctionName' for ${lambda.key} or declare a log group for this Lambda function in your stack.`,
          );
        }
      }
    }
  }
}

export async function findExistingLogGroupWithFunctionName(
  cloudWatchLogs: CloudWatchLogs,
  functionName: string,
): Promise<any> {
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
  stackName: string,
): Promise<any> {
  const logGroupNamePrefix = `${LAMBDA_LOG_GROUP_PREFIX}${stackName}-`;
  const args = { logGroupNamePrefix };
  const response = await cloudWatchLogs.describeLogGroups(args).promise();
  const { logGroups } = response;

  return logGroups ?? [];
}

export async function shouldSubscribeLogGroup(cloudWatchLogs: CloudWatchLogs, logGroupName: string): Promise<boolean> {
  const subscriptionFilters = await describeSubscriptionFilters(cloudWatchLogs, logGroupName);
  const numberOfActiveSubscriptionFilters = subscriptionFilters.length;
  if (numberOfActiveSubscriptionFilters >= MAX_ALLOWABLE_LOG_GROUP_SUBSCRIPTIONS) {
    log.debug(`Log group already has 2 or more subscriptions: ${subscriptionFilters}`);
    return false;
  }
  for (const subscription of subscriptionFilters) {
    const filterName = subscription.filterName;
    if (filterName === SUBSCRIPTION_FILTER_NAME) {
      //We found an existing datadog-cloudformation-macro subscription
      log.debug("We found an existing datadog-cloudformation-macro subscription");
      return false;
    }
  }
  return true;
}

async function describeSubscriptionFilters(cloudWatchLogs: CloudWatchLogs, logGroupName: string): Promise<any> {
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

export function findDeclaredLogGroup(
  logGroups: LogGroupDefinition[],
  functionKey: string,
  functionName?: string,
): LogGroupDefinition | undefined {
  for (const resource of Object.values(logGroups)) {
    const logGroupName = resource.logGroupResource.Properties.LogGroupName;

    // If in this function, 'FunctionName' property doesn't exist on the lambda,
    // so search through logGroupNames that use intrinsic functions ('Fn::Sub', 'Fn::Join') in definition

    log.debug("Searching through logGroupNames that use intrinsic functions ('Fn::Sub', 'Fn::Join') in definition");
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

function findDeclaredSub(
  subscriptions: SubscriptionDefinition[],
  logGroupName: string | { [fn: string]: any },
  logGroupKey: string,
): SubscriptionDefinition | undefined {
  for (const subscription of subscriptions) {
    const subscribedLogGroupName = subscription.subscriptionResource.Properties.LogGroupName;
    if (typeof subscribedLogGroupName === "string" && subscribedLogGroupName.includes(logGroupKey)) {
      return subscription;
    }
    if (subscribedLogGroupName === logGroupName) {
      return subscription;
    }
  }
}

async function putSubscriptionFilter(
  cloudWatchLogs: CloudWatchLogs,
  forwarderArn: string,
  logGroupName: string,
): Promise<void> {
  const args = {
    destinationArn: forwarderArn,
    filterName: SUBSCRIPTION_FILTER_NAME,
    filterPattern: "",
    logGroupName,
  };
  await cloudWatchLogs.putSubscriptionFilter(args).promise();
}

async function createLogGroup(cloudWatchLogs: CloudWatchLogs, logGroupName: string): Promise<void> {
  const args = { logGroupName };
  await cloudWatchLogs.createLogGroup(args).promise();
}
