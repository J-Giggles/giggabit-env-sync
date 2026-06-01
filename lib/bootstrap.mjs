/**
 * Startup sequence for giggabit-env-sync CLI commands.
 */
import { loadRepoEnv } from "./load-repo-env.mjs";
import { applyRepoConfig } from "./repo-config.mjs";
import { assertVercelAuthForRepo } from "./vercel-auth.mjs";
import { assertToolUpToDate } from "./upstream-check.mjs";

/**
 * @param {{ skipUpdateCheck?: boolean; skipAuth?: boolean }} [opts]
 */
export async function bootstrap(opts = {}) {
  loadRepoEnv();
  applyRepoConfig();
  if (!opts.skipAuth) {
    await assertVercelAuthForRepo();
  }
  if (!opts.skipUpdateCheck) {
    const ok = await assertToolUpToDate();
    if (!ok) {
      process.exitCode = 1;
      process.exit(1);
    }
  }
}
