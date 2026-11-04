import mongoose from 'mongoose';
import './models';

export async function syncAllIndexes() {
  for (const model of Object.values(mongoose.models)) {
    await model.syncIndexes();
  }
}

export async function diffAllIndexes() {
  for (const model of Object.values(mongoose.models)) {
    console.log(model.modelName, await model.diffIndexes());
  }
}
