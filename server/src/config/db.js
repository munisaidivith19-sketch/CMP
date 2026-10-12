import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Connect to MongoDB, retrying transient failures (e.g. Atlas "read ECONNRESET"
 * on a flaky network) before giving up, so one blip doesn't crash the API.
 */
export async function connectDB(
  uri = env.mongoUri,
  { attempts = 5, delayMs = 3000, connect = (u) => mongoose.connect(u, { serverSelectionTimeoutMS: 8000 }) } = {}
) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await connect(uri);
      const { host, port, name } = mongoose.connection;
      console.log(`[db] MongoDB connected (${env.dbTarget}) → ${host}:${port}/${name}`);
      // Build declared indexes (text + compound) so search/filter queries use them.
      await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
      return;
    } catch (err) {
      console.error(`[db] Could not connect to MongoDB (${env.dbTarget}), attempt ${i}/${attempts}:`, err.message);
      if (i < attempts) {
        await mongoose.disconnect().catch(() => {});
        await sleep(delayMs);
      }
    }
  }
  console.error(
    env.dbTarget === 'atlas'
      ? '[db] Check your internet connection and that your IP is on the Atlas Network Access list (or set DB_TARGET=local in server/.env).'
      : '[db] Is MongoDB Community Server running? Check MONGO_URI in server/.env'
  );
  process.exit(1);
}
