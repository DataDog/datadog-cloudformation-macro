import { LambdaFunction, RuntimeType } from "./layer";

export const AWS_LAMBDA_EXEC_WRAPPER_ENV_VAR = "AWS_LAMBDA_EXEC_WRAPPER";
export const AWS_LAMBDA_EXEC_WRAPPER = "/opt/datadog_wrapper";
export const DD_HANDLER_ENV_VAR = "DD_LAMBDA_HANDLER";
export const PYTHON_HANDLER = "datadog_lambda.handler.handler";
export const JS_HANDLER_WITH_LAYERS = "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler";
export const JS_HANDLER = "node_modules/datadog-lambda-js/dist/handler.handler";

/**
 * To avoid modifying code in the user's lambda handler, redirect the handler to a Datadog
 * handler that initializes the Lambda Layers and then calls the original handler.
 * 'DD_LAMBDA_HANDLER' is set to the original handler in the lambda's environment for the
 * replacement handler to find.
 */
export function redirectHandlers(lambdas: LambdaFunction[], addLayers: boolean): void {
  lambdas.forEach((lambda) => {
    if (lambda.runtimeType == RuntimeType.DOTNET || lambda.runtimeType == RuntimeType.JAVA) {
      setEnvDatadogWrapper(lambda);
      return;
    }

    setEnvDatadogHandler(lambda);
    const handler = getDDHandler(lambda.runtimeType, addLayers);
    if (handler === undefined) {
      return;
    }
    lambda.properties.Handler = handler;
  });
}

function getDDHandler(lambdaRuntime: RuntimeType | undefined, addLayers: boolean) {
  if (lambdaRuntime === undefined) {
    return;
  }
  switch (lambdaRuntime) {
    case RuntimeType.NODE:
      return addLayers ? JS_HANDLER_WITH_LAYERS : JS_HANDLER;
    case RuntimeType.PYTHON:
      return PYTHON_HANDLER;
  }
}

function setEnvDatadogHandler(lambda: LambdaFunction): void {
  const environment = lambda.properties.Environment ?? {};
  const environmentVariables = environment.Variables ?? {};

  const originalHandler = lambda.properties.Handler;
  environmentVariables[DD_HANDLER_ENV_VAR] = originalHandler;

  environment.Variables = environmentVariables;
  lambda.properties.Environment = environment;
}

function setEnvDatadogWrapper(lambda: LambdaFunction): void {
  const environment = lambda.properties.Environment ?? {};
  const environmentVariables = environment.Variables ?? {};

  environmentVariables[AWS_LAMBDA_EXEC_WRAPPER_ENV_VAR] = AWS_LAMBDA_EXEC_WRAPPER;

  environment.Variables = environmentVariables;
  lambda.properties.Environment = environment;
}
