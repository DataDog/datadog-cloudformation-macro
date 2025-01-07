import { InputEvent } from "../../src/types";
import { getConfig } from "../../src/step_function/env";

describe("getConfig", () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    jest.resetAllMocks();
    process.env = originalEnv;
  });

  // TODO: Change "env" to a field which is in defaultConfig once there is one
  describe("1. CloudFormation Macro params are set", () => {
    it("uses CloudFormation Macro params over environment variables and default configuration", () => {
      const event: InputEvent = {
        params: {
          env: "macroEnv",
        },
        fragment: {
          Mappings: {},
        },
      } as any;

      process.env.DD_ENV = "envVarEnv";

      const config = getConfig(event);
      expect(config.env).toBe("macroEnv");
    });
  });

  describe("2. CloudFormation Mappings are set", () => {
    it("uses CloudFormation Mappings params over environment variables and default configuration", () => {
      const event: InputEvent = {
        params: {},
        fragment: {
          Mappings: {
            Datadog: {
              Parameters: {
                env: "mappingEnv",
              },
            },
          },
        },
      } as any;

      process.env.DD_ENV = "envVarEnv";

      const config = getConfig(event);
      expect(config.env).toBe("mappingEnv");
    });
  });

  describe("3. Neither CloudFormation Macro params nor CloudFormation Mappings is set", () => {
    it("uses environment variables over default configuration", () => {
      const event: InputEvent = {
        params: {},
        fragment: {
          Mappings: {},
        },
      } as any;

      process.env.DD_ENV = "envVarEnv";

      const config = getConfig(event);
      expect(config.env).toBe("envVarEnv");
    });

    it("uses default configuration if no other params are set", () => {
      const event: InputEvent = {
        params: {},
        fragment: {
          Mappings: {},
        },
      } as any;

      const config = getConfig(event);
      expect(config.env).toBe(undefined);
    });
  });
});
