# Datadog CloudFormation Macro

This CloudFormation macro automatically installs Datadog Lambda layers to your Python and Node.js Lambda functions to collect custom metrics and traces.

## Installation

To install the macro, you will need to clone this repository and deploy a separate CloudFormation stack. This deployment will include a CloudFormation macro resource and a Lambda function that is invoked when the macro is run. Deploying this stack on your AWS account will give you access to use the macro on your other Lambda functions.

You can start by first cloning this repository:
```bash
git clone https://github.com/DataDog/datadog-cloudformation-macro.git
```

Make sure you have all the dependencies installed:
```bash
yarn install # Yarn users
npm install  # NPM users
```

And run the build script:
```bash
yarn build    # Yarn users
npm run build # NPM users
```

Now you are ready to deploy the macro to your AWS account.

### Deploying macro resources

1. You will need an S3 bucket to store the CloudFormation artifacts for the macro.
    * If you don't have one already, you can create one with `aws s3 mb s3://<bucket name>`

2. Package the provided CloudFormation template (`macro_template.yml`). This includes a Lambda function and a CloudFormation macro resource. The provided template uses the AWS Serverless Application Model, so it must be transformed before deployment.

    ```bash
    aws cloudformation package \
        --template-file template.yml \
        --s3-bucket <your bucket name here> \
        --output-template-file packaged.template
    ```

3. Deploy the packaged CloudFormation template to a CloudFormation stack:

    ```bash
    aws cloudformation deploy \
        --stack-name datadog-cfn-macro \
        --template-file packaged.template \
        --capabilities CAPABILITY_IAM
    ```

## Usage

### Deploying with SAM or AWS CLI

If you are deploying your serverless application with SAM, add the Datadog CloudFormation macro to your `template.yml` under the `Transform` section, after the required SAM transform:

```yaml
Transform:
  - AWS::Serverless-2016-10-31
  - Name: DatadogCfnMacro
```

### Deploying with CDK

If you are deploying your severless application with CDK, add the CloudFormation macro to your [Stack object](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_core.Stack.html) constructor.

**Typescript**
```typescript
import * as cdk from "@aws-cdk/core";

class CdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.addTransform("DatadogCfnMacro");
  }
}
```

**Python**
```python
from aws_cdk import core

class CdkStack(core.Stack):
    def __init__(self, scope: core.Construct, id: str, **kwargs) -> None:
        super().__init__(scope, id, **kwargs)
        self.add_transform("DatadogCfnMacro")
```

Note: For both SAM and CDK deployments, if you did not modify the provided `macro_template.yml` file when you installed the macro, then the macro name should be `DatadogCfnMacro`. If you have modified the original template, make sure the name of the transform you add here matches the `Name` property of the `AWS::CloudFormation::Macro` resource.

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

### Deploying with SAM or AWS CLI

You can configure the library by add the following section to the `Parameters` under the `Transform` section of your template file (usually `template.yml`):

```yaml
Transform:
  - AWS::Serverless-2016-10-31
  - Name: DatadogCfnMacro
    Parameters: 
        forwarderArn: "arn:aws:lambda:us-east-1:000000000000:function:datadog-forwarder"
        stackName: !Ref "AWS::StackName"
        service: "service-name"
```

### Deploying with CDK

To configure the library when deploying with CDK, add a `CfnMapping` to your `Stack` object: 

**Typescript**
```typescript
import * as cdk from "@aws-cdk/core";

class CdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.addTransform("DatadogCfnMacro");

    new cdk.CfnMapping(this, "Datadog", { // The id for this CfnMapping must be 'Datadog'
      mapping: {
        Parameters: { // This mapping key must be 'Parameters'
          forwarderArn: "arn:aws:lambda:us-east-1:000000000000:function:datadog-forwarder",
          stackName: this.stackName,
          service: "service-name",
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
    self.add_transform("DatadogCfnMacro")

    mapping = core.CfnMapping(self, "Datadog", # The id for this CfnMapping must be 'Datadog'
      mapping={
        "Parameters": { # This mapping key must be 'Parameters'
          "forwarderArn": "arn:aws:lambda:us-east-1:000000000000:function:datadog-forwarder",
          "stackName": self.stackName,
          "service": "service-name",
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

