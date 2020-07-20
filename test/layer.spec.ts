import {
  findLambdas,
  LambdaFunction,
  RuntimeType,
  applyLayers,
  LayerJSON,
} from "../src/layer";

function mockFunctionResource(Runtime: string) {
  return {
    Type: "AWS::Lambda::Function",
    Properties: {
      Handler: "app.handler",
      Role: "role-arn",
      Runtime,
    },
  };
}

function mockLambdaFunction(key: string, runtime: string, type: RuntimeType) {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: runtime,
      Role: "role-arn",
    },
    key,
    type,
    runtime,
  } as LambdaFunction;
}

describe("findLambdas", () => {
  it("finds lambdas and correct assigns runtime types", () => {
    const resources = {
      FunctionA: mockFunctionResource("nodejs8.10"),
      FunctionB: mockFunctionResource("nodejs10.x"),
      FunctionC: mockFunctionResource("nodejs12.x"),
      FunctionD: mockFunctionResource("python2.7"),
      FunctionE: mockFunctionResource("python3.6"),
      FunctionF: mockFunctionResource("python3.7"),
      FunctionG: mockFunctionResource("python3.8"),
      FunctionH: mockFunctionResource("go1.10"),
    };
    const lambdas = findLambdas(resources);

    expect(lambdas).toEqual([
      mockLambdaFunction("FunctionA", "nodejs8.10", RuntimeType.NODE),
      mockLambdaFunction("FunctionB", "nodejs10.x", RuntimeType.NODE),
      mockLambdaFunction("FunctionC", "nodejs12.x", RuntimeType.NODE),
      mockLambdaFunction("FunctionD", "python2.7", RuntimeType.PYTHON),
      mockLambdaFunction("FunctionE", "python3.6", RuntimeType.PYTHON),
      mockLambdaFunction("FunctionF", "python3.7", RuntimeType.PYTHON),
      mockLambdaFunction("FunctionG", "python3.8", RuntimeType.PYTHON),
      mockLambdaFunction("FunctionH", "go1.10", RuntimeType.UNSUPPORTED),
    ]);
  });
});

describe("applyLayers", () => {
  it("adds a layer array if none are present", () => {
    const lambda = mockLambdaFunction(
      "FunctionKey",
      "nodejs12.x",
      RuntimeType.NODE
    );
    const layers: LayerJSON = {
      regions: { "us-east-1": { "nodejs12.x": "node:1" } },
    };
    applyLayers("us-east-1", [lambda], layers);

    expect(lambda.properties.Layers).toEqual(["node:1"]);
  });

  it("appends to the layer array if already present", () => {
    const lambda = mockLambdaFunction(
      "FunctionKey",
      "nodejs12.x",
      RuntimeType.NODE
    );
    const layers: LayerJSON = {
      regions: { "us-east-1": { "nodejs12.x": "node:1" } },
    };
    lambda.properties.Layers = ["node:2"];
    applyLayers("us-east-1", [lambda], layers);

    expect(lambda.properties.Layers).toEqual(["node:2", "node:1"]);
  });

  it("doesn't add duplicate layers", () => {
    const lambda = mockLambdaFunction(
      "FunctionKey",
      "nodejs12.x",
      RuntimeType.NODE
    );
    const layers: LayerJSON = {
      regions: { "us-east-1": { "nodejs12.x": "node:1" } },
    };
    lambda.properties.Layers = ["node:1"];
    applyLayers("us-east-1", [lambda], layers);

    expect(lambda.properties.Layers).toEqual(["node:1"]);
  });

  it("only adds layer when region is found", () => {
    const lambda = mockLambdaFunction(
      "FunctionKey",
      "nodejs12.x",
      RuntimeType.NODE
    );
    const layers: LayerJSON = {
      regions: { "us-east-1": { "nodejs12.x": "node:1" } },
    };
    applyLayers("us-east-2", [lambda], layers);

    expect(lambda.properties.Layers).toBeUndefined();
  });

  it("only adds layers when layer arn is found", () => {
    const lambda = mockLambdaFunction(
      "FunctionKey",
      "nodejs12.x",
      RuntimeType.NODE
    );
    const layers: LayerJSON = {
      regions: { "us-east-1": { "python2.7": "python:1" } },
    };
    applyLayers("us-east-1", [lambda], layers);

    expect(lambda.properties.Layers).toBeUndefined();
  });

  it("doesn't add layer when runtime is not supported", () => {
    const lambda = mockLambdaFunction(
      "FunctionKey",
      "go1.10",
      RuntimeType.UNSUPPORTED
    );
    const layers: LayerJSON = {
      regions: { "us-east-1": { "python2.7": "python:1" } },
    };
    applyLayers("us-east-1", [lambda], layers);

    expect(lambda.properties.Layers).toBeUndefined();
  });
});
