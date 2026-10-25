import { Link } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../lib/auth';
import { useTitle } from '../lib/useTitle';

/**
 * Milestone 0 signed-in landing page. Deliberately minimal: the real dashboard
 * (two creation cards and recent workflows) is Milestone 1.
 */
export function HomePage() {
  useTitle('');
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="min-h-screen bg-fl-page">
      <AppHeader email={user.email} />
      <main className="fl-container py-12">
        <h1 className="text-[28px] font-bold leading-9 tracking-[-0.025em]">Welcome to Flico</h1>
        <p className="mt-2 text-[14px] leading-[22px] text-fl-text-secondary">
          Signed in as <span className="font-semibold text-fl-text">{user.email}</span>
        </p>

        <section className="fl-card mt-8 max-w-[640px] p-7" aria-labelledby="foundation-heading">
          <h2 id="foundation-heading" className="text-[18px] font-bold leading-[26px]">
            Foundation ready
          </h2>
          <p className="mt-2 text-fl-text-secondary">
            Sign-in, sessions and the app foundation are working. Your dashboard — Build manually, Create with AI and
            your recent workflows — arrives in the next milestone.
          </p>
          <p className="mt-4">
            <Link className="fl-link" to="/status">
              View system status
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
