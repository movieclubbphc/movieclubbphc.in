import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const help = `Record a FOTW watch directly in MongoDB (no deployment needed).

Usage:
  npm run fotw:watch
  npm run fotw:watch -- "Person Name" "Film Title" [rating]
  npm run fotw:watch -- "New Person" "Film Title" 4.5 --email person@example.com
  npm run fotw:watch -- "Person Name" "Film Title" --dry-run

Rating: optional, 0.5–5 in half-star steps. Omit to keep the existing rating.
Matches existing names/usernames and film titles, or an exact email/film ID.
Ambiguous matches prompt for selection in an interactive terminal.
New members require their real sign-in email; the script prompts if needed.
Loads MONGODB_URI from the environment, .env.local, or .env (in that order).
--dry-run resolves inputs and previews the change without writing anything.
`;

const { values, positionals } = parseArgs({
  options: {
    email: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
});

let prompt: ReturnType<typeof createInterface> | undefined;
async function ask(question: string) {
  if (!stdin.isTTY)
    throw new Error(
      `Missing input: ${question.trim()} Supply it as an argument in a non-interactive terminal.`
    );
  prompt ??= createInterface({ input: stdin, output: stdout });
  return (await prompt.question(question)).trim();
}

async function choose<T>(items: T[], label: (item: T) => string, kind: string): Promise<T> {
  if (items.length === 1) return items[0];
  console.log(`Multiple ${kind} matches:`);
  items.forEach((item, i) => console.log(`  ${i + 1}. ${label(item)}`));
  if (!stdin.isTTY)
    throw new Error(`Ambiguous ${kind}. Use an exact email or film ID from the list.`);
  while (true) {
    const value = await ask(`Choose ${kind} number: `);
    if (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= items.length) {
      return items[Number(value) - 1];
    }
    console.log('Enter one of the listed numbers.');
  }
}

const normalized = (value: string) => value.trim().toLowerCase();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function main() {
  if (values.help) {
    console.log(help);
    return;
  }
  if (positionals.length > 3)
    throw new Error(`Expected person, film, and optional rating.\n${help}`);
  const interactive = positionals.length === 0;
  const personInput = (positionals[0] || (await ask('Person name: '))).trim();
  const filmInput = (positionals[1] || (await ask('Film title: '))).trim();
  const ratingInput = (
    positionals[2] ?? (interactive ? await ask('Rating 0.5–5 (Enter to skip): ') : '')
  ).trim();
  if (!personInput || !filmInput) throw new Error('Person name and film are required.');
  if (personInput.length > 254 || filmInput.length > 500)
    throw new Error('Name or film search is too long.');
  const rating = ratingInput ? Number(ratingInput) : undefined;

  // Dynamic imports below ensure env is loaded before dbConnect reads its URI.
  const root = fileURLToPath(new URL('../', import.meta.url));
  dotenv.config({ path: [resolve(root, '.env.local'), resolve(root, '.env')], quiet: true });
  if (!process.env.MONGODB_URI)
    throw new Error('Set MONGODB_URI in .env.local, .env, or your shell.');
  const { recordAdminWatch, isValidWatchRating } = await import('../src/lib/fotw/recordAdminWatch');
  if (rating !== undefined && !isValidWatchRating(rating)) {
    throw new Error('Rating must be 0.5–5 in half-star steps.');
  }
  const { FOTWUser, FOTWFilm, FOTWRating } = await import('../src/lib/fotw/schemas');
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: false,
    autoCreate: false,
  });

  const memberQuery = (values.email || personInput).trim();
  const search = new RegExp(escapeRegex(memberQuery), 'i');
  const users = await FOTWUser.find(
    values.email
      ? { email: new RegExp(`^${escapeRegex(memberQuery)}$`, 'i') }
      : { $or: [{ name: search }, { username: search }, { email: search }] }
  )
    .select('name username email')
    .sort({ name: 1 })
    .lean();
  const exactUsers = users.filter((u) =>
    [u.name, u.username, u.email].some((v) => v && normalized(v) === normalized(memberQuery))
  );
  const memberChoices = exactUsers.length ? exactUsers : users;
  const member = memberChoices.length
    ? await choose(
        memberChoices,
        (u) =>
          `${u.name || u.username || 'Unnamed'}${u.username ? ` (@${u.username})` : ''} <${u.email}>`,
        'member'
      )
    : null;
  let email = member?.email || values.email?.trim().toLowerCase() || '';
  if (!member && !email) {
    console.log(`No member matches "${personInput}". A new member needs their sign-in email.`);
    email = normalized(await ask('New member email: '));
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error('A valid email is required.');
  const name = member?.name || personInput;
  if (!member && name.length > 120)
    throw new Error('New member name must be at most 120 characters.');
  // If a prompted email already belongs to someone, use that account explicitly.
  const existingByEmail = !member
    ? await FOTWUser.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') }).lean()
    : member;
  if (existingByEmail) email = existingByEmail.email;

  const filmQuery = mongoose.isObjectIdOrHexString(filmInput)
    ? { _id: filmInput }
    : { title: new RegExp(escapeRegex(filmInput), 'i') };
  const films = await FOTWFilm.find(filmQuery)
    .select('title year dateSuggested lockedAt watchedBy')
    .sort({ dateSuggested: -1 })
    .lean();
  if (!films.length)
    throw new Error(`No FOTW film matches "${filmInput}". Add the film to FOTW first.`);
  const exactFilms = films.filter((f) => normalized(f.title) === normalized(filmInput));
  const film = await choose(
    exactFilms.length ? exactFilms : films,
    (f) =>
      `${f.title} (${f.year || 'year unknown'}) · ${f.dateSuggested?.toISOString().slice(0, 10) || 'undated'} · ID ${f._id}`,
    'film'
  );
  const alreadyWatched = film.watchedBy.some((w) => normalized(w.userEmail) === normalized(email));
  const existingRating = await FOTWRating.findOne({ filmId: film._id, userEmail: email }).lean();
  console.log(
    `\nMember: ${existingByEmail?.name || name} <${email}>${existingByEmail ? '' : ' (new member)'}`
  );
  console.log(`Film: ${film.title} (${film.year || 'year unknown'}) [${film._id}]`);
  console.log(
    `Watch: ${alreadyWatched ? 'already recorded; watch counts stay the same' : 'add watch and update totals/streaks'}`
  );
  console.log(
    `Rating: ${rating !== undefined ? `${rating}/5${existingRating ? ` (replaces ${existingRating.rating}/5)` : ''}` : `unchanged${existingRating ? ` (${existingRating.rating}/5)` : ' (unrated)'}`}`
  );
  if (values['dry-run']) {
    console.log('\nDry run: no database changes made.');
    return;
  }
  const result = await recordAdminWatch({ filmId: film._id.toString(), email, name, rating });
  if (!result || result.status !== 200)
    throw new Error(result?.message || 'Could not record the watch.');
  console.log(`\n${result.message}`);
}

try {
  await main();
} catch (error) {
  // Never print connection strings or driver errors that might contain credentials.
  const message = error instanceof Error ? error.message : 'Unexpected error';
  console.error(
    message.includes('mongodb') || message.includes('://')
      ? 'Database operation failed. Check connectivity, credentials, and transaction support.'
      : message
  );
  process.exitCode = 1;
} finally {
  prompt?.close();
  await mongoose.disconnect();
}
