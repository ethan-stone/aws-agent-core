export function CopilotPage() {
  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Agents</p>
          <h2>Ops Copilot Workspace</h2>
        </div>
      </header>

      <div className="grid two">
        <article className="panel">
          <h3>Planned backend workflow</h3>
          <ul className="stat-list">
            <li>Client sends prompt to backend API</li>
            <li>Backend authorizes user and builds agent request context</li>
            <li>Backend invokes AgentCore with IAM via SDK</li>
            <li>Structured result is streamed or polled back to the UI</li>
          </ul>
        </article>
        <article className="panel">
          <h3>First agent outputs</h3>
          <ul className="stat-list">
            <li>Incident summary</li>
            <li>Likely root-cause hypotheses</li>
            <li>Recommended remediation plan</li>
            <li>Background remediation escalation status</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
