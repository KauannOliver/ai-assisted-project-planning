import { Worker } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

console.log('Starting TIC Capacity Engine worker...');
console.log(`Connecting worker to Redis at: ${redisUrl}`);

const worker = new Worker(
  'capacity-engine-queue',
  async (job) => {
    console.log(`[Worker] Processing job ${job.id} of type ${job.name}...`);
    // Placeholder for future engine updates (Modules 09-10)
    return { success: true, processedAt: new Date().toISOString() };
  },
  { connection: redisConnection }
);

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully.`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed with error:`, err);
});
