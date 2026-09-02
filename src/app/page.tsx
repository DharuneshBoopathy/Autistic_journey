/**
 * Placeholder root. Replaced in the gallery phase by the authenticated timeline;
 * unauthenticated visitors will be redirected to /login by middleware.
 */
export default function Home() {
  return (
    <main id="main" style={{ padding: 'var(--space-12)', maxWidth: '42rem', margin: '0 auto' }}>
      <h1
        style={{
          fontSize: 'var(--text-2xl)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wider)',
        }}
      >
        The Autistic Journey
      </h1>
      <p style={{ color: 'var(--ink-50)', marginTop: 'var(--space-2)' }}>
        A private archive. Access is limited to approved batch members.
      </p>
    </main>
  );
}
