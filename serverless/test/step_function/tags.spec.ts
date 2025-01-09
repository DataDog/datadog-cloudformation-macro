import { addTags } from "../../src/step_function/tags";
import { StateMachine } from "../../src/step_function/types";
import { Configuration } from "../../src/step_function/env";

describe("addTags", () => {
  it("adds necessary tags", () => {
    const stateMachine: StateMachine = {
      properties: {},
    } as any;

    const config: Configuration = {
      env: "dev",
      service: "my-service",
      version: "1.0.0",
      tags: "tag1:value1,tag2:value2",
    };

    addTags(config, stateMachine);
    const tags = stateMachine.properties.Tags;
    expect(tags).toStrictEqual([
      { Key: "service", Value: "my-service" },
      { Key: "env", Value: "dev" },
      { Key: "version", Value: "1.0.0" },
      { Key: "tag1", Value: "value1" },
      { Key: "tag2", Value: "value2" },
      { Key: "dd_sls_macro", Value: expect.any(String) },
      { Key: "DD_TRACE_ENABLED", Value: "true" },
    ]);
  });
});
