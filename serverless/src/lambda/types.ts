import { CFN_IF_FUNCTION_STRING } from "types";

// Array of string ARNs in normal case. Can also include
// CFN conditional objects represented as e.g.:
// {"Fn::If": ["isProd", ["prod-layer-arn"], ["stg-layer-arn"]]}
export type LambdaLayersProperty =
  | (string | LambdaLayersProperty)[]
  | { [CFN_IF_FUNCTION_STRING]: [string, LambdaLayersProperty, LambdaLayersProperty] };

export interface FunctionProperties {
  Handler: string;
  Runtime: string;
  Role: string | { [func: string]: string[] };
  Code: any;
  Environment?: { Variables?: { [key: string]: string | boolean } };
  Tags?: { Key: string; Value: string }[];
  Layers?: LambdaLayersProperty;
  TracingConfig?: { [key: string]: string };
  FunctionName?: string;
  Architectures?: [string];
  PackageType?: string;
}
