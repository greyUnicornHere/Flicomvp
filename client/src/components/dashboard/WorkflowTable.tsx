import { useNavigate, Link } from 'react-router';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { WorkflowSummary } from '../../../../shared/api';
import { formatModified, formatModifiedFull } from '../../lib/workflows';
import { Menu } from '../Menu';

type Props = {
  workflows: WorkflowSummary[];
  query: string;
  onRename: (workflow: WorkflowSummary) => void;
  onDelete: (workflow: WorkflowSummary) => void;
};

const statusLabel = { draft: 'Draft', analyzed: 'Analyzed' } as const;

/** Compact list: Name / Status / Last modified / Actions. Clicking a row opens the workflow. */
export function WorkflowTable({ workflows, query, onRename, onDelete }: Props) {
  const navigate = useNavigate();

  return (
    <div className="overflow-hidden rounded-fl-card border border-fl-border bg-fl-surface">
      <table className="fl-table">
        <thead>
          <tr>
            <th scope="col" className="w-[52%] !pl-9">Name</th>
            <th scope="col" className="w-[18%]">Status</th>
            <th scope="col" className="w-[22%]">Last modified</th>
            <th scope="col" className="w-[8%]">
              <span className="fl-sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {workflows.length === 0 ? (
            <tr>
              <td colSpan={4} className="!py-8 text-center text-fl-text-secondary">
                No workflows match “{query.trim()}”.
              </td>
            </tr>
          ) : (
            workflows.map((workflow) => (
              <tr
                key={workflow.id}
                className="cursor-pointer transition-colors duration-[140ms] hover:bg-fl-surface-subtle"
                onClick={() => navigate(`/workflows/${workflow.id}`)}
              >
                <td className="!pl-9 !py-[15px] text-[14px] text-fl-text">
                  <Link
                    to={`/workflows/${workflow.id}`}
                    className="rounded-[4px] hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {workflow.name}
                  </Link>
                </td>
                <td>
                  <span className="fl-badge" data-status={workflow.status === 'draft' ? 'draft' : undefined}>
                    {statusLabel[workflow.status]}
                  </span>
                </td>
                <td className="text-fl-text-secondary">
                  <time dateTime={workflow.updatedAt} title={formatModifiedFull(workflow.updatedAt)}>
                    {formatModified(workflow.updatedAt)}
                  </time>
                </td>
                <td className="!py-1 text-right" onClick={(event) => event.stopPropagation()}>
                  <div className="inline-flex">
                    <Menu
                      label={`Actions for ${workflow.name}`}
                      triggerClassName="grid h-11 w-11 place-items-center rounded-[10px] text-fl-text-secondary hover:bg-fl-brand-pale hover:text-fl-brand"
                      triggerContent={<MoreHorizontal size={20} aria-hidden="true" />}
                      width={180}
                      items={[
                        { label: 'Rename', icon: <Pencil size={16} aria-hidden="true" />, onSelect: () => onRename(workflow) },
                        {
                          label: 'Delete',
                          icon: <Trash2 size={16} aria-hidden="true" />,
                          danger: true,
                          onSelect: () => onDelete(workflow),
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
