import type { Metadata } from 'next';
import { AmoraClient } from './AmoraClient';

export const metadata: Metadata = {
  title: 'AMORA OS · Language & Culture Studio',
  description: 'Private operations system for AMORA Language & Culture Studio.'
};

export const dynamic = 'force-static';

export default function AmoraPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_AMORA_SUPABASE_URL || '';
  const publishableKey = process.env.NEXT_PUBLIC_AMORA_SUPABASE_PUBLISHABLE_KEY || '';

  return <AmoraClient supabaseUrl={supabaseUrl} publishableKey={publishableKey} />;
}
