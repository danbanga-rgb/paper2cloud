import { Stub } from "@/components/Stub";
// kind ∈ invoice | check | other. Multi-page for invoice; multi-check per image for check.
export default function Page({ params }: { params: { kind: string } }) {
  return <Stub screen="S2" title={`Capture — ${params.kind}`} phase={1} />;
}
