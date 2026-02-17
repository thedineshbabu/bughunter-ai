import { createClient } from 'redis';
import { logger } from '../index.js';

const client = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

client.on('error', (err) => {
  logger.error(`Redis client error: ${err.message}`);
});

client.on('connect', () => {
  logger.info('Redis client connected');
});

// Connect eagerly
await client.connect();

export default client;
