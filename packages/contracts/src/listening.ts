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
}
export function decodeListeningEvent(value: unknown): ListeningEventInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid listening event');
  const input = value as Record<string, unknown>;
  const fields = ['eventId', 'songId', 'startedAt', 'qualifiedAt'];
  if (
    Object.keys(input).length !== fields.length ||
    fields.some((field) => typeof input[field] !== 'string') ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new Error('Invalid listening event');
  const event = input as unknown as ListeningEventInput;
  const validTime = (time: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(time) &&
    Number.isFinite(Date.parse(time)) &&
    new Date(time).toISOString() === time.replace(/Z$/, time.includes('.') ? 'Z' : '.000Z');
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      event.eventId,
    ) ||
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
    eventId: event.eventId.toLowerCase(),
    songId: event.songId,
    startedAt: new Date(event.startedAt).toISOString(),
    qualifiedAt: new Date(event.qualifiedAt).toISOString(),
  };
}
