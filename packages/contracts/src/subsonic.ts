/** Server-only reusable credential; never expose to a browser or log as a harmless hash. */
export interface SubsonicTokenProof {
  readonly username: string;
  readonly t: string;
  readonly s: string;
}
/** Entity IDs remain opaque strings. Only numeric music-folder IDs are normalized at decoding. */
export type SubsonicId = string;
export interface SubsonicIdentity {
  username: string;
  adminRole: boolean;
}
export interface SubsonicPing {
  status: 'ok';
  version: string;
}
export interface MusicFolder {
  id: SubsonicId;
  name: string;
}
export interface MusicEntry {
  id: SubsonicId;
  title: string;
  isDir: boolean;
  parent?: SubsonicId;
  albumId?: SubsonicId;
  artistId?: SubsonicId;
  coverArt?: SubsonicId;
  album?: string;
  artist?: string;
  contentType?: string;
  suffix?: string;
  starred?: string;
  duration?: number;
  bitRate?: number;
  size?: number;
  track?: number;
  year?: number;
}
export interface MusicAlbum {
  id: SubsonicId;
  name: string;
  artist?: string;
  artistId?: SubsonicId;
  coverArt?: SubsonicId;
  songCount?: number;
  duration?: number;
  year?: number;
  song: MusicEntry[];
}
export interface MusicArtist {
  id: SubsonicId;
  name: string;
  coverArt?: SubsonicId;
  albumCount?: number;
  album: MusicAlbum[];
}
export interface MusicIndexes {
  lastModified?: number;
  ignoredArticles?: string;
  index: Array<{ name: string; artist: MusicArtist[] }>;
}
export interface MusicDirectory {
  id: SubsonicId;
  name: string;
  parent?: SubsonicId;
  child: MusicEntry[];
}
export interface MusicSearchResult {
  artist: MusicArtist[];
  album: MusicAlbum[];
  song: MusicEntry[];
}
export type SubsonicErrorKind =
  | 'invalid_configuration'
  | 'invalid_request'
  | 'invalid_response'
  | 'authentication'
  | 'token_auth_unsupported'
  | 'forbidden'
  | 'not_found'
  | 'protocol_incompatible'
  | 'upstream_error'
  | 'http_error'
  | 'network'
  | 'timeout'
  | 'cancelled';
/** Raw fixture wrapper; payload decoding remains mandatory at the adapter boundary. */
export interface SubsonicEnvelope {
  'subsonic-response': {
    status: 'ok' | 'failed';
    version: string;
    error?: { code: number; message: string };
    [key: string]: unknown;
  };
}
