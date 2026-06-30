import { cfnDeleteAndWait, cfnDeploy, createSourceBucket, emptyAndDeleteBucket, uploadFile } from "./aws";
import { CREATED_TS, execSync, MACRO_NAME, MACRO_STACK_NAME, RESOURCE_PREFIX, RUN_ID, SOURCE_BUCKET } from "./e2e.config";

// Builds the macro from source (the PR's code -- the tool under test) and registers
// it as a CloudFormation macro in the test region. This is the artifact we pin the
// suite against: a failure points at the macro, not at a published release.

const MACRO_TEMPLATE = "e2e/templates/macro.yml";
const MACRO_FUNCTION_NAME = `${RESOURCE_PREFIX}-macro-fn`;
const ZIP_KEY = `macro/${RUN_ID}/serverless-macro-${RUN_ID}.zip`;

export const deployMacroStack = async (region: string): Promise<void> => {
  // Build dist/ (tsc + prod deps) and zip it, exactly as the release pipeline does.
  console.log("Building macro zip from source...");
  execSync(`bash tools/build_zip.sh ${RUN_ID}`);
  const zipPath = `.macro/serverless-macro-${RUN_ID}.zip`;

  console.log(`Uploading macro zip to s3://${SOURCE_BUCKET}/${ZIP_KEY}`);
  await createSourceBucket(SOURCE_BUCKET, region);
  await uploadFile(zipPath, SOURCE_BUCKET, ZIP_KEY, region);

  console.log(`Registering macro "${MACRO_NAME}" via stack ${MACRO_STACK_NAME}`);
  await cfnDeploy({
    stackName: MACRO_STACK_NAME,
    templateFile: MACRO_TEMPLATE,
    region,
    parameters: {
      MacroName: MACRO_NAME,
      FunctionName: MACRO_FUNCTION_NAME,
      SourceBucket: SOURCE_BUCKET,
      SourceKey: ZIP_KEY,
      CreatedTs: String(CREATED_TS),
    },
    capabilities: ["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM"],
  });
};

export const teardownMacroStack = async (region: string): Promise<void> => {
  try {
    await cfnDeleteAndWait(MACRO_STACK_NAME, region);
  } catch (error) {
    console.error(`Failed to delete macro stack ${MACRO_STACK_NAME}:`, error);
  }
  try {
    await emptyAndDeleteBucket(SOURCE_BUCKET, region);
  } catch (error) {
    console.error(`Failed to delete source bucket ${SOURCE_BUCKET}:`, error);
  }
};
