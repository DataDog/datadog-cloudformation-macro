export interface StateMachine {
  properties: StateMachineProperties;
  resourceKey: string;
}

export interface StateMachineProperties {
  LoggingConfiguration?: LoggingConfiguration;
  RoleArn?: string | { [key: string]: any };
}

export interface LoggingConfiguration {
  Destinations?: LogDestination[];
  IncludeExecutionData?: boolean;
  Level?: string;
}

export interface LogDestination {
  CloudWatchLogsLogGroup: CloudWatchLogsLogGroup;
}

export interface CloudWatchLogsLogGroup {
  LogGroupArn:
    | string
    | {
        "Fn::GetAtt": string[];
      };
}
