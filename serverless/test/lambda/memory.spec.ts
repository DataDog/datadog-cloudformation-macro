import log from "loglevel";
import { handler } from "../../src/index";
import { ArchitectureType, LambdaFunction, RuntimeType } from "../../src/lambda/layer";
import {
  getEffectiveMemorySize,
  getLowMemoryWarningMessage,
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

  it("does not warn when suppressLowMemoryWarning is true", () => {
    expect(warnOnLowMemoryLambdas([mockLambda({ MemorySize: 128 })], true)).toEqual([]);
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

    it("does not warn for unsupported runtimes, which get no layer", async () => {
      const inputEvent = mockInputEvent({ nodeLayerVersion: 25 }, {});
      inputEvent.fragment.Resources[LAMBDA_KEY].Properties.Runtime = "unsupported-runtime";
      const output = await handler(inputEvent, {});

      expect(output.status).toEqual("success");
      expect(output.fragment.Resources[LAMBDA_KEY].Properties.Layers).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining(LOW_MEMORY_REASON));
    });

    it("does not warn when addLayers is false and the extension is not used", async () => {
      const inputEvent = mockInputEvent({ addLayers: false }, {});
      const output = await handler(inputEvent, {});

      expect(output.status).toEqual("success");
      expect(output.fragment.Resources[LAMBDA_KEY].Properties.Layers).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining(LOW_MEMORY_REASON));
    });

    it("warns when addLayers is false but the extension is applied", async () => {
      const inputEvent = mockInputEvent({ addLayers: false, extensionLayerVersion: 80, apiKey: "1234" }, {});
      const output = await handler(inputEvent, {});

      expect(output.status).toEqual("success");
      expect(output.fragment.Resources[LAMBDA_KEY].Properties.Layers).toEqual([
        expect.stringMatching(/arn:aws:lambda:us-east-1:.*:layer:Datadog-Extension:80/),
      ]);
      expect(warnSpy).toHaveBeenCalledWith(getLowMemoryWarningMessage(LAMBDA_KEY, 128));
    });

    it("does not warn when applying layers fails", async () => {
      // No nodeLayerVersion for a Node.js function makes applyLayers return an error.
      const inputEvent = mockInputEvent({}, {});
      const output = await handler(inputEvent, {});

      expect(output.status).toEqual("failure");
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining(LOW_MEMORY_REASON));
    });

    it("does not warn when memory is 256 MB", async () => {
      const inputEvent = mockInputEvent({ nodeLayerVersion: 25 }, {});
      inputEvent.fragment.Resources[LAMBDA_KEY].Properties.MemorySize = 256;
      await handler(inputEvent, {});

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining(LOW_MEMORY_REASON));
    });
  });
});
