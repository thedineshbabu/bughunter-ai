import { createClient } from 'redis';
import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)),
  transports: [new transports.Console()],
});

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
