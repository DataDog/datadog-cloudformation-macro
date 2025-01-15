import { TaggableResource } from "common/tags";

// Parsed state machine info from CloudFormation template. For internal use.
// Not aimed to match any CloudFormation type.
export interface StateMachine extends TaggableResource {
  properties: StateMachineProperties;
  resourceKey: string;
}

export type DefinitionString = string | { "Fn::Sub": string };

// Necessary fields from AWS::StepFunctions::StateMachine's Properties field
export interface StateMachineProperties {
  LoggingConfiguration?: LoggingConfiguration;
  RoleArn?: string | { [key: string]: any };
  Tags?: { Key: string; Value: string }[];
  // This also covers the "!Sub" shorthand in CloudFormation template. "!Sub" will be
  // replaced with "Fn::Sub" by AWS CloudFormation template processing and the
  // CloudFormation Macro will get "Fn::Sub".
  DefinitionString?: DefinitionString;
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
