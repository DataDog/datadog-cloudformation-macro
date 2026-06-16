import child_process from "node:child_process";

// Runner-agnostic command execution + bounded retries on transient cloud errors.
// Mirrors the datadog-ci reference impl (e2e/helpers/exec.ts) so the pattern is
// shared across suites. No jest/vitest imports.

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export const execPromise = async (command: string, env?: Record<string, string | undefined>): Promise<ExecResult> => {
  return new Promise((resolve) => {
    // 16 MB buffer: `aws cloudformation` / `get-function-configuration` JSON can be large.
    child_process.exec(command, { env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
};

// Transient cloud-provider errors that are safe to retry. Retry the cloud, not
// the assertions: throttling, timeouts, eventual-consistency conflicts.
const RETRYABLE_PATTERNS = [
  "Throttling",
  "ThrottlingException",
  "RequestLimitExceeded",
  "TooManyRequestsException",
  "Rate exceeded",
  "ServiceUnavailable",
  "InternalFailure",
  "InternalError",
  "RequestTimeout",
  "ETIMEDOUT",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "Connection reset",
  "timed out",
  // CloudFormation transient/eventual-consistency states
  "is in UPDATE_IN_PROGRESS state and can not be updated",
  "_IN_PROGRESS state and can not be",
];

const isRetryable = (result: ExecResult): boolean => {
  const output = `${result.stdout} ${result.stderr}`;
  return RETRYABLE_PATTERNS.some((pattern) => output.includes(pattern));
};

export const execPromiseWithRetries = async (
  command: string,
  env?: Record<string, string | undefined>,
  { maxAttempts = 3, delaySeconds = 5 }: { maxAttempts?: number; delaySeconds?: number } = {},
): Promise<ExecResult> => {
  let result: ExecResult = { exitCode: 1, stdout: "", stderr: "" };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    result = await execPromise(command, env);
    if (result.exitCode === 0) {
      return result;
    }
    if (attempt < maxAttempts && isRetryable(result)) {
      console.log(`Command failed with retryable error (attempt ${attempt}/${maxAttempts}), retrying in ${delaySeconds}s...`);
      console.log(`stdout: ${result.stdout}`);
      console.log(`stderr: ${result.stderr}`);
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    } else {
      return result;
    }
  }
  return result;
};

export const execSync = (command: string, env?: Record<string, string | undefined>): string => {
  return child_process.execSync(command, {
    encoding: "utf-8",
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
};
