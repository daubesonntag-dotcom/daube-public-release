import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'AMORA OS', template: '%s · AMORA OS' },
  description: 'Private operating system for AMORA Language & Culture Studio.'
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
