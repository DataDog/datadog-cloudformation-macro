import { addForwarder, SUBSCRIPTION_FILTER_PREFIX } from "../../src/step_function/forwarder";
import { findLogGroup } from "../../src/step_function/log";
import { Resources } from "../../src/common/types";

jest.mock("../../src/step_function/log");

describe("addForwarder", () => {
  it("adds a subscription filter to the log group", () => {
    const resources: Resources = {};
    const config = {
      stepFunctionForwarderArn: "arn:aws:lambda:us-east-1:123456789012:function:my-function",
    };
    const stateMachine = {
      resourceKey: "MyStateMachine",
    } as any;
    (findLogGroup as jest.Mock).mockReturnValue([
      "MyStateMachineLogGroup",
      {
        Properties: {
          LogGroupName: "/aws/lambda/my-function",
        },
      },
    ]);

    addForwarder(resources, config, stateMachine);

    const subscriptionFilterKey = stateMachine.resourceKey + SUBSCRIPTION_FILTER_PREFIX;
    expect(resources[subscriptionFilterKey]).toEqual({
      Type: "AWS::Logs::SubscriptionFilter",
      DependsOn: "MyStateMachineLogGroup",
      Properties: {
        LogGroupName: "/aws/lambda/my-function",
        DestinationArn: config.stepFunctionForwarderArn,
        FilterPattern: "",
      },
    });
  });
});
