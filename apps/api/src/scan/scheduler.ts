import type { ScanSettings, ScanSettingsRequest, SubsonicTokenProof } from '@musiclatte/contracts';
import type { ManagementDatabase } from '../storage/database.js';
import type { CredentialVault } from '../security/credential-vault.js';
import type { SubsonicClient } from '../subsonic/client.js';
import { upstreamError } from '../auth/session-service.js';
export interface ScanOptions {
  database: ManagementDatabase;
  vault: CredentialVault;
  clock: () => number;
  policyRevision: () => number;
  allowed: () => boolean;
  client: (
    proof: SubsonicTokenProof,
  ) => Pick<SubsonicClient, 'currentUser' | 'getScanStatus' | 'startScan'>;
}
const context = 'global-scan-schedule';
export function createScanScheduler(options: ScanOptions) {
  const db = options.database.connection;
  const row = () => db.prepare('SELECT * FROM scan_schedule WHERE singleton=1').get()!;
  let pending: Promise<void> | undefined;
  const abort = new AbortController();
  function read(): ScanSettings {
    const v = row();
    return {
      schemaVersion: 1,
      enabled: v.enabled === 1,
      intervalMinutes: Number(v.interval_minutes),
      nextRunAt: v.next_run_at as number | null,
      lastStartedAt: v.last_started_at as number | null,
      lastError: v.last_error as ScanSettings['lastError'],
    };
  }
  function update(input: ScanSettingsRequest, proof: SubsonicTokenProof) {
    if (
      typeof input.enabled !== 'boolean' ||
      !Number.isInteger(input.intervalMinutes) ||
      input.intervalMinutes < 15 ||
      input.intervalMinutes > 10080
    )
      throw new Error('Invalid scan schedule');
    db.prepare(
      'UPDATE scan_schedule SET enabled=?,interval_minutes=?,next_run_at=?,encrypted_proof=?,policy_revision=?,generation=generation+1,last_error=NULL WHERE singleton=1',
    ).run(
      input.enabled ? 1 : 0,
      input.intervalMinutes,
      input.enabled ? options.clock() + input.intervalMinutes * 60000 : null,
      input.enabled ? options.vault.seal(proof, context) : null,
      options.policyRevision(),
    );
    return read();
  }
  async function run() {
    if (abort.signal.aborted || !options.allowed()) return;
    const at = options.clock();
    const claimed = options.database.transaction(() => {
      const v = row();
      if (v.enabled !== 1 || Number(v.next_run_at) > at || Number(v.lease_until) > at) return null;
      db.prepare('UPDATE scan_schedule SET lease_until=?,next_run_at=? WHERE singleton=1').run(
        at + 60000,
        at + Number(v.interval_minutes) * 60000,
      );
      return v;
    });
    if (!claimed) return;
    try {
      if (claimed.policy_revision !== options.policyRevision()) throw new Error('scan_permission');
      const proof = options.vault.open(String(claimed.encrypted_proof), context);
      const client = options.client(proof);
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]);
      const identity = await client.currentUser({ signal });
      if (identity.username !== proof.username || identity.adminRole !== true)
        throw new Error('scan_permission');
      const status = await client.getScanStatus({ signal });
      const latest = row();
      if (
        abort.signal.aborted ||
        latest.enabled !== 1 ||
        latest.generation !== claimed.generation ||
        !options.allowed()
      )
        return;
      if (!status.scanning) {
        await client.startScan({ signal });
        db.prepare(
          'UPDATE scan_schedule SET last_started_at=?,last_error=NULL WHERE singleton=1 AND generation=?',
        ).run(options.clock(), Number(claimed.generation));
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      const mapped = upstreamError(error);
      const denied =
        (error instanceof Error &&
          ['scan_permission', 'Reauthentication required'].includes(error.message)) ||
        mapped.status === 401 ||
        mapped.status === 403;
      db.prepare(
        'UPDATE scan_schedule SET last_error=?,enabled=CASE WHEN ? THEN 0 ELSE enabled END,encrypted_proof=CASE WHEN ? THEN NULL ELSE encrypted_proof END,next_run_at=CASE WHEN ? THEN NULL ELSE next_run_at END WHERE singleton=1 AND generation=?',
      ).run(
        denied ? 'forbidden' : 'upstream_unavailable',
        +denied,
        +denied,
        +denied,
        Number(claimed.generation),
      );
    } finally {
      db.prepare('UPDATE scan_schedule SET lease_until=0 WHERE singleton=1').run();
    }
  }
  return {
    read,
    update,
    tick() {
      if (!pending)
        pending = run().finally(() => {
          pending = undefined;
        });
      return pending;
    },
    async close() {
      abort.abort();
      await pending;
    },
  };
}
