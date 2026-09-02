import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { Uploader } from './uploader';

export const metadata: Metadata = { title: 'Upload — The Autistic Journey' };
export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  await requireUser();
  return <Uploader />;
}
