import { client, v2 } from "@datadog/datadog-api-client";
import { DD_SITE } from "../constants";
import { RUN_ID_TAG_KEY } from "./naming";

// Polls Datadog for the telemetry the instrumented Lambda must produce: spans and
// logs that carry the identifying tags (service, env, version, run id). Queries are
// built from those dimensions so a non-empty result asserts IDENTITY, not mere
// existence -- the backend only returns items that match every dimension.
//
// Retry the cloud, not the assertions: poll on a fixed budget (15s x 20 = 5min),
// tolerate transient query errors, and fail once the budget is exhausted.

const POLL_INTERVAL_SECONDS = 15;
const MAX_ATTEMPTS = 20;
const LOOKBACK_MS = 30 * 60 * 1000;

const waitFor = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

const getConfiguration = (): client.Configuration => {
  const apiKey = process.env.DATADOG_API_KEY ?? process.env.DD_API_KEY;
  const appKey = process.env.DATADOG_APP_KEY ?? process.env.DD_APP_KEY;
  const configuration = client.createConfiguration({
    authMethods: { apiKeyAuth: apiKey, appKeyAuth: appKey },
  });
  configuration.setServerVariables({ site: DD_SITE });
  return configuration;
};

const pollUntilFound = async (label: string, query: () => Promise<unknown[]>): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[${label}] attempt ${attempt}/${MAX_ATTEMPTS}`);
    try {
      const results = await query();
      if (results.length > 0) {
        console.log(`[${label}] found ${results.length} item(s)`);
        return;
      }
    } catch (error) {
      console.error(`[${label}] query error:`, error);
    }
    if (attempt < MAX_ATTEMPTS) {
      await waitFor(POLL_INTERVAL_SECONDS);
    }
  }
  throw new Error(`[${label}] timed out after ${MAX_ATTEMPTS} attempts (${MAX_ATTEMPTS * POLL_INTERVAL_SECONDS}s)`);
};

export interface TelemetryIdentity {
  service: string;
  env: string;
  version: string;
  runId: string;
}

const identityFilter = (id: TelemetryIdentity): string =>
  `service:${id.service} env:${id.env} version:${id.version} ${RUN_ID_TAG_KEY}:${id.runId}`;

const querySpans = async (configuration: client.Configuration, id: TelemetryIdentity): Promise<unknown[]> => {
  const api = new v2.SpansApi(configuration);
  const now = new Date();
  const response = await api.listSpans({
    body: {
      data: {
        attributes: {
          filter: {
            query: identityFilter(id),
            from: new Date(now.getTime() - LOOKBACK_MS).toISOString(),
            to: now.toISOString(),
          },
          page: { limit: 5 },
        },
        type: "search_request",
      },
    },
  });
  return response.data ?? [];
};

const queryLogs = async (configuration: client.Configuration, id: TelemetryIdentity): Promise<unknown[]> => {
  const api = new v2.LogsApi(configuration);
  const now = new Date();
  const response = await api.listLogs({
    body: {
      filter: {
        query: identityFilter(id),
        from: new Date(now.getTime() - LOOKBACK_MS).toISOString(),
        to: now.toISOString(),
      },
      page: { limit: 5 },
    },
  });
  return response.data ?? [];
};

export const checkTelemetryFlowing = async (id: TelemetryIdentity): Promise<void> => {
  const configuration = getConfiguration();
  await Promise.all([
    pollUntilFound("spans", () => querySpans(configuration, id)),
    pollUntilFound("logs", () => queryLogs(configuration, id)),
  ]);
};
