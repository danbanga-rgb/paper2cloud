import { redirect } from "next/navigation";
// Role-based landing: uploaders → capture home, owner → dashboard. Implemented in Phase 1 with auth.
export default function Index() {
  redirect("/capture");
}
