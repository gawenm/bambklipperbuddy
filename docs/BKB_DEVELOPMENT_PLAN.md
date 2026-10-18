# BambKlipperBuddy plugin and Moonraker development

This branch is reserved for the versioned plugin SDK and Klipper/Moonraker integration.

## Scope

- Preserve the existing Bambu MQTT/FTP workflows and database.
- Discover only bundled, reviewed plugins initially.
- Store plugin enablement in the persistent application data directory.
- Register Klipper printers separately from Bambu-specific printer records.
- Use Moonraker HTTP APIs for read-only status before enabling print controls.
- Require authorization for plugin configuration and printer registration.
- Do not load arbitrary Python code from untrusted GitHub repositories.
- Add isolated execution, integrity checks and explicit permission grants before supporting third-party executable plugins.

## Deployment safety

Production `bambuddy` on `shed-server` must not be updated from this branch until the complete application tests and an isolated Docker smoke test pass. Keep `bambuddy_bambuddy_data` and `bambuddy_bambuddy_logs` intact. Do not run `docker compose down -v`.

## Existing Phase 1 patch

The Phase 1 plugin patch was generated and locally unit-tested in the development environment. It is **not yet committed to this branch**. The server-side Docker build previously failed because the legacy builder does not support the Dockerfile's BuildKit cache mounts. Use Docker Buildx / BuildKit for future builds.

## Next implementation steps

1. Commit and review the Phase 1 plugin SDK files.
2. Run backend unit tests and static checks.
3. Build a development Docker image using BuildKit.
4. Add frontend plugin management and Moonraker printer cards.
5. Integrate print history, Discord events and Klipper controls with capability checks.
