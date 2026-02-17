import { Queue } from 'bullmq';

const QUEUE_NAME = 'bughunter-tests';
const REDIS_KEY = 'bughunter:jobs';

const connection = {
  host: new URL(process.env.REDIS_URL || 'redis://localhost:6379').hostname,
  port: parseInt(new URL(process.env.REDIS_URL || 'redis://localhost:6379').port || '6379'),
};

// BullMQ queue (for advanced features)
const testQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Enqueue a test run job.
 * Also pushes a raw JSON payload to the Redis list consumed by the Python worker.
 *
 * @param {string} runId - UUID of the test run
 * @param {string} appUrl - URL of the app to test
 * @param {object|null} credentials - Optional login credentials
 */
export async function enqueueTestRun(runId, appUrl, credentials = null) {
  const payload = {
    run_id: runId,
    app_url: appUrl,
    credentials,
    enqueued_at: new Date().toISOString(),
  };

  // Push to the Python-consumed raw Redis list
  const { createClient } = await import('redis');
  const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  await redis.connect();
  await redis.rPush(REDIS_KEY, JSON.stringify(payload));
  await redis.quit();

  // Also add to BullMQ for observability / retries
  await testQueue.add('run-test', payload, {
    jobId: runId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });

  return payload;
}

export default testQueue;
