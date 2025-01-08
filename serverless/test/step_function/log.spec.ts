import { setUpLogging, buildLogGroupName } from "../../src/step_function/log";
import { Resources } from "types";
import { StateMachine, LoggingConfiguration, LogDestination } from "../../src/step_function/types";

describe("setUpLogging", () => {
  let resources: Resources;
  const config = { env: "dev" };
  let stateMachine: StateMachine;

  beforeEach(() => {
    resources = {};
    stateMachine = {
      resourceKey: "MyStateMachine",
      properties: {},
    } as StateMachine;
  });

  it("sets up log config if not present", () => {
    setUpLogging(resources, config, stateMachine);

    expect(stateMachine.properties.LoggingConfiguration).toBeDefined();
    const logConfig = stateMachine.properties.LoggingConfiguration as LoggingConfiguration;
    expect(logConfig.Level).toBe("ALL");
    expect(logConfig.IncludeExecutionData).toBe(true);
    expect(logConfig.Destinations).toBeDefined();
    const dest = logConfig.Destinations as LogDestination[];
    expect(dest.length).toBe(1);
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

    setUpLogging(resources, config, stateMachine);

    expect(stateMachine.properties.LoggingConfiguration).toBeDefined();
    const logConfig = stateMachine.properties.LoggingConfiguration as LoggingConfiguration;
    expect(logConfig.Level).toBe("ALL");
    expect(logConfig.IncludeExecutionData).toBe(true);
    expect(logConfig.Destinations).toBeDefined();
    const dest = logConfig.Destinations as LogDestination[];
    expect(dest.length).toBe(1);
  });

  it("creates a log group if not present", () => {
    setUpLogging(resources, config, stateMachine);

    expect(resources["MyStateMachineLogGroup"]).toStrictEqual({
      Type: "AWS::Logs::LogGroup",
      Properties: {
        LogGroupName: "/aws/vendedlogs/states/MyStateMachine-Logs-dev",
        RetentionInDays: 7,
      },
    });
  });
});

describe("buildLogGroupName", () => {
  it("builds log group name without env", () => {
    const stateMachine = { resourceKey: "MyStateMachine" } as StateMachine;
    const logGroupName = buildLogGroupName(stateMachine, undefined);
    expect(logGroupName).toBe("/aws/vendedlogs/states/MyStateMachine-Logs");
  });

  it("builds log group name with env", () => {
    const stateMachine = { resourceKey: "MyStateMachine" } as StateMachine;
    const logGroupName = buildLogGroupName(stateMachine, "dev");
    expect(logGroupName).toBe("/aws/vendedlogs/states/MyStateMachine-Logs-dev");
  });
});
