import { CloudWatchLogs } from "aws-sdk";
import {
  findExistingLogGroupWithFunctionName,
  getExistingLambdaLogGroupsOnStack,
  canSubscribeLogGroup,
  findDeclaredLogGroupName,
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
  >
) {
  return {
    describeLogGroups: jest
      .fn()
      .mockImplementation(({ logGroupNamePrefix }) => {
        let response: CloudWatchLogs.DescribeLogGroupsResponse = {};
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
    describeSubscriptionFilters: jest
      .fn()
      .mockImplementation(({ logGroupName }) => {
        const response = logGroups[logGroupName]?.filters ?? {};
        return { promise: () => Promise.resolve(response) };
      }),
  };
}

function mockResources(
  lambdas: LambdaFunction[],
  logGroups?: LogGroupDefinition[]
) {
  let resources: Record<string, any> = {};
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

function mockLambdaFunction(key: string, FunctionName?: string) {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: "nodejs12.x",
      Role: "role-arn",
      FunctionName,
    },
    key,
    type: RuntimeType.NODE,
    runtime: "nodejs12.x",
  } as LambdaFunction;
}

function mockLogGroupResource(
  key: string,
  LogGroupName: string | Record<string, any>
) {
  return {
    key,
    logGroupResource: {
      Type: "AWS::Logs::LogGroup",
      Properties: { LogGroupName },
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
    await addCloudWatchForwarderSubscriptions(
      resources,
      [lambda],
      undefined,
      forwarder,
      cloudWatchLogs as any
    );
    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({
      logGroupNamePrefix: "/aws/lambda/MyLambdaFunction",
    });
    expect(cloudWatchLogs.describeSubscriptionFilters).toHaveBeenCalledWith({
      logGroupName: "/aws/lambda/MyLambdaFunction",
    });
    expect(resources).toMatchObject({
      FunctionKeySubscription: {
        Type: "AWS::Logs::SubscriptionFilter",
        Properties: {
          DestinationArn: "forwarder-arn",
          FilterPattern: "",
          FilterName: "datadog-macro-filter",
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
      cloudWatchLogs as any
    );
    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({
      logGroupNamePrefix: "/aws/lambda/stack-name-",
    });
    expect(cloudWatchLogs.describeSubscriptionFilters).toHaveBeenCalledWith({
      logGroupName,
    });
    expect(resources).toMatchObject({
      FunctionKeySubscription: {
        Type: "AWS::Logs::SubscriptionFilter",
        Properties: {
          DestinationArn: "forwarder-arn",
          FilterPattern: "",
          FilterName: "datadog-macro-filter",
          LogGroupName: logGroupName,
        },
      },
    });
  });

  it("does not overwrite existing subscription on log group", async () => {
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
    await addCloudWatchForwarderSubscriptions(
      resources,
      [lambda],
      undefined,
      "forwarder-arn",
      cloudWatchLogs as any
    );
    expect(cloudWatchLogs.describeLogGroups).toHaveBeenCalledWith({
      logGroupNamePrefix: logGroupName,
    });
    expect(cloudWatchLogs.describeSubscriptionFilters).toHaveBeenCalledWith({
      logGroupName,
    });
    expect(resources).not.toHaveProperty("FunctionKeySubscription");
  });

  it("log groups are not created, but are already declared", async () => {
    const explicitlyNamedLambda = mockLambdaFunction(
      "FunctionOneKey",
      "MyLambdaFunction"
    );
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
    const declaredLogGroups = [
      explicitlyNamedLogGroup,
      dynamicallyNamedLogGroup,
    ];

    const resources = mockResources(lambdas, declaredLogGroups);
    const cloudWatchLogs = mockCloudWatchLogs({});
    await addCloudWatchForwarderSubscriptions(
      resources,
      lambdas,
      "stack-name",
      "forwarder-arn",
      cloudWatchLogs as any
    );

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
      FunctionOneKeySubscription: {
        Type: "AWS::Logs::SubscriptionFilter",
        Properties: {
          DestinationArn: "forwarder-arn",
          FilterPattern: "",
          FilterName: "datadog-macro-filter",
          LogGroupName: "/aws/lambda/MyLambdaFunction",
        },
      },
      FunctionTwoKeySubscription: {
        Type: "AWS::Logs::SubscriptionFilter",
        Properties: {
          DestinationArn: "forwarder-arn",
          FilterPattern: "",
          FilterName: "datadog-macro-filter",
          LogGroupName: { "Fn::Sub": "/aws/lambda/${FunctionTwoKey}" },
        },
      },
    });
  });

  it("log group does not yet exist, and is not declared", async () => {
    const lambda = mockLambdaFunction("FunctionKey", "MyLambdaFunction");
    const resources = mockResources([lambda]);
    const cloudWatchLogs = mockCloudWatchLogs({});
    await addCloudWatchForwarderSubscriptions(
      resources,
      [lambda],
      undefined,
      "forwarder-arn",
      cloudWatchLogs as any
    );
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
      FunctionKeySubscription: {
        Type: "AWS::Logs::SubscriptionFilter",
        Properties: {
          DestinationArn: "forwarder-arn",
          FilterPattern: "",
          FilterName: "datadog-macro-filter",
          LogGroupName: { "Fn::Sub": "/aws/lambda/${FunctionKey}" },
        },
      },
    });
  });
});

describe("findExistingLogGroupWithFunctionName", () => {
  it("returns undefined if log group with FunctionName doesn't exist", async () => {
    const functionName = "MyLambdaFunction";
    const cloudWatchLogs = mockCloudWatchLogs({});
    const result = await findExistingLogGroupWithFunctionName(
      cloudWatchLogs as any,
      functionName
    );

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
    const result = await findExistingLogGroupWithFunctionName(
      cloudWatchLogs as any,
      functionName
    );

    expect(result).toEqual({ logGroupName: "/aws/lambda/MyLambdaFunction" });
  });
});

describe("getExistingLambdaLogGroupOnStack", () => {
  it("returns empty array if no lambda log groups exist", async () => {
    const stackName = "stack-name";
    const cloudWatchLogs = mockCloudWatchLogs({});
    const result = await getExistingLambdaLogGroupsOnStack(
      cloudWatchLogs as any,
      stackName
    );

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
    const result = await getExistingLambdaLogGroupsOnStack(
      cloudWatchLogs as any,
      stackName
    );

    expect(result).toEqual([
      { logGroupName: "/aws/lambda/stack-name-DynamicallyGeneratedName" },
    ]);
  });
});

describe("canSubscribeLogGroup", () => {
  it("returns false if there's any existing subscription", async () => {
    const logGroupName = "/aws/lambda/stack-name-MyLambdaFunction";
    const cloudWatchLogs = mockCloudWatchLogs({
      [logGroupName]: { logGroup: { logGroupName } },
    });
    const canSubscribe = await canSubscribeLogGroup(
      cloudWatchLogs as any,
      logGroupName
    );
    expect(canSubscribe).toBeTruthy();
  });

  it("returns true is there are no existing subscriptions", async () => {
    const logGroupName = "/aws/lambda/stack-name-MyLambdaFunction";
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
    const canSubscribe = await canSubscribeLogGroup(
      cloudWatchLogs as any,
      logGroupName
    );
    expect(canSubscribe).toBeFalsy();
  });
});

describe("findDeclaredLogGroupName", () => {
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
    const logGroupName = findDeclaredLogGroupName(
      logGroups,
      "FunctionKey",
      "MyLambdaFunction"
    );
    expect(logGroupName).toEqual("/aws/lambda/MyLambdaFunction");
  });

  it("finds log group when logGroupName uses 'Fn::Sub'", () => {
    const logGroupName = findDeclaredLogGroupName(logGroups, "SubFunctionKey");
    expect(logGroupName).toEqual({
      "Fn::Sub": "/aws/lambda/${SubFunctionKey}",
    });
  });

  it("finds log group when logGroupName uses 'Fn::Join'", () => {
    const logGroupName = findDeclaredLogGroupName(logGroups, "JoinFunctionKey");
    expect(logGroupName).toEqual({
      "Fn::Join": ["", ["/aws/lambda/", { Ref: "JoinFunctionKey" }]],
    });
  });
});
