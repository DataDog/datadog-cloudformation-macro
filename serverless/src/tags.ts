import { Configuration } from "env";
import { LambdaFunction } from "./layer";

const SERVICE = "service";
const ENV = "env";
const VERSION = "version"
const MACRO_VERSION = "dd_sls_macro";
// Following the same pattern from SAM
const MACRO_BY = "dd_sls_macro_by";

export function addDDTags(lambdas: LambdaFunction[], config: Configuration) {
  // Add the tags for each function, unless a tag already exists.
  lambdas.forEach((lambda) => {
    const tags = lambda.properties.Tags ?? {};

    if (config.service && !tags[SERVICE]) {
      tags[SERVICE] = config.service;
    }
    if (config.env && !tags[ENV]) {
      tags[ENV] = config.env;
    }
    if (config.version && !tags[VERSION]) {
      tags[VERSION] = config.version;
    }
    if (config.tags) {
      const tagsArray = config.tags.split(",");
      tagsArray.forEach((tag: string) => {
        const [key, value] = tag.split(":");
        if (key && value && !tags[key]) {
          tags[key] = value;
        }
      });
    }

    lambda.properties.Tags = tags;
  });
}

export function addMacroTag(lambdas: LambdaFunction[], version: string | undefined) {
  if (!version) return;

  lambdas.forEach((lambda) => {
    const tags = lambda.properties.Tags ?? {};
    tags[MACRO_VERSION] = `v${version}`;

    lambda.properties.Tags = tags;
  });
}

export function addCDKTag(lambdas: LambdaFunction[]) {
  lambdas.forEach((lambda) => {
    const tags = lambda.properties.Tags ?? {};
    tags[MACRO_BY] = "CDK";

    lambda.properties.Tags = tags;
  });
}

export function addSAMTag(lambdas: LambdaFunction[]) {
  lambdas.forEach((lambda) => {
    const tags = lambda.properties.Tags ?? {};
    if (tags["lambda:createdBy"] === "SAM") {
      tags[MACRO_BY] = "SAM"
    }

    lambda.properties.Tags = tags;
  });
}
