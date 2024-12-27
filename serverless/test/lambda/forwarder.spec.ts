import { CloudWatchLogs } from "aws-sdk";
import {
  findExistingLogGroupWithFunctionName,
  getExistingLambdaLogGroupsOnStack,
  shouldSubscribeLogGroup,
  findDeclaredLogGroup,
  addCloudWatchForwarderSubscriptions,
  LogGroupDefinition,
  SUBSCRIPTION_FILTER_NAME,
} from "../../src/lambda/forwarder";
import { LambdaFunction, RuntimeType } from "../../src/lambda/layer";

function mockCloudWatchLogs(
  logGroups: Record<
    string,
    {
      logGroup: CloudWatchLogs.LogGroup;
      filters?: CloudWatchLogs.DescribeSubscriptionFiltersResponse;
    }
  >,
) {
  return {
    describeLogGroups: jest.fn().mockImplementation(({ logGroupNamePrefix }) => {
      const response: CloudWatchLogs.DescribeLogGroupsResponse = {};
      for (const logGroupName of Object.keys(logGroups)) {
        if (logGroupName.startsWith(logGroupNamePrefix)) {
          const lg = logGroups[logGroupName].logGroup;
          if (response.logGroups === undefined) {
            response.logGroups = [lg];
          } else {
            response.logGroups.push(lg);
          }
        }
      }
      return { promise: () => Promise.resolve(response) };
    }),
    describeSubscriptionFilters: jest.fn().mockImplementation(({ logGroupName }) => {
      const response = logGroups[logGroupName]?.filters ?? {};
      return { promise: () => Promise.resolve(response) };
    }),
    putSubscriptionFilter: jest.fn().mockImplementation(() => {
      return { promise: () => Promise.resolve() };
    }),
    createLogGroup: jest.fn().mockImplementation(() => {
      return { promise: () => Promise.resolve() };
    }),
  };
}

function mockResources(lambdas: LambdaFunction[], logGroups?: LogGroupDefinition[]) {
  const resources: Record<string, any> = {};
  for (const lambda of lambdas) {
    resources[lambda.key] = {
      Type: "AWS::Lambda::Function",
      Properties: lambda.properties,
    };
  }
  if (logGroups) {
    for (const lg of logGroups) {
      resources[lg.key] = lg.logGroupResource;
    }
  }
  return resources;
}

function mockLambdaFunction(key: string, functionName?: string) {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: "nodejs12.x",
      Role: "role-arn",
      FunctionName: functionName,
    },
    key,
    runtimeType: RuntimeType.NODE,
    runtime: "nodejs12.x",
  } as LambdaFunction;
}

function mockLogGroupResource(key: string, logGroupName: string | Record<string, any>) {
  return {
    key,
    logGroupResource: {
      Type: "AWS::Logs::LogGroup",
      Properties: { LogGroupName: logGroupName },
    },
  };
}

describe("addCloudWatchForwarderSubscriptions", () => {
  it("'FunctionName' property exists and log group already exists", async () => {
    // Log group exists but is not declared in template (the log group was implicitly
    // created when the Lambda function ran)

    const lambda = mockLambdaFunction("FunctionKey", "FunctionName");
    const resources = mockResources([lambda]);
    const forwarder = "forwarder-arn";
    const logGroupName = "/aws/lambda/FunctionName";
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: { logGroup: { logGroupName }, filters: {} },
    });
    await addCloudWatchForwarderSubscriptions(resources, [lambda], undefined, forwarder, cloudWatchLogs as any);

    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({ logGroupNamePrefix: logGroupName });
    expect(cloudWatchLogs.describeSubscriptionFilters).toHaveBeenCalledWith({ logGroupName });
    expect(cloudWatchLogs.createLogGroup).not.toHaveBeenCalled();
    expect(cloudWatchLogs.putSubscriptionFilter).toHaveBeenCalledWith({
      destinationArn: forwarder,
      filterName: SUBSCRIPTION_FILTER_NAME,
      filterPattern: "",
      logGroupName,
    });
    expect(resources).toEqual(mockResources([lambda])); // template should not be modified
  });

  it("function name is dynamically generated and log group already exists", async () => {
    // Log group exists but is not declared in template (the log group was implicitly
    // created when the Lambda function ran)

    const lambda = mockLambdaFunction("FunctionKey");
    const resources = mockResources([lambda]);
    const forwarder = "forwarder-arn";
    const logGroupName = "/aws/lambda/stack-name-FunctionKey-1234";
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: { logGroup: { logGroupName }, filters: {} },
    });
    await addCloudWatchForwarderSubscriptions(resources, [lambda], "stack-name", forwarder, cloudWatchLogs as any);

    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({ logGroupNamePrefix: "/aws/lambda/stack-name-" });
    expect(cloudWatchLogs.describeSubscriptionFilters).toHaveBeenCalledWith({ logGroupName });
    expect(cloudWatchLogs.createLogGroup).not.toHaveBeenCalled();
    expect(cloudWatchLogs.putSubscriptionFilter).toHaveBeenCalledWith({
      destinationArn: forwarder,
      filterName: SUBSCRIPTION_FILTER_NAME,
      filterPattern: "",
      logGroupName,
    });
    expect(resources).toEqual(mockResources([lambda])); // template should not be modified
  });

  //At the moment this test assumes a log group subscriptions is full when it has 2 existing subscriptions.
  it("does not overwrite existing subscriptions on a log group that already has the maximum number of subscriptions", async () => {
    const lambda = mockLambdaFunction("FunctionKey", "FunctionName");
    const resources = mockResources([lambda]);
    const logGroupName = "/aws/lambda/FunctionName";
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: {
        logGroup: { logGroupName },
        filters: {
          subscriptionFilters: [
            {
              destinationArn: "other-forwarder-arn",
              filterName: "other-filter",
              logGroupName,
            },
            {
              destinationArn: "other-forwarder-arn2",
              filterName: "other-filter2",
              logGroupName,
            },
          ],
        },
      },
    });
    await addCloudWatchForwarderSubscriptions(resources, [lambda], undefined, "forwarder-arn", cloudWatchLogs as any);
    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({ logGroupNamePrefix: logGroupName });
    expect(cloudWatchLogs.describeSubscriptionFilters).toHaveBeenCalledWith({ logGroupName });
    expect(cloudWatchLogs.createLogGroup).not.toHaveBeenCalled();
    expect(cloudWatchLogs.putSubscriptionFilter).not.toHaveBeenCalled();
  });

  it("errors if log group does not exist, but is declared in template", async () => {
    const dynamicallyNamedLambda = mockLambdaFunction("FunctionKey");
    const logGroup = {
      key: "FunctionKeyLogGroup",
      logGroupResource: {
        Type: "AWS::Logs::LogGroup",
        Properties: {
          LogGroupName: { "Fn::Sub": "/aws/lambda/${FunctionKey}" },
        },
      },
    };
    const resources = mockResources([dynamicallyNamedLambda], [logGroup]);
    const cloudWatchLogs = mockCloudWatchLogs({});

    await expect(
      addCloudWatchForwarderSubscriptions(
        resources,
        [dynamicallyNamedLambda],
        "stack-name",
        "forwarder-arn",
        cloudWatchLogs as any,
      ),
    ).rejects.toThrow(
      "Found a declared log group for FunctionKey but no subscription filter declared for forwarder-arn." +
        " To allow the macro to automatically create a log group and subscription, please remove the log group declaration.",
    );
    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({
      logGroupNamePrefix: "/aws/lambda/stack-name-",
    });
    expect(cloudWatchLogs.describeSubscriptionFilters).not.toHaveBeenCalled();
  });

  it("macro creates log group and subscription when function name is provided", async () => {
    // The log group does not exist, and is not declared by the customer.
    // Because we have the 'FunctionName' property for this Lambda function, we can create the
    // log group and subscription to the forwarder ARN through AWS SDK.

    const lambda = mockLambdaFunction("FunctionKey", "FunctionName");
    const resources = mockResources([lambda]);
    const forwarder = "forwarder-arn";
    const logGroupName = "/aws/lambda/FunctionName";
    const cloudWatchLogs = mockCloudWatchLogs({});
    await addCloudWatchForwarderSubscriptions(resources, [lambda], undefined, forwarder, cloudWatchLogs as any);

    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({ logGroupNamePrefix: logGroupName });
    expect(cloudWatchLogs.describeSubscriptionFilters).not.toHaveBeenCalled();
    expect(cloudWatchLogs.createLogGroup).toHaveBeenCalledWith({ logGroupName });
    expect(cloudWatchLogs.putSubscriptionFilter).toHaveBeenCalledWith({
      destinationArn: forwarder,
      filterName: SUBSCRIPTION_FILTER_NAME,
      filterPattern: "",
      logGroupName,
    });
    expect(resources).toEqual(mockResources([lambda])); // template should not be modified
  });

  it("log group and correct subscription already previously created by macro", async () => {
    const lambda = mockLambdaFunction("FunctionKey", "FunctionName");
    const resources = mockResources([lambda]);
    const forwarder = "forwarder-arn";
    const logGroupName = "/aws/lambda/FunctionName";
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: {
        logGroup: { logGroupName },
        filters: {
          subscriptionFilters: [
            {
              destinationArn: forwarder,
              filterName: SUBSCRIPTION_FILTER_NAME,
              logGroupName,
            },
          ],
        },
      },
    });
    await addCloudWatchForwarderSubscriptions(resources, [lambda], undefined, forwarder, cloudWatchLogs as any);

    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({ logGroupNamePrefix: logGroupName });
    expect(cloudWatchLogs.describeSubscriptionFilters).toHaveBeenCalledWith({ logGroupName });
    expect(cloudWatchLogs.createLogGroup).not.toHaveBeenCalled();
    expect(cloudWatchLogs.putSubscriptionFilter).not.toHaveBeenCalled();
  });

  it("log group and subscription are not initialized, but are declared", async () => {
    const lambda = mockLambdaFunction("FunctionKey", "FunctionName");
    const logGroupName = "/aws/lambda/FunctionName";
    const forwarder = "forwarder-arn";

    const logGroup = {
      key: "FunctionKeyLogGroup",
      logGroupResource: {
        Type: "AWS::Logs::LogGroup",
        Properties: {
          LogGroupName: logGroupName,
        },
      },
    };

    const resources = mockResources([lambda], [logGroup]);
    const declaredSubscription = {
      Type: "AWS::Logs::SubscriptionFilter",
      Properties: {
        DestinationArn: forwarder,
        FilterPattern: "",
        LogGroupName: logGroup.logGroupResource.Properties.LogGroupName,
      },
    };
    resources.FunctionKeySubscription = declaredSubscription;
    const cloudWatchLogs = mockCloudWatchLogs({});
    await addCloudWatchForwarderSubscriptions(
      resources,
      [lambda],
      undefined, // no need for stackName, lambda is explicitly named
      forwarder,
      cloudWatchLogs as any,
    );

    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({ logGroupNamePrefix: logGroupName });
    expect(cloudWatchLogs.describeSubscriptionFilters).not.toHaveBeenCalled();
    expect(cloudWatchLogs.createLogGroup).not.toHaveBeenCalled();
    expect(cloudWatchLogs.putSubscriptionFilter).not.toHaveBeenCalled();
    expect(resources).toEqual({
      // log groups and subscriptions are unchanged
      FunctionKey: {
        Type: "AWS::Lambda::Function",
        Properties: lambda.properties,
      },
      FunctionKeyLogGroup: logGroup.logGroupResource,
      FunctionKeySubscription: declaredSubscription,
    });
  });
});

describe("findExistingLogGroupWithFunctionName", () => {
  it("returns undefined if log group with FunctionName doesn't exist", async () => {
    const functionName = "MyLambdaFunction";
    const cloudWatchLogs = mockCloudWatchLogs({});
    const result = await findExistingLogGroupWithFunctionName(cloudWatchLogs as any, functionName);

    expect(result).toBeUndefined();
  });

  it("can find existing log group with FunctionName", async () => {
    const functionName = "MyLambdaFunction";
    const cloudWatchLogs = mockCloudWatchLogs({
      "/aws/lambda/MyLambdaFunction": {
        logGroup: { logGroupName: "/aws/lambda/MyLambdaFunction" },
        filters: {},
      },
    });
    const result = await findExistingLogGroupWithFunctionName(cloudWatchLogs as any, functionName);

    expect(result).toEqual({ logGroupName: "/aws/lambda/MyLambdaFunction" });
  });
});

describe("getExistingLambdaLogGroupOnStack", () => {
  it("returns empty array if no lambda log groups exist", async () => {
    const stackName = "stack-name";
    const cloudWatchLogs = mockCloudWatchLogs({});
    const result = await getExistingLambdaLogGroupsOnStack(cloudWatchLogs as any, stackName);

    expect(result).toBeDefined();
    expect(result).toEqual([]);
  });

  it("finds lambda log groups with stack name", async () => {
    const stackName = "stack-name";
    const cloudWatchLogs = mockCloudWatchLogs({
      "/aws/lambda/stack-name-DynamicallyGeneratedName": {
        logGroup: {
          logGroupName: "/aws/lambda/stack-name-DynamicallyGeneratedName",
        },
        filters: {},
      },
    });
    const result = await getExistingLambdaLogGroupsOnStack(cloudWatchLogs as any, stackName);

    expect(result).toEqual([{ logGroupName: "/aws/lambda/stack-name-DynamicallyGeneratedName" }]);
  });
});

describe("shouldSubscribeLogGroup", () => {
  it("returns true when there are no existing subscriptions", async () => {
    const functionNamePrefix = "stack-name-FunctionKey";
    const logGroupName = `/aws/lambda/${functionNamePrefix}`;
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: { logGroup: { logGroupName } },
    });
    const shouldSub = await shouldSubscribeLogGroup(cloudWatchLogs as any, logGroupName);
    expect(shouldSub).toBe(true);
  });

  it("returns false if the log group only has 1 existing datadog-serverless-macro-filter subscription filter", async () => {
    const functionNamePrefix = "stack-name-FunctionKey";
    const logGroupName = `/aws/lambda/${functionNamePrefix}`;
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: {
        logGroup: { logGroupName },
        filters: {
          subscriptionFilters: [
            {
              destinationArn: "destination-arn",
              filterName: "datadog-serverless-macro-filter",
              logGroupName,
            },
          ],
        },
      },
    });
    const shouldSub = await shouldSubscribeLogGroup(cloudWatchLogs as any, logGroupName);
    expect(shouldSub).toBe(false);
  });

  it("returns true if the log group only has 1 existing non-Datadog subscription filter", async () => {
    const functionNamePrefix = "stack-name-FunctionKey";
    const logGroupName = `/aws/lambda/${functionNamePrefix}`;
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: {
        logGroup: { logGroupName },
        filters: {
          subscriptionFilters: [
            {
              destinationArn: "destination-arn",
              filterName: "non-Datadog-filter",
              logGroupName,
            },
          ],
        },
      },
    });
    const shouldSub = await shouldSubscribeLogGroup(cloudWatchLogs as any, logGroupName);
    expect(shouldSub).toBe(true);
  });

  it("returns false if the log group has 2 existing subscription filters, 1 datadog-cloudformation-macro filter, and 1 non-Datadog filter", async () => {
    const functionNamePrefix = "stack-name-FunctionKey";
    const logGroupName = `/aws/lambda/${functionNamePrefix}`;
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: {
        logGroup: { logGroupName },
        filters: {
          subscriptionFilters: [
            {
              destinationArn: "destination-arn",
              filterName: "non-Datadog-filter",
              logGroupName,
            },
            {
              destinationArn: "forwarder-arn",
              filterName: "datadog-serverless-macro-filter",
              logGroupName,
            },
          ],
        },
      },
    });
    const shouldSub = await shouldSubscribeLogGroup(cloudWatchLogs as any, logGroupName);
    expect(shouldSub).toBe(false);
  });

  //This test assumes the maximum allowed subscriptions by a AWS Cloudwatch log group is 2.
  it("returns false if the log group has 2 existing non-datadog subscription filters", async () => {
    const functionNamePrefix = "stack-name-FunctionKey";
    const logGroupName = `/aws/lambda/${functionNamePrefix}`;
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: {
        logGroup: { logGroupName },
        filters: {
          subscriptionFilters: [
            {
              destinationArn: "destination-arn",
              filterName: "another-filter",
              logGroupName,
            },
            {
              destinationArn: "other-forwarder-arn2",
              filterName: "other-filter2",
              logGroupName,
            },
          ],
        },
      },
    });
    const shouldSub = await shouldSubscribeLogGroup(cloudWatchLogs as any, logGroupName);
    expect(shouldSub).toBe(false);
  });
});

describe("findDeclaredLogGroup", () => {
  const logGroups = [
    mockLogGroupResource("LogGroupOne", "/aws/lambda/MyLambdaFunction"),
    mockLogGroupResource("LogGroupTwo", {
      "Fn::Sub": "/aws/lambda/${SubFunctionKey}",
    }),
    mockLogGroupResource("LogGroupThree", {
      "Fn::Join": ["", ["/aws/lambda/", { Ref: "JoinFunctionKey" }]],
    }),
  ];

  it("finds log group when declared with 'FunctionName'", () => {
    const logGroup = findDeclaredLogGroup(logGroups, "FunctionKey", "MyLambdaFunction");
    let logGroupName: string | { [fn: string]: any } = "";
    if (logGroup) {
      logGroupName = logGroup.logGroupResource.Properties.LogGroupName;
    }
    expect(logGroupName).toEqual("/aws/lambda/MyLambdaFunction");
  });

  it("finds log group when logGroupName uses 'Fn::Sub'", () => {
    const logGroup = findDeclaredLogGroup(logGroups, "SubFunctionKey");
    let logGroupName: string | { [fn: string]: any } = "";
    if (logGroup) {
      logGroupName = logGroup.logGroupResource.Properties.LogGroupName;
    }
    expect(logGroupName).toEqual({
      "Fn::Sub": "/aws/lambda/${SubFunctionKey}",
    });
  });

  it("finds log group when logGroupName uses 'Fn::Join'", () => {
    const logGroup = findDeclaredLogGroup(logGroups, "JoinFunctionKey");
    let logGroupName: string | { [fn: string]: any } = "";
    if (logGroup) {
      logGroupName = logGroup.logGroupResource.Properties.LogGroupName;
    }
    expect(logGroupName).toEqual({
      "Fn::Join": ["", ["/aws/lambda/", { Ref: "JoinFunctionKey" }]],
    });
  });
});
