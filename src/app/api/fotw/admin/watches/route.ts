import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import mongoose from 'mongoose';
import dbConnect from '@/lib/dbConnect';
import { authOptions } from '@/lib/auth';
import { FOTW_ADMINS } from '@/lib/fotwConfig';
import { FOTWFilm, FOTWUser } from '@/lib/fotw/schemas';
import { isValidWatchRating, recordAdminWatch } from '@/lib/fotw/recordAdminWatch';

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
  const hasRating = body?.rating !== undefined && body?.rating !== null;
  if (hasRating && !isValidWatchRating(body.rating)) {
    return NextResponse.json(
      { message: 'Choose a rating from 0.5 to 5 stars in half-star steps.' },
      { status: 400 }
    );
  }
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
    const result = await recordAdminWatch({
      filmId: body.filmId,
      email,
      name,
      rating: body.rating,
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
