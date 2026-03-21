export function InfoPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel">
      <div className="panel-header"><h3>{title}</h3></div>
      <p className="helper-text">{body}</p>
    </div>
  );
}
