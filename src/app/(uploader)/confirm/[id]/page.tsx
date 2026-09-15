import { Stub } from "@/components/Stub";
// Renders S5 (invoice) or S6+S7 (check with applications) depending on documents.doc_type.
export default function Page({ params }: { params: { id: string } }) {
  return <Stub screen="S5" title={`Confirm — ${params.id}`} phase={1} />;
}
