/** Placeholder for unimplemented screens. Every route renders one until built; remove as you go. */
export function Stub({ screen, title, phase }: { screen: string; title: string; phase: number }) {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 20 }}>{title}</h1>
      <p>
        Not implemented. Contract: <code>design/screens.md</code> §{screen}. Prototype: <code>design/prototype/index.html#{screen.toLowerCase()}</code>. Phase {phase}.
      </p>
    </main>
  );
}
