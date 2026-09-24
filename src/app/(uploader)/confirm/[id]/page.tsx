import { Stub } from "@/components/Stub";
// Renders S5 (invoice) or S6+S7 (check with applications) depending on documents.doc_type.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Stub screen="S5" title={`Confirm — ${id}`} phase={1} />;
}
