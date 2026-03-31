/**
 * Stale Run Reaper
 * Periodically checks for runs stuck in "running" status whose agent heartbeat
 * has expired, and marks them as "failed". This prevents ghost runs from
 * appearing indefinitely in the UI when the agent process crashes mid-run.
 */

import { query } from '../config/db.js';
import redisClient from '../config/redis.js';
import { logger } from '../index.js';

const REAP_INTERVAL_MS = 60_000; // check every 60 seconds
const STALE_THRESHOLD_S = 90;    // must match agent HEARTBEAT_TTL

let timer = null;

async function reapStaleRuns() {
  try {
    // Find runs that have been "running" for a while
    const result = await query(
      `SELECT id FROM test_runs
       WHERE status = 'running'
         AND started_at < NOW() - INTERVAL '3 minutes'`
    );

    for (const row of result.rows) {
      const runId = row.id;
      const heartbeatKey = `bughunter:heartbeat:${runId}`;

      try {
        const hb = await redisClient.get(heartbeatKey);
        if (hb === null) {
          // No heartbeat at all — agent never started or already crashed
          await markFailed(runId, 'Agent process stopped responding (no heartbeat)');
        } else {
          const age = Math.floor(Date.now() / 1000) - parseInt(hb, 10);
          if (age > STALE_THRESHOLD_S) {
            await markFailed(runId, `Agent heartbeat stale (${age}s since last beat)`);
          }
        }
      } catch (err) {
        logger.warn(`Reaper: failed to check heartbeat for run ${runId}: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error(`Reaper: failed to query stale runs: ${err.message}`);
  }
}

async function markFailed(runId, reason) {
  logger.warn(`Reaper: marking run ${runId} as failed — ${reason}`);
  await query(
    `UPDATE test_runs SET status = 'failed', error = $2, completed_at = NOW()
     WHERE id = $1 AND status = 'running'`,
    [runId, reason]
  );
}

export function startReaper() {
  logger.info('Stale run reaper started');
  timer = setInterval(reapStaleRuns, REAP_INTERVAL_MS);
  // Run once immediately on startup
  reapStaleRuns();
}

export function stopReaper() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
