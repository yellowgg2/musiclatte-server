export const listeningDeliveryStatuses = [
  'not_sent',
  'dispatching',
  'submitted',
  'uncertain',
  'skipped',
] as const;
export type ListeningDeliveryStatus = (typeof listeningDeliveryStatuses)[number];
export interface ListeningEventInput {
  eventId: string;
  songId: string;
  startedAt: string;
  qualifiedAt: string;
  listenedMs: number;
}
export function decodeListeningEvent(value: unknown): ListeningEventInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid listening event');
  const input = value as Record<string, unknown>;
  const fields = ['eventId', 'songId', 'startedAt', 'qualifiedAt'];
  if (
    Object.keys(input).length !== fields.length + 1 ||
    fields.some((field) => typeof input[field] !== 'string') ||
    Object.keys(input).some((key) => ![...fields, 'listenedMs'].includes(key))
  )
    throw new Error('Invalid listening event');
  const event = input as unknown as ListeningEventInput;
  const validTime = (time: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(time) &&
    Number.isFinite(Date.parse(time)) &&
    new Date(time).toISOString() === time.replace(/Z$/, time.includes('.') ? 'Z' : '.000Z');
  if (
    !/^[A-Za-z0-9_-]{22,128}$/.test(event.eventId) ||
    !Number.isSafeInteger(event.listenedMs) ||
    event.listenedMs <= 0 ||
    event.listenedMs > Date.parse(event.qualifiedAt) - Date.parse(event.startedAt) ||
    !event.songId.trim() ||
    event.songId.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(event.songId) ||
    !validTime(event.startedAt) ||
    !validTime(event.qualifiedAt) ||
    Date.parse(event.startedAt) < 0 ||
    Date.parse(event.qualifiedAt) < Date.parse(event.startedAt)
  )
    throw new Error('Invalid listening event');
  return {
    eventId: event.eventId,
    listenedMs: event.listenedMs,
    songId: event.songId,
    startedAt: new Date(event.startedAt).toISOString(),
    qualifiedAt: new Date(event.qualifiedAt).toISOString(),
  };
}
