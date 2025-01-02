import { setUpLogging, buildLogGroupName } from "../../src/step_function/log";
import { Resources } from "types";
import { StateMachine, LoggingConfiguration, LogDestination } from "../../src/step_function/types";
import { getEmptyStateMachineRole } from "../../test/step_function/helper";

const expectedActionsForRole = [
  "logs:CreateLogDelivery",
  "logs:CreateLogStream",
  "logs:GetLogDelivery",
  "logs:UpdateLogDelivery",
  "logs:DeleteLogDelivery",
  "logs:ListLogDeliveries",
  "logs:PutLogEvents",
  "logs:PutResourcePolicy",
  "logs:DescribeResourcePolicies",
  "logs:DescribeLogGroups",
];

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

  it("sets up logging configuration if not present", () => {
    setUpLogging(resources, stateMachine);

    expect(stateMachine.properties.LoggingConfiguration).toBeDefined();
    const logConfig = stateMachine.properties.LoggingConfiguration as LoggingConfiguration;
    expect(logConfig.Level).toBe("ALL");
    expect(logConfig.IncludeExecutionData).toBe(true);
    expect(logConfig.Destinations).toBeDefined();
    const dest = logConfig.Destinations as LogDestination[];
    expect(dest.length).toBe(1);
  });

  it("updates existing logging configuration", () => {
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
    expect(logConfig.Destinations).toBeDefined();
    const dest = logConfig.Destinations as LogDestination[];
    expect(dest.length).toBe(1);
    expect(dest[0].CloudWatchLogsLogGroup.LogGroupArn).toBe("existing-log-group-arn");
  });

  it("creates a log group if not present", () => {
    setUpLogging(resources, stateMachine);

    expect(resources["MyStateMachineLogGroup"]).toStrictEqual({
      Type: "AWS::Logs::LogGroup",
      Properties: {
        LogGroupName: "/aws/vendedlogs/states/MyStateMachine-Logs",
        RetentionInDays: 7,
      },
    });
  });

  it("creates a role if not present", () => {
    setUpLogging(resources, stateMachine);

    expect(resources["MyStateMachineRole"]).toBeDefined();
    const role = resources["MyStateMachineRole"];
    expect(role.Type).toBe("AWS::IAM::Role");
    expect(role.Properties.Policies).toBeDefined();
    expect(role.Properties.Policies[0].PolicyDocument.Statement[0].Action).toStrictEqual(expectedActionsForRole);
  });

  it("adds permissions to the role if RoleArn is defined using Fn::GetAtt", () => {
    stateMachine.properties.RoleArn = { "Fn::GetAtt": ["MyStateMachineRole", "Arn"] };
    resources["MyStateMachineRole"] = getEmptyStateMachineRole();

    setUpLogging(resources, stateMachine);

    expect(resources["MyStateMachineRole"]).toBeDefined();
    const role = resources["MyStateMachineRole"];
    expect(role.Type).toBe("AWS::IAM::Role");
    expect(role.Properties.Policies).toBeDefined();
    expect(role.Properties.Policies[0].PolicyDocument.Statement[0].Action).toStrictEqual(expectedActionsForRole);
  });

  it("adds permissions to the role if RoleArn is defined using Fn::Sub", () => {
    stateMachine.properties.RoleArn = { "Fn::Sub": "${MyStateMachineRole.Arn}" };
    resources["MyStateMachineRole"] = getEmptyStateMachineRole();

    setUpLogging(resources, stateMachine);

    expect(resources["MyStateMachineRole"]).toBeDefined();
    const role = resources["MyStateMachineRole"];
    expect(role.Type).toBe("AWS::IAM::Role");
    expect(role.Properties.Policies).toBeDefined();
    expect(role.Properties.Policies[0].PolicyDocument.Statement[0].Action).toStrictEqual(expectedActionsForRole);
  });

  it("throws an error for unsupported RoleArn format", () => {
    stateMachine.properties.RoleArn = { "Fn::Unsupported": "value" };

    expect(() => setUpLogging(resources, stateMachine)).toThrow(
      "Unsupported RoleArn format: [object Object]. Step Function Instrumentation is not supported. Please open a feature request in https://github.com/DataDog/datadog-cdk-constructs.",
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
