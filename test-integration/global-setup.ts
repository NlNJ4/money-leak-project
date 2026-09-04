// Global setup: wipe the throwaway stack once before all integration
// files. Env guard runs first via the imported module.
import { wipeLocalData } from "./helpers";

export default async function setup(): Promise<void> {
  await wipeLocalData();
}

export const teardown = wipeLocalData;
