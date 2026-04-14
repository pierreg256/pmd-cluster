# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
