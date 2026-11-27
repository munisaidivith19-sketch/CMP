import mongoose from 'mongoose';

const { Schema } = mongoose;

export const ATTENDANCE_FLOWS = ['period', 'day'];

/**
 * The college-wide attendance flow chosen by the Principal (one document,
 * _id 'attendance-flow'). `history` keeps every choice with the class day it
 * starts on, so any past day is always judged by the flow that applied then
 * (edit windows, day-wise copies). No entry = period-wise.
 */
const attendanceFlowSchema = new Schema(
  {
    _id: { type: String, default: 'attendance-flow' },
    history: {
      type: [
        {
          flow: { type: String, enum: ATTENDANCE_FLOWS, required: true },
          // First class day (UTC midnight of the campus date) the flow applies to.
          from: { type: Date, required: true },
          setBy: { type: Schema.Types.ObjectId, ref: 'User' },
          setAt: { type: Date, default: Date.now },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { versionKey: false }
);

export default mongoose.model('AttendanceFlow', attendanceFlowSchema);
