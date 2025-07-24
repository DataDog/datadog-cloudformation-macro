import {
  LambdaConfigLoader,
  setEnvConfiguration,
  validateParameters,
  checkForMultipleApiKeys,
} from "../../src/lambda/env";
import { ArchitectureType, LambdaFunction, RuntimeType } from "../../src/lambda/layer";

const loader = new LambdaConfigLoader();
describe("getConfig", () => {
  it("correctly parses parameters from Mappings", () => {
    const params = {
      addLayers: false,
      logLevel: "error",
    };
    const mappings = { Datadog: { Parameters: params } };
    const config = loader.getConfigFromCfnMappings(mappings);
    expect(config).toMatchObject(params);
  });

  it("gets default configuration when no parameters are specified", () => {
    const config = loader.getConfigFromCfnParams({});
    expect(config).toEqual(expect.objectContaining(loader.defaultConfiguration));
  });

  it("gets a mixed a configuration when some values are present", () => {
    const params = {
      site: "my-site",
      enableXrayTracing: false,
    };
    const config = loader.getConfigFromCfnParams(params);
    expect(config).toEqual(
      expect.objectContaining({
        addLayers: true,
        addExtension: false,
        exclude: [],
        flushMetricsToLogs: true,
        site: "my-site",
        enableXrayTracing: false,
        enableDDTracing: true,
        enableDDLogs: true,
        enableEnhancedMetrics: true,
        captureLambdaPayload: false,
      }),
    );
  });

  describe("with env vars set", () => {
    const CURRENT_ENV = process.env;

    beforeEach(() => {
      jest.resetModules(); // Clear the cache
      process.env = { ...CURRENT_ENV }; // Make a copy we can modify
    });

    afterEach(() => {
      process.env = CURRENT_ENV; // Restore environment
    });

    it("gets default values overwritten by environment variables", () => {
      process.env["DD_API_KEY_SECRET_ARN"] =
        "arn:aws:secretsmanager:my-region-1:123456789012:secret:DdApiKeySecret-abcd1234";
      process.env["DD_FLUSH_TO_LOG"] = "false";
      const config = loader.getConfigFromEnvVars();
      expect(config).toEqual(
        expect.objectContaining({
          addLayers: true,
          addExtension: false,
          exclude: [],
          flushMetricsToLogs: false,
          logLevel: undefined,
          site: "datadoghq.com",
          enableXrayTracing: false,
          enableDDTracing: true,
          enableDDLogs: true,
          enableEnhancedMetrics: true,
          captureLambdaPayload: false,
          apiKeySecretArn: "arn:aws:secretsmanager:my-region-1:123456789012:secret:DdApiKeySecret-abcd1234",
        }),
      );
    });

    it("gets a mixed a configuration when some values are present", () => {
      process.env["DD_API_KEY_SECRET_ARN"] =
        "arn:aws:secretsmanager:my-region-1:123456789012:secret:DdApiKeySecret-abcd1234";
      process.env["DD_FLUSH_TO_LOG"] = "false";
      process.env["DD_ENHANCED_METRICS"] = "false";
      process.env["DD_CAPTURE_LAMBDA_PAYLOAD"] = "true";
      const params = {
        site: "my-site",
        enableXrayTracing: false,
        enableEnhancedMetrics: true,
        captureLambdaPayload: false,
      };
      const config = loader.getConfigFromCfnParams(params);
      expect(config).toEqual(
        expect.objectContaining({
          addLayers: true,
          addExtension: false,
          exclude: [],
          flushMetricsToLogs: false,
          site: "my-site",
          enableXrayTracing: false,
          enableDDTracing: true,
          enableDDLogs: true,
          enableEnhancedMetrics: true,
          captureLambdaPayload: false,
          apiKeySecretArn: "arn:aws:secretsmanager:my-region-1:123456789012:secret:DdApiKeySecret-abcd1234",
        }),
      );
    });

    it("gets fipsMode from environment variable", () => {
      process.env["DD_LAMBDA_FIPS_MODE"] = "true";
      const config = loader.getConfigFromEnvVars();
      expect(config.fipsMode).toBe(true);
    });
  });
});

describe("setEnvConfiguration", () => {
  it("sets env vars with simple config and extension", () => {
    const lambda: LambdaFunction = {
      properties: {
        Handler: "app.handler",
        Runtime: "python2.7",
        Role: "role-arn",
        Code: {},
      },
      key: "FunctionKey",
      runtimeType: RuntimeType.PYTHON,
      runtime: "python2.7",
      architecture: "x86_64",
      architectureType: ArchitectureType.x86_64,
    };
    const config = {
      addLayers: false,
      apiKey: "1234",
      extensionLayerVersion: 13,
      service: "my-service",
      env: "test",
      version: "1",
      tags: "team:avengers,project:marvel",
    };
    setEnvConfiguration({ ...loader.defaultConfiguration, ...config }, [lambda]);

    expect(lambda.properties.Environment).toEqual({
      Variables: {
        DD_API_KEY: "1234",
        DD_CAPTURE_LAMBDA_PAYLOAD: false,
        DD_ENHANCED_METRICS: true,
        DD_FLUSH_TO_LOG: true,
        DD_SITE: "datadoghq.com",
        DD_ENV: "test",
        DD_SERVICE: "my-service",
        DD_VERSION: "1",
        DD_TAGS: "team:avengers,project:marvel",
        DD_SERVERLESS_LOGS_ENABLED: true,
      },
    });
  });

  it("sets env vars with simple config without extension", () => {
    const lambda: LambdaFunction = {
      properties: {
        Handler: "app.handler",
        Runtime: "python2.7",
        Role: "role-arn",
        Code: {},
      },
      key: "FunctionKey",
      runtimeType: RuntimeType.PYTHON,
      runtime: "python2.7",
      architecture: "x86_64",
      architectureType: ArchitectureType.x86_64,
    };
    const config = {
      addLayers: false,
      apiKey: "1234",
      service: "my-service",
      env: "test",
      version: "1",
      tags: "team:avengers,project:marvel",
    };
    setEnvConfiguration({ ...loader.defaultConfiguration, ...config }, [lambda]);

    expect(lambda.properties.Environment).toEqual({
      Variables: {
        DD_API_KEY: "1234",
        DD_CAPTURE_LAMBDA_PAYLOAD: false,
        DD_ENHANCED_METRICS: true,
        DD_FLUSH_TO_LOG: true,
        DD_SITE: "datadoghq.com",
        DD_ENV: "test",
        DD_SERVICE: "my-service",
        DD_TAGS: "team:avengers,project:marvel",
        DD_SERVERLESS_LOGS_ENABLED: true,
      },
    });
  });

  it("sets env vars with complicated config and extension)", () => {
    const lambda: LambdaFunction = {
      properties: {
        Handler: "app.handler",
        Runtime: "python2.7",
        Role: "role-arn",
        Code: {},
      },
      key: "FunctionKey",
      runtimeType: RuntimeType.PYTHON,
      runtime: "python2.7",
      architecture: "x86_64",
      architectureType: ArchitectureType.x86_64,
    };
    const config = {
      addLayers: false,
      addExtension: false,
      apiKey: "1234",
      apiKMSKey: "5678",
      site: "datadoghq.eu",
      logLevel: "debug",
      flushMetricsToLogs: true,
      enableXrayTracing: true,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      captureLambdaPayload: true,
      enableColdStartTracing: true,
      minColdStartTraceDuration: "80",
      coldStartTraceSkipLibs: "lib1,lib2",
      enableProfiling: true,
      encodeAuthorizerContext: true,
      decodeAuthorizerContext: true,
      apmFlushDeadline: "20",
      extensionLayerVersion: 13,
      service: "my-service",
      env: "test",
      version: "1",
      tags: "team:avengers,project:marvel",
      llmObsEnabled: true,
      llmObsMlApp: "my-llm-app",
      llmObsAgentlessEnabled: false,
    };
    setEnvConfiguration(config, [lambda]);

    expect(lambda.properties.Environment).toEqual({
      Variables: {
        DD_API_KEY: "1234",
        DD_APM_FLUSH_DEADLINE_MILLISECONDS: "20",
        DD_FLUSH_TO_LOG: true,
        DD_KMS_API_KEY: "5678",
        DD_LOG_LEVEL: "debug",
        DD_SITE: "datadoghq.eu",
        DD_ENHANCED_METRICS: true,
        DD_SERVERLESS_LOGS_ENABLED: true,
        DD_CAPTURE_LAMBDA_PAYLOAD: true,
        DD_ENV: "test",
        DD_SERVICE: "my-service",
        DD_VERSION: "1",
        DD_TAGS: "team:avengers,project:marvel",
        DD_COLD_START_TRACING: true,
        DD_MIN_COLD_START_DURATION: "80",
        DD_COLD_START_TRACE_SKIP_LIB: "lib1,lib2",
        DD_PROFILING_ENABLED: true,
        DD_ENCODE_AUTHORIZER_CONTEXT: true,
        DD_DECODE_AUTHORIZER_CONTEXT: true,
        DD_LLMOBS_ENABLED: true,
        DD_LLMOBS_ML_APP: "my-llm-app",
        DD_LLMOBS_AGENTLESS_ENABLED: false,
      },
    });
  });

  it("sets env vars with complicated config without extension", () => {
    const lambda: LambdaFunction = {
      properties: {
        Handler: "app.handler",
        Runtime: "python2.7",
        Role: "role-arn",
        Code: {},
      },
      key: "FunctionKey",
      runtimeType: RuntimeType.PYTHON,
      runtime: "python2.7",
      architecture: "x86_64",
      architectureType: ArchitectureType.x86_64,
    };
    const config = {
      addLayers: false,
      addExtension: false,
      apiKey: "1234",
      apiKMSKey: "5678",
      site: "datadoghq.eu",
      logLevel: "debug",
      flushMetricsToLogs: true,
      enableXrayTracing: true,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      captureLambdaPayload: true,
      enableColdStartTracing: true,
      minColdStartTraceDuration: "80",
      coldStartTraceSkipLibs: "lib1,lib2",
      enableProfiling: true,
      encodeAuthorizerContext: true,
      decodeAuthorizerContext: true,
      apmFlushDeadline: "20",
      service: "my-service",
      env: "test",
      version: "1",
      tags: "team:avengers,project:marvel",
    };
    setEnvConfiguration(config, [lambda]);

    expect(lambda.properties.Environment).toEqual({
      Variables: {
        DD_API_KEY: "1234",
        DD_APM_FLUSH_DEADLINE_MILLISECONDS: "20",
        DD_FLUSH_TO_LOG: true,
        DD_KMS_API_KEY: "5678",
        DD_LOG_LEVEL: "debug",
        DD_SITE: "datadoghq.eu",
        DD_ENHANCED_METRICS: true,
        DD_ENV: "test",
        DD_SERVERLESS_LOGS_ENABLED: true,
        DD_SERVICE: "my-service",
        DD_CAPTURE_LAMBDA_PAYLOAD: true,
        DD_COLD_START_TRACING: true,
        DD_MIN_COLD_START_DURATION: "80",
        DD_COLD_START_TRACE_SKIP_LIB: "lib1,lib2",
        DD_PROFILING_ENABLED: true,
        DD_ENCODE_AUTHORIZER_CONTEXT: true,
        DD_DECODE_AUTHORIZER_CONTEXT: true,
        DD_TAGS: "team:avengers,project:marvel",
      },
    });
  });

  it("doesn't overwrite already present env vars on lambdas (with extension)", () => {
    const originalEnvVars = {
      DD_API_KEY: "1234",
      DD_FLUSH_TO_LOG: true,
      DD_KMS_API_KEY: "5678",
      DD_LOG_LEVEL: "debug",
      DD_SITE: "datadoghq.eu",
      DD_ENHANCED_METRICS: true,
      DD_CAPTURE_LAMBDA_PAYLOAD: false,
      DD_ENV: "test",
      DD_SERVICE: "my-service",
      DD_VERSION: "1",
      DD_TAGS: "team:avengers,project:marvel",
      DD_COLD_START_TRACING: true,
      DD_MIN_COLD_START_DURATION: "80",
      DD_COLD_START_TRACE_SKIP_LIB: "lib1,lib2",
      DD_PROFILING_ENABLED: true,
      DD_ENCODE_AUTHORIZER_CONTEXT: true,
      DD_DECODE_AUTHORIZER_CONTEXT: true,
      DD_APM_FLUSH_DEADLINE_MILLISECONDS: "20",
    };
    const lambda: LambdaFunction = {
      properties: {
        Handler: "app.handler",
        Runtime: "python2.7",
        Role: "role-arn",
        Code: {},
        Environment: { Variables: originalEnvVars },
      },
      key: "FunctionKey",
      runtimeType: RuntimeType.PYTHON,
      runtime: "python2.7",
      architecture: "x86_64",
      architectureType: ArchitectureType.x86_64,
    };
    const config = {
      addLayers: false,
      addExtension: false,
      apiKey: "abcd",
      apiKMSKey: "efgh",
      site: "datadoghq.com",
      logLevel: "info",
      flushMetricsToLogs: false,
      enableXrayTracing: true,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: false,
      captureLambdaPayload: false,
      enableColdStartTracing: false,
      minColdStartTraceDuration: "100",
      coldStartTraceSkipLibs: "lib3,lib4",
      enableProfiling: false,
      encodeAuthorizerContext: false,
      decodeAuthorizerContext: false,
      apmFlushDeadline: "30",
      extensionLayerVersion: 13,
      service: "config-service",
      env: "config-test",
      version: "2",
      tags: "team:serverless,project:lambda",
    };
    setEnvConfiguration(config, [lambda]);

    expect(lambda.properties.Environment).toEqual({
      Variables: originalEnvVars,
    });
  });

  it("does not define `DD_LOG_LEVEL` by default when logLevel is undefined", () => {
    const lambda: LambdaFunction = {
      properties: {
        Handler: "app.handler",
        Runtime: "python2.7",
        Role: "role-arn",
        Code: {},
      },
      key: "FunctionKey",
      runtimeType: RuntimeType.PYTHON,
      runtime: "python2.7",
      architecture: "x86_64",
      architectureType: ArchitectureType.x86_64,
    };
    const config = {
      addLayers: false,
      addExtension: false,
      apiKey: "1234",
      apiKMSKey: "5678",
      site: "datadoghq.eu",
      logLevel: undefined,
      flushMetricsToLogs: true,
      enableXrayTracing: true,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      captureLambdaPayload: false,
    };
    setEnvConfiguration(config, [lambda]);

    expect(lambda.properties.Environment).toEqual({
      Variables: {
        DD_API_KEY: "1234",
        DD_FLUSH_TO_LOG: true,
        DD_KMS_API_KEY: "5678",
        DD_SITE: "datadoghq.eu",
        DD_ENHANCED_METRICS: true,
        DD_SERVERLESS_LOGS_ENABLED: true,
        DD_CAPTURE_LAMBDA_PAYLOAD: false,
      },
    });
  });

  it("defines `DD_LOG_LEVEL` when logLevel is defined", () => {
    const lambda: LambdaFunction = {
      properties: {
        Handler: "app.handler",
        Runtime: "python2.7",
        Role: "role-arn",
        Code: {},
      },
      key: "FunctionKey",
      runtimeType: RuntimeType.PYTHON,
      runtime: "python2.7",
      architecture: "x86_64",
      architectureType: ArchitectureType.x86_64,
    };
    const config = {
      addLayers: false,
      addExtension: false,
      apiKey: "1234",
      apiKMSKey: "5678",
      site: "datadoghq.eu",
      logLevel: "info",
      flushMetricsToLogs: true,
      enableXrayTracing: true,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      captureLambdaPayload: false,
    };
    setEnvConfiguration(config, [lambda]);

    expect(lambda.properties.Environment).toEqual({
      Variables: {
        DD_API_KEY: "1234",
        DD_FLUSH_TO_LOG: true,
        DD_KMS_API_KEY: "5678",
        DD_LOG_LEVEL: "info",
        DD_SITE: "datadoghq.eu",
        DD_ENHANCED_METRICS: true,
        DD_SERVERLESS_LOGS_ENABLED: true,
        DD_CAPTURE_LAMBDA_PAYLOAD: false,
      },
    });
  });

  it("adds `DD_API_KEY_SECRET_ARN` correctly", () => {
    const lambda: LambdaFunction = {
      properties: {
        FunctionName: "my-function",
        Handler: "app.handler",
        Runtime: "python3.9",
        Role: "role-arn",
        Code: {},
      },
      key: "FunctionKey",
      runtimeType: RuntimeType.PYTHON,
      runtime: "python3.9",
      architecture: "x86_64",
      architectureType: ArchitectureType.x86_64,
    };
    const config = {
      addLayers: false,
      addExtension: false,
      apiKeySecretArn: "some-resource:from:aws:secrets-manager:arn",
      site: "datadoghq.eu",
      logLevel: "info",
      flushMetricsToLogs: true,
      enableXrayTracing: true,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      extensionLayerVersion: 13,
      captureLambdaPayload: false,
    };
    setEnvConfiguration(config, [lambda]);

    expect(lambda.properties.Environment).toEqual({
      Variables: {
        DD_API_KEY_SECRET_ARN: "some-resource:from:aws:secrets-manager:arn",
        DD_FLUSH_TO_LOG: true,
        DD_LOG_LEVEL: "info",
        DD_SITE: "datadoghq.eu",
        DD_ENHANCED_METRICS: true,
        DD_SERVERLESS_LOGS_ENABLED: true,
        DD_CAPTURE_LAMBDA_PAYLOAD: false,
      },
    });
  });

  it("throws error when using synchronous metrics in node using `DD_API_KEY_SECRET_ARN`", () => {
    const lambda: LambdaFunction = {
      properties: {
        FunctionName: "my-function",
        Handler: "app.handler",
        Runtime: "nodejs12.x",
        Role: "role-arn",
        Code: {},
      },
      key: "FunctionKey",
      runtimeType: RuntimeType.NODE,
      runtime: "nodejs12.x",
      architecture: "x86_64",
      architectureType: ArchitectureType.x86_64,
    };
    const config = {
      addLayers: false,
      addExtension: false,
      apiKeySecretArn: "some-resource:from:aws:secrets-manager:arn",
      site: "datadoghq.eu",
      logLevel: "info",
      flushMetricsToLogs: false,
      enableXrayTracing: true,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      captureLambdaPayload: false,
    };

    expect(() => {
      setEnvConfiguration(config, [lambda]);
    }).toThrow(
      `\`apiKeySecretArn\` is not supported for Node runtimes (${lambda.properties.FunctionName}) when using Synchronous Metrics. Use either \`apiKey\` or \`apiKmsKey\`.`,
    );
  });
});

describe("validateParameters", () => {
  it("returns an error when given an invalid site url", () => {
    const params = {
      addLayers: true,
      addExtension: false,
      flushMetricsToLogs: true,
      logLevel: "info",
      site: "datacathq.com",
      enableXrayTracing: false,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      captureLambdaPayload: false,
    };

    const errors = validateParameters(params);
    expect(
      errors.includes(
        "Warning: Invalid site URL. Must be one of datadoghq.com, datadoghq.eu, us3.datadoghq.com, us5.datadoghq.com, ap1.datadoghq.com, ap2.datadoghq.com, ddog-gov.com.",
      ),
    ).toBe(true);
  });

  it("returns an error when extensionLayerVersion and forwarderArn are set", () => {
    const params = {
      addLayers: true,
      addExtension: false,
      flushMetricsToLogs: true,
      logLevel: "info",
      site: "datadoghq.com",
      enableXrayTracing: false,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      extensionLayerVersion: 6,
      forwarderArn: "test-forwarder",
      captureLambdaPayload: false,
    };

    const errors = validateParameters(params);
    expect(
      errors.includes(
        "setting `forwarderArn` with `addExtension` and/or `extensionLayerVersion` as these parameters cannot be set at the same time.",
      ),
    ).toBe(true);
  });

  it("returns an error when extensionLayer is true without setting extensionLayerVersion", () => {
    const params = {
      addLayers: true,
      addExtension: true,
      flushMetricsToLogs: true,
      logLevel: "info",
      site: "datadoghq.com",
      enableXrayTracing: false,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      forwarderArn: "test-forwarder",
      captureLambdaPayload: false,
    };

    const errors = validateParameters(params);
    expect(errors.includes("Please add the `extensionLayerVersion` parameter when `addExtension` is set.")).toBe(true);
  });

  it("returns an error when extensionLayerVersion is set but neither apiKey nor apiKMSKey is set", () => {
    const params = {
      addLayers: true,
      addExtension: false,
      flushMetricsToLogs: true,
      logLevel: "info",
      site: "datadoghq.com",
      enableXrayTracing: false,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      extensionLayerVersion: 6,
      captureLambdaPayload: false,
    };

    const errors = validateParameters(params);
    expect(
      errors.includes(
        "When `extensionLayerVersion` is set, `apiKey`, `apiKeySecretArn`, or `apiKmsKey` must also be set.",
      ),
    ).toBe(true);
  });

  it("returns an error when multiple api keys are set", () => {
    const params = {
      addLayers: true,
      addExtension: false,
      apiKey: "1234",
      apiKMSKey: "5678",
      flushMetricsToLogs: true,
      logLevel: "info",
      site: "datacathq.com",
      enableXrayTracing: false,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      captureLambdaPayload: false,
    };

    const errors = validateParameters(params);
    expect(errors.includes("`apiKey` and `apiKMSKey` should not be set at the same time.")).toBe(true);
  });

  it("returns an error when llmObsEnabled is true but llmObsMlApp is not set", () => {
    const params = {
      addLayers: true,
      addExtension: false,
      apiKey: "1234",
      flushMetricsToLogs: true,
      logLevel: "info",
      site: "datadoghq.com",
      enableXrayTracing: false,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      captureLambdaPayload: false,
      llmObsEnabled: true,
    };

    const errors = validateParameters(params);
    expect(errors).toContain("When `llmObsEnabled` is true, `llmObsMlApp` must also be set.");
  });

  it("returns an error when llmObsMlApp is not a valid value", () => {
    const params = {
      addLayers: true,
      addExtension: false,
      apiKey: "1234",
      flushMetricsToLogs: true,
      logLevel: "info",
      site: "datadoghq.com",
      enableXrayTracing: false,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      captureLambdaPayload: false,
      llmObsEnabled: true,
      llmObsMlApp: "bad~!@#$%^&*()_+",
    };

    const errors = validateParameters(params);
    expect(errors).toContain(
      "`llmObsMlApp` must only contain up to 193 alphanumeric characters, hyphens, underscores, periods, and slashes.",
    );
  });

  it("works with ap1", () => {
    const params = {
      addLayers: true,
      addExtension: false,
      apiKey: "1234",
      flushMetricsToLogs: true,
      logLevel: "info",
      site: "ap1.datadoghq.com",
      enableXrayTracing: false,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      captureLambdaPayload: false,
    };

    const errors = validateParameters(params);
    console.log({ errors });
    expect(errors.length).toEqual(0);
  });

  it("returns a warning when FIPS mode is enabled but site is not ddog-gov.com", () => {
    const params = {
      addLayers: true,
      addExtension: false,
      apiKey: "1234",
      flushMetricsToLogs: true,
      logLevel: "info",
      site: "datadoghq.com",
      enableXrayTracing: false,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      captureLambdaPayload: false,
      fipsMode: true,
    };

    const errors = validateParameters(params);
    expect(
      errors.includes(
        "Warning: FIPS mode is enabled but the site is not set to 'ddog-gov.com'. " +
        "FIPS compliance typically requires using GovCloud endpoints.",
      ),
    ).toBe(true);
  });

  it("does not return a warning when FIPS mode is enabled with ddog-gov.com site", () => {
    const params = {
      addLayers: true,
      addExtension: false,
      apiKey: "1234",
      flushMetricsToLogs: true,
      logLevel: "info",
      site: "ddog-gov.com",
      enableXrayTracing: false,
      enableDDTracing: true,
      enableDDLogs: true,
      enableEnhancedMetrics: true,
      captureLambdaPayload: false,
      fipsMode: true,
    };

    const errors = validateParameters(params);
    expect(errors.some(error => error.includes("FIPS mode is enabled"))).toBe(false);
  });
});

describe("checkForMultipleApiKeys", () => {
  it("throws error if both API key and KMS API key are defined", () => {
    expect(
      checkForMultipleApiKeys({
        addLayers: false,
        addExtension: false,
        apiKey: "1234",
        apiKMSKey: "5678",
        logLevel: "debug",
        site: "datadoghq.com",
        flushMetricsToLogs: false,
        enableEnhancedMetrics: false,
        enableXrayTracing: false,
        enableDDTracing: false,
        enableDDLogs: false,
        captureLambdaPayload: false,
      }),
    ).toMatch("`apiKey` and `apiKMSKey`");
  });

  it("throws error if both API key and API key secret ARN are defined", () => {
    expect(
      checkForMultipleApiKeys({
        addLayers: false,
        addExtension: false,
        apiKey: "5678",
        apiKeySecretArn: "some-resource:from:aws:secrets-manager:arn",
        logLevel: "debug",
        site: "datadoghq.com",
        flushMetricsToLogs: false,
        enableEnhancedMetrics: false,
        enableXrayTracing: false,
        enableDDTracing: false,
        enableDDLogs: false,
        captureLambdaPayload: false,
      }),
    ).toMatch("`apiKey` and `apiKeySecretArn`");
  });

  it("throws error if both API key secret ARN and KMS API key are defined", () => {
    expect(
      checkForMultipleApiKeys({
        addLayers: false,
        addExtension: false,
        apiKeySecretArn: "some-resource:from:aws:secrets-manager:arn",
        apiKMSKey: "5678",
        logLevel: "debug",
        site: "datadoghq.com",
        flushMetricsToLogs: false,
        enableEnhancedMetrics: false,
        enableXrayTracing: false,
        enableDDTracing: false,
        enableDDLogs: false,
        captureLambdaPayload: false,
      }),
    ).toMatch("`apiKMSKey` and `apiKeySecretArn`");
  });

  it("throws error if both API key secret ARN and KMS API key are defined", () => {
    expect(
      checkForMultipleApiKeys({
        addLayers: false,
        addExtension: false,
        apiKey: "1234",
        apiKeySecretArn: "some-resource:from:aws:secrets-manager:arn",
        apiKMSKey: "5678",
        logLevel: "debug",
        site: "datadoghq.com",
        flushMetricsToLogs: false,
        enableEnhancedMetrics: false,
        enableXrayTracing: false,
        enableDDTracing: false,
        enableDDLogs: false,
        captureLambdaPayload: false,
      }),
    ).toMatch("`apiKey`, `apiKMSKey`, and `apiKeySecretArn`");
  });
});
