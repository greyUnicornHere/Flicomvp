import { Logo } from './Logo';

/** Friendly full-page fallback for unexpected rendering errors. */
export function ErrorFallback() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-fl-page px-6">
      <Logo />
      <div className="fl-card w-full max-w-[460px] p-8" role="alert">
        <h1 className="text-[22px] font-bold leading-8 tracking-[-0.025em]">Something went wrong</h1>
        <p className="mt-2 text-fl-text-secondary">
          Flico ran into an unexpected problem on this screen. Reloading the page usually fixes it.
        </p>
        <div className="mt-6 flex gap-3">
          <button type="button" className="fl-btn fl-btn-primary" onClick={() => window.location.reload()}>
            Reload page
          </button>
          <a className="fl-btn" href="/">
            Go to start
          </a>
        </div>
      </div>
    </main>
  );
}
