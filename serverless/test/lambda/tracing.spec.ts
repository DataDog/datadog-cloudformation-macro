import { enableTracing, TracingMode, IamRoleProperties, MissingIamRoleError } from "../../src/lambda/tracing";
import { ArchitectureType, LambdaFunction, RuntimeType } from "../../src/lambda/layer";

function mockLambdaFunction() {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: "nodejs16.x",
      Role: { "Fn::GetAtt": ["HelloWorldFunctionRole", "Arn"] },
      Code: {
        S3Bucket: "s3-bucket",
        S3Key: "stack-name/key",
      },
    },
    key: "HelloWorldFunction",
    runtimeType: RuntimeType.NODE,
    runtime: "nodejs16.x",
    architecture: "x86_64",
    architectureType: ArchitectureType.x86_64,
  } as LambdaFunction;
}

function mockLambdaFunctionWithPreDefinedTraceSetting() {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: "nodejs16.x",
      Role: { "Fn::GetAtt": ["HelloWorldFunctionRole", "Arn"] },
      Code: {
        S3Bucket: "s3-bucket",
        S3Key: "stack-name/key",
      },
      Environment: {
        Variables: {
          DD_TRACE_ENABLED: false,
        },
      },
    },
    key: "HelloWorldFunction",
    runtimeType: RuntimeType.NODE,
    runtime: "nodejs16.x",
    architecture: "x86_64",
    architectureType: ArchitectureType.x86_64,
  } as LambdaFunction;
}

function mockResources() {
  return {
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
        Handler: "app.handler",
        Role: {
          "Fn::GetAtt": ["HelloWorldFunctionRole", "Arn"],
        },
        Runtime: "nodejs12.x",
      },
    },
  };
}

describe("enableTracing", () => {
  it("hybrid tracing with no existing policies", () => {
    const tracingMode = TracingMode.HYBRID;
    const lambda = mockLambdaFunction();
    const resources: Record<string, any> = mockResources();
    const iamRole: IamRoleProperties = resources.HelloWorldFunctionRole.Properties;
    enableTracing(tracingMode, [lambda], resources);

    expect(lambda.properties.TracingConfig).toEqual({ Mode: "Active" });
    expect(iamRole.Policies).toEqual([
      {
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: {
            Effect: "Allow",
            Action: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
            Resource: ["*"],
          },
        },
        PolicyName: { "Fn::Join": ["-", [lambda.key, "Policy"]] },
      },
    ]);
    expect(lambda.properties.Environment).toMatchObject({
      Variables: {
        DD_TRACE_ENABLED: true,
        DD_MERGE_XRAY_TRACES: true,
      },
    });
  });

  it("only dd tracing enabled", () => {
    const tracingMode = TracingMode.DD_TRACE;
    const lambda = mockLambdaFunction();
    const resources: Record<string, any> = mockResources();
    const iamRole: IamRoleProperties = resources.HelloWorldFunctionRole.Properties;
    enableTracing(tracingMode, [lambda], resources);

    expect(lambda.properties.TracingConfig).toBeUndefined();
    expect(iamRole.Policies).toBeUndefined();
    expect(lambda.properties.Environment).toMatchObject({
      Variables: { DD_TRACE_ENABLED: true },
    });
  });

  it("dd tracing enabled but should not override a funciton with a predefined trace setting", () => {
    const tracingMode = TracingMode.DD_TRACE;
    const lambdaWithFunctionLevelTraceSetting = mockLambdaFunctionWithPreDefinedTraceSetting();
    const lambdaWithOutTraceSetting = mockLambdaFunction();
    const resources: Record<string, any> = mockResources();
    const iamRole: IamRoleProperties = resources.HelloWorldFunctionRole.Properties;
    enableTracing(tracingMode, [lambdaWithFunctionLevelTraceSetting, lambdaWithOutTraceSetting], resources);

    expect(lambdaWithFunctionLevelTraceSetting.properties.TracingConfig).toBeUndefined();
    expect(lambdaWithOutTraceSetting.properties.TracingConfig).toBeUndefined();
    expect(iamRole.Policies).toBeUndefined();
    expect(lambdaWithFunctionLevelTraceSetting.properties.Environment).toMatchObject({
      Variables: { DD_TRACE_ENABLED: false },
    });
    expect(lambdaWithOutTraceSetting.properties.Environment).toMatchObject({
      Variables: { DD_TRACE_ENABLED: true },
    });
  });

  it("only xray tracing enabled and adds policies without ovewriting existing ones", () => {
    const tracingMode = TracingMode.XRAY;
    const lambda = mockLambdaFunction();
    const resources: Record<string, any> = mockResources();
    const iamRole: IamRoleProperties = resources.HelloWorldFunctionRole.Properties;
    enableTracing(tracingMode, [lambda], resources);

    expect(lambda.properties.TracingConfig).toEqual({ Mode: "Active" });
    expect(iamRole.Policies).toEqual([
      {
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: {
            Effect: "Allow",
            Action: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
            Resource: ["*"],
          },
        },
        PolicyName: { "Fn::Join": ["-", [lambda.key, "Policy"]] },
      },
    ]);
    expect(lambda.properties.Environment).toBeUndefined();
  });

  it("no tracing enabled", () => {
    const tracingMode = TracingMode.NONE;
    const lambda = mockLambdaFunction();
    const resources: Record<string, any> = mockResources();
    enableTracing(tracingMode, [lambda], resources);

    expect(lambda.properties.TracingConfig).toBeUndefined();
    expect(resources.HelloWorldFunctionRole.Properties.Policies).toBeUndefined();
  });

  it("throws MissingIamRoleError if IAM role is not found", () => {
    const tracingMode = TracingMode.XRAY;
    const lambda: LambdaFunction = {
      properties: {
        Handler: "app.handler",
        Runtime: "nodejs16.x",
        Role: "role-arn",
        Code: {
          S3Bucket: "s3-bucket",
          S3Key: "stack-name/key",
        },
      },
      key: "HelloWorldFunction",
      runtimeType: RuntimeType.NODE,
      runtime: "nodejs16.x",
      architecture: "x86_64",
      architectureType: ArchitectureType.x86_64,
    };
    const resources: Record<string, any> = {
      HelloWorldFunction: {
        Type: "AWS::Lambda::Function",
        Properties: {
          Handler: "app.handler",
          Role: "role-arn",
          Runtime: "nodejs12.x",
        },
      },
    };

    expect.assertions(2);
    try {
      enableTracing(tracingMode, [lambda], resources);
    } catch (err: any) {
      expect(err).toBeInstanceOf(MissingIamRoleError);
      expect(err.message).toEqual(
        `No AWS::IAM::Role resource was found for the function ${lambda.key} when adding xray tracing policies`,
      );
    }
  });
});
