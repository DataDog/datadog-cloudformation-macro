import { defaultConfiguration } from "../src/env";
import { RuntimeType, LambdaFunction } from "../src/layer";
import { addDDTags, addMacroTag, addCDKTag, addSAMTag } from "../src/tags";

function mockLambdaFunction(tags: { [key: string]: string } | undefined) {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: "nodejs12.x",
      Role: "role-arn",
      Tags: { ...tags },
    },
    key: "FunctionKey",
    runtimeType: RuntimeType.NODE,
    runtime: "nodejs12.x",
  } as LambdaFunction;
}

describe("addDDTags", () => {
  it("does not override existing tags on function", () => {
    const config = {
      ...defaultConfiguration,
      service: "my-other-service",
      env: "test",
      version: "1",
      tags: "team:avengers,project:marvel",
    }
    const existingTags = { env: "dev", service: "my-service", version: "2", team: "serverless" };
    const lambda = mockLambdaFunction(existingTags);
    addDDTags([lambda], config);

    expect(lambda.properties.Tags).toEqual({ ...existingTags, project: "marvel" });
  });

  it("does not add tags if provided config doesn't have tags", () => {
    const lambda = mockLambdaFunction(undefined);
    addDDTags([lambda], defaultConfiguration);

    expect(lambda.properties.Tags).toEqual({});
  });

  it("creates tags property if needed", () => {
    const config = {
      ...defaultConfiguration,
      service: "my-service",
      env: "test",
      version: "1",
      tags: "team:avengers,project:marvel",
    }
    const lambda = mockLambdaFunction(undefined);
    addDDTags([lambda], config);

    expect(lambda.properties.Tags).toEqual({
      service: "my-service",
      env: "test",
      version: "1",
      team: "avengers",
      project: "marvel",
    });
  });

  it("adds to existing tags property if needed", () => {
    const config = {
      ...defaultConfiguration,
      service: "my-service",
      version: "1",
      tags: "team:avengers",
    }
    const existingTags = { env: "dev", project: "lambda" };
    const lambda = mockLambdaFunction(existingTags);
    addDDTags([lambda], config);

    expect(lambda.properties.Tags).toEqual({
      env: "dev",
      project: "lambda",
      service: "my-service",
      version: "1",
      team: "avengers",
    });
  });
});

describe("addMacroTag", () => {
  it("does not update tags if no version is passed in", () => {
    const existingTags = { band: "ironmaiden" };
    const lambda = mockLambdaFunction(existingTags);
    addMacroTag([lambda], undefined);

    expect(lambda.properties.Tags).toEqual(existingTags);
  });

  it("creates tags property if needed", () => {
    const lambda = mockLambdaFunction(undefined);
    addMacroTag([lambda], "6.6.6");

    expect(lambda.properties.Tags).toEqual({ dd_sls_macro: "v6.6.6" });
  });

  it("appends version tag if needed", () => {
    const existingTags = { env: "dev" };
    const lambda = mockLambdaFunction(existingTags);
    addMacroTag([lambda], "6.6.6");

    expect(lambda.properties.Tags).toEqual({
      env: "dev",
      dd_sls_macro: "v6.6.6",
    });
  });
});

describe("addCDKTag", () => {
  it("creates tags property if needed", () => {
    const lambda = mockLambdaFunction(undefined);
    addCDKTag([lambda]);

    expect(lambda.properties.Tags).toEqual({ dd_sls_macro_by: "CDK" });
  });

  it("appends version tag if needed", () => {
    const existingTags = { env: "dev" };
    const lambda = mockLambdaFunction(existingTags);
    addCDKTag([lambda]);

    expect(lambda.properties.Tags).toEqual({
      env: "dev",
      dd_sls_macro_by: "CDK",
    });
  });
});

describe("addSAMTag", () => {
  it("creates tags property if needed", () => {
    const lambda = mockLambdaFunction(undefined);
    addSAMTag([lambda]);

    expect(lambda.properties.Tags).toEqual({});
  });

  it("appends version tag if needed", () => {
    const existingTags = { "lambda:createdBy": "SAM" };
    const lambda = mockLambdaFunction(existingTags);
    addSAMTag([lambda]);


    expect(lambda.properties.Tags).toEqual({
      "lambda:createdBy": "SAM",
      dd_sls_macro_by: "SAM",
    });
  });
});
