# Clear all data and settings

Status: Shipped

## Behavior

Settings > General offers **Clear all data and settings** with red text in both themes.
A confirmation describes permanent deletion, focuses Cancel, and submits once. Errors remain
visible and allow retry. An active recording prevents reset.

The desktop records the request, quits normally, and relaunches without replaying the initial
app link. Before creating windows or services, the new process removes Path's managed media
from every registered recording location, pending asset deletions, database, credentials,
cached models, diagnostics, temporary CLI work, local backups, and browser storage/caches.
Normal startup recreates the defaults. A failed deletion leaves the request and database
available for retry on next launch.

## Out of scope

Do not remove imported originals, exported files, unrelated contents of custom recording
folders, installed third-party tools, their login sessions, or externally managed models.
Do not perform a reset against a user's actual profile during verification.

## Acceptance evidence

- `AppDataReset.test.ts`: deferred deletion, all registered roots, pending deletions, preserved
  originals/unrelated folders, failed deletion retry, browser cleanup failure, and fresh defaults.
- `ClearDataIpc.test.ts`: strict explicit confirmation, arbitrary path rejection, and all active
  recording states blocked.
- `SettingsPage.test.tsx`: Cancel focus, dismissal, single submission, locked restart state,
  visible errors, and retry/cancellation.
- `node tests/ElectronDataReset.mjs`: Windows Electron relaunch in a temporary profile, real
  database worker and file deletion, original preservation, and cleared `path://renderer`
  theme storage. Uses the production reset service; no real user profile is touched.
- Exported Settings page inspected in Chrome: action and confirmation text colors are
  `rgb(184, 62, 78)` in light mode and `rgb(241, 160, 168)` in dark mode. Cancel receives focus,
  Escape dismisses, and confirmation submits once.
- `npm run check`, all 642 tests in 101 files, and `npm run build` pass.

Native macOS/Linux reset and packaged installer relaunch are not verified. If the database
cannot be read or a managed asset remains locked, reset stops with an error and retries on
next launch; it does not silently skip those files.
