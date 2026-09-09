# Phase 7 S04 — listening storage

Node24.20.0/npm11.19.0, repository root, base f90a4e5. Implementation complete; schema20→21.

- RED: five storage assertions plus one contract assertion failed for absent boundaries, before production implementation.
- GREEN: focused storage7 and existing session/backup/import/metadata/mix regression93 =100 passed. Added exact schema20 migration case also passed (final mix scope8);101 across final scopes. Contract listening-schema1 passed.
- `npm run format`, `npm run typecheck`, `npm run build`, `npm run format:check`: exit0.
- Two actual Node processes race the same event: one row/sequence and exactly one successful claim. Reopen alone retains dispatching; explicit startup recovery makes it uncertain and unclaimable.
- Receipt-insert failure rolls back event; event UPDATE is rejected; wrong-payload replay conflicts. Successful receipt survives actual backup/restore; a snapshot missing its delivery is rejected.
- History and ranked keysets retain original high-water after new insertion, account isolation and [from,to) boundaries. Exact tie-breakers verified.
- Local synthetic top-query measurements (single observations, no SLA):100 events0.236ms;10000 events1.456ms. EXPLAIN history uses COVERING INDEX listening_history_owner (identity_key, sequence); range aggregation uses COVERING INDEX listening_range_owner (identity_key, qualified_at) plus TEMP B-TREE FOR GROUP BY. Cost grows with local event count.
- No API/UI/Gallery/copy changes; P7 acceptance unchanged. Test connections/processes/temp databases cleaned. Real gonic not required for this storage boundary.
- Rulebook context search found no directly relevant new safeguard. Postflight skipped(no_new_lesson), no canonical writes.
