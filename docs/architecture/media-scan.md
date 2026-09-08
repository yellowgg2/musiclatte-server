# Media scanning

Settings offers **Scan now**, **Automatic scanning**, and an editable minute interval to users with
`library.scan` allowed. Non-administrators see an administrator-only explanation. Both server
`ALLOW_SCAN=true` and freshly verified upstream admin permission are required; existing users' roles
are not changed. Existing POST `/api/v1/scan` behavior remains compatible.

- GET `/api/v1/scan` reads scanning/count state.
- GET/PUT `/api/v1/scan/schedule` reads/saves the server-wide schedule. PUT accepts only `enabled`
  and integer `intervalMinutes` in15–10080. Browser writes retain Origin/client/CSRF guards.
- New installations default to disabled with360 minutes (6 hours). Enabling schedules the first
  run one interval later. Saving resets the next run; disabling removes scheduled credentials.
- Schema14 stores the interval, next run, last request time/error, generation and durable lease.
  Credentials use the existing AES-GCM vault and never appear in API responses or logs.
- API runtime checks due work every15 seconds, including on startup, independently of browser
  activity/session expiry. Each run rechecks upstream identity/admin permission and instance policy
  revision. Permission/credential loss disables the schedule. Logout does not disable this explicitly
  configured server-wide automation; use its toggle to stop it.
- A SQLite claim prevents concurrent schedulers starting the same due run. Next due time advances
  before network work; missed intervals are coalesced, existing gonic scans are skipped and upstream
  failures retry at the next interval. Shutdown aborts in-flight work before closing the database.

This schedules scan requests, not a promise of full media indexing completion at a specific instant.
Imports and metadata registration retain their existing scan flows. File watchers and gonic's own
scan interval are not enabled or reconfigured.

Playlist overview/detail use the available shell width instead of a68rem centered limit. The overview
places its compact title alongside language selection and separates count/create actions into one row.
Shared Action, TextField, StatusSurface, PlaylistCard and existing spacing/color tokens are reused;
new scan UI is feature-local. Korean and English resources have matching keys.
