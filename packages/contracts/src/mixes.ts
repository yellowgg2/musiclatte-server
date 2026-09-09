export interface MixConditions {
  musicFolderId?: string;
  genre?: string;
  fromYear?: number;
  toYear?: number;
  size: number;
}
export interface MixInput {
  name: string;
  conditions: MixConditions;
}
export interface SavedMix extends MixInput {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export const mixOperationIdPattern = '^[A-Za-z0-9_-]{22,128}$';
export const mixConditionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    musicFolderId: { type: 'string', minLength: 1, maxLength: 512 },
    genre: { type: 'string', minLength: 1, maxLength: 512 },
    fromYear: { type: 'integer', minimum: 0, maximum: 9999 },
    toYear: { type: 'integer', minimum: 0, maximum: 9999 },
    size: { type: 'integer', minimum: 1, maximum: 500 },
  },
} as const;
export const mixInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'conditions'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    conditions: mixConditionsSchema,
  },
} as const;
export const createMixSchema = {
  ...mixInputSchema,
  required: ['name', 'conditions', 'operationId'],
  properties: {
    ...mixInputSchema.properties,
    operationId: { type: 'string', pattern: mixOperationIdPattern },
  },
} as const;
const expectedRevision = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;
export const updateMixSchema = {
  ...createMixSchema,
  required: ['operationId', 'expectedRevision'],
  anyOf: [{ required: ['name'] }, { required: ['conditions'] }],
  properties: { ...createMixSchema.properties, expectedRevision },
} as const;
export const deleteMixSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['operationId', 'expectedRevision'],
  properties: { operationId: createMixSchema.properties.operationId, expectedRevision },
} as const;
export const savedMixSchema = {
  ...mixInputSchema,
  required: ['id', 'name', 'conditions', 'revision', 'createdAt', 'updatedAt'],
  properties: {
    ...mixInputSchema.properties,
    id: { type: 'string', format: 'uuid' },
    revision: expectedRevision,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;
function invalid(): never {
  throw new Error('Invalid mix');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
export function decodeMixInput(value: unknown): MixInput {
  const source = record(value);
  if (Object.keys(source).some((key) => !['name', 'conditions'].includes(key))) return invalid();
  if (typeof source.name !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(source.name))
    return invalid();
  const name = source.name.trim();
  if ([...name].length < 1 || [...name].length > 100) return invalid();
  const raw = record(source.conditions);
  if (
    Object.keys(raw).some(
      (key) => !['musicFolderId', 'genre', 'fromYear', 'toYear', 'size'].includes(key),
    )
  )
    return invalid();
  const conditions: MixConditions = { size: 50 };
  for (const key of ['musicFolderId', 'genre'] as const) {
    const entry = raw[key];
    if (entry === undefined) continue;
    if (
      typeof entry !== 'string' ||
      !entry.trim() ||
      entry.length > 512 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(entry)
    )
      return invalid();
    conditions[key] = entry;
  }
  for (const key of ['fromYear', 'toYear', 'size'] as const) {
    const entry = raw[key];
    if (entry === undefined) continue;
    if (
      typeof entry !== 'number' ||
      !Number.isSafeInteger(entry) ||
      entry < (key === 'size' ? 1 : 0) ||
      entry > (key === 'size' ? 500 : 9999)
    )
      return invalid();
    conditions[key] = entry;
  }
  if (
    conditions.fromYear !== undefined &&
    conditions.toYear !== undefined &&
    conditions.fromYear > conditions.toYear
  )
    return invalid();
  return { name, conditions };
}
/** Check keys before JSON.parse discards duplicates, including escaped spellings. */
export function parseMixJson(source: string): unknown {
  try {
    const value: unknown = JSON.parse(source);
    const scopes: Array<Set<string> | null> = [];
    for (const match of source.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\]]/g)) {
      const token = match[0];
      if (token === '{') scopes.push(new Set());
      else if (token === '[') scopes.push(null);
      else if (token === '}' || token === ']') scopes.pop();
      else if (/^\s*:/.test(source.slice(match.index! + token.length))) {
        const keys = scopes.at(-1);
        const key: string = JSON.parse(token);
        if (!keys || keys.has(key)) return invalid();
        keys.add(key);
      }
    }
    return value;
  } catch {
    return invalid();
  }
}
