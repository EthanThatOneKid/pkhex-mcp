import { z } from "@hono/zod-openapi";

/**
 * Frozen contracts -- single source of truth.
 * Spec: docs/spec/v0.1.md section 5.
 */

/** Party size is fixed by the games (six slots). */
export const PARTY_SIZE = 6;

export const PlaytimeSchema = z
  .object({
    hours: z.number().int().min(0),
    minutes: z.number().int().min(0).max(59),
    seconds: z.number().int().min(0).max(59),
  })
  .openapi("Playtime");

export const TrainerMetaSchema = z
  .object({
    tid: z.number().int().min(0).max(0xffff),
    sid: z.number().int().min(0).max(0xffff),
    playerName: z.string(),
    playtime: PlaytimeSchema,
    mapId: z.number().int().min(0).max(0xffff),
  })
  .openapi("TrainerMeta");

export const EnrichedTrainerMetaSchema = TrainerMetaSchema.extend({
  locationName: z.string().nullable(),
}).openapi("EnrichedTrainerMeta");

/** One raw party slot as it crosses the wire (spec section 5; ADR-0002). */
export const SyncSlotSchema = z
  .object({
    /** base64 of the slot's 236 bytes at stride 0xEC (316 chars with padding). */
    bytes: z.base64().length(316),
    /** True when the game had transiently decrypted this slot in place. */
    decryptedInPlace: z.boolean(),
  })
  .openapi("SyncSlot");

const syncSlot = SyncSlotSchema;

export const SyncPayloadSchema = z
  .object({
    trainerMeta: TrainerMetaSchema,
    /** Always length 6; emptiness is a decode-time verdict, not a wire one. */
    slots: z.tuple([
      syncSlot,
      syncSlot,
      syncSlot,
      syncSlot,
      syncSlot,
      syncSlot,
    ]),
  })
  .openapi("SyncPayload");

export const StatusConditionSchema = z
  .enum(["psn", "brn", "par", "slp", "frz"])
  .openapi("StatusCondition");

export const MoveSlotSchema = z
  .object({
    moveId: z.number().int().min(0),
    moveName: z.string(),
    ppCur: z.number().int().min(0),
    ppMax: z.number().int().min(1),
  })
  .openapi("MoveSlot")
  .nullable();

export const StatsSchema = z
  .object({
    attack: z.number().int().min(0),
    defense: z.number().int().min(0),
    spAttack: z.number().int().min(0),
    spDefense: z.number().int().min(0),
    speed: z.number().int().min(0),
  })
  .openapi("Stats");

export const PartyMemberSchema = z
  .object({
    slot: z.number().int().min(1).max(6),
    /** u32 identity. */
    pid: z.number().int().min(0).max(0xffffffff),
    speciesId: z.number().int().min(0),
    speciesName: z.string(),
    types: z.array(z.string()).min(1).max(2),
    level: z.number().int().min(1).max(100),
    hpCur: z.number().int().min(0),
    hpMax: z.number().int().min(1),
    statusCondition: StatusConditionSchema.nullable(),
    statusDetail: z.number().int().min(0).nullable(),
    natureName: z.string(),
    heldItemId: z.number().int().min(0).nullable(),
    itemName: z.string().nullable(),
    abilityName: z.string(),
    moves: z.tuple([
      MoveSlotSchema,
      MoveSlotSchema,
      MoveSlotSchema,
      MoveSlotSchema,
    ]),
    stats: StatsSchema,
  })
  .openapi("PartyMember");

export const SyncHealthSchema = z
  .object({
    state: z.enum(["live", "stale", "disconnected"]),
    ageMs: z.number().int().min(0),
  })
  .openapi("SyncHealth");

const partyMemberOrNull = PartyMemberSchema.nullable();

export const GameStateSchema = z
  .object({
    receivedAt: z.iso.datetime(),
    sync: SyncHealthSchema,
    trainerMeta: EnrichedTrainerMetaSchema,
    slots: z.tuple([
      partyMemberOrNull,
      partyMemberOrNull,
      partyMemberOrNull,
      partyMemberOrNull,
      partyMemberOrNull,
      partyMemberOrNull,
    ]),
  })
  .openapi("GameState");

export type Playtime = z.infer<typeof PlaytimeSchema>;
export type TrainerMeta = z.infer<typeof TrainerMetaSchema>;
export type EnrichedTrainerMeta = z.infer<typeof EnrichedTrainerMetaSchema>;
export type SyncSlot = z.infer<typeof SyncSlotSchema>;
export type SyncPayload = z.infer<typeof SyncPayloadSchema>;
export type StatusCondition = z.infer<typeof StatusConditionSchema>;
export type MoveSlot = z.infer<typeof MoveSlotSchema>;
export type Stats = z.infer<typeof StatsSchema>;
export type PartyMember = z.infer<typeof PartyMemberSchema>;
export type SyncHealth = z.infer<typeof SyncHealthSchema>;
export type GameState = z.infer<typeof GameStateSchema>;
