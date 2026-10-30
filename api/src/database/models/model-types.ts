import type {
  InferAttributes,
  InferCreationAttributes,
  Model as SequelizeModel,
} from 'sequelize';

/**
 * sequelize-typescript's base Model declares optional `deletedAt` and `version` fields that are not
 * columns in this schema; keep them (and any per-model extras) out of the inferred attribute types.
 */
type BaseOmit = 'deletedAt' | 'version';

/** Attribute type of a model. `Extra` lists base-class fields the table does not have (e.g. 'updatedAt'). */
export type Attrs<
  M extends SequelizeModel,
  Extra extends keyof M = never,
> = InferAttributes<M, { omit: Extract<BaseOmit, keyof M> | Extra }>;

/** Creation attribute type: CreationOptional columns (id, defaults, nullable, timestamps) may be omitted. */
export type CreationAttrs<
  M extends SequelizeModel,
  Extra extends keyof M = never,
> = InferCreationAttributes<M, { omit: Extract<BaseOmit, keyof M> | Extra }>;
