import { CloudWatchLogs } from "aws-sdk";
import {
  findExistingLogGroupWithFunctionName,
  getExistingLambdaLogGroupsOnStack,
  canSubscribeLogGroup,
  findDeclaredLogGroup,
  addCloudWatchForwarderSubscriptions,
  LogGroupDefinition,
} from "../src/forwarder";
import { LambdaFunction, RuntimeType } from "../src/layer";

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
    const lambda = mockLambdaFunction("FunctionKey", "MyLambdaFunction");
    const resources = mockResources([lambda]);
    const forwarder = "forwarder-arn";
    const cloudWatchLogs = mockCloudWatchLogs({
      "/aws/lambda/MyLambdaFunction": {
        logGroup: { logGroupName: "/aws/lambda/MyLambdaFunction" },
        filters: {},
      },
    });
    await addCloudWatchForwarderSubscriptions(resources, [lambda], undefined, forwarder, cloudWatchLogs as any);
    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({
      logGroupNamePrefix: "/aws/lambda/MyLambdaFunction",
    });
    expect(cloudWatchLogs.describeSubscriptionFilters).toHaveBeenCalledWith({
      logGroupName: "/aws/lambda/MyLambdaFunction",
    });
    expect(resources).toMatchObject({
      FunctionKeyLogGroupSubscription: {
        Type: "AWS::Logs::SubscriptionFilter",
        Properties: {
          DestinationArn: "forwarder-arn",
          FilterPattern: "",
          LogGroupName: "/aws/lambda/MyLambdaFunction",
        },
      },
    });
  });

  it("function name is dynamically generated and log group already exists", async () => {
    const lambda = mockLambdaFunction("FunctionKey");
    const resources = mockResources([lambda]);
    const logGroupName = "/aws/lambda/stack-name-FunctionKey-1234";
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: { logGroup: { logGroupName }, filters: {} },
    });
    await addCloudWatchForwarderSubscriptions(
      resources,
      [lambda],
      "stack-name",
      "forwarder-arn",
      cloudWatchLogs as any,
    );
    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({
      logGroupNamePrefix: "/aws/lambda/stack-name-",
    });
    expect(cloudWatchLogs.describeSubscriptionFilters).toHaveBeenCalledWith({
      logGroupName,
    });
    expect(resources).toMatchObject({
      FunctionKeyLogGroupSubscription: {
        Type: "AWS::Logs::SubscriptionFilter",
        Properties: {
          DestinationArn: "forwarder-arn",
          FilterPattern: "",
          LogGroupName: logGroupName,
        },
      },
    });
  });

  it("does not overwrite existing unknown subscription on log group", async () => {
    const lambda = mockLambdaFunction("FunctionKey", "MyLambdaFunction");
    const resources = mockResources([lambda]);
    const logGroupName = "/aws/lambda/MyLambdaFunction";
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
          ],
        },
      },
    });
    await addCloudWatchForwarderSubscriptions(resources, [lambda], undefined, "forwarder-arn", cloudWatchLogs as any);
    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({
      logGroupNamePrefix: logGroupName,
    });
    expect(cloudWatchLogs.describeSubscriptionFilters).toHaveBeenCalledWith({
      logGroupName,
    });
    expect(resources).not.toHaveProperty("FunctionKeySubscription");
  });

  it("log groups are not created, but are already declared", async () => {
    const explicitlyNamedLambda = mockLambdaFunction("FunctionOneKey", "MyLambdaFunction");
    const dynamicallyNamedLambda = mockLambdaFunction("FunctionTwoKey");
    const lambdas = [explicitlyNamedLambda, dynamicallyNamedLambda];

    const explicitlyNamedLogGroup = {
      key: "FunctionOneKeyLogGroup",
      logGroupResource: {
        Type: "AWS::Logs::LogGroup",
        Properties: {
          LogGroupName: "/aws/lambda/MyLambdaFunction",
        },
      },
    };
    const dynamicallyNamedLogGroup = {
      key: "FunctionTwoKeyLogGroup",
      logGroupResource: {
        Type: "AWS::Logs::LogGroup",
        Properties: {
          LogGroupName: { "Fn::Sub": "/aws/lambda/${FunctionTwoKey}" },
        },
      },
    };
    const declaredLogGroups = [explicitlyNamedLogGroup, dynamicallyNamedLogGroup];

    const resources = mockResources(lambdas, declaredLogGroups);
    const cloudWatchLogs = mockCloudWatchLogs({});
    await addCloudWatchForwarderSubscriptions(resources, lambdas, "stack-name", "forwarder-arn", cloudWatchLogs as any);

    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledTimes(2);
    expect(cloudWatchLogs.describeLogGroups).toHaveBeenNthCalledWith(1, {
      logGroupNamePrefix: "/aws/lambda/MyLambdaFunction",
    });
    expect(cloudWatchLogs.describeLogGroups).toHaveBeenNthCalledWith(2, {
      logGroupNamePrefix: "/aws/lambda/stack-name-",
    });
    expect(cloudWatchLogs.describeSubscriptionFilters).not.toHaveBeenCalled();
    expect(resources).toEqual({
      // log groups are unchanged and no duplicate log groups are declared
      FunctionOneKey: {
        Type: "AWS::Lambda::Function",
        Properties: explicitlyNamedLambda.properties,
      },
      FunctionTwoKey: {
        Type: "AWS::Lambda::Function",
        Properties: dynamicallyNamedLambda.properties,
      },
      FunctionOneKeyLogGroup: explicitlyNamedLogGroup.logGroupResource,
      FunctionTwoKeyLogGroup: dynamicallyNamedLogGroup.logGroupResource,
      FunctionOneKeyLogGroupSubscription: {
        Type: "AWS::Logs::SubscriptionFilter",
        DependsOn: "FunctionOneKeyLogGroup",
        Properties: {
          DestinationArn: "forwarder-arn",
          FilterPattern: "",
          LogGroupName: "/aws/lambda/MyLambdaFunction",
        },
      },
      FunctionTwoKeyLogGroupSubscription: {
        Type: "AWS::Logs::SubscriptionFilter",
        DependsOn: "FunctionTwoKeyLogGroup",
        Properties: {
          DestinationArn: "forwarder-arn",
          FilterPattern: "",
          LogGroupName: { "Fn::Sub": "/aws/lambda/${FunctionTwoKey}" },
        },
      },
    });
  });

  it("log group does not yet exist, and is not declared", async () => {
    const lambda = mockLambdaFunction("FunctionKey", "MyLambdaFunction");
    const resources = mockResources([lambda]);
    const cloudWatchLogs = mockCloudWatchLogs({});
    await addCloudWatchForwarderSubscriptions(resources, [lambda], undefined, "forwarder-arn", cloudWatchLogs as any);
    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({
      logGroupNamePrefix: "/aws/lambda/MyLambdaFunction",
    });
    expect(cloudWatchLogs.describeSubscriptionFilters).not.toHaveBeenCalled();
    expect(resources).toMatchObject({
      FunctionKeyLogGroup: {
        Type: "AWS::Logs::LogGroup",
        Properties: {
          LogGroupName: { "Fn::Sub": "/aws/lambda/${FunctionKey}" },
        },
      },
      FunctionKeyLogGroupSubscription: {
        Type: "AWS::Logs::SubscriptionFilter",
        Properties: {
          DestinationArn: "forwarder-arn",
          FilterPattern: "",
          LogGroupName: { "Fn::Sub": "/aws/lambda/${FunctionKey}" },
        },
      },
    });
  });

  it("log group and correct subscription already previously created by macro", async () => {
    const lambda = mockLambdaFunction("FunctionKey", "MyLambdaFunction");
    const resources = mockResources([lambda]);
    const forwarderArn = "test-forwarder-arn";
    const logGroupName = "/aws/lambda/MyLambdaFunction";
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: {
        logGroup: { logGroupName },
        filters: {
          subscriptionFilters: [
            {
              destinationArn: forwarderArn,
              filterName: lambda.properties.FunctionName,
              logGroupName,
            },
          ],
        },
      },
    });
    await addCloudWatchForwarderSubscriptions(resources, [lambda], undefined, forwarderArn, cloudWatchLogs as any);

    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({
      logGroupNamePrefix: "/aws/lambda/MyLambdaFunction",
    });
    expect(cloudWatchLogs.describeSubscriptionFilters).toHaveBeenCalledWith({
      logGroupName,
    });
    // Need to include this resource, since not including it would delete the already created sub
    expect(resources).toHaveProperty("FunctionKeyLogGroupSubscription");
  });

  it("log group and subscription are not initialized, but are declared", async () => {
    const lambda = mockLambdaFunction("FunctionKey", "MyLambdaFunction");

    const logGroup = {
      key: "FunctionKeyLogGroup",
      logGroupResource: {
        Type: "AWS::Logs::LogGroup",
        Properties: {
          LogGroupName: "/aws/lambda/MyLambdaFunction",
        },
      },
    };

    const resources = mockResources([lambda], [logGroup]);
    const declaredSubscription = {
      Type: "AWS::Logs::SubscriptionFilter",
      Properties: {
        DestinationArn: "forwarder-arn",
        FilterPattern: "",
        LogGroupName: "/aws/lambda/MyLambdaFunction",
      },
    };
    // The declared subcription has a slightly different key than the one the macro would use to
    // create a new subscription, but the macro does not rely on the key to find existing subs.
    resources.FunctionKeySubscription = declaredSubscription;
    const cloudWatchLogs = mockCloudWatchLogs({});
    await addCloudWatchForwarderSubscriptions(
      resources,
      [lambda],
      undefined, // no need for stackName, lambda is explicitly named
      "forwarder-arn",
      cloudWatchLogs as any,
    );

    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({
      logGroupNamePrefix: "/aws/lambda/MyLambdaFunction",
    });
    expect(cloudWatchLogs.describeSubscriptionFilters).not.toHaveBeenCalled();
    expect(resources).toEqual({
      // log groups and subscriptions are unchanged, no duplicates declared
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

describe("canSubscribeLogGroup", () => {
  it("returns false if there's any existing subscription", async () => {
    const functionNamePrefix = "stack-name-MyLambdaFunction";
    const logGroupName = `/aws/lambda/${functionNamePrefix}`;
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: { logGroup: { logGroupName } },
    });
    const canSubscribe = await canSubscribeLogGroup(cloudWatchLogs as any, logGroupName, functionNamePrefix);
    expect(canSubscribe).toBeTruthy();
  });

  it("returns true if there are no existing subscriptions", async () => {
    const functionNamePrefix = "stack-name-MyLambdaFunction";
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
          ],
        },
      },
    });
    const canSubscribe = await canSubscribeLogGroup(cloudWatchLogs as any, logGroupName, functionNamePrefix);
    expect(canSubscribe).toBeFalsy();
  });

  it("returns true if the existing subscription is one created by the macro", async () => {
    const functionNamePrefix = "stack-name-MyLambdaFunction";
    const logGroupName = `/aws/lambda/${functionNamePrefix}`;
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: {
        logGroup: { logGroupName },
        filters: {
          subscriptionFilters: [
            {
              destinationArn: "forwarder-arn",
              filterName: `${functionNamePrefix}Subscription-randomlyGeneratedString`,
              logGroupName,
            },
          ],
        },
      },
    });
    const canSubscribe = await canSubscribeLogGroup(cloudWatchLogs as any, logGroupName, functionNamePrefix);
    expect(canSubscribe).toBeTruthy();
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
