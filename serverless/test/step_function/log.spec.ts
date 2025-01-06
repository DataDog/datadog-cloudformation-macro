import { setUpLogging } from "../../src/step_function/log";
import { Resources } from "types";
import { StateMachine, LoggingConfiguration } from "../../src/step_function/types";

describe("setUpLogging", () => {
  let resources: Resources;
  let stateMachine: StateMachine;

  beforeEach(() => {
    resources = {};
    stateMachine = {
      resourceKey: "MyStateMachine",
      properties: {},
    } as StateMachine;
  });

  it("sets up log config if not present", () => {
    setUpLogging(resources, stateMachine);

    expect(stateMachine.properties.LoggingConfiguration).toBeDefined();
    const logConfig = stateMachine.properties.LoggingConfiguration as LoggingConfiguration;
    expect(logConfig.Level).toBe("ALL");
    expect(logConfig.IncludeExecutionData).toBe(true);
  });

  it("updates existing log config", () => {
    stateMachine.properties.LoggingConfiguration = {
      Level: "ERROR",
      IncludeExecutionData: false,
      Destinations: [
        {
          CloudWatchLogsLogGroup: {
            LogGroupArn: "existing-log-group-arn",
          },
        },
      ],
    };

    setUpLogging(resources, stateMachine);

    expect(stateMachine.properties.LoggingConfiguration).toBeDefined();
    const logConfig = stateMachine.properties.LoggingConfiguration as LoggingConfiguration;
    expect(logConfig.Level).toBe("ALL");
    expect(logConfig.IncludeExecutionData).toBe(true);
  });
});
