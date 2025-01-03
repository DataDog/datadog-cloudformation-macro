// Parsed state machine info from CloudFormation template. For internal use.
// Not aimed to match any CloudFormation type.
export interface StateMachine {
  properties: StateMachineProperties;
  resourceKey: string;
}

// Necessary fields from AWS::StepFunctions::StateMachine's Properties field
export interface StateMachineProperties {
  LoggingConfiguration?: LoggingConfiguration;
  RoleArn?: string | { [key: string]: any };
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
