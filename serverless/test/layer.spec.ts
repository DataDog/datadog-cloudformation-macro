import {
  findLambdas,
  LambdaFunction,
  RuntimeType,
  applyLayers,
  DD_ACCOUNT_ID,
  DD_GOV_ACCOUNT_ID,
  getMissingLayerVersionErrorMsg,
  getLambdaLibraryLayerArn,
  getExtensionLayerArn,
  ArchitectureType,
} from "../src/layer";

function mockFunctionResource(runtime: string | { Ref: string }, architectures?: string[]) {
  return {
    Type: "AWS::Lambda::Function",
    Properties: {
      Handler: "app.handler",
      Role: "role-arn",
      Runtime: runtime,
      Architectures: architectures,
    },
  };
}

function mockLambdaFunction(
  key: string,
  runtime: string,
  runtimeType: RuntimeType,
  architecture: string,
  architectureType: ArchitectureType = ArchitectureType.x86_64,
  runtimeProperty?: { Ref: string },
) {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: runtimeProperty ?? runtime,
      Role: "role-arn",
      Architectures: [architecture],
    },
    key,
    runtimeType,
    runtime,
    architecture,
    architectureType,
  } as LambdaFunction;
}

describe("findLambdas", () => {
  it("finds lambdas and correctly assigns runtime types", () => {
    const resources = {
      Node12Function: mockFunctionResource("nodejs12.x", ["x86_64"]),
      Node14Function: mockFunctionResource("nodejs14.x", ["x86_64"]),
      Node16Function: mockFunctionResource("nodejs16.x", ["x86_64"]),
      Python27Function: mockFunctionResource("python2.7", ["x86_64"]),
      Python36Function: mockFunctionResource("python3.6", ["x86_64"]),
      Python37Function: mockFunctionResource("python3.7", ["x86_64"]),
      Python38Function: mockFunctionResource("python3.8", ["x86_64"]),
      Python39Function: mockFunctionResource("python3.9", ["x86_64"]),
      GoFunction: mockFunctionResource("go1.10", ["x86_64"]),
      RefFunction: mockFunctionResource({ Ref: "ValueRef" }, ["arm64"]),
    };
    const lambdas = findLambdas(resources, { ValueRef: "nodejs14.x" });

    expect(lambdas).toEqual([
      mockLambdaFunction("Node12Function", "nodejs12.x", RuntimeType.NODE, "x86_64", ArchitectureType.x86_64),
      mockLambdaFunction("Node14Function", "nodejs14.x", RuntimeType.NODE, "x86_64", ArchitectureType.x86_64),
      mockLambdaFunction("Node16Function", "nodejs16.x", RuntimeType.NODE, "x86_64", ArchitectureType.x86_64),
      mockLambdaFunction("Python27Function", "python2.7", RuntimeType.PYTHON, "x86_64", ArchitectureType.x86_64),
      mockLambdaFunction("Python36Function", "python3.6", RuntimeType.PYTHON, "x86_64", ArchitectureType.x86_64),
      mockLambdaFunction("Python37Function", "python3.7", RuntimeType.PYTHON, "x86_64", ArchitectureType.x86_64),
      mockLambdaFunction("Python38Function", "python3.8", RuntimeType.PYTHON, "x86_64", ArchitectureType.x86_64),
      mockLambdaFunction("Python39Function", "python3.9", RuntimeType.PYTHON, "x86_64", ArchitectureType.x86_64),
      mockLambdaFunction("GoFunction", "go1.10", RuntimeType.UNSUPPORTED, "x86_64", ArchitectureType.x86_64),
      mockLambdaFunction("RefFunction", "nodejs14.x", RuntimeType.NODE, "arm64", ArchitectureType.ARM64, {
        Ref: "ValueRef",
      }),
    ]);
  });
});

describe("applyLayers", () => {
  it("adds a layer array if none are present", () => {
    const lambda = mockLambdaFunction("FunctionKey", "nodejs12.x", RuntimeType.NODE, "x86_64");
    const region = "us-east-1";
    const nodeLayerVersion = 25;
    const errors = applyLayers(region, [lambda], undefined, nodeLayerVersion);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toEqual([
      `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Node12-x:${nodeLayerVersion}`,
    ]);
  });

  it("appends to the layer array if already present", () => {
    const lambda = mockLambdaFunction("FunctionKey", "nodejs12.x", RuntimeType.NODE, "x86_64");
    lambda.properties.Layers = ["node:2"];

    const region = "us-east-1";
    const nodeLayerVersion = 25;
    const errors = applyLayers(region, [lambda], undefined, nodeLayerVersion);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toEqual([
      "node:2",
      `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Node12-x:${nodeLayerVersion}`,
    ]);
  });

  it("doesn't add duplicate layers", () => {
    const lambda = mockLambdaFunction("FunctionKey", "nodejs12.x", RuntimeType.NODE, "x86_64");
    const region = "us-east-1";
    const nodeLayerVersion = 25;
    const layerArn = `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Node12-x:${nodeLayerVersion}`;
    lambda.properties.Layers = [layerArn];
    const errors = applyLayers(region, [lambda], undefined, nodeLayerVersion);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toEqual([layerArn]);
  });

  it("doesn't add layer when runtime is not supported", () => {
    const lambda = mockLambdaFunction("FunctionKey", "go1.10", RuntimeType.UNSUPPORTED, "x86_64");
    const errors = applyLayers("us-east-1", [lambda]);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toBeUndefined();
  });

  it("returns errors if layer versions are not provided for corresponding Lambda runtimes", () => {
    const pythonLambda = mockLambdaFunction("PythonFunctionKey", "python2.7", RuntimeType.PYTHON, "x86_64");
    const nodeLambda = mockLambdaFunction("NodeFunctionKey", "nodejs12.x", RuntimeType.NODE, "x86_64");
    const errors = applyLayers("us-east-1", [pythonLambda, nodeLambda]);

    expect(errors).toEqual([
      getMissingLayerVersionErrorMsg("PythonFunctionKey", "Python", "python"),
      getMissingLayerVersionErrorMsg("NodeFunctionKey", "Node.js", "node"),
    ]);
    expect(pythonLambda.properties.Layers).toBeUndefined();
    expect(nodeLambda.properties.Layers).toBeUndefined();
  });

  it("applies the node and extension lambda layers", () => {
    const lambda = mockLambdaFunction("FunctionKey", "nodejs12.x", RuntimeType.NODE, "x86_64");
    const region = "us-east-1";
    const nodeLayerVersion = 25;
    const extensionLayerVersion = 6;
    const errors = applyLayers(region, [lambda], undefined, nodeLayerVersion, extensionLayerVersion);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toEqual([
      `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Node12-x:${nodeLayerVersion}`,
      `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Extension:${extensionLayerVersion}`,
    ]);
  });

  it("applies the node and extension lambda layers for arm", () => {
    const lambda = mockLambdaFunction("FunctionKey", "nodejs12.x", RuntimeType.NODE, "arm64", ArchitectureType.ARM64);
    const region = "us-east-1";
    const nodeLayerVersion = 25;
    const extensionLayerVersion = 6;
    const errors = applyLayers(region, [lambda], undefined, nodeLayerVersion, extensionLayerVersion);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toEqual([
      `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Node12-x:${nodeLayerVersion}`,
      `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Extension-ARM:${extensionLayerVersion}`,
    ]);
  });

  it("applies the python and extension lambda layers", () => {
    const lambda = mockLambdaFunction("FunctionKey", "python3.6", RuntimeType.PYTHON, "x86_64");
    const region = "us-east-1";
    const pythonLayerVersion = 25;
    const extensionLayerVersion = 6;
    const errors = applyLayers(region, [lambda], pythonLayerVersion, undefined, extensionLayerVersion);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toEqual([
      `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Python36:${pythonLayerVersion}`,
      `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Extension:${extensionLayerVersion}`,
    ]);
  });

  it("applies the python and extension lambda layers for arm", () => {
    const lambda = mockLambdaFunction("FunctionKey", "python3.9", RuntimeType.PYTHON, "arm64", ArchitectureType.ARM64);
    const region = "us-east-1";
    const pythonLayerVersion = 25;
    const extensionLayerVersion = 6;
    const errors = applyLayers(region, [lambda], pythonLayerVersion, undefined, extensionLayerVersion);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toEqual([
      `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Python39-ARM:${pythonLayerVersion}`,
      `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Extension-ARM:${extensionLayerVersion}`,
    ]);
  });
});

describe("isGovCloud", () => {
  it("applies the GovCloud layer", () => {
    const pythonLambda = mockLambdaFunction("PythonFunctionKey", "python3.8", RuntimeType.PYTHON, "x86_64");
    const nodeLambda = mockLambdaFunction("NodeFunctionKey", "nodejs16.x", RuntimeType.NODE, "x86_64");
    const errors = applyLayers("us-gov-east-1", [pythonLambda, nodeLambda], 21, 30);

    expect(errors.length).toEqual(0);
    expect(pythonLambda.properties.Layers).toEqual([
      `arn:aws-us-gov:lambda:us-gov-east-1:${DD_GOV_ACCOUNT_ID}:layer:Datadog-Python38:21`,
    ]);
    expect(nodeLambda.properties.Layers).toEqual([
      `arn:aws-us-gov:lambda:us-gov-east-1:${DD_GOV_ACCOUNT_ID}:layer:Datadog-Node16-x:30`,
    ]);
  });
});

describe("getLambdaLibraryLayerArn", () => {
  it("gets the us-east-1 layer arn for the Datadog Node16 Lambda Library", () => {
    const region = "us-east-1";
    const version = 22;
    const runtime = "nodejs16.x";
    const layerArn = getLambdaLibraryLayerArn(region, version, runtime, "x86_64");
    expect(layerArn).toEqual(`arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Node16-x:${version}`);
  });
  it("gets the us-east-1 layer arn for the Datadog Python36 Lambda Library", () => {
    const region = "us-east-1";
    const version = 22;
    const runtime = "python3.6";
    const layerArn = getLambdaLibraryLayerArn(region, version, runtime, "x86_64");
    expect(layerArn).toEqual(`arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Python36:${version}`);
  });
  it("gets the us-east-1 ARM layer arn for the Datadog Python38 Lambda Library", () => {
    const region = "us-east-1";
    const version = 22;
    const runtime = "python3.8";
    const layerArn = getLambdaLibraryLayerArn(region, version, runtime, "arm64");
    expect(layerArn).toEqual(`arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Python38-ARM:${version}`);
  });
  it("gets the us-gov-east-1 layer arn for the Datadog Python36 Lambda Library", () => {
    const region = "us-gov-east-1";
    const version = 22;
    const runtime = "python3.6";
    const layerArn = getLambdaLibraryLayerArn(region, version, runtime, "x86_64");
    expect(layerArn).toEqual(`arn:aws-us-gov:lambda:${region}:${DD_GOV_ACCOUNT_ID}:layer:Datadog-Python36:${version}`);
  });
  it("gets the us-gov-east-1 ARM layer arn for the Datadog Python39 Lambda Library", () => {
    const region = "us-gov-east-1";
    const version = 22;
    const runtime = "python3.9";
    const layerArn = getLambdaLibraryLayerArn(region, version, runtime, "arm64");
    expect(layerArn).toEqual(
      `arn:aws-us-gov:lambda:${region}:${DD_GOV_ACCOUNT_ID}:layer:Datadog-Python39-ARM:${version}`,
    );
  });
  it("gets the us-gov-east-1 layer arn for the Datadog Node16 Lambda Library", () => {
    const region = "us-gov-east-1";
    const version = 22;
    const runtime = "nodejs16.x";
    const layerArn = getLambdaLibraryLayerArn(region, version, runtime, "x86_64");
    expect(layerArn).toEqual(`arn:aws-us-gov:lambda:${region}:${DD_GOV_ACCOUNT_ID}:layer:Datadog-Node16-x:${version}`);
  });
});

describe("getExtensionLayerArn", () => {
  it("gets the us-east-1 layer arn for the Datadog Lambda Extension", () => {
    const region = "us-east-1";
    const version = 6;
    const layerArn = getExtensionLayerArn(region, version, "x86_64");
    expect(layerArn).toEqual(`arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Extension:${version}`);
  });
  it("gets the us-east-1 layer arn for the ARM Datadog Lambda Extension", () => {
    const region = "us-east-1";
    const version = 6;
    const layerArn = getExtensionLayerArn(region, version, "arm64");
    expect(layerArn).toEqual(`arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Extension-ARM:${version}`);
  });
  it("gets the us-gov-west-1 layer arn for the Datadog Lambda Extension", () => {
    const region = "us-gov-west-1";
    const version = 6;
    const layerArn = getExtensionLayerArn(region, version, "x86_64");
    expect(layerArn).toEqual(`arn:aws-us-gov:lambda:${region}:${DD_GOV_ACCOUNT_ID}:layer:Datadog-Extension:${version}`);
  });
  it("gets the us-gov-west-1 layer arn for the ARM Datadog Lambda Extension", () => {
    const region = "us-gov-west-1";
    const version = 6;
    const layerArn = getExtensionLayerArn(region, version, "arm64");
    expect(layerArn).toEqual(
      `arn:aws-us-gov:lambda:${region}:${DD_GOV_ACCOUNT_ID}:layer:Datadog-Extension-ARM:${version}`,
    );
  });
});
