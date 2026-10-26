import { useId, useRef, useState, type FormEvent } from 'react';
import { WORKFLOW_NAME_MAX, type WorkflowSummary } from '../../../../shared/api';
import { Modal } from '../Modal';

type DialogProps = {
  workflow: WorkflowSummary;
  onCancel: () => void;
  onFocusFallback?: () => void;
};

export function RenameDialog({ workflow, onCancel, onConfirm }: DialogProps & { onConfirm: (name: string) => Promise<void> }) {
  const [name, setName] = useState(workflow.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const formId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Please enter a name.');
    if (trimmed.length > WORKFLOW_NAME_MAX) return setError(`Names can be up to ${WORKFLOW_NAME_MAX} characters.`);
    setSaving(true);
    setError(null);
    try {
      await onConfirm(trimmed);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Rename workflow"
      onClose={onCancel}
      initialFocusRef={inputRef}
      footer={
        <>
          <button type="button" className="fl-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" form={formId} className="fl-btn fl-btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="mt-3">
        <label htmlFor={inputId} className="block text-[13px] font-semibold leading-5 text-fl-text">
          Workflow name
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="fl-input mt-2"
          value={name}
          maxLength={WORKFLOW_NAME_MAX + 20}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {error && (
          <p id={errorId} role="alert" className="mt-2 text-[13px] leading-5 text-fl-error">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

export function DeleteDialog({
  workflow,
  onCancel,
  onConfirm,
  onFocusFallback,
}: DialogProps & { onConfirm: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(`Couldn't delete. ${(err as Error).message}`);
      setDeleting(false);
    }
  };

  return (
    <Modal
      title="Delete workflow permanently?"
      onClose={onCancel}
      initialFocusRef={cancelRef}
      onFocusFallback={onFocusFallback}
      footer={
        <>
          <button ref={cancelRef} type="button" className="fl-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="fl-btn border-fl-error bg-fl-error text-white hover:border-fl-error hover:bg-[var(--fl-exception-ink)]"
            onClick={confirm}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : 'Delete permanently'}
          </button>
        </>
      }
    >
      <p>
        <strong className="font-semibold text-fl-text">“{workflow.name}”</strong> and everything saved with it will be
        deleted from Flico. This can't be undone, and there is no trash to restore it from.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-[13px] leading-5 text-fl-error">
          {error}
        </p>
      )}
    </Modal>
  );
}
