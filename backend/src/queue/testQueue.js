import { Queue } from 'bullmq';
import redisClient from '../config/redis.js';

const QUEUE_NAME = 'bughunter-tests';
const REDIS_KEY = 'bughunter:jobs';

const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  ...(redisUrl.password ? { password: redisUrl.password } : {}),
};

// BullMQ queue (for observability / retries)
const testQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Enqueue a test run job.
 * Pushes a raw JSON payload to the Redis list consumed by the Python worker,
 * and also adds a BullMQ job for observability and retry support.
 *
 * @param {string} runId - UUID of the test run
 * @param {string} appUrl - URL of the app to test
 * @param {object|null} credentials - Plaintext login credentials (never ciphertext)
 * @param {object|null} testConfig - Optional test configuration {max_pages, instructions, focus_areas}
 */
export async function enqueueTestRun(runId, appUrl, credentials = null, testConfig = null) {
  const payload = {
    run_id: runId,
    app_url: appUrl,
    credentials,
    test_config: testConfig,
    enqueued_at: new Date().toISOString(),
  };

  // Push to the Python-consumed raw Redis list using the shared persistent connection
  await redisClient.rPush(REDIS_KEY, JSON.stringify(payload));

  // Also add to BullMQ for observability / retries
  await testQueue.add('run-test', payload, {
    jobId: runId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });

  return payload;
}

export default testQueue;
