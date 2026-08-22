import { decodePartySlot } from "../gen4/deserialize.ts";
import { PARTY_SIZE } from "../gen4/schemas.ts";
import type {
  EnrichedTrainerMeta,
  GameState,
  PartyMember,
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

export interface IntegrityStats {
  /** Total Torn reads ever collapsed to last-known-good. */
  tornEvents: number;
  /** Party slots that were torn in the most recent Sync (1..6). */
  lastSyncTornSlots: number[];
}

export interface GameStateStoreOptions {
  /** Injectable clock for tests; real time in production. */
  now?: () => number;
}

const EMPTY_SLOTS: readonly (PartyMember | null)[] = Array.from(
  { length: PARTY_SIZE },
  () => null,
);

/**
 * Memory-only holder of the newest decoded Snapshot (spec section 8).
 * Every valid Sync is an idempotent full-replace; no persistence.
 *
 * Torn-read self-heal: a slot whose decode fails keeps its last-known-good
 * member; degradations are counted for the debug surface only.
 */
export class GameStateStore {
  #trainerMeta: EnrichedTrainerMeta | null = null;
  #slots: (PartyMember | null)[] = [...EMPTY_SLOTS];
  #receivedAtMs: number | null = null;
  #tornEvents = 0;
  #lastSyncTornSlots: number[] = [];
  readonly #now: () => number;

  constructor(options: GameStateStoreOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
  }

  recordSync(payload: SyncPayload): void {
    const receivedAtMs = this.#now();
    const nextSlots: (PartyMember | null)[] = [];
    const tornSlots: number[] = [];

    for (let i = 0; i < PARTY_SIZE; i++) {
      const result = decodePartySlot(i + 1, payload.slots[i]!);
      if (result.status === "ok") nextSlots.push(result.member);
      else if (result.status === "empty") nextSlots.push(null);
      else {
        // Torn read: keep serving last-known-good for this slot.
        nextSlots.push(this.#slots[i]!);
        tornSlots.push(i + 1);
      }
    }

    this.#slots = nextSlots;
    this.#trainerMeta = { ...payload.trainerMeta, locationName: null };
    this.#receivedAtMs = receivedAtMs;
    this.#tornEvents += tornSlots.length;
    this.#lastSyncTornSlots = tornSlots;
  }

  /** Contract-shaped GameState, or null before the first-ever Sync. */
  getGameState(): GameState | null {
    if (this.#receivedAtMs === null || this.#trainerMeta === null) return null;
    const ageMs = Math.max(0, this.#now() - this.#receivedAtMs);
    return {
      receivedAt: new Date(this.#receivedAtMs).toISOString(),
      sync: { state: computeSyncState(ageMs), ageMs },
      trainerMeta: this.#trainerMeta,
      slots: this.#slots.slice(0, PARTY_SIZE) as GameState["slots"],
    };
  }

  /** Degradation counters -- debug surface only, never MCP vocabulary. */
  integrity(): IntegrityStats {
    return {
      tornEvents: this.#tornEvents,
      lastSyncTornSlots: [...this.#lastSyncTornSlots],
    };
  }
}
