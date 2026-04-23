import React, { useEffect, useState } from 'react';
import type { DashboardSession, DashboardSettings, DashboardReviewerSettings, DashboardReviewCapability } from '@plannotator/shared/dashboard';

interface HomeDashboardProps {
  sessions: DashboardSession[];
  settings: DashboardSettings | null;
  reviewCapabilities: DashboardReviewCapability[];
  onImport: (input: { project: string; plan: string }) => Promise<void>;
  onSaveSettings: (settings: DashboardReviewerSettings) => Promise<void>;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  sessions,
  settings,
  reviewCapabilities,
  onImport,
  onSaveSettings,
}) => {
  const [project, setProject] = useState('');
  const [plan, setPlan] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [importing, setImporting] = useState(false);
  const [reviewer, setReviewer] = useState<DashboardReviewerSettings>(
    settings?.reviewer ?? {
      provider: 'codex',
      model: 'gpt-5.4',
      promptPreset: 'balanced',
      customPrompt: '',
    },
  );

  useEffect(() => {
    if (settings?.reviewer) {
      setReviewer(settings.reviewer);
    }
  }, [settings]);

  const selectedCapability = reviewCapabilities.find((capability) => capability.id === reviewer.provider) ?? null;
  const providerOptions = reviewCapabilities.length > 0
    ? reviewCapabilities
    : [
        { id: 'codex', name: 'Codex', available: true, models: [] },
        { id: 'claude', name: 'Claude', available: true, models: [] },
        { id: 'ollama', name: 'Ollama', available: true, models: [] },
      ];

  const handleFileImport = async (file: File | null) => {
    if (!file) return;
    setPlan(await file.text());
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Plannotator Home</div>
          <h1 className="text-4xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Review incoming plans from supported hosts, import markdown manually for unsupported agents,
            and set the default reviewer used by source review mode.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-medium">Inbox</h2>
                <p className="text-xs text-muted-foreground">Persistent plan sessions, newest first.</p>
              </div>
              <div className="text-xs text-muted-foreground">{sessions.length} session{sessions.length === 1 ? '' : 's'}</div>
            </div>

            <div className="space-y-3">
              {sessions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                  No plan sessions yet. Import a markdown plan on the right or send one from a supported host.
                </div>
              ) : (
                sessions.map((session) => (
                  <a
                    key={session.id}
                    href={`/?session=${encodeURIComponent(session.id)}`}
                    className="block rounded-xl border border-border bg-background/70 p-4 hover:border-primary/40 hover:bg-background transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="font-medium">{session.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {session.project} · {session.origin} · {session.status}
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {new Date(session.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  </a>
                ))
              )}
            </div>
          </section>

          <div className="space-y-6">
            <section className="rounded-2xl border border-border bg-card/60 p-5 space-y-4">
              <div>
                <h2 className="text-lg font-medium">Reviewer Defaults</h2>
                <p className="text-xs text-muted-foreground">Global defaults. Session review can override these later.</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {providerOptions.map((capability) => (
                  <div
                    key={capability.id}
                    className={`rounded-xl border px-3 py-3 ${
                      reviewer.provider === capability.id
                        ? 'border-primary/40 bg-primary/10'
                        : 'border-border bg-background/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{capability.name}</div>
                      <div className={`text-[11px] uppercase tracking-[0.16em] ${
                        capability.available ? 'text-emerald-500' : 'text-amber-500'
                      }`}>
                        {capability.available ? 'Ready' : 'Unavailable'}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {capability.models.length > 0 ? capability.models.slice(0, 2).join(' · ') : 'No detected models'}
                    </div>
                  </div>
                ))}
              </div>

              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Provider</span>
                <select
                  value={reviewer.provider}
                  onChange={(e) => setReviewer((prev) => ({ ...prev, provider: e.target.value as DashboardReviewerSettings['provider'] }))}
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
                  onChange={(e) => setReviewer((prev) => ({ ...prev, model: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Provider-specific model"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Prompt preset</span>
                <select
                  value={reviewer.promptPreset}
                  onChange={(e) => setReviewer((prev) => ({ ...prev, promptPreset: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="balanced">Balanced</option>
                  <option value="strict">Strict</option>
                  <option value="concise">Concise</option>
                  <option value="custom">Custom</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Custom system prompt</span>
                <textarea
                  value={reviewer.customPrompt ?? ''}
                  onChange={(e) => setReviewer((prev) => ({ ...prev, customPrompt: e.target.value }))}
                  className="min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Optional override appended to the preset."
                />
              </label>

              {selectedCapability && (
                <div className={`rounded-xl border px-3 py-3 text-xs ${
                  selectedCapability.available
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-foreground'
                    : 'border-amber-500/20 bg-amber-500/10 text-foreground'
                }`}>
                  <div className="font-medium">
                    {selectedCapability.name} {selectedCapability.available ? 'is available' : 'is not available'}
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
                disabled={savingSettings}
                onClick={async () => {
                  setSavingSettings(true);
                  try {
                    await onSaveSettings(reviewer);
                  } finally {
                    setSavingSettings(false);
                  }
                }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {savingSettings ? 'Saving...' : 'Save Defaults'}
              </button>
            </section>

            <section className="rounded-2xl border border-border bg-card/60 p-5 space-y-4">
              <div>
                <h2 className="text-lg font-medium">Manual Import</h2>
                <p className="text-xs text-muted-foreground">Paste markdown or load a `.md` file for unsupported hosts.</p>
              </div>

              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Project label</span>
                <input
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  placeholder="manual-project"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Markdown file</span>
                <input
                  type="file"
                  accept=".md,.markdown,text/markdown,text/plain"
                  onChange={(e) => void handleFileImport(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted-foreground"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Plan markdown</span>
                <textarea
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  className="min-h-48 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                  placeholder="# Plan title"
                />
              </label>

              <button
                type="button"
                disabled={importing || !plan.trim()}
                onClick={async () => {
                  setImporting(true);
                  try {
                    await onImport({ project: project.trim(), plan });
                  } finally {
                    setImporting(false);
                  }
                }}
                className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {importing ? 'Importing...' : 'Import Plan'}
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
