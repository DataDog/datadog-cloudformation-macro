import { FunctionInfo } from "./layer";
import { TYPE, PROPERTIES } from "./index";

const FUNCTION = "Function";
const TAGS = "Tags";
const ENV = "env";
const API_GATEWAY_STAGE_TYPE = "AWS::ApiGateway::Stage";
const STAGE_NAME = "StageName";

export function addEnvTag(globals: any, resources: any, funcs: FunctionInfo[]) {
  // Don't add any tag to override if 'env' tag already exists under the Globals section.
  if (globals !== undefined) {
    const functionGlobals = globals[FUNCTION];
    if (functionGlobals !== undefined) {
      const globalTags = functionGlobals[TAGS];
      if (globalTags !== undefined && globalTags[ENV] !== undefined) {
        return;
      }
    }
  }

  // Find AWS stage name to use as the 'env' tag value.
  // This only exists if an AWS::Serverless::Api resource was configured, which in turn creates
  // an AWS::ApiGateway::Stage resource that has the 'StageName' property.
  const stage = findAwsStage(resources);
  if (stage === undefined) {
    return;
  }

  // Add the tag for each function, unless an 'env' tag already exists.
  funcs.forEach((func) => {
    let tags = func.lambda.Tags;
    if (tags === undefined) {
      tags = [];
    }
    for (const tag of tags) {
      if (tag.Key === ENV) {
        return;
      }
    }
    tags.push({
      Value: stage,
      Key: ENV,
    });
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
