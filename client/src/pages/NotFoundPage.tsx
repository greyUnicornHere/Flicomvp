import { Link } from 'react-router';
import { FullPageMessage } from '../components/FullPageMessage';
import { useTitle } from '../lib/useTitle';

export function NotFoundPage() {
  useTitle('Page not found');
  return (
    <FullPageMessage title="Page not found">
      <p className="mt-2 text-fl-text-secondary">This page doesn't exist or you don't have access to it.</p>
      <Link to="/" className="fl-btn fl-btn-primary mt-6">
        Go to Flico
      </Link>
    </FullPageMessage>
  );
}
