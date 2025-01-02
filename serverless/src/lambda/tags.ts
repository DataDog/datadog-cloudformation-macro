import { Configuration } from "./env";
import { LambdaFunction } from "./layer";

const SERVICE = "service";
const ENV = "env";
const VERSION = "version";
const MACRO_VERSION = "dd_sls_macro";
// Following the same pattern from SAM
const MACRO_BY = "dd_sls_macro_by";

export function addDDTags(lambdas: LambdaFunction[], config: Configuration): void {
  // Add the tags for each function, unless a tag already exists.
  lambdas.forEach((lambda) => {
    const tags = lambda.properties.Tags ?? [];

    const service = tags.find((tag) => tag.Key === SERVICE);
    const env = tags.find((tag) => tag.Key === ENV);
    const version = tags.find((tag) => tag.Key === VERSION);

    if (config.service && !service) {
      tags.push({ Key: SERVICE, Value: config.service });
    }
    if (config.env && !env) {
      tags.push({ Key: ENV, Value: config.env });
    }
    if (config.version && !version) {
      tags.push({ Key: VERSION, Value: config.version });
    }
    if (config.tags) {
      const tagsArray = config.tags.split(",");
      tagsArray.forEach((tag: string) => {
        const [key, value] = tag.split(":");
        const keyDoesntExsist = !tags.find((tag) => tag.Key === key);
        if (key && value && keyDoesntExsist) {
          tags.push({ Key: key, Value: value });
        }
      });
    }

    lambda.properties.Tags = tags;
  });
}

export function addMacroTag(lambdas: LambdaFunction[], version: string | undefined): void {
  if (!version) return;

  lambdas.forEach((lambda) => {
    const tags = lambda.properties.Tags ?? [];
    tags.push({ Value: `v${version}`, Key: MACRO_VERSION });

    lambda.properties.Tags = tags;
  });
}

export function addCDKTag(lambdas: LambdaFunction[]): void {
  lambdas.forEach((lambda) => {
    const tags = lambda.properties.Tags ?? [];
    tags.push({ Key: MACRO_BY, Value: "CDK" });

    lambda.properties.Tags = tags;
  });
}

export function addSAMTag(lambdas: LambdaFunction[]): void {
  lambdas.forEach((lambda) => {
    const tags = lambda.properties.Tags ?? [];

    const createdBySam = tags.find((tag) => tag.Key === "lambda:createdBy" && tag.Value === "SAM");
    if (createdBySam) {
      tags.push({ Key: MACRO_BY, Value: `SAM` });
    }

    lambda.properties.Tags = tags;
  });
}
