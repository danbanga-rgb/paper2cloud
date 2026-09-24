import { notFound } from "next/navigation";
import { LabelHelper } from "./LabelHelper";

// Phase 0 labeling helper (S0): photo left, model draft as editable fields right, save to fixtures/labels/.
// Local dev only — it reads the git-ignored fixtures folder, which holds check photos.
export const dynamic = "force-dynamic";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LabelHelper />;
}
