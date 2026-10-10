// Re-mounts on every navigation, so each page's content fades and rises in
// once (see .page-enter in globals.css; skipped under reduced motion).
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
