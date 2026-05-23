/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to launch the uptime monitor background loop.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run in the Node.js runtime (not Edge), and only in the actual server
  // process (not during `next build`).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV === 'test') return;

  const { startUptimeCron } = await import('./lib/uptime-cron');
  startUptimeCron();
}
