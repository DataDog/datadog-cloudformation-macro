// This file is generated. Do not edit it directly.

export const lambdaLayerCatalog = {
  architectures: {
    x86_64: {
      architectureType: "x86_64",
      extensionLayerNames: {
        standard: "Datadog-Extension",
        fips: "Datadog-Extension-FIPS",
      },
    },
    arm64: {
      architectureType: "ARM64",
      extensionLayerNames: {
        standard: "Datadog-Extension-ARM",
        fips: "Datadog-Extension-ARM-FIPS",
      },
    },
  },
  runtimes: {
    dotnet6: {
      runtimeType: "DOTNET",
      tracerLayerNames: { x86_64: "dd-trace-dotnet", arm64: "dd-trace-dotnet-ARM" },
    },
    dotnet8: {
      runtimeType: "DOTNET",
      tracerLayerNames: { x86_64: "dd-trace-dotnet", arm64: "dd-trace-dotnet-ARM" },
    },
    dotnet10: {
      runtimeType: "DOTNET",
      tracerLayerNames: { x86_64: "dd-trace-dotnet", arm64: "dd-trace-dotnet-ARM" },
    },
    java11: {
      runtimeType: "JAVA",
      tracerLayerNames: { x86_64: "dd-trace-java", arm64: "dd-trace-java" },
    },
    java17: {
      runtimeType: "JAVA",
      tracerLayerNames: { x86_64: "dd-trace-java", arm64: "dd-trace-java" },
    },
    java21: {
      runtimeType: "JAVA",
      tracerLayerNames: { x86_64: "dd-trace-java", arm64: "dd-trace-java" },
    },
    java25: {
      runtimeType: "JAVA",
      tracerLayerNames: { x86_64: "dd-trace-java", arm64: "dd-trace-java" },
    },
    java8: {
      runtimeType: "JAVA",
      tracerLayerNames: { x86_64: "dd-trace-java", arm64: "dd-trace-java" },
    },
    "java8.al2": {
      runtimeType: "JAVA",
      tracerLayerNames: { x86_64: "dd-trace-java", arm64: "dd-trace-java" },
    },
    "nodejs14.x": {
      runtimeType: "NODE",
      tracerLayerNames: { x86_64: "Datadog-Node14-x", arm64: "Datadog-Node14-x" },
    },
    "nodejs16.x": {
      runtimeType: "NODE",
      tracerLayerNames: { x86_64: "Datadog-Node16-x", arm64: "Datadog-Node16-x" },
    },
    "nodejs18.x": {
      runtimeType: "NODE",
      tracerLayerNames: { x86_64: "Datadog-Node18-x", arm64: "Datadog-Node18-x" },
    },
    "nodejs20.x": {
      runtimeType: "NODE",
      tracerLayerNames: { x86_64: "Datadog-Node20-x", arm64: "Datadog-Node20-x" },
    },
    "nodejs22.x": {
      runtimeType: "NODE",
      tracerLayerNames: { x86_64: "Datadog-Node22-x", arm64: "Datadog-Node22-x" },
    },
    "nodejs24.x": {
      runtimeType: "NODE",
      tracerLayerNames: { x86_64: "Datadog-Node24-x", arm64: "Datadog-Node24-x" },
    },
    "provided.al2": {
      runtimeType: "CUSTOM",
      tracerLayerNames: { x86_64: null, arm64: null },
    },
    "provided.al2023": {
      runtimeType: "CUSTOM",
      tracerLayerNames: { x86_64: null, arm64: null },
    },
    "python3.7": {
      runtimeType: "PYTHON",
      tracerLayerNames: { x86_64: "Datadog-Python37", arm64: null },
    },
    "python3.8": {
      runtimeType: "PYTHON",
      tracerLayerNames: { x86_64: "Datadog-Python38", arm64: "Datadog-Python38-ARM" },
    },
    "python3.9": {
      runtimeType: "PYTHON",
      tracerLayerNames: { x86_64: "Datadog-Python39", arm64: "Datadog-Python39-ARM" },
    },
    "python3.10": {
      runtimeType: "PYTHON",
      tracerLayerNames: { x86_64: "Datadog-Python310", arm64: "Datadog-Python310-ARM" },
    },
    "python3.11": {
      runtimeType: "PYTHON",
      tracerLayerNames: { x86_64: "Datadog-Python311", arm64: "Datadog-Python311-ARM" },
    },
    "python3.12": {
      runtimeType: "PYTHON",
      tracerLayerNames: { x86_64: "Datadog-Python312", arm64: "Datadog-Python312-ARM" },
    },
    "python3.13": {
      runtimeType: "PYTHON",
      tracerLayerNames: { x86_64: "Datadog-Python313", arm64: "Datadog-Python313-ARM" },
    },
    "python3.14": {
      runtimeType: "PYTHON",
      tracerLayerNames: { x86_64: "Datadog-Python314", arm64: "Datadog-Python314-ARM" },
    },
    "ruby3.2": {
      runtimeType: "RUBY",
      tracerLayerNames: { x86_64: "Datadog-Ruby3-2", arm64: "Datadog-Ruby3-2-ARM" },
    },
    "ruby3.3": {
      runtimeType: "RUBY",
      tracerLayerNames: { x86_64: "Datadog-Ruby3-3", arm64: "Datadog-Ruby3-3-ARM" },
    },
    "ruby3.4": {
      runtimeType: "RUBY",
      tracerLayerNames: { x86_64: "Datadog-Ruby3-4", arm64: "Datadog-Ruby3-4-ARM" },
    },
    "ruby4.0": {
      runtimeType: "RUBY",
      tracerLayerNames: { x86_64: "Datadog-Ruby4-0", arm64: "Datadog-Ruby4-0-ARM" },
    },
  },
} as const;

export type CatalogArchitecture = keyof typeof lambdaLayerCatalog.architectures;
