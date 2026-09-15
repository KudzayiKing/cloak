/*
 * CloudGemmaProvider — explicit, consent-gated cloud fallback (spec §7).
 * The orchestrator only invokes this after the user granted permission for
 * the specific request. The UI must label any cloud-produced answer.
 */

import type {
  GenerationRequest,
  GenerationResult,
  InferenceProvider,
} from "./InferenceProvider";

export class CloudGemmaProvider implements InferenceProvider {
  readonly providerId = "CloudGemmaProvider";

  /** Cloud inference requires an operator-configured endpoint. None is
   *  provisioned by default and none is required for local-first operation. */
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    throw new Error(
      "Cloud fallback is not configured. Cloaq remains fully usable with local-only processing."
    );
  }
}
