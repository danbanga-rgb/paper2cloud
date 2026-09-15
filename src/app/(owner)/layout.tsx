import type { ReactNode } from "react";
// Phase 1: server-side role check (owner) — RLS is not enough for route-level gating.
export default function OwnerLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
