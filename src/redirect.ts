import { LambdaFunction, RuntimeType } from "./layer";

export const DD_HANDLER_ENV_VAR = "DD_LAMBDA_HANDLER";
export const PYTHON_HANDLER = "datadog_lambda.handler.handler";
export const JS_HANDLER_WITH_LAYERS =
  "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler";
export const JS_HANDLER = "node_modules/datadog-lambda-js/dist/handler.handler";

export function redirectHandlers(
  lambdas: LambdaFunction[],
  addLayers: boolean
) {
  lambdas.forEach((lambda) => {
    setEnvDatadogHandler(lambda);
    const handler = getDDHandler(lambda.type, addLayers);
    if (handler === undefined) {
      return;
    }
    lambda.properties.Handler = handler;
  });
}

function getDDHandler(
  lambdaRuntime: RuntimeType | undefined,
  addLayers: boolean
) {
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

function setEnvDatadogHandler(lambda: LambdaFunction) {
  const environment = lambda.properties.Environment ?? {};
  const environmentVariables = environment.Variables ?? {};

  const originalHandler = lambda.properties.Handler;
  environmentVariables[DD_HANDLER_ENV_VAR] = originalHandler;

  environment.Variables = environmentVariables;
  lambda.properties.Environment = environment;
}
