# Project Plan — PMD Cluster on Azure VMSS

## Overview

Distributed [portmapd](https://crates.io/crates/portmapd) mesh cluster running on Azure VMSS (Flexible orchestration), with automatic peer discovery via [portmapd-azure](https://crates.io/crates/portmapd-azure) and a TypeScript API service on each node communicating with PMD via Unix socket.

## Architecture

```
                        ┌───────────────────┐
                        │   Load Balancer    │
                        │   :80 → :8080      │
                        └────────┬──────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
        ┌─────▼─────┐     ┌─────▼─────┐     ┌─────▼─────┐
        │   VM 0     │     │   VM 1     │     │   VM 2     │
        │ 10.0.1.4   │     │ 10.0.1.5   │     │ 10.0.1.10  │
        │            │     │            │     │            │
        │ ┌────────┐ │     │ ┌────────┐ │     │ ┌────────┐ │
        │ │ API    │ │     │ │ API    │ │     │ │ API    │ │
        │ │ :8080  │ │     │ │ :8080  │ │     │ │ :8080  │ │
        │ └───┬────┘ │     │ └───┬────┘ │     │ └───┬────┘ │
        │     │socket │     │     │socket │     │     │socket │
        │ ┌───▼────┐ │     │ ┌───▼────┐ │     │ ┌───▼────┐ │
        │ │ PMD    │◄├─────├─►│ PMD    │◄├─────├─►│ PMD    │ │
        │ │ :4369  │ │     │ │ :4369  │ │     │ │ :4369  │ │
        │ └────────┘ │     │ └────────┘ │     │ └────────┘ │
        └────────────┘     └────────────┘     └────────────┘
              ▲                   ▲                   ▲
              └───────────────────┴───────────────────┘
                    Azure Resource Graph discovery
                      (tag: pmd-cluster=prod)

        ┌─────────────────┐  ┌──────────────────────┐
        │  Key Vault       │  │  Managed Identity     │
        │  (pmd-cookie)    │  │  (Reader + KV User)   │
        └─────────────────┘  └──────────────────────┘
```

## Components

### Infrastructure (`terraform/`)

| File | Purpose |
|------|---------|
| `main.tf` | Provider azurerm ~> 4.0, resource group |
| `variables.tf` | All configurable variables |
| `network.tf` | VNet, subnet, NSG, NAT Gateway, Public IP Prefix |
| `identity.tf` | User-assigned managed identity + RBAC |
| `keyvault.tf` | Key Vault + pmd-cookie secret |
| `loadbalancer.tf` | Standard LB, health probe, rule :80→:8080 |
| `vmss.tf` | Flexible VMSS, cloud-init, LB backend pool |
| `outputs.tf` | Resource IDs, LB public IP |

### Application (`app/`)

| File | Purpose |
|------|---------|
| `src/index.ts` | HTTP API + PMD socket client |
| `package.json` | Dependencies, scripts, version |
| `tsconfig.json` | TypeScript compiler config |

### Configuration

| File | Purpose |
|------|---------|
| `config/config.toml.tpl` | PMD config template (bind=BIND_ADDR placeholder) |
| `scripts/cloud-init.yaml` | Boot: install PMD, Node.js, API, systemd services |

## Phases

### Phase 1 — Infrastructure Foundation ✅

- [x] Terraform project structure (provider, RG, variables)
- [x] Networking (VNet, subnet, NSG port 4369/9090/22/8080)
- [x] NAT Gateway for explicit outbound
- [x] Per-instance public IPs (Standard SKU via Public IP Prefix)
- [x] Key Vault + random cookie secret
- [x] User-assigned managed identity (Reader RG + KV Secrets User)

### Phase 2 — PMD Cluster ✅

- [x] Cloud-init: install Rust, cargo install portmapd
- [x] Cookie retrieval from Key Vault via IMDS
- [x] PMD config with `discovery = ["azure-tag"]`
- [x] Bind on private IP (detected from IMDS)
- [x] systemd service `pmd.service`
- [x] Flexible VMSS (instances visible in Resource Graph)
- [x] Auto-discovery via azure-tag plugin
- [x] 3-node cluster with mesh convergence

### Phase 3 — API Service ✅

- [x] TypeScript API on port 8080
- [x] `GET /` — Hello from <hostname>
- [x] `GET /status` — PMD status + nodes via socket
- [x] Service self-registration via PMD socket (`Register`)
- [x] Graceful shutdown with `Unregister` on SIGTERM
- [x] systemd service `pmd-api.service` (after pmd.service)
- [x] Load Balancer :80 → :8080 with health probe on /status

### Phase 4 — Project Setup ✅

- [x] Git repository initialization
- [x] Custom agents (infra, application, documentalist)
- [x] Project plan (`PLAN.md`)
- [x] Semantic versioning
- [x] Publish to GitHub

### Phase 5 — Testing (next)

- [ ] Install PMD locally (`cargo install portmapd`)
- [ ] Unit tests for PMD socket client (mock socket server)
- [ ] Unit tests for HTTP routes
- [ ] Integration tests against local PMD instance
- [ ] CI pipeline (GitHub Actions)

### Phase 6 — Enhancements (future)

- [ ] CRDT shared state via `concordat` across cluster nodes
- [ ] Prometheus + Grafana monitoring stack
- [ ] Alerting on join/leave events
- [ ] Custom VM image (Packer) for faster boot
- [ ] Autoscale rules based on metrics
- [ ] Health check endpoint improvements

## Agents

| Agent | Scope | Responsibilities |
|-------|-------|-----------------|
| `infra` | `terraform/`, `scripts/`, `config/` | Terraform code, deployment, validation |
| `application` | `app/` | TypeScript code, tests, PMD socket client |
| `documentalist` | `*.md`, version | Plans, READMEs, changelog, versioning |

## Technology Stack

| Component | Technology |
|-----------|-----------|
| IaC | Terraform (azurerm ~> 4.0) |
| Cloud | Azure (VMSS Flexible, Key Vault, LB, NAT GW) |
| Membership | portmapd v0.5.0 + portmapd-azure |
| CRDT | concordat v0.2.0 (future) |
| API Runtime | Node.js 20 LTS |
| API Language | TypeScript (strict, ES2022) |
| API Framework | node:http (stdlib) |
| PMD Protocol | Unix socket + JSON-line |
