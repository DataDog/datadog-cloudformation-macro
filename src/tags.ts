import { LambdaFunction } from "./layer";

const FUNCTION = "Function";
const TAGS = "Tags";
const SERVICE = "service";
const ENV = "env";

export function addServiceAndEnvTags(
  globals: any,
  lambdas: LambdaFunction[],
  service: string | undefined,
  env: string | undefined
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

  // Add the tag for each function, unless an 'env' tag already exists.
  lambdas.forEach((lambda) => {
    let functionServiceTagExists = false;
    let functionEnvTagExists = false;

    let tags = lambda.properties.Tags;
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
