import { RuntimeType, LambdaFunction } from "../src/layer";
import { addServiceAndEnvTags } from "../src/tags";

function mockLambdaFunction(Tags: any) {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: "nodejs12.x",
      Role: "role-arn",
      Tags,
    },
    key: "FunctionKey",
    type: RuntimeType.NODE,
    runtime: "nodejs12.x",
  } as LambdaFunction;
}

describe("addServiceAndEnvTags", () => {
  it("does not override existing tags on function", () => {
    // TODO: if provided tags differ from existing tags, should we output an error?
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
