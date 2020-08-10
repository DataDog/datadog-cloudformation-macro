import {
  redirectHandlers,
  JS_HANDLER_WITH_LAYERS,
  JS_HANDLER,
  PYTHON_HANDLER,
  DD_HANDLER_ENV_VAR,
} from "../src/redirect";
import { LambdaFunction, RuntimeType } from "../src/layer";

function mockLambdaFunction(key: string, runtime: string, runtimeType: RuntimeType) {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: runtime,
      Role: "role-arn",
    },
    key,
    runtimeType,
    runtime,
  } as LambdaFunction;
}

describe("redirectHandlers", () => {
  it("redirects js handler correctly when addLayers is true", () => {
    const lambda = mockLambdaFunction("FunctionKey", "nodejs12.x", RuntimeType.NODE);
    redirectHandlers([lambda], true);

    expect(lambda.properties.Handler).toEqual(JS_HANDLER_WITH_LAYERS);
  });

  it("redirects js handlers correctly when addLayers is false", () => {
    const lambda = mockLambdaFunction("FunctionKey", "nodejs12.x", RuntimeType.NODE);
    redirectHandlers([lambda], false);

    expect(lambda.properties.Handler).toEqual(JS_HANDLER);
  });

  it("redirects handler and sets env variable to original handler", () => {
    const lambda = mockLambdaFunction("FunctionKey", "python2.7", RuntimeType.PYTHON);
    redirectHandlers([lambda], true);

    expect(lambda.properties.Handler).toEqual(PYTHON_HANDLER);
    expect(lambda.properties.Environment).toEqual({
      Variables: { [DD_HANDLER_ENV_VAR]: "app.handler" },
    });
  });
});
