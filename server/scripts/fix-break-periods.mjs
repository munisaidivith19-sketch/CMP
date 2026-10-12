/**
 * Breaks are not periods. Dry run by default; pass --apply to write.
 *
 *   node scripts/fix-break-periods.mjs          # report only
 *   node scripts/fix-break-periods.mjs --apply  # renumber
 *
 * Class days saved while a break still took a period number
 * (P1 P2 P3 [Break P4] P5 P6) become P1 P2 P3 [Break] P4 P5. Genuine free
 * periods keep their gap. Attendance already taken is never touched — each
 * session keeps the period it was held as. The server also runs this at boot.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { normaliseBreakPeriods } from '../src/services/timetablePeriods.js';

const APPLY = process.argv.includes('--apply');

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
console.log(APPLY ? '── APPLYING ──' : '── DRY RUN (pass --apply to write) ──');
const { days, slots } = await normaliseBreakPeriods({ dryRun: !APPLY, log: console.log });
console.log(days ? `${APPLY ? 'Renumbered' : 'Would renumber'} ${slots} slot(s) on ${days} class day(s)` : 'Nothing to renumber');
await mongoose.disconnect();
