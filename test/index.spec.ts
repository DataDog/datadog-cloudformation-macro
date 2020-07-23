import {
  handler,
  RESOURCES,
  PROPERTIES,
  FunctionProperties,
  getMissingStackNameErrorMsg,
  InputEvent,
} from "../src/index";
import { IamRoleProperties } from "../src/tracing";
import {
  DescribeLogGroupsRequest,
  DescribeSubscriptionFiltersRequest,
  DescribeLogGroupsResponse,
} from "aws-sdk/clients/cloudwatchlogs";
import { LogGroupDefinition } from "../src/forwarder";

const LAMBDA_KEY = "HelloWorldFunction";
jest.mock("aws-sdk", () => {
  return {
    CloudWatchLogs: jest.fn().mockImplementation((_) => {
      return {
        describeLogGroups: (
          params: DescribeLogGroupsRequest,
          callback?: Function
        ) => {
          const response: DescribeLogGroupsResponse = {
            logGroups: [
              { logGroupName: `/aws/lambda/stack-name-${LAMBDA_KEY}` },
            ],
          };
          return {
            promise: jest
              .fn()
              .mockImplementation(() => Promise.resolve(response)),
          };
        },
        describeSubscriptionFilters: (
          params: DescribeSubscriptionFiltersRequest,
          callback: any
        ) => {
          return {
            promise: jest.fn().mockImplementation(() => Promise.resolve([])),
          };
        },
      };
    }),
  };
});

function mockInputEvent(
  params: any,
  mappings: any,
  logGroups?: LogGroupDefinition[]
) {
  let fragment: Record<string, any> = {
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
          ManagedPolicyArns: [
            "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
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
    fragment["Mappings"] = mappings;
  }
  if (logGroups) {
    if (logGroups) {
      for (const lg of logGroups) {
        fragment.Resources[lg.key] = lg.logGroupResource;
      }
    }
  }
  return {
    region: "us-east-1",
    accountId: "test-accountId",
    fragment,
    transformId: "DDCloudformationMacro",
    params: params || {},
    requestId: "test-requestId",
    templateParameterValues: {},
  } as InputEvent;
}

describe("Macro", () => {
  describe("parameters and config", () => {
    it("uses transform parameters if they are provided", async () => {
      const transformParams = { site: "transform-params-site" };
      const mappings = {
        Datadog: {
          Parameters: { site: "mappings-site" },
        },
      };
      const inputEvent = mockInputEvent(transformParams, mappings);
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties =
        output.fragment[RESOURCES][LAMBDA_KEY][PROPERTIES];
      expect(lambdaProperties.Environment).toMatchObject({
        Variables: { DD_SITE: "transform-params-site" },
      });
    });

    it("uses parameters under Mappings section if template parameters are not given", async () => {
      const mappings = {
        Datadog: {
          Parameters: { site: "mappings-site" },
        },
      };
      const inputEvent = mockInputEvent({}, mappings);
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties =
        output.fragment[RESOURCES][LAMBDA_KEY][PROPERTIES];

      expect(lambdaProperties.Environment).toMatchObject({
        Variables: { DD_SITE: "mappings-site" },
      });
    });
  });

  describe("lambda layers", () => {
    it("adds lambda layers by default", async () => {
      const inputEvent = mockInputEvent({}, {}); // Use default configuration
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties =
        output.fragment[RESOURCES][LAMBDA_KEY][PROPERTIES];
      expect(lambdaProperties.Layers).toEqual([
        expect.stringMatching(/arn\:aws\:lambda\:us\-east\-1\:.*\:layer\:.*/),
      ]);
    });

    it("skips adding lambda layers when addLayers is false", async () => {
      const params = { addLayers: false };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties =
        output.fragment[RESOURCES][LAMBDA_KEY][PROPERTIES];
      expect(lambdaProperties.Layers).toBeUndefined();
    });
  });

  describe("tracing", () => {
    it("skips adding tracing when enableXrayTracing is false", async () => {
      const params = { enableXrayTracing: false };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});
      const iamRole: IamRoleProperties =
        output.fragment[RESOURCES][`${LAMBDA_KEY}Role`][PROPERTIES];
      const lambdaProperties: FunctionProperties =
        output.fragment[RESOURCES][LAMBDA_KEY][PROPERTIES];
      expect(lambdaProperties.TracingConfig).toBeUndefined();
      expect(iamRole.Policies).toBeUndefined();
    });
  });

  describe("CloudWatch subscriptions", () => {
    it("adds subscription filters when forwarder is provided", async () => {
      const params = { forwarderArn: "forwarder-arn", stackName: "stack-name" };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});

      // Mocked response includes implicitly created log group, should not redeclare
      expect(output.fragment[RESOURCES]).not.toHaveProperty(
        `${LAMBDA_KEY}LogGroup`
      );
      expect(output.fragment[RESOURCES]).toHaveProperty(
        `${LAMBDA_KEY}Subscription`
      );
    });

    it("macro fails when forwarder is provided & at least one lambda has a dynamically generated name, but no stack name is given", async () => {
      const params = { forwarderArn: "forwarder-arn" };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});

      expect(output.status).toEqual("failure");
      expect(output.errorMessage).toEqual(
        getMissingStackNameErrorMsg([LAMBDA_KEY])
      );
    });
  });

  describe("tags", () => {
    it("does not add or modify tags when neither 'service' nor 'env' are provided", async () => {
      const inputEvent = mockInputEvent({}, {});
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties =
        output.fragment[RESOURCES][LAMBDA_KEY][PROPERTIES];
      expect(lambdaProperties.Tags).toBeUndefined();
    });

    it("adds tags if either 'service' or 'env' params are provided", async () => {
      const params = {
        service: "my-service",
        env: "test",
      };
      const inputEvent = mockInputEvent(params, {});
      const output = await handler(inputEvent, {});
      const lambdaProperties: FunctionProperties =
        output.fragment[RESOURCES][LAMBDA_KEY][PROPERTIES];
      expect(lambdaProperties.Tags).toEqual([
        { Value: "my-service", Key: "service" },
        { Value: "test", Key: "env" },
      ]);
    });
  });
});
