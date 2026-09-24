import { Stub } from "@/components/Stub";
// kind ∈ invoice | check | other. Multi-page for invoice; multi-check per image for check.
export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return <Stub screen="S2" title={`Capture — ${kind}`} phase={1} />;
}
