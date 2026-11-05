import { Schema, model } from 'mongoose';

/** Infrastructure, not domain data. One document per job. */
const jobLockSchema = new Schema(
  {
    _id: { type: String }, // job name, e.g. 'hold-sweeper'
    lockedBy: { type: String, required: true }, // instance id
    lockedUntil: { type: Date, required: true },
    lastRunAt: { type: Date, default: null }, // /ready checks this (data-model.md D7)
  },
  { collection: 'jobLocks', versionKey: false },
);

export const JobLock = model('JobLock', jobLockSchema);
