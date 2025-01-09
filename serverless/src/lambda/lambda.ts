import { Configuration, setEnvConfiguration } from "./env";
import { findLambdas, applyLayers, applyExtensionLayer, LambdaFunction } from "./layer";
import { getTracingMode, enableTracing, MissingIamRoleError, TracingMode } from "./tracing";
import { addDDTags, addMacroTag, addCDKTag, addSAMTag } from "./tags";
import { redirectHandlers } from "./redirect";
import { addCloudWatchForwarderSubscriptions } from "./forwarder";
import { CloudWatchLogs } from "aws-sdk";
import { InputEvent, OutputEvent, SUCCESS, FAILURE } from "../common/types";
import log from "loglevel";
import { version } from "../../package.json";

export async function instrumentLambdas(event: InputEvent, config: Configuration): Promise<OutputEvent> {
  const region = event.region;
  const fragment = event.fragment;
  const resources = fragment.Resources;

  // find lambdas then filter out the lamba's that are flagged to be excluded from instrumentation.
  const lambdas = findLambdas(resources, event.templateParameterValues).filter(
    (lambda) => !config.exclude?.includes(lambda.key),
  );
  log.debug(`Lambda resources found: ${JSON.stringify(lambdas)}`);

  log.debug("Setting environment variables for Lambda function resources");
  setEnvConfiguration(config, lambdas);

  // Apply layers
  if (config.addLayers) {
    log.debug("Applying Layers to Lambda functions...");
    const errors = applyLayers(
      region,
      lambdas,
      config.pythonLayerVersion,
      config.nodeLayerVersion,
      config.dotnetLayerVersion,
      config.javaLayerVersion,
    );
    if (errors.length > 0) {
      return {
        requestId: event.requestId,
        status: FAILURE,
        fragment,
        errorMessage: errors.join("\n"),
      };
    }
  }

  if (config.addExtension || config.extensionLayerVersion !== undefined) {
    const errors = applyExtensionLayer(region, lambdas, config.extensionLayerVersion);
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
    log.debug(`Setting tracing mode to ${TracingMode[tracingMode]} for Lambda functions...`);
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

    log.debug("Adding Datadog Forwarder CloudWatch subscriptions...");
    await addCloudWatchForwarderSubscriptions(
      resources,
      lambdas,
      config.stackName,
      config.forwarderArn,
      cloudWatchLogs,
    );
  }

  // Add the optional datadog tags if forwarder is being used
  if (config.forwarderArn) {
    log.debug("Adding optional tags...");
    addDDTags(lambdas, config);
  }

  log.debug("Adding macro version tag...");
  addMacroTag(lambdas, version);

  log.debug("Adding dd_sls_macro_by tag...");
  if (resources.CDKMetadata) {
    addCDKTag(lambdas);
  } else {
    addSAMTag(lambdas);
  }

  // Redirect handlers
  log.debug("Wrapping Lambda function handlers with Datadog handler...");
  redirectHandlers(lambdas, config.addLayers);

  return {
    requestId: event.requestId,
    status: SUCCESS,
    fragment,
  };
}

/**
 * Returns true if one or more lambda resources in the provided template is missing
 * the 'FunctionName' property. In this case, it means at least one of the names
 * will be dynamically generated.
 */
function lambdaHasDynamicallyGeneratedName(lambdas: LambdaFunction[]): LambdaFunction[] {
  const dynmicallyNamedLambdas: LambdaFunction[] = [];
  for (const lambda of lambdas) {
    if (lambda.properties.FunctionName === undefined) {
      dynmicallyNamedLambdas.push(lambda);
    }
  }
  return dynmicallyNamedLambdas;
}

export function getMissingStackNameErrorMsg(lambdaKeys: string[]): string {
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
