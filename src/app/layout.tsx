import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'The Autistic Journey / Gallery',
  description: 'A private photo archive.',
  // A private archive should never be indexed. This complements the X-Robots-Tag
  // header set for every route in next.config.ts.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
