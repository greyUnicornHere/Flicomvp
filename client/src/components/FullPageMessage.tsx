import type { ReactNode } from 'react';
import { AuthLayout } from './AuthLayout';

export function FullPageMessage({ title, children, role }: { title: string; children?: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <AuthLayout>
      <div className="fl-card p-8 text-center" role={role}>
        <h1 className="text-[18px] font-bold leading-[26px]">{title}</h1>
        {children}
      </div>
    </AuthLayout>
  );
}
