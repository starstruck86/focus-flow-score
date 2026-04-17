// ════════════════════════════════════════════════════════════════
// Strategy Core — Library Retrieval Re-export
//
// One canonical entry point for library retrieval across all surfaces.
// The implementation lives next to the orchestrator (it has been the
// shared retrieval since day one). PR #1 just gives chat and future
// callers a single import path under strategy-core/.
//
// Do NOT fork this. If retrieval needs to change, change it in
// libraryRetrieval.ts.
// ════════════════════════════════════════════════════════════════

export { retrieveLibraryContext } from "../strategy-orchestrator/libraryRetrieval.ts";
export type {
  LibraryRetrievalResult,
  RetrievedKI,
  RetrievedPlaybook,
} from "../strategy-orchestrator/types.ts";
