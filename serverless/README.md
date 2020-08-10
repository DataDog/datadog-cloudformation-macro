# Datadog Serverless Macro

This CloudFormation macro automatically installs Datadog Lambda layers to your Python and Node.js Lambda functions to collect custom metrics and traces. Find more information about the Datadog [Python](https://github.com/DataDog/datadog-lambda-layer-python) and [Node.js](https://github.com/DataDog/datadog-lambda-layer-js) Lambda layers in their repositories.

## Installation

To make the macro available for use in your AWS account, deploy a CloudFormation stack with a Datadog provided template. This deployment includes a CloudFormation macro resource and a Lambda function that is invoked when the macro is run. Deploying this stack enables you to use the macro on other CloudFormation stacks deployed in the same account. For details about how defining a macro in your account works, see [this CloudFormation documentation page](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-macros.html).

If you are installing for the first time, deploy with:
```bash
aws cloudformation create-stack \
  --stack-name datadog-serverless-macro \
  --template-url https://datadog-cloudformation-template.s3.amazonaws.com/aws/serverless-macro/latest.yml \
  --capabilities CAPABILITY_AUTO_EXPAND CAPABILITY_IAM
```

If you are updating the macro after a new release, use the `update-stack` method instead with the same paramters:
```bash
aws cloudformation update-stack \
  --stack-name datadog-serverless-macro \
  --template-url https://datadog-cloudformation-template.s3.amazonaws.com/aws/serverless-macro/latest.yml \
  --capabilities CAPABILITY_AUTO_EXPAND CAPABILITY_IAM
```

**Note:** You only need to deploy the macro once for a given region in your account, and it can be used for all CloudFormation stacks deployed in that same region.

## Usage

### AWS SAM

If you are deploying your serverless application with SAM, add the Datadog Serverless CloudFormation macro under the `Transform` section in your your `template.yml` file, after the required SAM transform:

```yaml
Transform:
  - AWS::Serverless-2016-10-31
  - Name: DatadogServerlessMacro
```

### AWS CDK

If you are deploying your serverless application with CDK, add the Datadog Serverless CloudFormation macro to your [Stack object](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_core.Stack.html) constructor.

**Typescript**
```typescript
import * as cdk from "@aws-cdk/core";

class CdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.addTransform("DatadogServerlessMacro");
  }
}
```

**Python**
```python
from aws_cdk import core

class CdkStack(core.Stack):
    def __init__(self, scope: core.Construct, id: str, **kwargs) -> None:
        super().__init__(scope, id, **kwargs)
        self.add_transform("DatadogServerlessMacro")
```

Note: For both SAM and CDK deployments, if you did not modify the provided `macro_template.yml` file when you installed the macro, then the name of the macro defined in your account will be `DatadogServerlessMacro`. If you have modified the original template, make sure the name of the transform you add here matches the `Name` property of the `AWS::CloudFormation::Macro` resource.

## Configuration

You can configure the library by add the following parameters:

```yaml
# Whether to add the Lambda Layers, or expect the user to bring their own. Defaults to true.
addLayers: true

# The log level, set to DEBUG for extended logging. Defaults to info.
logLevel: "info"

# Send custom metrics via logs with the help of Datadog Forwarder Lambda function (recommended). Defaults to true.
flushMetricsToLogs: true

# Which Datadog Site to send data to, only needed when flushMetricsToLogs is false. Defaults to datadoghq.com.
site: datadoghq.com # datadoghq.eu for Datadog EU

# Datadog API Key, only needed when flushMetricsToLogs is false.
apiKey: ""

# Datadog API Key encrypted using KMS, only needed when flushMetricsToLogs is false.
apiKMSKey: ""

# Enable enhanced metrics for Lambda functions. Defaults to true.
enableEnhancedMetrics: true

# Enable tracing on Lambda functions. Defaults to false.
enableXrayTracing: false

# Enable tracing on Lambda function using dd-trace, datadog's APM library. Requires datadog log forwarder to be set up. Defaults to true.
enableDDTracing: true

# When set, the plugin will try to subscribe the lambda's cloudwatch log groups to the forwarder with the given arn.
forwarderArn: arn:aws:lambda:us-east-1:000000000000:function:datadog-forwarder

# The name of the CloudFromation stack being deployed. Only required when a forwarderArn is provided and Lambda functions are dynamically named (when the `FunctionName` property isn't provided for a Lambda). For how to add this parameter for SAM and CDK, see examples below.
stackName: ""

# When set, the macro will add a `service` tag to all Lambda functions with the provided value.
service: ""

# When set, the macro will add a `env` tag to all Lambda functions with the provided value.
env: ""
```

### SAM

You can configure the library by add the following section to the `Parameters` under the `Transform` section of your `template.yml` file:

```yaml
Transform:
  - AWS::Serverless-2016-10-31
  - Name: DatadogServerlessMacro
    Parameters: 
        forwarderArn: "arn:aws:lambda:us-east-1:000000000000:function:datadog-forwarder"
        stackName: !Ref "AWS::StackName"
        service: "service-name"
        env: "test"
```

### AWS CDK

To configure the library when deploying with CDK, add a `CfnMapping` to your `Stack` object: 

**Typescript**
```typescript
import * as cdk from "@aws-cdk/core";

class CdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.addTransform("DatadogServerlessMacro");

    new cdk.CfnMapping(this, "Datadog", { // The id for this CfnMapping must be 'Datadog'
      mapping: {
        Parameters: { // This mapping key must be 'Parameters'
          forwarderArn: "arn:aws:lambda:us-east-1:000000000000:function:datadog-forwarder",
          stackName: this.stackName,
          service: "service-name",
          env: "test",
        },
      },
    });
  }
}
```

**Python**
```python
from aws_cdk import core

class CdkStack(core.Stack):
  def __init__(self, scope: core.Construct, id: str, **kwargs) -> None:
    super().__init__(scope, id, **kwargs)
    self.add_transform("DatadogServerlessMacro")

    mapping = core.CfnMapping(self, "Datadog", # The id for this CfnMapping must be 'Datadog'
      mapping={
        "Parameters": { # This mapping key must be 'Parameters'
          "forwarderArn": "arn:aws:lambda:us-east-1:000000000000:function:datadog-forwarder",
          "stackName": self.stackName,
          "service": "service-name",
          "env": "test",
        }
      })
```

## How it works

This macro modifies your CloudFormation template to attach the Datadog Lambda Layers for [Node.js](https://github.com/DataDog/datadog-lambda-layer-js) and [Python](https://github.com/DataDog/datadog-lambda-layer-python) to your functions. It redirects to a replacement handler that initializes the Lambda Layers without any required code changes. It also enables X-Ray tracing for your Lambda functions.

**IMPORTANT NOTE:** Because the plugin automatically wraps your Lambda handler function, you do **NOT** need to wrap your handler function as stated in the Node.js and Python Layer documentation.

**Node.js**
```js
module.exports.myHandler = datadog(
  // This wrapper is NOT needed when using this plugin
  async function myHandler(event, context) {},
);
```

**Python**
```python
@datadog_lambda_wrapper # This wrapper is NOT needed when using this plugin
def lambda_handler(event, context):
```
