import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { anonymous, mockApi, renderAt, signedIn } from '../test/render';

describe('route protection', () => {
  it('redirects signed-out visitors from the app to sign-in (A02)', async () => {
    mockApi({ 'GET /api/auth/me': anonymous });
    const router = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Sign in to Flico' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/signin');
  });

  it('offers Retry when the API cannot be reached', async () => {
    mockApi({ 'GET /api/auth/me': { status: 502, body: null } });
    renderAt('/');
    expect(await screen.findByRole('heading', { name: "Couldn't reach Flico" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('sign-in page', () => {
  it('requests a link and shows the neutral confirmation with the dev outbox hint', async () => {
    const calls = mockApi({
      'GET /api/auth/me': anonymous,
      'POST /api/auth/request-link': {
        status: 200,
        body: { ok: true, devOutbox: true, message: 'If a@example.com has an invitation, a sign-in link is on its way.' },
      },
    });
    renderAt('/signin');
    await userEvent.type(await screen.findByLabelText('Email address'), 'a@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'local outbox' })).toHaveAttribute('href', '/dev/outbox');
    expect(calls.find((c) => c.key === 'POST /api/auth/request-link')?.body).toEqual({ email: 'a@example.com' });
  });

  it('validates an empty email with a visible, announced error', async () => {
    mockApi({ 'GET /api/auth/me': anonymous });
    renderAt('/signin');
    await userEvent.click(await screen.findByRole('button', { name: 'Email me a sign-in link' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your email address.');
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows rate-limit errors from the server', async () => {
    mockApi({
      'GET /api/auth/me': anonymous,
      'POST /api/auth/request-link': { status: 429, body: { error: { code: 'rate_limited', message: 'Too many attempts.' } } },
    });
    renderAt('/signin');
    await userEvent.type(await screen.findByLabelText('Email address'), 'a@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts.');
  });
});

describe('verify page', () => {
  it('requires an explicit click before using the one-time token, then signs in', async () => {
    window.history.replaceState(null, '', '/auth/verify?token=abc123abc123abc123abc123');
    const calls = mockApi({ 'GET /api/auth/me': anonymous, 'POST /api/auth/verify': signedIn() });
    const router = renderAt('/auth/verify?token=abc123abc123abc123abc123');

    const button = await screen.findByRole('button', { name: 'Continue to Flico' });
    expect(calls.some((c) => c.key === 'POST /api/auth/verify')).toBe(false);
    await userEvent.click(button);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(calls.find((c) => c.key === 'POST /api/auth/verify')?.body).toEqual({ token: 'abc123abc123abc123abc123' });
  });

  it('explains a used link and offers a new one (A04)', async () => {
    window.history.replaceState(null, '', '/auth/verify?token=used-token-used-token-used');
    mockApi({
      'GET /api/auth/me': anonymous,
      'POST /api/auth/verify': {
        status: 400,
        body: { error: { code: 'link_used', message: 'This sign-in link has already been used. Please request a new one.' } },
      },
    });
    renderAt('/auth/verify?token=used-token-used-token-used');
    await userEvent.click(await screen.findByRole('button', { name: 'Continue to Flico' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already been used');
    expect(screen.getByRole('link', { name: 'Request a new sign-in link' })).toHaveAttribute('href', '/signin');
  });
});
