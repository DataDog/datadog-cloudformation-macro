import { TaggableResource } from "common/tags";

// Parsed state machine info from CloudFormation template. For internal use.
// Not aimed to match any CloudFormation type.
export interface StateMachine extends TaggableResource {
  properties: StateMachineProperties;
  resourceKey: string;
}

export type DefinitionString = string | { "Fn::Sub": string | (string | object)[] };

// Necessary fields from AWS::StepFunctions::StateMachine's Properties field
export interface StateMachineProperties {
  LoggingConfiguration?: LoggingConfiguration;
  RoleArn?: string | { [key: string]: any };
  Tags?: { Key: string; Value: string }[];
  // This also covers the "!Sub" shorthand in CloudFormation template. "!Sub" will be
  // replaced with "Fn::Sub" by AWS CloudFormation template processing and the
  // CloudFormation Macro will get "Fn::Sub".
  DefinitionString?: DefinitionString;
  Definition?: StateMachineDefinition;
}

// Matches AWS::StepFunctions::StateMachine LoggingConfiguration
export interface LoggingConfiguration {
  Destinations?: LogDestination[];
  IncludeExecutionData?: boolean;
  Level?: string;
}

// Matches AWS::StepFunctions::StateMachine LogDestination
export interface LogDestination {
  CloudWatchLogsLogGroup: CloudWatchLogsLogGroup;
}

// Matches AWS::StepFunctions::StateMachine CloudWatchLogsLogGroup
export interface CloudWatchLogsLogGroup {
  LogGroupArn:
    | string
    | {
        "Fn::GetAtt": string[];
      };
}

export interface StateMachineDefinition {
  States: { [key: string]: StateMachineState };
}

// Lambda invocation step's Payload field
export type LambdaStepPayload = {
  "Execution.$"?: any;
  Execution?: any;
  "State.$"?: any;
  State?: any;
  "StateMachine.$"?: any;
  StateMachine?: any;
};

// Step Function invocation step's Input field
export type StateMachineStateInput = {
  "CONTEXT.$"?: string;
  CONTEXT?: string;
};

// A state in the Step Function definition
export interface StateMachineState {
  Resource?: string;
  Parameters?: {
    FunctionName?: string;
    // Payload field for Lambda invocation steps
    Payload?: string | LambdaStepPayload;
    "Payload.$"?: string;
    // Input field for Step Function invocation steps
    Input?: string | StateMachineStateInput;
  };
  Next?: string;
  End?: boolean;
}
