import type { ReactNode } from 'react';
import { Logo } from './Logo';

/** Centered layout for signed-out pages. The logo sits on the warm page background that matches its raster. */
export function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-screen flex-col items-center bg-fl-page px-6 pb-16 pt-[12vh]">
      <Logo width={132} />
      <div className={`mt-10 w-full ${wide ? 'max-w-[720px]' : 'max-w-[440px]'}`}>{children}</div>
    </main>
  );
}
