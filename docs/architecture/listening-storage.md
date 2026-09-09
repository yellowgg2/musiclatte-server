# Web listening storage

Migration021 upgrades schema20 to21. `listening_events` is append only (SQL update/delete guards), source web, with HMAC identity/event/request keys, opaque song ID, epoch-ms times and insertion sequence. It stores no song metadata, paths or credentials. Retention is indefinite for this phase.

`listening_deliveries` is inserted in the same transaction. One compare-and-set changes not_sent to dispatching. Only dispatching can finish submitted or uncertain. Repository construction never takes over live work. The exclusive startup owner must call recoverDispatching after the previous process exits; it marks interrupted attempts uncertain, never retryable. S05 owns this runtime integration and response policy; S13 owns deployment/restore probes. No recording route or background dispatcher is introduced here.

History sorts by sequence descending. Top songs sorts count descending, last qualification descending, then song ID ascending. Both queries bind account, [from,to) and immutable insertion high-water; S05 signs these plus asOf in cursors. Hydration remains the later API page's job. Indexes bound account/history and account/time ranges; aggregation uses local events and a temporary grouping B-tree, without scanning gonic.

Backup validation checks every event, required matching delivery, delivery state/timestamps and orphan records. Normal restore does not dispatch anything; later API/runtime must not replay historical events. Existing management data and flags are preserved.
