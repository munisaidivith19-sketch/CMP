import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);

export async function connectDB(uri = env.mongoUri) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    const { host, port, name } = mongoose.connection;
    console.log(`[db] MongoDB connected → ${host}:${port}/${name}`);
    // Build declared indexes (text + compound) so search/filter queries use them.
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  } catch (err) {
    console.error('[db] Could not connect to MongoDB:', err.message);
    console.error('[db] Is MongoDB Community Server running? Check MONGO_URI in server/.env');
    process.exit(1);
  }
}
