import type { FileRecovery } from './file-store.js';
/** No automatic overwrite is inferred from an ambiguous final-file observation. */
export function classifyMetadataRecovery(recovery: FileRecovery) {
  if (recovery.state === 'file_saved' && recovery.intent?.candidateDigest === recovery.digest)
    return 'receipt' as const;
  if (
    recovery.state === 'preimage' &&
    (!recovery.intent || recovery.intent.preimageDigest === recovery.digest)
  )
    return 'safe_failure' as const;
  return 'manual' as const;
}
