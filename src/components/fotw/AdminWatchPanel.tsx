'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

type Member = { email: string; name?: string; username?: string };
type Film = {
  _id: string;
  title: string;
  year?: number;
  dateSuggested?: string;
  lockedAt?: string;
  watchedBy: { userEmail: string }[];
};

const inputClass =
  'w-full rounded-lg border border-[#1e1e1e] bg-[#0a0a0a] px-3 py-2.5 text-sm text-white outline-none focus:border-[#40bcf4]';

export default function AdminWatchPanel({ onRecorded }: { onRecorded: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [films, setFilms] = useState<Film[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [newMember, setNewMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [filmSearch, setFilmSearch] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [filmId, setFilmId] = useState('');
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function loadOptions() {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/fotw/admin/watches', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not load members and films.');
      setMembers(data.members);
      setFilms(data.films);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load members and films.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOptions();
  }, []);

  const member = members.find((m) => m.email.toLowerCase() === email.trim().toLowerCase());
  const film = films.find((f) => f._id === filmId);
  const alreadyWatched = film?.watchedBy.some(
    (w) => w.userEmail.toLowerCase().trim() === email.toLowerCase().trim()
  );
  const visibleMembers = members.filter(
    (m) =>
      m.email === email ||
      `${m.name || ''} ${m.username || ''} ${m.email}`
        .toLowerCase()
        .includes(memberSearch.toLowerCase())
  );
  const visibleFilms = films.filter(
    (f) =>
      f._id === filmId ||
      `${f.title} ${f.year || ''}`.toLowerCase().includes(filmSearch.toLowerCase())
  );

  async function recordWatch(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/fotw/admin/watches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filmId, email, name: member?.name || name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not record the watch.');
      setMessage({ error: false, text: data.message });
      await loadOptions();
      onRecorded();
    } catch (error) {
      setMessage({
        error: true,
        text: error instanceof Error ? error.message : 'Could not record the watch.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="mb-12 rounded-2xl border border-[#1e1e1e] bg-[#0f0f0f] p-6"
      aria-labelledby="record-watch-heading"
    >
      <h2
        id="record-watch-heading"
        className="flex items-center gap-2 text-sm font-semibold text-white"
      >
        <Check size={18} /> Record a watch
      </h2>
      <p className="mt-2 mb-5 text-sm text-[#8a9bb0]">
        Add a member’s watch for any current or previous film. Film totals, watch history,
        leaderboard counts, and streaks update together.
      </p>
      {message && (
        <p
          role={message.error ? 'alert' : 'status'}
          className={`mb-4 rounded-lg p-3 text-sm ${message.error ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}
        >
          {message.text}
        </p>
      )}
      {loadError ? (
        <div role="alert" className="text-sm text-red-400">
          {loadError}{' '}
          <button type="button" onClick={loadOptions} className="underline">
            Retry
          </button>
        </div>
      ) : loading ? (
        <p role="status" className="flex items-center gap-2 text-sm text-[#8a9bb0]">
          <Loader2 size={16} className="animate-spin" /> Loading members and films…
        </p>
      ) : (
        <form onSubmit={recordWatch} className="space-y-5">
          <fieldset disabled={saving} className="space-y-5 disabled:opacity-60">
            <div className="flex gap-4 text-sm text-[#8a9bb0]">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="watch-member-mode"
                  checked={!newMember}
                  onChange={() => {
                    setNewMember(false);
                    setEmail('');
                    setMessage(null);
                  }}
                />{' '}
                Existing member
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="watch-member-mode"
                  checked={newMember}
                  onChange={() => {
                    setNewMember(true);
                    setEmail('');
                    setMessage(null);
                  }}
                />{' '}
                New member
              </label>
            </div>
            {newMember ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2 text-sm text-[#8a9bb0] block">
                  Name
                  <input
                    required
                    maxLength={120}
                    className={inputClass}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setMessage(null);
                    }}
                    autoComplete="off"
                  />
                </label>
                <label className="space-y-2 text-sm text-[#8a9bb0] block">
                  Email
                  <input
                    required
                    type="email"
                    maxLength={254}
                    className={inputClass}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setMessage(null);
                    }}
                    autoComplete="off"
                  />
                </label>
                <p className="sm:col-span-2 text-xs text-[#8a9bb0]">
                  Use the email they sign in with so their watch history follows their account.{' '}
                  {member &&
                    `This email belongs to ${member.username || member.name}; their existing account will be used.`}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor="watch-member-search" className="text-sm text-[#8a9bb0]">
                  Member
                </label>
                <input
                  id="watch-member-search"
                  type="search"
                  placeholder="Search by name, username, or email"
                  className={inputClass}
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
                <select
                  aria-label="Choose a member"
                  required
                  className={inputClass}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setMessage(null);
                  }}
                >
                  <option value="">Choose a member</option>
                  {visibleMembers.map((m) => (
                    <option key={m.email} value={m.email}>
                      {m.username || m.name || m.email} — {m.email}
                    </option>
                  ))}
                </select>
                {!visibleMembers.length && (
                  <p className="text-xs text-[#8a9bb0]">
                    No matching members. Choose “New member” to add someone.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor="watch-film-search" className="text-sm text-[#8a9bb0]">
                Film
              </label>
              <input
                id="watch-film-search"
                type="search"
                placeholder="Search films by title or release year"
                className={inputClass}
                value={filmSearch}
                onChange={(e) => setFilmSearch(e.target.value)}
              />
              <select
                aria-label="Choose a film"
                required
                className={inputClass}
                value={filmId}
                onChange={(e) => {
                  setFilmId(e.target.value);
                  setMessage(null);
                }}
              >
                <option value="">Choose a film</option>
                {visibleFilms.map((f) => (
                  <option key={f._id} value={f._id}>
                    {f.title}
                    {f.year ? ` (${f.year})` : ''} — {f.lockedAt ? 'Previous' : 'Current'}
                    {f.dateSuggested
                      ? ` · ${new Date(f.dateSuggested).toLocaleDateString('en-IN')}`
                      : ''}
                  </option>
                ))}
              </select>
              {!visibleFilms.length && <p className="text-xs text-[#8a9bb0]">No matching films.</p>}
            </div>
            {alreadyWatched ? (
              <p role="status" className="text-sm text-[#40bcf4]">
                This member has already watched this film. No changes needed.
              </p>
            ) : (
              film &&
              email && (
                <p className="text-sm text-[#8a9bb0]">
                  Record{' '}
                  <span className="text-white">
                    {member?.username || member?.name || name || email}
                  </span>{' '}
                  as having watched <span className="text-white">{film.title}</span>.
                </p>
              )
            )}
            <button
              type="submit"
              disabled={
                saving || !filmId || !email || (newMember && !name.trim()) || alreadyWatched
              }
              className="flex items-center gap-2 rounded-lg bg-[#00e054] px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {saving ? 'Recording…' : 'Record watch'}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
