import type { ClientSession } from 'mongoose';
import { FOTWSeason } from './schemas';

/** Run inside the same transaction that creates or activates the next season. */
export async function activateSeason(startDate: Date, session: ClientSession, seasonId?: string) {
  // Season filters use inclusive end dates. Stop one millisecond before the
  // new season so a film at its exact start belongs only to the new season.
  await FOTWSeason.updateMany(
    {
      ...(seasonId ? { _id: { $ne: seasonId } } : {}),
      startDate: { $lt: startDate },
      endDate: null,
    },
    { $set: { endDate: new Date(startDate.getTime() - 1), isActive: false } },
    { session }
  );
  await FOTWSeason.updateMany(
    { ...(seasonId ? { _id: { $ne: seasonId } } : {}), isActive: true },
    { $set: { isActive: false } },
    { session }
  );
}
