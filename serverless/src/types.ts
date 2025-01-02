export const SUCCESS = "success";
export const FAILURE = "failure";

export const CFN_IF_FUNCTION_STRING = "Fn::If";

export type Parameters = { [key: string]: any };

export interface Resources {
  [logicalId: string]: {
    Type: string;
    Properties: any;
  };
}

export interface CfnTemplate {
  Mappings?: any;
  Resources: Resources;
}

export interface InputEvent {
  region: string;
  accountId: string;
  fragment: CfnTemplate;
  transformId: string; // Name of the macro
  params: Parameters;
  requestId: string;
  templateParameterValues: Parameters;
}

export interface OutputEvent {
  requestId: string;
  status: string;
  fragment: CfnTemplate;
  errorMessage?: string;
}
