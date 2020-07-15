import { LambdaFunction } from "./layer";

const SERVICE = "service";
const ENV = "env";

export function addServiceAndEnvTags(
  lambdas: LambdaFunction[],
  service: string | undefined,
  env: string | undefined
) {
  let globalServiceTagExists = false;
  let globalEnvTagExists = false;

  // Add the tag for each function, unless a 'service' or 'env' tag already exists.
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
