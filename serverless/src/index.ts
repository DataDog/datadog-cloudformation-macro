import { getConfigFromCfnMappings, getConfigFromCfnParams, setEnvConfiguration } from "./env";
import { findLambdas, applyLayers, LambdaFunction } from "./layer";
import { getTracingMode, enableTracing, MissingIamRoleError } from "./tracing";
import { addServiceAndEnvTags, addMacroTag, addCDKTag, addSAMTag } from "./tags";
import { redirectHandlers } from "./redirect";
import { addCloudWatchForwarderSubscriptions } from "./forwarder";
import { CloudWatchLogs } from "aws-sdk";
import { version } from "../package.json";

const SUCCESS = "success";
const FAILURE = "failure";

export interface Resources {
  [logicalId: string]: {
    Type: string;
    Properties: any;
  };
}

interface Outputs {
  [key: string]: {
    Description: string;
    Value: {
      [Fn: string]: string;
    };
  };
}

interface CfnTemplate {
  Mappings?: any;
  Resources: Resources;
  Outputs: Outputs;
}

export interface InputEvent {
  region: string;
  accountId: string;
  fragment: CfnTemplate;
  transformId: string; // Name of the macro
  params: { [key: string]: any };
  requestId: string;
  templateParameterValues: { [key: string]: any };
}

export interface FunctionProperties {
  Handler: string;
  Runtime: string;
  Role: string | { [func: string]: string[] };
  Code: any;
  Environment?: { Variables?: { [key: string]: string | boolean } };
  Tags?: { Value: string; Key: string }[];
  Layers?: string[];
  TracingConfig?: { [key: string]: string };
  FunctionName?: string;
}

export const handler = async (event: InputEvent, _: any) => {
  try {
    const region = event.region;
    const fragment = event.fragment;
    const resources = fragment.Resources;
    const lambdas = findLambdas(resources);
    const outputs = fragment.Outputs;

    let config;

    // Use the parameters given for this specific transform/macro if it exists
    const transformParams = event.params ?? {};
    if (Object.keys(transformParams).length > 0) {
      config = getConfigFromCfnParams(transformParams);
    } else {
      // If not, check the Mappings section for Datadog config parameters as well
      config = getConfigFromCfnMappings(fragment.Mappings);
    }
    setEnvConfiguration(config, lambdas);

    // Apply layers
    if (config.addLayers) {
      const errors = applyLayers(region, lambdas, config.pythonLayerVersion, config.nodeLayerVersion);
      if (errors.length > 0) {
        return {
          requestId: event.requestId,
          status: FAILURE,
          fragment,
          errorMessage: errors.join("\n"),
        };
      }
    }

    // Enable tracing
    const tracingMode = getTracingMode(config);
    try {
      enableTracing(tracingMode, lambdas, resources);
    } catch (err) {
      if (err instanceof MissingIamRoleError) {
        return {
          requestId: event.requestId,
          status: FAILURE,
          fragment,
          errorMessage: err.message,
        };
      }
    }

    // Cloudwatch forwarder subscriptions
    if (config.forwarderArn) {
      const dynamicallyNamedLambdas = lambdaHasDynamicallyGeneratedName(lambdas);
      if (dynamicallyNamedLambdas.length > 0 && config.stackName === undefined) {
        const lambdaKeys = dynamicallyNamedLambdas.map((lambda) => lambda.key);
        const errorMessage = getMissingStackNameErrorMsg(lambdaKeys);
        return {
          requestId: event.requestId,
          status: FAILURE,
          fragment,
          errorMessage,
        };
      }

      const cloudWatchLogs = new CloudWatchLogs({ region });
      await addCloudWatchForwarderSubscriptions(
        resources,
        lambdas,
        config.stackName,
        config.forwarderArn,
        cloudWatchLogs,
      );
    }

    // Add service & env tags if values are provided
    if (config.service || config.env) {
      addServiceAndEnvTags(lambdas, config.service, config.env);
    }

    addMacroTag(lambdas, version);

    if (resources.CDKMetadata) {
      addCDKTag(lambdas);
    } else {
      addSAMTag(lambdas);
    }

    // Redirect handlers
    redirectHandlers(lambdas, config.addLayers);

    // Add Output Links to Datadog Function
    addOutputLinks(outputs, lambdas, config.site);

    return {
      requestId: event.requestId,
      status: SUCCESS,
      fragment,
    };
  } catch (error) {
    return {
      requestId: event.requestId,
      status: FAILURE,
      fragment: event.fragment,
      errorMessage: error.message,
    };
  }
};

/**
 * Returns true if one or more lambda resources in the provided template is missing
 * the 'FunctionName' property. In this case, it means at least one of the names
 * will be dynamically generated.
 */
function lambdaHasDynamicallyGeneratedName(lambdas: LambdaFunction[]) {
  const dynmicallyNamedLambdas: LambdaFunction[] = [];
  for (const lambda of lambdas) {
    if (lambda.properties.FunctionName === undefined) {
      dynmicallyNamedLambdas.push(lambda);
    }
  }
  return dynmicallyNamedLambdas;
}

/**
 * Builds the CloudFormation Outputs containing the alphanumeric key, description,
 * and value (URL) to the function in Datadog
 */
function addOutputLinks(outputs: Outputs, lambdas: LambdaFunction[], site: string) {
  for (const lambda of lambdas) {
    const functionKey = lambda.key;
    const key = `DatadogServerless${functionKey}`.replace(/[^a-z0-9]/gi, "");
    // Create Fn::Sub string using the Logical ID of the function and AWS::Region/AccountId pseudoparameters
    // https://app.datadoghq.com/functions/${LogicalID}:${AWS::Region}:${AWS::AccountId}:aws?source=cfn-macro
    outputs[key] = {
      Description: `Monitor ${functionKey} in Datadog:`,
      Value: {
        "Fn::Sub": `https://app.${site}/functions/\${${functionKey}}:\${AWS::Region}:\${AWS::AccountId}:aws?source=cfn-macro`,
      },
    };
  }
}

export function getMissingStackNameErrorMsg(lambdaKeys: string[]) {
  return (
    "A forwarder ARN was provided with one or more dynamically named lambda function resources," +
    " but the stack name was not provided. Without the stack name, the dynamically generated" +
    "function name can't be predicted and CloudWatch subscriptions can't be added. \n" +
    "To fix this, either add a 'FunctionName' property to the following resources:" +
    `${lambdaKeys.toString()}, or include the 'stackName' under the Datadog parameters. \n` +
    "If deploying with SAM, add 'stackName: !Ref \"AWS::StackName\"' under the Datadog" +
    "transform parameters. If deploying with CDK, add the stack name by adding " +
    "'stackName: <your stack object>.stackName' under the CfnMapping with the id 'Datadog'."
  );
}
