import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readMetadataConfig } from './metadata/config.js';
import { metadataDirectory } from './metadata/runtime-config.js';
import { createMetadataBackup, restoreMetadataBackup } from './metadata/backup.js';
import { validateSchema, type ManagementDatabase } from './storage/database.js';

try {
  const [action, path, ...extra] = process.argv.slice(2);
  if (!['create', 'restore'].includes(action ?? '') || !path || extra.length) throw new Error();
  const config = readMetadataConfig(process.env);
  if (!config.enabled) throw new Error();
  const management = metadataDirectory(process.env.MANAGEMENT_DIRECTORY, true);
  const privateRoot = metadataDirectory(process.env.METADATA_DATA_ROOT, true);
  const uploadRoot = metadataDirectory(process.env.METADATA_UPLOAD_ROOT, true);
  const keyPath = process.env.CREDENTIAL_KEY_PATH;
  if (!keyPath) throw new Error();
  const fileAccess = {
    musicRoot: config.musicRoot,
    python: config.python,
    helperPath: join(dirname(config.helperPath), 'file_access.py'),
    ...config.policy.limits,
  };
  if (action === 'restore') {
    await restoreMetadataBackup({
      source: path,
      management,
      keyRoot: dirname(keyPath),
      privateRoot,
      uploadRoot,
      fileAccess,
    });
  } else {
    const connection = new DatabaseSync(join(management, 'management.sqlite'), { readOnly: true });
    const database: ManagementDatabase = {
      connection,
      transaction: () => {
        throw new Error('read_only_snapshot');
      },
      close: () => connection.close(),
    };
    try {
      validateSchema(connection);
      await createMetadataBackup({
        database,
        keyPath,
        privateRoot,
        uploadRoot,
        destination: path,
        fileAccess,
      });
    } finally {
      database.close();
    }
  }
  process.stdout.write('metadata_snapshot_verified\n');
} catch {
  process.stderr.write('metadata_snapshot_failed\n');
  process.exitCode = 1;
}
