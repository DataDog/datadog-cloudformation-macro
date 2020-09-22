import { LambdaFunction } from "./layer";

const SERVICE = "service";
const ENV = "env";

export function addServiceAndEnvTags(lambdas: LambdaFunction[], service: string | undefined, env: string | undefined) {
  // Add the tag for each function, unless a 'service' or 'env' tag already exists.
  lambdas.forEach((lambda) => {
    let functionServiceTagExists = false;
    let functionEnvTagExists = false;
    const tags = lambda.properties.Tags ?? [];

    for (const tag of tags) {
      if (tag.Key === SERVICE) {
        functionServiceTagExists = true;
      }
      if (tag.Key === ENV) {
        functionEnvTagExists = true;
      }
    }

    if (service && !functionServiceTagExists) {
      tags.push({ Value: service, Key: SERVICE });
    }
    if (env && !functionEnvTagExists) {
      tags.push({ Value: env, Key: ENV });
    }

    if (tags.length > 0) {
      lambda.properties.Tags = tags;
    }
  });
}

export function addMacroTag(lambdas: LambdaFunction[], version: string | undefined) {
  if (!version) return;
  // Add the tag for each function, unless a 'service' or 'env' tag already exists.
  lambdas.forEach((lambda) => {
    const tags = lambda.properties.Tags ?? [];
    tags.push({ Value: `v${version}`, Key: "dd_sls_macro" });

    lambda.properties.Tags = tags;
  });
}
