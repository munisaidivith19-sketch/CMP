import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Hourly counters for the SOC overview (requests, 4xx, 5xx, captured errors
 * per source). Each API process keeps its counts in memory and adds them here
 * once a minute ($inc), so several instances add up correctly and a restart
 * loses at most one minute of counts. Kept 35 days.
 */
const socMetricSchema = new Schema(
  {
    hour: { type: Date, required: true }, // start of the UTC hour
    key: { type: String, required: true, maxlength: 60 }, // e.g. "http.total", "http.5xx", "errors.job"
    count: { type: Number, default: 0 },
  },
  { versionKey: false }
);

socMetricSchema.index({ hour: 1, key: 1 }, { unique: true });
socMetricSchema.index({ hour: 1 }, { expireAfterSeconds: 35 * 24 * 3600, name: 'soc_metric_retention' });

export default mongoose.model('SocMetric', socMetricSchema);
