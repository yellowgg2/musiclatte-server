import { metadataFields, type MetadataField } from '@musiclatte/contracts';

type AlbumProjectionRow = {
  stage?: unknown;
  error_code?: unknown;
  changed_fields_json?: unknown;
  reflection_json?: unknown;
};

function fields(value: unknown): MetadataField[] | null {
  if (
    !Array.isArray(value) ||
    value.some((field) => typeof field !== 'string' || !metadataFields.includes(field as never))
  )
    return null;
  return value as MetadataField[];
}

/**
 * gonic projects directory-level album metadata from the first track. A verified file whose only
 * remaining mismatch is that album projection may move to its ID3-managed album directory, where
 * organization registration will build the final projection.
 */
export function isOrganizationAlbumProjectionPending(row: AlbumProjectionRow | undefined) {
  if (
    !row ||
    row.stage !== 'reflecting' ||
    row.error_code !== 'reflection_mismatch' ||
    typeof row.changed_fields_json !== 'string' ||
    typeof row.reflection_json !== 'string'
  )
    return false;
  try {
    const changed = fields(JSON.parse(row.changed_fields_json));
    const reflection = JSON.parse(row.reflection_json) as Record<string, unknown>;
    const verified = fields(reflection.fileVerifiedFields);
    const mismatched = fields(reflection.mismatched);
    return (
      !!changed &&
      !!verified &&
      !!mismatched &&
      mismatched.length === 1 &&
      mismatched[0] === 'album' &&
      changed.includes('album') &&
      changed.every((field) => verified.includes(field))
    );
  } catch {
    return false;
  }
}
