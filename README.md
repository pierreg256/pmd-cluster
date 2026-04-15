# PMD Cluster on Azure VMSS

Distributed [portmapd](https://crates.io/crates/portmapd) mesh cluster running on an Azure Virtual Machine Scale Set (Flexible), with automatic peer discovery via [portmapd-azure](https://crates.io/crates/portmapd-azure) and a TypeScript API service on each node communicating via Unix socket.

## Architecture

```mermaid
graph TD
    LB["🔀 Load Balancer<br/>:80 → :8080"]
    Bastion["🛡️ Azure Bastion<br/>SSH tunneling"]

    subgraph VMSS["Azure VMSS (Flexible) — private IPs only"]
        subgraph VM0["VM 0"]
            NODE0["Node (TS) :8080"]
            PMD0["PMD :4369"]
            NODE0 -->|Unix socket| PMD0
        end
        subgraph VM1["VM 1"]
            NODE1["Node (TS) :8080"]
            PMD1["PMD :4369"]
            NODE1 -->|Unix socket| PMD1
        end
        subgraph VM2["VM 2"]
            NODE2["Node (TS) :8080"]
            PMD2["PMD :4369"]
            NODE2 -->|Unix socket| PMD2
        end

        NODE0 <-->|ring :9443| NODE1
        NODE1 <-->|ring :9443| NODE2
        NODE0 <-->|ring :9443| NODE2

        PMD0 <-->|mesh :4369| PMD1
        PMD1 <-->|mesh :4369| PMD2
        PMD0 <-->|mesh :4369| PMD2
    end

    LB -->|:8080| NODE0
    LB -->|:8080| NODE1
    LB -->|:8080| NODE2

    Bastion -->|SSH :22| VM0
    Bastion -->|SSH :22| VM1
    Bastion -->|SSH :22| VM2

    ARG["Azure Resource Graph<br/>tag: pmd-cluster=prod"]
    PMD0 -.->|discovery| ARG
    PMD1 -.->|discovery| ARG
    PMD2 -.->|discovery| ARG

    KV["🔑 Key Vault<br/>pmd-cookie"]
    MI["🪪 Managed Identity<br/>Reader + KV User"]
    KV -.-> MI
    MI -.-> VMSS
```

Each VM runs two processes:
- **Node** — TypeScript API service (:8080) that communicates with the local PMD via Unix socket and with other nodes via the internal ring protocol (:9443, TCP, HMAC-authenticated)
- **PMD** — portmapd daemon (:4369) handling membership, failure detection, and peer discovery via Azure Resource Graph

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- Azure CLI authenticated (`az login`)
- An SSH key pair (`~/.ssh/id_rsa.pub`)

## Quick Start

```bash
cd terraform

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars if needed (region, VM size, etc.)

# Deploy
terraform init
terraform plan
terraform apply
```

## Verify the Cluster

```bash
# Get VMSS instance private IPs
az vmss nic list \
  -g rg-pmd-cluster \
  --vmss-name vmss-pmd-cluster \
  --query '[].ipConfigurations[0].privateIPAddress' -o tsv

# SSH via Azure Bastion tunnel (native client)
az network bastion ssh \
  -n bastion-pmd-cluster \
  -g rg-pmd-cluster \
  --target-resource-id <VM_RESOURCE_ID> \
  --auth-type ssh-key \
  --username azureuser \
  --ssh-key ~/.ssh/id_rsa

# On the VM — check PMD status
systemctl status pmd
pmd status
pmd nodes    # Should list all 3 nodes
```

## Scaling

```bash
# Scale up to 5 instances
az vmss scale -g rg-pmd-cluster -n vmss-pmd-cluster --new-capacity 5

# New VMs will auto-join the cluster within ~30s (azure-tag polling interval)
# Verify from any existing node via Bastion:
az network bastion ssh \
  -n bastion-pmd-cluster -g rg-pmd-cluster \
  --target-resource-id <VM_RESOURCE_ID> \
  --auth-type ssh-key --username azureuser --ssh-key ~/.ssh/id_rsa \
  -- -t "pmd nodes"
```

## Configuration

### PMD Config (`config/config.toml.tpl`)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `port` | 4369 | TCP port for inter-PMD communication |
| `discovery` | `["azure-tag"]` | Discovery plugin (azure tag-based) |
| `heartbeat_interval_secs` | 2 | Heartbeat frequency |
| `sync_interval_secs` | 5 | CRDT delta sync frequency |
| `phi_threshold` | 8.0 | Phi accrual failure detector threshold |
| `metrics_port` | 9090 | Prometheus metrics endpoint |

### Terraform Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `location` | `westeurope` | Azure region |
| `vm_size` | `Standard_B2s` | VM SKU |
| `vmss_min_instances` | 3 | Initial instance count |
| `pmd_cluster_tag_value` | `prod` | Tag value for discovery |
| `pmd_version` | `v0.5.0` | PMD release version |

## Security

- **Azure Bastion**: SSH access via Bastion tunnel only — no public IPs on VMs
- **Cookie auth**: All nodes share a 32-byte HMAC cookie stored in Key Vault
- **mTLS**: Inter-node TLS with auto-generated certificates
- **Managed Identity**: VMs use user-assigned MI — no credentials stored on disk
- **NSG**: Port 4369 restricted to subnet-internal traffic; SSH restricted to Bastion subnet
- **systemd hardening**: `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`

## Cleanup

```bash
terraform destroy
```

## Roadmap (future iterations)

- [ ] Service registration on the PMD mesh (application-level services)
- [ ] Shared CRDT state via `concordat` across cluster nodes
- [ ] Prometheus + Grafana monitoring stack
- [ ] Alerting on join/leave events
- [ ] Custom VM image (Packer) for faster boot
