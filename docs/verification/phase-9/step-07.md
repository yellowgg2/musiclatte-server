# Phase 9 Step 07 verification

- RED: no public organization DTO, route, PAT scope, candidate lookup, retry receipt, or capability
  existed after the internal S03–S06 producers were complete.
- Contract: `media:organize` requires metadata read and write. Candidate, preview, job, and retry
  payloads are strict and bounded; decoders reject private or unknown fields.
- Admission: one current track/revision and one same-token succeeded metadata job are required.
  Evidence is 1–8 HTTPS descriptors and must cover every changed field without claiming a field
  absent from both the patch result and current MP3. Lyrics retains its separate scope.
- Authorization: the API accepts only bearer PATs with all three organization scopes and rechecks
  canonical account, current library intersection, policy revision, expiry, and revocation. Cookie,
  legacy bearer, mixed credentials, query tokens, and insufficient scopes fail before admission.
- Idempotency: same operation/body returns the original job before mutable path inspection; a
  changed body conflicts. Recovery retry records one hash-only event for the durable next owner and
  cannot repeat succeeded work.
- Privacy: candidate output is bounded to selection metadata. Status exposes only stage, opaque
  old/new IDs, error, and recovery owner—not paths, evidence, proof, digest, or raw rows.
- Capability: `metadata.organization` is supported only with configured account policy and becomes
  available only with ready metadata/organization runtime.
- GREEN: focused API/auth/worker unit and contract suites, typecheck, build, format, and diff gates
  passed under Node 24.20.0.
- Rulebook: local Node/deployment alignment and async Fastify lifecycle guidance were applied;
  postflight is `skipped(no_new_lesson)`.
