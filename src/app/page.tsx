import { redirect } from 'next/navigation';

/**
 * The root path has no content of its own.
 *
 * There is nothing public to show: `/` is not in the proxy's `PUBLIC_PATHS`, so an
 * anonymous visitor is redirected to `/login` before this ever renders. Anyone who
 * gets here is signed in, and the archive's front door is the timeline.
 *
 * The redirect is unconditional rather than gated on a session check. That is not
 * an oversight: `/gallery` calls `requireUser()` for itself, so a visitor who
 * somehow arrived without one lands on `/login` anyway — and checking here would be
 * a second copy of a rule that already lives in one place.
 */
export default function Home() {
  redirect('/gallery');
}
