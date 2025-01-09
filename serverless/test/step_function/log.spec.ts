import { setUpLogging, buildLogGroupName, ROLE_ACTIONS, findLogGroup } from "../../src/step_function/log";
import { Resources } from "common/types";
import { StateMachine, LoggingConfiguration, LogDestination } from "../../src/step_function/types";

function getEmptyStateMachineRole() {
  return {
    Type: "AWS::IAM::Role",
    Properties: {
      AssumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: "states.amazonaws.com",
            },
            Action: "sts:AssumeRole",
          },
        ],
      },
      Policies: [],
    },
  };
}

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

  it("creates a role if not present", () => {
    setUpLogging(resources, config, stateMachine);

    expect(resources["MyStateMachineRole"]).toBeDefined();
    const role = resources["MyStateMachineRole"];
    expect(role.Type).toBe("AWS::IAM::Role");
    expect(role.Properties.Policies[0].PolicyDocument.Statement[0].Action).toStrictEqual(ROLE_ACTIONS);
    expect(stateMachine.properties.RoleArn).toStrictEqual({ FN_GET_ATT: ["MyStateMachineRole", "Arn"] });
  });

  it("adds permissions to the role if RoleArn is defined using Fn::GetAtt", () => {
    stateMachine.properties.RoleArn = { "Fn::GetAtt": ["MyStateMachineRole", "Arn"] };
    resources["MyStateMachineRole"] = getEmptyStateMachineRole();

    setUpLogging(resources, config, stateMachine);

    expect(resources["MyStateMachineRole"]).toBeDefined();
    const role = resources["MyStateMachineRole"];
    expect(role.Type).toBe("AWS::IAM::Role");
    expect(role.Properties.Policies[0].PolicyDocument.Statement[0].Action).toStrictEqual(ROLE_ACTIONS);
  });

  it("adds permissions to the role if RoleArn is defined using Fn::Sub", () => {
    stateMachine.properties.RoleArn = { "Fn::Sub": "${MyStateMachineRole.Arn}" };
    resources["MyStateMachineRole"] = getEmptyStateMachineRole();

    setUpLogging(resources, config, stateMachine);

    expect(resources["MyStateMachineRole"]).toBeDefined();
    const role = resources["MyStateMachineRole"];
    expect(role.Type).toBe("AWS::IAM::Role");
    expect(role.Properties.Policies[0].PolicyDocument.Statement[0].Action).toStrictEqual(ROLE_ACTIONS);
  });

  it("throws an error for unsupported RoleArn format", () => {
    stateMachine.properties.RoleArn = { "Fn::Unsupported": "value" };

    expect(() => setUpLogging(resources, config, stateMachine)).toThrow(
      "Unsupported RoleArn format: [object Object]. Step Function Instrumentation is not supported. Please open a feature request in https://github.com/DataDog/datadog-cloudformation-macro.",
    );
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

describe("findLogGroup", () => {
  let resources: Resources;
  let stateMachine: StateMachine;

  beforeEach(() => {
    resources = {};
    stateMachine = {
      resourceKey: "MyStateMachine",
      properties: {
        LoggingConfiguration: {
          Destinations: [
            {
              CloudWatchLogsLogGroup: {
                LogGroupArn: {
                  "Fn::GetAtt": ["MyStateMachineLogGroup", "Arn"],
                },
              },
            },
          ],
        },
      },
    } as StateMachine;
  });

  it("finds the log group if it exists", () => {
    resources["MyStateMachineLogGroup"] = {
      Type: "AWS::Logs::LogGroup",
      Properties: {
        LogGroupName: "/aws/vendedlogs/states/MyStateMachine-Logs-dev",
        RetentionInDays: 7,
      },
    };

    const logGroup = findLogGroup(resources, stateMachine);
    expect(logGroup.Type).toBe("AWS::Logs::LogGroup");
    expect(logGroup.Properties.LogGroupName).toBe("/aws/vendedlogs/states/MyStateMachine-Logs-dev");
  });

  it("throws an error if log config or destination is not found", () => {
    stateMachine.properties.LoggingConfiguration = undefined;

    expect(() => findLogGroup(resources, stateMachine)).toThrow(
      "Log config or destination not found for state machine MyStateMachine",
    );
  });

  it("throws an error if logGroupArn is a string", () => {
    stateMachine.properties.LoggingConfiguration = {
      Destinations: [
        {
          CloudWatchLogsLogGroup: {
            LogGroupArn: "string-log-group-arn",
          },
        },
      ],
    };

    expect(() => findLogGroup(resources, stateMachine)).toThrow(
      "logGroupArn is a string: string-log-group-arn. Step Function Instrumentation is not supported. Please open a feature request in https://github.com/DataDog/datadog-cloudformation-macro.",
    );
  });

  it("throws an error if logGroupArn is not specified using Fn::GetAtt", () => {
    stateMachine.properties.LoggingConfiguration = {
      Destinations: [
        {
          CloudWatchLogsLogGroup: {
            LogGroupArn: {
              "Fn::Unsupported": ["MyStateMachineLogGroup", "Arn"],
            } as any,
          },
        },
      ],
    };

    expect(() => findLogGroup(resources, stateMachine)).toThrow(
      'logGroupArn is not specified using Fn::GetAtt in the common way: {"Fn::Unsupported":["MyStateMachineLogGroup","Arn"]}. Step Function Instrumentation is not supported. Please open a feature request in https://github.com/DataDog/datadog-cloudformation-macro.',
    );
  });
});
