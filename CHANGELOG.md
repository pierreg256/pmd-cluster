# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-04-16

### Added

- **Phase 6 — Distributed State (Concordat WASM)**
  - `concordat` WASM dependency for delta-state CRDT documents
  - `ring.ts` — ring topology helpers (successor/predecessor computation)
  - `state.ts` — `RingState` class wrapping `WasmCrdtDoc` with typed accessors
  - Node registration (addNode/markLeaving/removeNode) with automatic ring recomputation
  - Shared kv store (kvSet/kvGet/kvRemove) with CRDT merge semantics
  - Delta sync API (deltaSince/mergeDelta/versionVector)

- **Phase 7 — Node Discovery (PMD Polling)**
  - `watcher.ts` — `NodeWatcher` class (EventEmitter) polling PMD socket for node changes
  - Join/leave detection with diff-based comparison
  - `currentPeers()` for listing non-local nodes

- **Phase 8 — Internal Gossip Transport**
  - `codec.ts` — binary frame codec (1B type + 4B length + payload), streaming decoder
  - `auth.ts` — HMAC-SHA256 auth with timing-safe comparison, replay protection (±30s)
  - `internal-server.ts` — TCP server (:9443) with AUTH handshake, PUSH/PULL/PING handlers
  - `gossip.ts` — `GossipManager` with persistent connection pool, push-on-mutation, periodic pull, auto-reconnect with exponential backoff, PING/PONG keepalive

- Azure Bastion for SSH access (no public IPs on VMs)
- DNS label on LB public IP (`pmd-cluster-api.<region>.cloudapp.azure.com`)
- 82 tests total (78 unit + 4 integration), all passing

### Changed

- Version bump 0.2.0 → 0.3.0
- NSG: SSH restricted to Bastion subnet (10.0.2.0/26)
- VMSS instances no longer have public IPs
- Cloud-init deploys all source files (index.ts, app.ts, pmd-client.ts)
- Architecture diagrams converted to Mermaid

### Removed

- `admin_ssh_cidr` variable (replaced by Bastion)
- Public IP prefix for VMSS instances

## [0.2.0] - 2026-04-14

### Added

- Refactored app into testable modules (`pmd-client.ts`, `app.ts`, `index.ts`)
- PMD socket client with typed interfaces (`PmdStatus`, `PmdNode`, `PmdService`)
- 14 unit tests with mock socket server (Node.js built-in test runner)
- 4 integration tests against a real local PMD daemon
- `tsx` for running TypeScript tests directly
- `npm test`, `npm run test:unit`, `npm run test:integration` scripts
- ESM module support (`"type": "module"`)

### Changed

- `pmd-client` functions now take `PmdClientOptions` (configurable socket path)
- `createApp()` factory for testable HTTP server instantiation
- Version bump 0.1.0 → 0.2.0

## [0.1.0] - 2026-04-14

### Added

- Terraform infrastructure for Azure VMSS (Flexible orchestration)
- PMD cluster with 3 nodes and automatic azure-tag discovery
- Key Vault for shared cookie authentication
- NAT Gateway for explicit outbound connectivity
- Per-instance public IPs via Public IP Prefix (Standard SKU)
- NSG rules for PMD (4369), Prometheus (9090), SSH (22), API (8080)
- User-assigned managed identity with Reader + Key Vault Secrets User roles
- Cloud-init provisioning: Rust, portmapd, Node.js, API service
- TypeScript API service on port 8080 per node
- `GET /` — Hello from hostname
- `GET /status` — PMD cluster status and nodes via Unix socket
- PMD socket client (JSON-line protocol, no CLI shell-out)
- Service self-registration (`Register`) and graceful unregister (`SIGTERM`)
- Standard Load Balancer :80 → :8080 with health probe on /status
- systemd services for PMD and API with dependency ordering
- PMD config with private IP bind (detected from IMDS)
- Custom agents: infra, application, documentalist
- Project plan (`PLAN.md`)
