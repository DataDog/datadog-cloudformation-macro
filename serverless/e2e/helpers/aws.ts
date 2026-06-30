import { execPromise, execPromiseWithRetries, ExecResult } from "./exec";
import { CREATED_TS, FRESHNESS_TAG_KEY } from "./e2e.config";

// Thin, runner-agnostic wrappers over the `aws` CLI. The CLI inherits AWS creds
// from the environment (locally via `aws-vault exec ... --`, in CI via OIDC), so
// no SDK auth wiring is needed here.

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

// Transient AWS throttling errors safe to retry on a bounded budget.
const AWS_RETRY = {
  retryPatterns: ["Throttling", "Rate exceeded", "RequestThrottled"],
  maxAttempts: 3,
  delaySeconds: 15,
};

export interface DeployArgs {
  stackName: string;
  templateFile: string;
  region: string;
  parameters?: Record<string, string>;
  // Extra resource tags applied to every stack resource that supports tagging.
  tags?: Record<string, string>;
  capabilities?: string[];
}

const buildDeployCommand = (args: DeployArgs): string => {
  const capabilities = args.capabilities ?? ["CAPABILITY_AUTO_EXPAND", "CAPABILITY_IAM", "CAPABILITY_NAMED_IAM"];
  const tags = { [FRESHNESS_TAG_KEY]: String(CREATED_TS), ...args.tags };

  const parts = [
    "aws cloudformation deploy",
    `--stack-name ${args.stackName}`,
    `--template-file ${shellQuote(args.templateFile)}`,
    `--region ${args.region}`,
    `--capabilities ${capabilities.join(" ")}`,
  ];

  const params = Object.entries(args.parameters ?? {});
  if (params.length > 0) {
    parts.push(`--parameter-overrides ${params.map(([k, v]) => `${k}=${shellQuote(v)}`).join(" ")}`);
  }

  const tagPairs = Object.entries(tags);
  if (tagPairs.length > 0) {
    parts.push(`--tags ${tagPairs.map(([k, v]) => `${k}=${shellQuote(v)}`).join(" ")}`);
  }

  return parts.join(" ");
};

// Result of an APPLY/re-APPLY deploy. `noChanges` distinguishes the idempotent
// no-op (CloudFormation reports an empty changeset) from a real deploy.
export interface DeployResult extends ExecResult {
  noChanges: boolean;
}

export const cfnDeploy = async (args: DeployArgs): Promise<DeployResult> => {
  const result = await execPromiseWithRetries(buildDeployCommand(args), AWS_RETRY);
  const output = `${result.stdout}\n${result.stderr}`;
  // `aws cloudformation deploy` signals an empty changeset either via a zero exit
  // (CLI v2) or a non-zero exit with this message (older CLI). Treat both as "no diff".
  const noChanges = /No changes to deploy/i.test(output);
  if (result.exitCode !== 0 && !noChanges) {
    throw new Error(`Deploy of ${args.stackName} failed (exit ${result.exitCode}):\n${output}`);
  }
  return { ...result, noChanges };
};

export const cfnDeleteAndWait = async (stackName: string, region: string): Promise<void> => {
  await execPromise(`aws cloudformation delete-stack --stack-name ${stackName} --region ${region}`);
  // Best-effort wait; teardown must not throw and block sibling cleanup.
  await execPromise(`aws cloudformation wait stack-delete-complete --stack-name ${stackName} --region ${region}`);
};

export const invokeFunction = async (functionName: string, region: string): Promise<ExecResult> => {
  // Output payload to a temp file we don't read; we only care that the invoke
  // succeeds and produces telemetry.
  return execPromiseWithRetries(
    `aws lambda invoke --function-name ${functionName} --region ${region} --payload '{}' --cli-binary-format raw-in-base64-out /tmp/${functionName}-invoke.json`,
    AWS_RETRY,
  );
};

// --- S3 source bucket for the macro zip --------------------------------------

export const createSourceBucket = async (bucket: string, region: string): Promise<void> => {
  // us-east-1 rejects an explicit LocationConstraint; every other region requires it.
  const locationFlag = region === "us-east-1" ? "" : `--create-bucket-configuration LocationConstraint=${region}`;
  const result = await execPromiseWithRetries(
    `aws s3api create-bucket --bucket ${bucket} --region ${region} ${locationFlag}`,
    AWS_RETRY,
  );
  if (result.exitCode !== 0 && !/BucketAlreadyOwnedByYou/.test(`${result.stdout}${result.stderr}`)) {
    throw new Error(`Failed to create source bucket ${bucket}: ${result.stderr}`);
  }
  await execPromise(
    `aws s3api put-bucket-tagging --bucket ${bucket} --region ${region} --tagging 'TagSet=[{Key=${FRESHNESS_TAG_KEY},Value=${CREATED_TS}}]'`,
  );
};

export const uploadFile = async (localPath: string, bucket: string, key: string, region: string): Promise<void> => {
  const result = await execPromiseWithRetries(
    `aws s3 cp ${shellQuote(localPath)} s3://${bucket}/${key} --region ${region}`,
    AWS_RETRY,
  );
  if (result.exitCode !== 0) {
    throw new Error(`Failed to upload ${localPath} to s3://${bucket}/${key}: ${result.stderr}`);
  }
};

export const emptyAndDeleteBucket = async (bucket: string, region: string): Promise<void> => {
  await execPromise(`aws s3 rm s3://${bucket} --recursive --region ${region}`);
  await execPromise(`aws s3api delete-bucket --bucket ${bucket} --region ${region}`);
};
