import { FunctionInfo, RuntimeType } from "./layer";

export const datadogHandlerEnvVar = "DD_LAMBDA_HANDLER";
export const pythonHandler = "datadog_lambda.handler.handler";
export const jsHandlerWithLayers =
  "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler";
export const jsHandler = "node_modules/datadog-lambda-js/dist/handler.handler";

export function redirectHandlers(funcs: FunctionInfo[]) {
  funcs.forEach((func) => {
    setEnvDatadogHandler(func);
    const handler = getDDHandler(func.type, true);
    if (handler === undefined) {
      return;
    }
    func.lambda.Handler = handler;
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
      return addLayers ? jsHandlerWithLayers : jsHandler;
    case RuntimeType.PYTHON:
      return pythonHandler;
  }
}

function setEnvDatadogHandler(func: FunctionInfo) {
  const environment = func.lambda.Environment ?? {};
  const environmentVariables = environment.Variables ?? {};

  const originalHandler = func.lambda.Handler;
  environmentVariables[datadogHandlerEnvVar] = originalHandler;

  environment.Variables = environmentVariables;
  func.lambda.Environment = environment;
}
