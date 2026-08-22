import type {
  EnrichedTrainerMeta,
  GameState,
  SyncPayload,
} from "../gen4/schemas.ts";

/** Spec section 8: live <=2s, stale <=30s, disconnected beyond. */
export const LIVE_MS = 2_000;
export const STALE_MS = 30_000;

export type SyncStateName = "live" | "stale" | "disconnected";

export function computeSyncState(ageMs: number): SyncStateName {
  if (ageMs <= LIVE_MS) return "live";
  if (ageMs <= STALE_MS) return "stale";
  return "disconnected";
}

interface Snapshot {
  payload: SyncPayload;
  receivedAtMs: number;
}

export interface GameStateStoreOptions {
  /** Injectable clock for tests; real time in production. */
  now?: () => number;
}

/**
 * Memory-only holder of the newest Snapshot (spec section 8).
 * Every valid Sync is an idempotent full-replace; no persistence.
 */
export class GameStateStore {
  #snapshot: Snapshot | null = null;
  readonly #now: () => number;

  constructor(options: GameStateStoreOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
  }

  recordSync(payload: SyncPayload): void {
    this.#snapshot = { payload, receivedAtMs: this.#now() };
  }

  /** Contract-shaped GameState, or null before the first-ever Sync. */
  getGameState(): GameState | null {
    const snap = this.#snapshot;
    if (snap === null) return null;
    const ageMs = Math.max(0, this.#now() - snap.receivedAtMs);
    return {
      receivedAt: new Date(snap.receivedAtMs).toISOString(),
      sync: { state: computeSyncState(ageMs), ageMs },
      // Decoder + enrichment tables land with the decoder ticket; until then
      // Party slots are unknown and location names unresolved.
      slots: [null, null, null, null, null, null],
      trainerMeta: enrichTrainerMeta(snap.payload.trainerMeta),
    };
  }
}

function enrichTrainerMeta(meta: SyncPayload["trainerMeta"]): EnrichedTrainerMeta {
  return { ...meta, locationName: null };
}
