import { RuntimeType, LambdaFunction } from "../src/layer";
import { addServiceAndEnvTags, addMacroTag, addCDKTag, addSAMTag } from "../src/tags";

function mockLambdaFunction(tags: any) {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: "nodejs12.x",
      Role: "role-arn",
      Tags: tags,
    },
    key: "FunctionKey",
    runtimeType: RuntimeType.NODE,
    runtime: "nodejs12.x",
  } as LambdaFunction;
}

describe("addServiceAndEnvTags", () => {
  it("does not override existing tags on function", () => {
    const existingTags = [
      { Value: "dev", Key: "env" },
      { Value: "my-service", Key: "service" },
    ];
    const lambda = mockLambdaFunction(existingTags);
    addServiceAndEnvTags([lambda], "my-other-service", "test");

    expect(lambda.properties.Tags).toEqual(existingTags);
  });

  it("does not add service or env tags if provided param is undefined", () => {
    const lambda = mockLambdaFunction(undefined);
    addServiceAndEnvTags([lambda], undefined, undefined);

    expect(lambda.properties.Tags).toBeUndefined();
  });

  it("creates tags property if needed", () => {
    const lambda = mockLambdaFunction(undefined);
    addServiceAndEnvTags([lambda], "my-service", "test");

    expect(lambda.properties.Tags).toEqual([
      { Value: "my-service", Key: "service" },
      { Value: "test", Key: "env" },
    ]);
  });

  it("adds to existing tags property if needed", () => {
    const existingTags = [{ Value: "dev", Key: "env" }];
    const lambda = mockLambdaFunction(existingTags);
    addServiceAndEnvTags([lambda], "my-service", undefined);

    expect(lambda.properties.Tags).toEqual([
      { Value: "dev", Key: "env" },
      { Value: "my-service", Key: "service" },
    ]);
  });
});

describe("addMacroTag", () => {
  it("does not update tags if no version is passed in", () => {
    const existingTags = [{ Value: "ironmaiden", Key: "band" }];
    const lambda = mockLambdaFunction(existingTags);
    addMacroTag([lambda], undefined);

    expect(lambda.properties.Tags).toEqual(existingTags);
  });

  it("creates tags property if needed", () => {
    const lambda = mockLambdaFunction(undefined);
    addMacroTag([lambda], "6.6.6");

    expect(lambda.properties.Tags).toEqual([{ Value: "v6.6.6", Key: "dd_sls_macro" }]);
  });

  it("appends version tag if needed", () => {
    const existingTags = [{ Value: "dev", Key: "env" }];
    const lambda = mockLambdaFunction(existingTags);
    addMacroTag([lambda], "6.6.6");

    expect(lambda.properties.Tags).toEqual([
      { Value: "dev", Key: "env" },
      { Value: "v6.6.6", Key: "dd_sls_macro" },
    ]);
  });
});

describe("addCDKTag", () => {
  it("creates tags property if needed", () => {
    const lambda = mockLambdaFunction(undefined);
    addCDKTag([lambda]);

    expect(lambda.properties.Tags).toEqual([{ Value: "CDK", Key: "dd_sls_macro_by" }]);
  });

  it("appends version tag if needed", () => {
    const existingTags = [{ Value: "dev", Key: "env" }];
    const lambda = mockLambdaFunction(existingTags);
    addCDKTag([lambda]);

    expect(lambda.properties.Tags).toEqual([
      { Value: "dev", Key: "env" },
      { Value: "CDK", Key: "dd_sls_macro_by" },
    ]);
  });
});

describe("addSAMTag", () => {
  it("creates tags property if needed", () => {
    const lambda = mockLambdaFunction(undefined);
    addSAMTag([lambda]);

    expect(lambda.properties.Tags).toEqual([]);
  });

  it("appends version tag if needed", () => {
    const existingTags = [{ Value: "SAM", Key: "lambda:createdBy" }];
    const lambda = mockLambdaFunction(existingTags);
    addSAMTag([lambda]);

    expect(lambda.properties.Tags).toEqual([
      { Value: "SAM", Key: "lambda:createdBy" },
      { Value: "SAM", Key: "dd_sls_macro_by" },
    ]);
  });
});
