import { InputEvent } from "../src/types";
import { FunctionProperties } from "../src/lambda/types";
import { LogGroupDefinition } from "../src/lambda/forwarder";
import { handler } from "../src/index";

export const LAMBDA_KEY = "HelloWorldFunction";
export const VERSION_REGEX =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(\+[0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*)?$/;

export function mockInputEvent(
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

export function mockGovCloudInputEvent(params: any, mappings: any, logGroups?: LogGroupDefinition[]) {
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
});
