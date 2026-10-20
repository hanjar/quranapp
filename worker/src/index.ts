import { createApp } from './app';
import type { Env } from './env';
import { runCleanup } from './housekeeping';

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCleanup(env.DB, Date.now()));
  },
} satisfies ExportedHandler<Env>;
