# PMD Cluster — Copilot Instructions

## Project Structure

```
solution/
├── terraform/       # Infrastructure as Code (Azure)
├── app/             # TypeScript API service
│   └── src/         # Source code
├── config/          # PMD configuration templates
├── scripts/         # Cloud-init and provisioning scripts
└── .github/agents/  # Custom Copilot agents
```

## Agents

This project uses three specialized agents:

- **@infra** — Terraform code, Azure deployment, cloud-init, validation
- **@application** — TypeScript API, PMD socket client, tests
- **@documentalist** — Plans, READMEs, changelogs, documentation

## Key Conventions

- **Versioning**: Semantic versioning (0.x.y). Version lives in `app/package.json` and `CHANGELOG.md`.
- **PMD communication**: Always via Unix socket (`/var/lib/pmd/.pmd/pmd-4369.sock`), never CLI shell-out.
- **Terraform**: Always validate after editing `.tf` files. Use Flexible VMSS (not Uniform).
- **TypeScript**: Strict mode, no external HTTP dependencies, Node.js stdlib only.
- **Testing**: Unit tests use mock socket server. Integration tests use a local PMD instance.
