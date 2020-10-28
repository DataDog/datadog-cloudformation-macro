import { LambdaFunction } from "./layer";

const SERVICE = "service";
const ENV = "env";
const MACRO_VERSION = "dd_sls_macro";
// Following the same pattern from SAM
const MACRO_BY = "dd_sls_macro_by";

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

  lambdas.forEach((lambda) => {
    const tags = lambda.properties.Tags ?? [];
    tags.push({ Value: `v${version}`, Key: MACRO_VERSION });

    lambda.properties.Tags = tags;
  });
}

export function addCDKTag(lambdas: LambdaFunction[]) {
  lambdas.forEach((lambda) => {
    const tags = lambda.properties.Tags ?? [];
    tags.push({ Value: "CDK", Key: MACRO_BY });

    lambda.properties.Tags = tags;
  });
}

export function addSAMTag(lambdas: LambdaFunction[]) {
  lambdas.forEach((lambda) => {
    const tags = lambda.properties.Tags ?? [];
    tags.forEach((tag) => {
      if (tag.Key === "lambda:createdBy" && tag.Value === "SAM") {
        tags.push({ Value: `SAM`, Key: MACRO_BY });
      }
    });

    lambda.properties.Tags = tags;
  });
}
