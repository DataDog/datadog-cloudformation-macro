import {
  redirectHandlers,
  JS_HANDLER_WITH_LAYERS,
  JS_HANDLER,
  DD_HANDLER_ENV_VAR,
  AWS_LAMBDA_EXEC_WRAPPER_ENV_VAR,
  AWS_LAMBDA_EXEC_WRAPPER,
} from "../../src/lambda/redirect";
import { LambdaFunction, RuntimeType } from "../../src/lambda/layer";

function mockLambdaFunction(runtime: string, runtimeType: RuntimeType): LambdaFunction {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: runtime,
      Role: "role-arn",
    },
    key: "FunctionKey",
    runtimeType,
    runtime,
  } as LambdaFunction;
}

const mockNodeLambda = () => mockLambdaFunction("nodejs18.x", RuntimeType.NODE);
const mockDotnetLambda = () => mockLambdaFunction("dotnet6", RuntimeType.DOTNET);
const mockJavaLambda = () => mockLambdaFunction("java11", RuntimeType.JAVA);

interface TestCase {
  name: string;
  createLambda: () => LambdaFunction;
  addLayers: boolean;
  useExtension: boolean;
  expectedHandler: string;
  expectedEnvVars: { [key: string]: string };
}

const testCases: TestCase[] = [
  // Node.js tests
  {
    name: "NODE",
    createLambda: mockNodeLambda,
    addLayers: true,
    useExtension: true,
    expectedHandler: JS_HANDLER_WITH_LAYERS,
    expectedEnvVars: { [DD_HANDLER_ENV_VAR]: "app.handler" },
  },
  {
    name: "NODE",
    createLambda: mockNodeLambda,
    addLayers: true,
    useExtension: false,
    expectedHandler: JS_HANDLER_WITH_LAYERS,
    expectedEnvVars: { [DD_HANDLER_ENV_VAR]: "app.handler" },
  },
  {
    name: "NODE",
    createLambda: mockNodeLambda,
    addLayers: false,
    useExtension: true,
    expectedHandler: JS_HANDLER,
    expectedEnvVars: { [DD_HANDLER_ENV_VAR]: "app.handler" },
  },
  {
    name: "NODE",
    createLambda: mockNodeLambda,
    addLayers: false,
    useExtension: false,
    expectedHandler: JS_HANDLER,
    expectedEnvVars: { [DD_HANDLER_ENV_VAR]: "app.handler" },
  },

  // .NET tests
  {
    name: "DOTNET",
    createLambda: mockDotnetLambda,
    addLayers: true,
    useExtension: true,
    expectedHandler: "app.handler",
    expectedEnvVars: { [AWS_LAMBDA_EXEC_WRAPPER_ENV_VAR]: AWS_LAMBDA_EXEC_WRAPPER },
  },
  {
    name: "DOTNET",
    createLambda: mockDotnetLambda,
    addLayers: false,
    useExtension: true,
    expectedHandler: "app.handler",
    expectedEnvVars: { [AWS_LAMBDA_EXEC_WRAPPER_ENV_VAR]: AWS_LAMBDA_EXEC_WRAPPER },
  },
  {
    name: "DOTNET",
    createLambda: mockDotnetLambda,
    addLayers: true,
    useExtension: false,
    expectedHandler: "app.handler",
    expectedEnvVars: { [DD_HANDLER_ENV_VAR]: "app.handler" },
  },
  {
    name: "DOTNET",
    createLambda: mockDotnetLambda,
    addLayers: false,
    useExtension: false,
    expectedHandler: "app.handler",
    expectedEnvVars: { [DD_HANDLER_ENV_VAR]: "app.handler" },
  },

  // Java tests
  {
    name: "JAVA",
    createLambda: mockJavaLambda,
    addLayers: true,
    useExtension: true,
    expectedHandler: "app.handler",
    expectedEnvVars: { [AWS_LAMBDA_EXEC_WRAPPER_ENV_VAR]: AWS_LAMBDA_EXEC_WRAPPER },
  },
  {
    name: "JAVA",
    createLambda: mockJavaLambda,
    addLayers: false,
    useExtension: true,
    expectedHandler: "app.handler",
    expectedEnvVars: { [AWS_LAMBDA_EXEC_WRAPPER_ENV_VAR]: AWS_LAMBDA_EXEC_WRAPPER },
  },
  {
    name: "JAVA",
    createLambda: mockJavaLambda,
    addLayers: true,
    useExtension: false,
    expectedHandler: "app.handler",
    expectedEnvVars: { [DD_HANDLER_ENV_VAR]: "app.handler" },
  },
  {
    name: "JAVA",
    createLambda: mockJavaLambda,
    addLayers: false,
    useExtension: false,
    expectedHandler: "app.handler",
    expectedEnvVars: { [DD_HANDLER_ENV_VAR]: "app.handler" },
  },
];

describe("redirectHandlers", () => {
  it.each(testCases)(
    "$name with addLayers=$addLayers, useExtension=$useExtension",
    ({ createLambda, addLayers, useExtension, expectedHandler, expectedEnvVars }) => {
      const lambda = createLambda();
      redirectHandlers([lambda], addLayers, useExtension);

      expect(lambda.properties.Handler).toEqual(expectedHandler);
      expect(lambda.properties.Environment).toEqual({
        Variables: expectedEnvVars,
      });
    },
  );
});
