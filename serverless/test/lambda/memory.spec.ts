import log from "loglevel";
import { handler } from "../../src/index";
import { ArchitectureType, LambdaFunction, RuntimeType } from "../../src/lambda/layer";
import {
  getEffectiveMemorySize,
  getLowMemoryWarningMessage,
  LOW_MEMORY_THRESHOLD_MB,
  LOW_MEMORY_REASON,
  warnOnLowMemoryLambdas,
} from "../../src/lambda/memory";
import { FunctionProperties } from "../../src/lambda/types";
import { LAMBDA_KEY, mockInputEvent } from "../index.spec";

function mockLambda(properties: Partial<FunctionProperties> = {}, key = LAMBDA_KEY): LambdaFunction {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: "python3.12",
      Role: "role-arn",
      Code: {},
      ...properties,
    },
    key,
    runtimeType: RuntimeType.PYTHON,
    runtime: "python3.12",
    architecture: "x86_64",
    architectureType: ArchitectureType.x86_64,
  };
}

describe("low memory warning", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  // loglevel binds console methods when the level is set (the handler calls log.setLevel),
  // so spy on console.warn and re-apply the level to bind loglevel to the spy.
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    log.setLevel("debug");
  });

  afterEach(() => {
    warnSpy.mockRestore();
    log.setLevel("debug");
  });

  it("defines the threshold and reason code", () => {
    expect(LOW_MEMORY_THRESHOLD_MB).toBe(256);
    expect(LOW_MEMORY_REASON).toBe("lambda_low_memory");
  });

  it("uses the exact warning text", () => {
    expect(getLowMemoryWarningMessage("MyFunction", 128)).toBe(
      "Function MyFunction has 128 MB of memory, below the recommended minimum of 256 MB (lambda_low_memory). " +
        "The Datadog Lambda Extension and tracer add memory overhead (about 70 MB for Python), which can cause out-of-memory errors and timeouts. " +
        "Increase the function's memory to at least 256 MB, or set suppressLowMemoryWarning to true to silence this warning.",
    );
  });

  it("warns when memory is below 256 MB", () => {
    const warnings = warnOnLowMemoryLambdas([mockLambda({ MemorySize: 255 })], false);
    expect(warnings).toEqual([getLowMemoryWarningMessage(LAMBDA_KEY, 255)]);
    expect(warnSpy).toHaveBeenCalledWith(getLowMemoryWarningMessage(LAMBDA_KEY, 255));
  });

  it("does not warn when memory is exactly 256 MB", () => {
    expect(warnOnLowMemoryLambdas([mockLambda({ MemorySize: 256 })], false)).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when memory is above 256 MB", () => {
    expect(warnOnLowMemoryLambdas([mockLambda({ MemorySize: 1024 })], false)).toEqual([]);
  });

  it("warns with the AWS default of 128 MB when MemorySize is unset", () => {
    expect(getEffectiveMemorySize({})).toBe(128);
    expect(warnOnLowMemoryLambdas([mockLambda()], false)).toEqual([getLowMemoryWarningMessage(LAMBDA_KEY, 128)]);
  });

  it("treats numeric strings as numbers", () => {
    expect(getEffectiveMemorySize({ MemorySize: "128" })).toBe(128);
    expect(warnOnLowMemoryLambdas([mockLambda({ MemorySize: "128" })], false)).toEqual([
      getLowMemoryWarningMessage(LAMBDA_KEY, 128),
    ]);
    expect(warnOnLowMemoryLambdas([mockLambda({ MemorySize: "512" })], false)).toEqual([]);
  });

  it("does not warn when MemorySize is an intrinsic function", () => {
    const lambdas = [
      mockLambda({ MemorySize: { Ref: "MemoryParam" } }, "RefFunction"),
      mockLambda({ MemorySize: { "Fn::If": ["IsProd", 1024, 128] } }, "IfFunction"),
    ];
    expect(warnOnLowMemoryLambdas(lambdas, false)).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when MemorySize is a non-numeric string", () => {
    expect(warnOnLowMemoryLambdas([mockLambda({ MemorySize: "abc" })], false)).toEqual([]);
  });

  it("does not warn when MemorySize is a non-finite number", () => {
    expect(getEffectiveMemorySize({ MemorySize: NaN })).toBeUndefined();
    expect(warnOnLowMemoryLambdas([mockLambda({ MemorySize: -Infinity })], false)).toEqual([]);
  });

  describe("SAM Globals", () => {
    const SERVERLESS = "AWS::Serverless::Function";

    it("uses Globals.Function.MemorySize for AWS::Serverless::Function when unset", () => {
      const globals = { Function: { MemorySize: 512 } };
      expect(getEffectiveMemorySize({}, SERVERLESS, globals)).toBe(512);
      expect(warnOnLowMemoryLambdas([mockLambda()], false, { [LAMBDA_KEY]: SERVERLESS }, globals)).toEqual([]);
    });

    it("warns when Globals.Function.MemorySize is below 256 MB", () => {
      const globals = { Function: { MemorySize: 128 } };
      expect(warnOnLowMemoryLambdas([mockLambda()], false, { [LAMBDA_KEY]: SERVERLESS }, globals)).toEqual([
        getLowMemoryWarningMessage(LAMBDA_KEY, 128),
      ]);
    });

    it("prefers the function's MemorySize over Globals", () => {
      const globals = { Function: { MemorySize: 1024 } };
      expect(getEffectiveMemorySize({ MemorySize: 128 }, SERVERLESS, globals)).toBe(128);
    });

    it("falls back to 128 MB when neither the function nor Globals set MemorySize", () => {
      expect(getEffectiveMemorySize({}, SERVERLESS, { Function: {} })).toBe(128);
    });

    it("does not warn when Globals.Function.MemorySize is an intrinsic", () => {
      const globals = { Function: { MemorySize: { Ref: "MemoryParam" } } };
      expect(getEffectiveMemorySize({}, SERVERLESS, globals)).toBeUndefined();
    });

    it("ignores Globals for AWS::Lambda::Function", () => {
      const globals = { Function: { MemorySize: 1024 } };
      expect(getEffectiveMemorySize({}, "AWS::Lambda::Function", globals)).toBe(128);
    });
  });

  it("does not warn when suppressLowMemoryWarning is true", () => {
    expect(warnOnLowMemoryLambdas([mockLambda({ MemorySize: 128 })], true)).toEqual([]);
    expect(warnOnLowMemoryLambdas([mockLambda({ MemorySize: 128 })], "true")).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  describe("through the macro handler", () => {
    it("warns but still instruments a low-memory function", async () => {
      const inputEvent = mockInputEvent({ nodeLayerVersion: 25 }, {});
      inputEvent.fragment.Resources[LAMBDA_KEY].Properties.MemorySize = 128;
      const output = await handler(inputEvent, {});

      expect(output.status).toEqual("success");
      expect(output.fragment.Resources[LAMBDA_KEY].Properties.Layers).toEqual([
        expect.stringMatching(/arn:aws:lambda:us-east-1:.*:layer:Datadog-Node24-x:25/),
      ]);
      expect(warnSpy).toHaveBeenCalledWith(getLowMemoryWarningMessage(LAMBDA_KEY, 128));
    });

    it("does not warn when suppressLowMemoryWarning is set", async () => {
      const inputEvent = mockInputEvent({ nodeLayerVersion: 25, suppressLowMemoryWarning: true }, {});
      const output = await handler(inputEvent, {});

      expect(output.status).toEqual("success");
      expect(warnSpy).not.toHaveBeenCalledWith(getLowMemoryWarningMessage(LAMBDA_KEY, 128));
    });

    it("does not warn for excluded functions", async () => {
      const inputEvent = mockInputEvent({ nodeLayerVersion: 25, exclude: [LAMBDA_KEY] }, {});
      await handler(inputEvent, {});

      expect(warnSpy).not.toHaveBeenCalledWith(getLowMemoryWarningMessage(LAMBDA_KEY, 128));
    });

    it("does not warn when memory is 256 MB", async () => {
      const inputEvent = mockInputEvent({ nodeLayerVersion: 25 }, {});
      inputEvent.fragment.Resources[LAMBDA_KEY].Properties.MemorySize = 256;
      await handler(inputEvent, {});

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining(LOW_MEMORY_REASON));
    });
  });
});
