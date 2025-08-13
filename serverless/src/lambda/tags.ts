import { LambdaFunction } from "./layer";

// Following the same pattern from SAM
const MACRO_BY = "dd_sls_macro_by";

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
