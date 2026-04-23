import React from 'react';
import type { DashboardReviewComment, DashboardReviewerSettings, DashboardReviewCapability } from '@plannotator/shared/dashboard';

interface PlanSourceReviewProps {
  markdown: string;
  reviewer: DashboardReviewerSettings;
  reviewCapabilities: DashboardReviewCapability[];
  comments: DashboardReviewComment[];
  isRunning: boolean;
  onReviewerChange: (reviewer: DashboardReviewerSettings) => void;
  onRunReview: () => Promise<void>;
  onEditComment: (id: string, patch: Partial<DashboardReviewComment>) => void;
  onDeleteComment: (id: string) => void;
  onClose: () => void;
}

export const PlanSourceReview: React.FC<PlanSourceReviewProps> = ({
  markdown,
  reviewer,
  reviewCapabilities,
  comments,
  isRunning,
  onReviewerChange,
  onRunReview,
  onEditComment,
  onDeleteComment,
  onClose,
}) => {
  const lineMap = React.useMemo(() => {
    const map = new Map<number, DashboardReviewComment[]>();
    for (const comment of comments) {
      const existing = map.get(comment.lineStart) ?? [];
      existing.push(comment);
      map.set(comment.lineStart, existing);
    }
    return map;
  }, [comments]);

  const lines = React.useMemo(() => markdown.split('\n'), [markdown]);
  const providerOptions = reviewCapabilities.length > 0
    ? reviewCapabilities
    : [
        { id: 'codex', name: 'Codex', available: true, models: [] },
        { id: 'claude', name: 'Claude', available: true, models: [] },
        { id: 'ollama', name: 'Ollama', available: true, models: [] },
      ];
  const selectedCapability = providerOptions.find((capability) => capability.id === reviewer.provider) ?? null;

  return (
    <div className="w-full max-w-6xl mx-auto grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
      <section className="rounded-2xl border border-border bg-card/60 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-medium">Source Review</div>
            <div className="text-xs text-muted-foreground">Line-numbered markdown with git-style comments.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Back to Reader
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto bg-background/80">
          <div className="font-mono text-sm">
            {lines.map((line, index) => {
              const lineNo = index + 1;
              const lineComments = lineMap.get(lineNo) ?? [];
              return (
                <div key={lineNo} className="border-b border-border/40">
                  <div className="grid grid-cols-[64px_1fr] gap-4 px-4 py-2">
                    <div className="text-right text-xs text-muted-foreground select-none">{lineNo}</div>
                    <pre className="whitespace-pre-wrap break-words text-foreground">{line || ' '}</pre>
                  </div>
                  {lineComments.length > 0 && (
                    <div className="ml-[84px] mr-4 mb-3 space-y-2">
                      {lineComments.map((comment) => (
                        <div key={`${comment.id}-${lineNo}`} className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <div className="text-xs font-medium text-foreground">
                              {comment.lineStart === comment.lineEnd
                                ? `L${comment.lineStart}`
                                : `L${comment.lineStart}-${comment.lineEnd}`} · {comment.title || 'Line comment'} · {comment.severity || 'comment'}
                            </div>
                            <button
                              type="button"
                              onClick={() => onDeleteComment(comment.id)}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              Delete
                            </button>
                          </div>
                          <input
                            value={comment.title ?? ''}
                            onChange={(e) => onEditComment(comment.id, { title: e.target.value })}
                            className="mb-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                            placeholder="Comment title"
                          />
                          <select
                            value={comment.severity ?? 'important'}
                            onChange={(e) => onEditComment(comment.id, { severity: e.target.value as DashboardReviewComment['severity'] })}
                            className="mb-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                          >
                            <option value="important">Important</option>
                            <option value="nit">Nit</option>
                          </select>
                          <textarea
                            value={comment.text}
                            onChange={(e) => onEditComment(comment.id, { text: e.target.value })}
                            className="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <aside className="rounded-2xl border border-border bg-card/60 p-5 space-y-4 h-fit">
        <div>
          <div className="text-sm font-medium">Reviewer Override</div>
          <div className="text-xs text-muted-foreground">Session-specific override for this plan review run.</div>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Provider</span>
          <select
            value={reviewer.provider}
            onChange={(e) => onReviewerChange({ ...reviewer, provider: e.target.value as DashboardReviewerSettings['provider'] })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {providerOptions.map((capability) => (
              <option key={capability.id} value={capability.id}>
                {capability.name}{capability.available ? '' : ' (Unavailable)'}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Model</span>
          <input
            value={reviewer.model ?? ''}
            onChange={(e) => onReviewerChange({ ...reviewer, model: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder="Override model"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Prompt preset</span>
          <select
            value={reviewer.promptPreset}
            onChange={(e) => onReviewerChange({ ...reviewer, promptPreset: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="balanced">Balanced</option>
            <option value="strict">Strict</option>
            <option value="concise">Concise</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Custom prompt</span>
          <textarea
            value={reviewer.customPrompt ?? ''}
            onChange={(e) => onReviewerChange({ ...reviewer, customPrompt: e.target.value })}
            className="min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder="Optional extra review instructions"
          />
        </label>

        {selectedCapability && (
          <div className={`rounded-xl border px-3 py-3 text-xs ${
            selectedCapability.available
              ? 'border-emerald-500/20 bg-emerald-500/10 text-foreground'
              : 'border-amber-500/20 bg-amber-500/10 text-foreground'
          }`}>
            <div className="font-medium">
              {selectedCapability.name} {selectedCapability.available ? 'is available' : 'is unavailable'}
            </div>
            <div className="mt-1 text-muted-foreground">
              {selectedCapability.models.length > 0
                ? `Detected models: ${selectedCapability.models.join(', ')}`
                : 'No models were detected for this provider.'}
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={isRunning || !!selectedCapability && !selectedCapability.available}
          onClick={() => void onRunReview()}
          className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {isRunning ? 'Reviewing...' : 'Review'}
        </button>

        <div className="rounded-xl border border-border bg-background/70 px-3 py-3 text-xs text-muted-foreground">
          {comments.length === 0
            ? 'No line comments yet. Run a review to generate draft comments.'
            : `${comments.length} draft comment${comments.length === 1 ? '' : 's'} ready to edit before you send feedback.`}
        </div>
      </aside>
    </div>
  );
};
