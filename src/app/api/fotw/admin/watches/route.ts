import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import mongoose from 'mongoose';
import dbConnect from '@/lib/dbConnect';
import { authOptions } from '@/lib/auth';
import { FOTW_ADMINS } from '@/lib/fotwConfig';
import { FOTWFilm, FOTWUser } from '@/lib/fotw/schemas';
import { calculateUserStreak } from '@/lib/fotw/streaks';

async function isAdmin() {
  const session = await getServerSession(authOptions);
  return !!session?.user?.email && FOTW_ADMINS.includes(session.user.email);
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  try {
    await dbConnect();
    // Include members with no watches, and every edition regardless of season.
    const [members, films] = await Promise.all([
      FOTWUser.find({}).select('email name username').sort({ name: 1 }).lean(),
      FOTWFilm.find({})
        .select('title year dateSuggested createdAt lockedAt watchedBy.userEmail')
        .sort({ dateSuggested: -1, createdAt: -1 })
        .lean(),
    ]);
    return NextResponse.json({ members, films });
  } catch (error) {
    console.error('[admin/watches] GET error:', error);
    return NextResponse.json({ message: 'Could not load members and films.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    typeof body?.filmId !== 'string' ||
    !mongoose.isObjectIdOrHexString(body.filmId) ||
    name.length > 120
  ) {
    return NextResponse.json(
      { message: 'Choose a film and enter a valid member email (name up to 120 characters).' },
      { status: 400 }
    );
  }

  try {
    await dbConnect();
    // A transaction prevents a partial update between the film and member.
    // MongoDB retries conflicting writes, including two admins adding the same watch.
    const result = await mongoose.connection.transaction(async (session) => {
      const film = await FOTWFilm.findById(body.filmId).session(session);
      if (!film) return { status: 404, message: 'Film not found.' };
      const emailPattern = new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      const user = await FOTWUser.findOne({ email: emailPattern }).session(session);
      if (!user && !name) return { status: 400, message: 'Enter a name for the new member.' };
      // Preserve the existing email so older records and exact-match readers agree.
      const memberEmail = user?.email || email;
      if (film.watchedBy.some((w) => w.userEmail.trim().toLowerCase() === email)) {
        return {
          status: 200,
          alreadyWatched: true,
          message: 'This member has already watched this film.',
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
      return {
        status: 200,
        alreadyWatched: false,
        message: `Recorded ${user?.username || user?.name || name} as having watched ${film.title}.`,
      };
    });
    const { status, ...payload } = result!;
    return NextResponse.json(payload, { status });
  } catch (error) {
    console.error('[admin/watches] POST error:', error);
    return NextResponse.json(
      { message: 'Could not record the watch. Please try again.' },
      { status: 500 }
    );
  }
}
