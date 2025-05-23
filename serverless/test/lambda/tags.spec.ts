import { LambdaConfigLoader } from "../../src/lambda/env";
import { RuntimeType, LambdaFunction } from "../../src/lambda/layer";
import { addCDKTag, addSAMTag } from "../../src/lambda/tags";
import { addDDTags, addMacroTag } from "../../src/common/tags";

function mockLambdaFunction(tags: { Key: string; Value: string }[]) {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: "nodejs12.x",
      Role: "role-arn",
      Tags: [...tags],
    },
    key: "FunctionKey",
    runtimeType: RuntimeType.NODE,
    runtime: "nodejs12.x",
  } as LambdaFunction;
}

const configLoader = new LambdaConfigLoader();
describe("addDDTags", () => {
  it("does not override existing tags on function", () => {
    const config = {
      ...configLoader.defaultConfiguration,
      service: "my-other-service",
      env: "test",
      version: "1",
      tags: "team:avengers,project:marvel",
    };
    const existingTags = [
      { Key: "env", Value: "dev" },
      { Key: "service", Value: "my-service" },
      { Key: "version", Value: "2" },
      { Key: "team", Value: "serverless" },
    ];
    const lambda = mockLambdaFunction(existingTags);
    addDDTags(lambda, config);

    expect(lambda.properties.Tags).toEqual([...existingTags, { Key: "project", Value: "marvel" }]);
  });

  it("does not add tags if provided config doesn't have tags", () => {
    const lambda = mockLambdaFunction([]);
    addDDTags(lambda, configLoader.defaultConfiguration);

    expect(lambda.properties.Tags).toEqual([]);
  });

  describe("with env vars set", () => {
    const CURRENT_ENV = process.env;

    beforeEach(() => {
      jest.resetModules(); // Clear the cache
      process.env = { ...CURRENT_ENV }; // Make a copy we can modify
    });

    afterEach(() => {
      process.env = CURRENT_ENV; // Restore environment
    });

    it("does add tags from the environment", () => {
      process.env["DD_TAGS"] = "strongest_avenger:hulk";
      const config = {
        ...configLoader.getConfigFromEnvVars(),
        service: "my-service",
      };
      const lambda = mockLambdaFunction([]);
      addDDTags(lambda, config);

      expect(lambda.properties.Tags).toEqual([
        { Key: "service", Value: "my-service" },
        { Key: "strongest_avenger", Value: "hulk" },
      ]);
    });
  });

  it("creates tags property if needed", () => {
    const config = {
      ...configLoader.defaultConfiguration,
      service: "my-service",
      env: "test",
      version: "1",
      tags: "team:avengers,project:marvel",
    };
    const lambda = mockLambdaFunction([]);
    addDDTags(lambda, config);

    expect(lambda.properties.Tags).toEqual([
      { Key: "service", Value: "my-service" },
      { Key: "env", Value: "test" },
      { Key: "version", Value: "1" },
      { Key: "team", Value: "avengers" },
      { Key: "project", Value: "marvel" },
    ]);
  });

  it("adds to existing tags property if needed", () => {
    const config = {
      ...configLoader.defaultConfiguration,
      service: "my-service",
      version: "1",
      tags: "team:avengers",
    };
    const existingTags = [
      { Key: "env", Value: "dev" },
      { Key: "project", Value: "lambda" },
    ];
    const lambda = mockLambdaFunction(existingTags);
    addDDTags(lambda, config);

    expect(lambda.properties.Tags).toEqual([
      { Key: "env", Value: "dev" },
      { Key: "project", Value: "lambda" },
      { Key: "service", Value: "my-service" },
      { Key: "version", Value: "1" },
      { Key: "team", Value: "avengers" },
    ]);
  });
});

describe("addMacroTag", () => {
  it("does not update tags if no version is passed in", () => {
    const existingTags = [{ Key: "band", Value: "ironmaiden" }];
    const lambda = mockLambdaFunction(existingTags);
    addMacroTag(lambda, undefined);

    expect(lambda.properties.Tags).toEqual(existingTags);
  });

  it("creates tags property if needed", () => {
    const lambda = mockLambdaFunction([]);
    addMacroTag(lambda, "6.6.6");

    expect(lambda.properties.Tags).toEqual([{ Key: "dd_sls_macro", Value: "v6.6.6" }]);
  });

  it("appends version tag if needed", () => {
    const existingTags = [{ Key: "env", Value: "dev" }];
    const lambda = mockLambdaFunction(existingTags);
    addMacroTag(lambda, "6.6.6");

    expect(lambda.properties.Tags).toEqual([
      { Key: "env", Value: "dev" },
      { Key: "dd_sls_macro", Value: "v6.6.6" },
    ]);
  });
});

describe("addCDKTag", () => {
  it("creates tags property if needed", () => {
    const lambda = mockLambdaFunction([]);
    addCDKTag([lambda]);

    expect(lambda.properties.Tags).toEqual([{ Key: "dd_sls_macro_by", Value: "CDK" }]);
  });

  it("appends version tag if needed", () => {
    const existingTags = [{ Key: "env", Value: "dev" }];
    const lambda = mockLambdaFunction(existingTags);
    addCDKTag([lambda]);

    expect(lambda.properties.Tags).toEqual([
      { Key: "env", Value: "dev" },
      { Key: "dd_sls_macro_by", Value: "CDK" },
    ]);
  });
});

describe("addSAMTag", () => {
  it("creates tags property if needed", () => {
    const lambda = mockLambdaFunction([]);
    addSAMTag([lambda]);

    expect(lambda.properties.Tags).toEqual([]);
  });

  it("appends version tag if needed", () => {
    const existingTags = [{ Key: "lambda:createdBy", Value: "SAM" }];
    const lambda = mockLambdaFunction(existingTags);
    addSAMTag([lambda]);

    expect(lambda.properties.Tags).toEqual([
      { Key: "lambda:createdBy", Value: "SAM" },
      { Key: "dd_sls_macro_by", Value: "SAM" },
    ]);
  });
});
