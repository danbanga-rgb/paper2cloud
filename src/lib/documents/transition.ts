/**
 * The only way server code changes `documents.status`: checks the §8 state machine, updates with
 * optimistic concurrency (status must still be `from`), and writes the audit log (SPEC §12).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertTransition, type Actor, type DocStatus } from "../contracts/status";

export async function transition(
  db: SupabaseClient,
  documentId: string,
  from: DocStatus,
  to: DocStatus,
  actor: Actor,
  actorId: string | null,
  note?: Record<string, unknown>,
): Promise<void> {
  assertTransition(from, to, actor);
  const { data, error } = await db
    .from("documents")
    .update({ status: to })
    .eq("id", documentId)
    .eq("status", from)
    .select("id");
  if (error) throw new Error(`status update failed: ${error.message}`);
  if (!data || data.length !== 1) throw new Error(`document ${documentId} was not in status ${from}`);
  await audit(db, actorId, "status_change", "document", documentId, { from, to, actor, ...note });
}

export async function audit(
  db: SupabaseClient,
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string,
  diff: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("audit_log").insert({ actor_id: actorId, action, entity, entity_id: entityId, diff });
  if (error) throw new Error(`audit log failed: ${error.message}`);
}
