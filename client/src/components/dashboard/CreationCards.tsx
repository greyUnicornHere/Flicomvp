import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, FileText, Sparkles } from 'lucide-react';
import { createManualWorkflow } from '../../lib/workflows';

const cardClass =
  'fl-card fl-create-card group relative flex w-full flex-col items-start text-left shadow-none';

/** The two equally prominent ways to start. Hover changes border/background only, never position. */
export function CreationCards() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildManually = async () => {
    setCreating(true);
    setError(null);
    try {
      const workflow = await createManualWorkflow();
      navigate(`/workflows/${workflow.id}`);
    } catch (err) {
      setError(`Couldn't create a workflow. ${(err as Error).message}`);
      setCreating(false);
    }
  };

  return (
    <section aria-label="Create a workflow" className="mt-10">
      <div className="grid grid-cols-2 gap-5">
        <button type="button" className={cardClass} onClick={buildManually} disabled={creating} aria-busy={creating}>
          <CardIcon tone="neutral">
            <FileText size={26} strokeWidth={1.75} aria-hidden="true" />
          </CardIcon>
          <CardText
            title="Build manually"
            description={creating ? 'Creating your workflow…' : 'Start with a blank canvas and map your workflow step by step.'}
          />
        </button>

        <Link to="/create/ai" className={cardClass}>
          <CardIcon tone="brand">
            <Sparkles size={26} strokeWidth={1.75} aria-hidden="true" />
          </CardIcon>
          <CardText title="Create with AI" description="Describe your workflow and let AI create a draft for you." />
        </Link>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[13px] leading-5 text-fl-error">
          {error}
        </p>
      )}
    </section>
  );
}

function CardIcon({ tone, children }: { tone: 'neutral' | 'brand'; children: React.ReactNode }) {
  const toneClass = tone === 'brand' ? 'bg-fl-brand-pale text-fl-brand' : 'bg-[var(--fl-finish-fill)] text-fl-text-secondary';
  return <span className={`grid h-16 w-16 place-items-center rounded-full ${toneClass}`}>{children}</span>;
}

function CardText({ title, description }: { title: string; description: string }) {
  return (
    <>
      <span className="mt-5 block text-[18px] font-bold leading-[26px] text-fl-text">{title}</span>
      <span className="mt-1 block max-w-[420px] pr-10 text-[14px] leading-[22px] text-fl-text-secondary">{description}</span>
      {/* Same position in both cards, regardless of how the description wraps. */}
      <ArrowRight
        size={22}
        aria-hidden="true"
        className="absolute bottom-[34px] right-[30px] text-fl-text-secondary group-hover:text-fl-brand"
      />
    </>
  );
}
