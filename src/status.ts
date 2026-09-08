import { fail, type ErrorEnvelope } from "./errors.js";
import { discoverTrackerRuntime, type DiscoverOptions, type DiscoverSuccess } from "./discover.js";
import type { ServiceClient } from './service-client.js';

export type TrackerStatusSuccess = DiscoverSuccess & {
  service: null;
};

export type TrackerStatusResult = TrackerStatusSuccess | ErrorEnvelope;

export function runTrackerStatus(
  args: unknown,
  options: DiscoverOptions = {},
): TrackerStatusResult {
  if (args !== undefined && args !== null && (typeof args !== "object" || Array.isArray(args))) {
    return fail("INVALID_ARGUMENT", "tracker_status arguments must be an object");
  }
  const record = (args ?? {}) as Record<string, unknown>;
  if ("probe_service" in record && typeof record.probe_service !== "boolean") {
    return fail("INVALID_ARGUMENT", "probe_service must be a boolean", {
      probe_service: record.probe_service,
    });
  }

  const discovered = discoverTrackerRuntime(options);
  if (!discovered.ok) {
    return discovered;
  }
  return { ...discovered, service: null };
}

export async function runTrackerStatusWithService(args: unknown, client: ServiceClient, options: DiscoverOptions = {}) {
  const result = runTrackerStatus(args, options);
  if (!result.ok) return result;
  if ((args as Record<string, unknown> | null | undefined)?.probe_service === true) {
    const probe = await client.request('status');
    if (!probe.ok) return probe;
  }
  return { ...result, service: client.snapshot() };
}
