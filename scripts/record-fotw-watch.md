# Record a FOTW watch from the terminal

Run from the repository root with dependencies installed. This connects directly
to MongoDB; it does not require a running website or a Vercel deployment.
It uses `MONGODB_URI` from your shell, `.env.local`, or `.env`, in that order.
Use the production database URI to update the live site's data.

```sh
# Interactive: asks for person, film, and optional rating
npm run fotw:watch

# Record a watch and a rating
npm run fotw:watch -- "Person Name" "Film Title" 4.5

# Record only the watch; any existing rating stays unchanged
npm run fotw:watch -- "Person Name" "Film Title"

# Preview without writing
npm run fotw:watch -- "Person Name" "Film Title" 4.5 --dry-run

# Create a new member using their actual sign-in email
npm run fotw:watch -- "New Person" "Film Title" 4 --email person@example.com
```

Names match existing members by name or username. Film titles match existing
FOTW editions, including previous films. Exact matches take priority; multiple
matches prompt you to select a member or edition. In a non-interactive shell,
use an exact email and film ID to resolve ambiguity. If no member matches, the
script asks for their sign-in email so their history follows their account.
`--email` explicitly selects an account by email instead of searching by name.
The script does not create films.

Ratings range from 0.5 to 5 in half-star steps. A supplied rating replaces that
person's rating for the film. Repeating a command does not add another watch or
increase watch counts again. Leaving out the rating preserves the existing one.

The script and admin dashboard use the same transaction to update the film's
watcher list/count, member watch counters, streaks, latest watched edition, and
optional rating. Previous films, leaderboard views, profiles, rating averages,
and badges read these existing records. Imported member totals are preserved.
MongoDB must support transactions (Atlas or a replica set).

You can also run it directly without npm:

```sh
node --import tsx scripts/record-fotw-watch.ts "Person Name" "Film Title" 4.5
```

Use `npm run fotw:watch -- --help` for usage. Changes appear when the website
next fetches its data; reload an already-open page to see them.
