import mongoose from 'mongoose';

/**
 * Run `fn(session)` inside a MongoDB transaction (Atlas and any replica set),
 * retried by the driver on transient errors. Every write in `fn` must pass
 * `{ session }` to take part.
 *
 * A standalone mongod cannot run transactions; there `fn(null)` runs without
 * one, so local development keeps working. Production (Atlas) is always a
 * replica set, where the writes commit or roll back together.
 */
let supported;

async function transactionsSupported() {
  if (supported !== undefined) return supported;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    supported = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    supported = false;
  }
  return supported;
}

export async function withTransaction(fn) {
  if (!(await transactionsSupported())) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
