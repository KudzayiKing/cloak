/*
 * Execution routing types (spec §6 Layer 4).
 */

import type { ExecutionRoute } from "@/lib/cloak/types";

export interface RouteDecision {
  route: ExecutionRoute;
  /** Why the orchestrator chose this route — surfaced in processing details. */
  reason: string;
}
