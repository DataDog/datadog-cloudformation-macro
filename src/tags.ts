import { FunctionInfo } from "./layer";
import { TYPE, PROPERTIES } from "./index";

const FUNCTION = "Function";
const TAGS = "Tags";
const SERVICE = "service";
const ENV = "env";
const API_GATEWAY_STAGE_TYPE = "AWS::ApiGateway::Stage";
const STAGE_NAME = "StageName";

export function addServiceAndEnvTags(
  globals: any,
  resources: any,
  funcs: FunctionInfo[],
  service: string | undefined,
  env: string | undefined,
  autoTagEnv: boolean
) {
  let globalServiceTagExists = false;
  let globalEnvTagExists = false;

  // Don't add any overriding tags if they already exists under the Globals section.
  if (globals !== undefined) {
    const functionGlobals = globals[FUNCTION];
    if (functionGlobals !== undefined) {
      const globalTags = functionGlobals[TAGS];
      if (globalTags !== undefined) {
        globalServiceTagExists = globalTags[SERVICE] !== undefined;
        globalEnvTagExists = globalTags[ENV] !== undefined;
      }
    }
  }

  // Find AWS stage name to use as the 'env' tag value.
  // This only exists if an AWS::Serverless::Api resource was configured, which in turn creates
  // an AWS::ApiGateway::Stage resource that has the 'StageName' property.
  if (env === undefined && autoTagEnv) {
    env = findAwsStage(resources);
  }

  // Add the tag for each function, unless an 'env' tag already exists.
  funcs.forEach((func) => {
    let functionServiceTagExists = false;
    let functionEnvTagExists = false;

    let tags = func.lambda.Tags;
    if (tags === undefined) {
      tags = [];
    }

    for (const tag of tags) {
      if (tag.Key === SERVICE) {
        functionServiceTagExists = true;
      }
      if (tag.Key === ENV) {
        functionEnvTagExists = true;
      }
    }

    if (!globalServiceTagExists && !functionServiceTagExists && service) {
      tags.push({ Value: service, Key: SERVICE });
    }
    if (!globalEnvTagExists && !functionEnvTagExists && env) {
      tags.push({ Value: env, Key: ENV });
    }
  });
}

export function findAwsStage(resources: any) {
  for (const resource of Object.values(resources) as any) {
    const type = resource[TYPE];
    if (type === API_GATEWAY_STAGE_TYPE) {
      const properties = resource[PROPERTIES];
      return properties[STAGE_NAME];
    }
  }
}
