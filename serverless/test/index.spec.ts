import { handler, FunctionProperties, getMissingStackNameErrorMsg, InputEvent } from "../src/index";
import { getMissingLayerVersionErrorMsg } from "../src/layer";
import { IamRoleProperties } from "../src/tracing";
import {
  DescribeLogGroupsRequest,
  DescribeLogGroupsResponse,
  DescribeSubscriptionFiltersRequest,
  CreateLogGroupRequest,
  PutSubscriptionFilterRequest,
} from "aws-sdk/clients/cloudwatchlogs";
import { LogGroupDefinition } from "../src/forwarder";

const LAMBDA_KEY = "HelloWorldFunction";
const VERSION_REGEX =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(\+[0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*)?$/;
jest.mock("aws-sdk", () => {
  return {
    CloudWatchLogs: jest.fn().mockImplementation((_) => {
      return {
        describeLogGroups: (params: DescribeLogGroupsRequest, callback?: any) => {
          const response: DescribeLogGroupsResponse = {
            logGroups: [{ logGroupName: `/aws/lambda/stack-name-${LAMBDA_KEY}` }],
          };
          return {
            promise: jest.fn().mockImplementation(() => Promise.resolve(response)),
          };
        },
        describeSubscriptionFilters: (params: DescribeSubscriptionFiltersRequest, callback?: any) => {
          return {
            promise: jest.fn().mockImplementation(() => Promise.resolve([])),
          };
        },
        putSubscriptionFilter: (params: PutSubscriptionFilterRequest, callback?: any) => {
          return { promise: () => Promise.resolve() };
        },
        createLogGroup: (params: CreateLogGroupRequest, callback?: any) => {
          return { promise: () => Promise.resolve() };
        },
      };
    }),
  };
});

function mockInputEvent(
  params: any,
  mappings: any,
  logGroups?: LogGroupDefinition[],
  fromCDK?: boolean,
  fromSAM?: boolean,
) {
  const fragment: Record<string, any> = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "Sample lambda with SAM and Datadog macro",
    Resources: {
      HelloWorldFunctionRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Action: ["sts:AssumeRole"],
                Effect: "Allow",
                Principal: {
                  Service: ["lambda.amazonaws.com"],
                },
              },
            ],
          },
          ManagedPolicyArns: ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"],
        },
      },
      HelloWorldFunction: {
        Type: "AWS::Lambda::Function",
        Properties: {
          Code: {
            S3Bucket: "s3-bucket",
            S3Key: "stack-name/key",
          },
          Handler: "app.handler",
          Role: {
            "Fn::GetAtt": ["HelloWorldFunctionRole", "Arn"],
          },
          Runtime: "nodejs12.x",
        },
      },
    },
  };
  if (mappings !== undefined) {
    fragment.Mappings = mappings;
  }
  if (logGroups) {
    for (const lg of logGroups) {
      fragment.Resources[lg.key] = lg.logGroupResource;
    }
  }

  if (fromCDK) {
    fragment.Resources.CDKMetadata = {
      Type: "AWS::CDK::Metadata",
      Properties: {
        Modules:
          "aws-cdk=1.64.0,@aws-cdk/assets=1.64.0,@aws-cdk/aws-applicationautoscaling=1.64.0,@aws-cdk/aws-autoscaling-common=1.64.0,@aws-cdk/aws-cloudwatch=1.64.0,@aws-cdk/aws-codeguruprofiler=1.64.0,@aws-cdk/aws-ec2=1.64.0,@aws-cdk/aws-events=1.64.0,@aws-cdk/aws-iam=1.64.0,@aws-cdk/aws-kms=1.64.0,@aws-cdk/aws-lambda=1.64.0,@aws-cdk/aws-logs=1.64.0,@aws-cdk/aws-s3=1.64.0,@aws-cdk/aws-s3-assets=1.64.0,@aws-cdk/aws-sqs=1.64.0,@aws-cdk/aws-ssm=1.64.0,@aws-cdk/cloud-assembly-schema=1.64.0,@aws-cdk/core=1.64.0,@aws-cdk/cx-api=1.64.0,@aws-cdk/region-info=1.64.0,jsii-runtime=node.js/v14.8.0",
      },
      Condition: "CDKMetadataAvailable",
    };
  }

  if (fromSAM) {
    fragment.Resources.HelloWorldFunction.Properties.Tags = [
      {
        Key: "lambda:createdBy",
        Value: "SAM",
      },
    ];
  }

  return {
    region: "us-east-1",
    accountId: "test-accountId",
    fragment,
    transformId: "DDCloudformationMacro",
    params: params ?? {},
    requestId: "test-requestId",
    templateParameterValues: {},
  } as InputEvent;
}

function mockGovCloudInputEvent(params: any, mappings: any, logGroups?: LogGroupDefinition[]) {
  const govCloudEvent = mockInputEvent(params, mappings, logGroups);
  govCloudEvent.region = "us-gov-east-1";
  return govCloudEvent;
}

describe("Macro", () => {
  describe("parameters and config", () => {
    it("uses transform parameters if they are provided", async () => {
      const transformParams = { site: "datadoghq.com" };
      const mappings = {
        Datadog: {
          Parameters: { site: "mappings-site" },
        },
      };
      const inputEvent = mockInputEvent(transformParams, mappings);
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      expect(lambdaProperties.Environment).toMatchObject({
        Variables: { DD_SITE: "datadoghq.com" },
      });
    });

    it("uses parameters under Mappings section if template parameters are not given", async () => {
      const mappings = {
        Datadog: {
          Parameters: { site: "datadoghq.eu" },
        },
      };
      const inputEvent = mockInputEvent({}, mappings);
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      expect(lambdaProperties.Environment).toMatchObject({
        Variables: { DD_SITE: "datadoghq.eu" },
      });
    });
  });

  describe("lambda layers", () => {
    it("adds lambda layers by default", async () => {
      const params = { nodeLayerVersion: 25 };
      const inputEvent = mockInputEvent(params, {}); // Use default configuration
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      // Mocked Lambda has runtime nodejs12.x, so layer name is Datadog-Node12-x, with provided version number (25) at end
      expect(lambdaProperties.Layers).toEqual([
        expect.stringMatching(/arn:aws:lambda:us-east-1:.*:layer:Datadog-Node12-x:25/),
      ]);
    });

    it("macro fails when corresponding lambda layer version is not provided", async () => {
      const params = { addExtension: false };
      const inputEvent = mockInputEvent(params, {}); // Use default configuration, no lambda layer version provided
      const output = await handler(inputEvent, {});

      expect(output.status).toEqual("failure");
      expect(output.errorMessage).toEqual(getMissingLayerVersionErrorMsg(LAMBDA_KEY, "Node.js", "node"));
    });

    it("add only the extension layer", async () => {
      const params = { addLayers: false, addExtension: true, extensionLayerVersion: 6, apiKey: "abc123" };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      // Mocked Lambda has the addExtension parameter to true and extensionLayerVersion to 6.
      expect(lambdaProperties.Layers).toEqual([
        expect.stringMatching(/arn:aws:lambda:us-east-1:.*:layer:Datadog-Extension:6/),
      ]);
    });

    it("add only the extension layer by only setting the extension layer version", async () => {
      const params = { addLayers: false, extensionLayerVersion: 6, apiKey: "abc123" };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      // Mocked Lambda has the addExtension parameter to true and extensionLayerVersion to 6.
      expect(lambdaProperties.Layers).toEqual([
        expect.stringMatching(/arn:aws:lambda:us-east-1:.*:layer:Datadog-Extension:6/),
      ]);
    });

    it("skips adding lambda layers when addLayers is false", async () => {
      const params = { addLayers: false };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      expect(lambdaProperties.Layers).toBeUndefined();
    });

    it("uses the GovCloud layer when a GovCloud region is detected", async () => {
      const params = { nodeLayerVersion: 25 };
      const inputEvent = mockGovCloudInputEvent(params, {});
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      expect(lambdaProperties.Layers).toEqual([
        expect.stringMatching(/arn:aws-us-gov:lambda:us-gov-east-1:002406178527:layer:Datadog-Node12-x:25/),
      ]);
    });

    it("Excluding a lambda function from being instrumented", async () => {
      const params = { exclude: [LAMBDA_KEY], nodeLayerVersion: 32, extensionLayerVersion: 32, apiKey: "testtest" };
      const inputEvent = mockInputEvent(params, {}); // Use default configuration
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      expect(lambdaProperties.Layers).toBeUndefined();
      expect(lambdaProperties.Handler).toBe("app.handler");
    });
  });

  describe("tracing", () => {
    it("skips adding tracing when enableXrayTracing is false", async () => {
      const params = { enableXrayTracing: false };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});
      const iamRole: IamRoleProperties = output.fragment.Resources[`${LAMBDA_KEY}Role`].Properties;
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      expect(lambdaProperties.TracingConfig).toBeUndefined();
      expect(iamRole.Policies).toBeUndefined();
    });
  });

  describe("CloudWatch subscriptions", () => {
    it("adds subscription filters when forwarder is provided", async () => {
      const params = {
        forwarderArn: "forwarder-arn",
        stackName: "stack-name",
        nodeLayerVersion: 25,
        addExtension: false,
      };
      const inputEvent = mockInputEvent(params, {});
      await handler(inputEvent, {});

      // Mocked response includes implicitly created log group, should not create log group
      // expect(cloudWatchLogs.createLogGroup).not.toHaveBeenCalled();
      // expect(cloudWatchLogs.putSubscriptionFilter).toHaveBeenCalled();
    });

    it("macro fails when forwarder is provided & at least one lambda has a dynamically generated name, but no stack name is given", async () => {
      const params = { forwarderArn: "forwarder-arn", nodeLayerVersion: 25 };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});

      expect(output.status).toEqual("failure");
      expect(output.errorMessage).toEqual(getMissingStackNameErrorMsg([LAMBDA_KEY]));
    });
  });

  describe("tags", () => {
    it("only adds macro version tag when neither 'service' nor 'env' are provided", async () => {
      const params = { nodeLayerVersion: 25 };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      expect(lambdaProperties.Tags).toEqual([{ Key: "dd_sls_macro", Value: expect.stringMatching(VERSION_REGEX) }]);
    });

    it("only adds cdk created tag when CDKMetadata is present", async () => {
      const params = { nodeLayerVersion: 25 };
      const inputEvent = mockInputEvent(params, {}, undefined, true);
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      expect(lambdaProperties.Tags).toEqual([
        { Key: "dd_sls_macro", Value: expect.stringMatching(VERSION_REGEX) },
        { Key: "dd_sls_macro_by", Value: "CDK" },
      ]);
    });

    it("only adds SAM created tag when lambda:createdBy:SAM tag is present", async () => {
      const params = { nodeLayerVersion: 25 };
      const inputEvent = mockInputEvent(params, {}, undefined, false, true);
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      expect(lambdaProperties.Tags).toEqual([
        { Key: "lambda:createdBy", Value: "SAM" },
        { Key: "dd_sls_macro", Value: expect.stringMatching(VERSION_REGEX) },
        { Key: "dd_sls_macro_by", Value: "SAM" },
      ]);
    });

    it("adds tags if tag params are provided and forwarderArn is set", async () => {
      const params = {
        service: "my-service",
        env: "test",
        version: "1",
        tags: "team:avengers,project:marvel",
        forwarderArn: "forwarder-arn",
        stackName: "stack-name",
        nodeLayerVersion: 25,
        addExtension: false,
      };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      expect(lambdaProperties.Tags).toEqual([
        { Key: "service", Value: "my-service" },
        { Key: "env", Value: "test" },
        { Key: "version", Value: "1" },
        { Key: "team", Value: "avengers" },
        { Key: "project", Value: "marvel" },
        { Key: "dd_sls_macro", Value: expect.stringMatching(VERSION_REGEX) },
      ]);
    });

    it("doesn't add tags if tags params are provided but forwarderArn is not set", async () => {
      const params = {
        service: "my-service",
        env: "test",
        version: "1",
        tags: "team:avengers,project:marvel",
        nodeLayerVersion: 25,
        addExtension: false,
      };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties = output.fragment.Resources[LAMBDA_KEY].Properties;

      expect(lambdaProperties.Tags).toEqual([{ Key: "dd_sls_macro", Value: expect.stringMatching(VERSION_REGEX) }]);
    });
  });
});
