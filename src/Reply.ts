import { Schema } from "effect"

/** Command acknowledgements and subscription deliveries, not finite-query rows. */
export const Reply = Schema.Struct({
  version: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  watch: Schema.optional(Schema.String),
  relative_path: Schema.optional(Schema.String),
  clock: Schema.optional(Schema.String),
  subscribe: Schema.optional(Schema.String),
  unsubscribe: Schema.optional(Schema.String),
  subscription: Schema.optional(Schema.String),
  canceled: Schema.optional(Schema.Boolean),
  is_fresh_instance: Schema.optional(Schema.Boolean),
  files: Schema.optional(Schema.Array(Schema.Struct({
    name: Schema.String, exists: Schema.Boolean, new: Schema.optional(Schema.Boolean),
    type: Schema.optional(Schema.String),
    size: Schema.optional(Schema.NullOr(Schema.Number)),
    mtime_ms: Schema.optional(Schema.NullOr(Schema.Number))
  })))
})
export type Reply = typeof Reply.Type

/** Decode dispatch metadata before selecting the operation-specific schema. */
export const Envelope = Schema.Struct({
  error: Schema.optional(Schema.String),
  subscription: Schema.optional(Schema.String),
  canceled: Schema.optional(Schema.Boolean)
})
export type Envelope = typeof Envelope.Type

export const QueryReply = Schema.Struct({
  clock: Schema.String,
  warning: Schema.optional(Schema.String),
  is_fresh_instance: Schema.optional(Schema.Boolean),
  files: Schema.Array(Schema.Union([Schema.String, Schema.Struct({
    name: Schema.String,
    type: Schema.String,
    size: Schema.optional(Schema.NullOr(Schema.Number)),
    mtime_ms: Schema.optional(Schema.NullOr(Schema.Number))
  })]))
})
export type QueryReply = typeof QueryReply.Type

export const ConfigReply = Schema.Struct({ config: Schema.Struct({
  ignore_dirs: Schema.optional(Schema.Array(Schema.String)),
  ignore_vcs: Schema.optional(Schema.Array(Schema.String))
}) })
export type ConfigReply = typeof ConfigReply.Type
