import mongoose from 'mongoose';
import { FOTWFilm, FOTWUser, FOTWRating } from './schemas';
import { calculateUserStreak } from './streaks';

export function isValidWatchRating(rating: unknown): rating is number {
  return (
    typeof rating === 'number' &&
    Number.isFinite(rating) &&
    rating >= 0.5 &&
    rating <= 5 &&
    Number.isInteger(rating * 2)
  );
}

/** Caller must connect to MongoDB and authorize the admin before calling. */
export async function recordAdminWatch({
  filmId,
  email,
  name,
  rating,
}: {
  filmId: string;
  email: string;
  name: string;
  rating?: number | null;
}) {
  email = email.trim().toLowerCase();
  const hasRating = rating !== undefined && rating !== null;
  if (hasRating && !isValidWatchRating(rating)) {
    throw new Error('Choose a rating from 0.5 to 5 stars in half-star steps.');
  }
  // A transaction prevents a partial update between the film and member.
  // MongoDB retries conflicting writes, including two admins adding the same watch.
  return mongoose.connection.transaction(async (session) => {
    const film = await FOTWFilm.findById(filmId).session(session);
    if (!film) return { status: 404, message: 'Film not found.' };
    const emailPattern = new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const user = await FOTWUser.findOne({ email: emailPattern }).session(session);
    if (!user && !name) return { status: 400, message: 'Enter a name for the new member.' };
    // Preserve the existing email so older records and exact-match readers agree.
    const memberEmail = user?.email || email;
    const saveRating = async () => {
      if (!hasRating) return;
      await FOTWRating.updateOne(
        { userEmail: memberEmail, filmId: film._id },
        { $set: { rating: rating } },
        { upsert: true, runValidators: true, session }
      );
    };
    if (film.watchedBy.some((w) => w.userEmail.trim().toLowerCase() === email)) {
      await saveRating();
      return {
        status: 200,
        alreadyWatched: true,
        message: hasRating
          ? `Saved ${rating}/5 stars for ${user?.username || user?.name || name || memberEmail} on ${film.title}. Their watch was already recorded.`
          : 'This member has already watched this film.',
      };
    }

    film.watchedBy.push({ userEmail: memberEmail, watchedAt: new Date() });
    film.watchedCount = film.watchedBy.length;
    await film.save({ session });

    const allFilms = await FOTWFilm.find({})
      .select('dateSuggested createdAt lockedAt watchedBy')
      .session(session)
      .lean();
    const streaks = calculateUserStreak(allFilms, memberEmail, user?.longestStreak || 0);
    const latestWatchedWeek = allFilms
      .filter((f) => f.watchedBy.some((w) => w.userEmail.trim().toLowerCase() === email))
      .map((f) => f.dateSuggested || f.createdAt)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    await FOTWUser.updateOne(
      user ? { _id: user._id } : { email: memberEmail },
      {
        $set: { ...streaks, lastWatchedWeek: latestWatchedWeek },
        $setOnInsert: { name },
        // Preserve imported/legacy totals, matching the regular watch route.
        $inc: { watchedCount: 1, seasonWatchedCount: 1 },
      },
      { upsert: true, session }
    );
    await saveRating();
    return {
      status: 200,
      alreadyWatched: false,
      message: `Recorded ${user?.username || user?.name || name} as having watched ${film.title}${hasRating ? ` with a rating of ${rating}/5 stars` : ''}.`,
    };
  });
}
