output "resource_group_name" {
  description = "Name of the resource group"
  value       = azurerm_resource_group.this.name
}

output "vmss_id" {
  description = "ID of the VMSS"
  value       = azurerm_orchestrated_virtual_machine_scale_set.pmd.id
}

output "vmss_name" {
  description = "Name of the VMSS"
  value       = azurerm_orchestrated_virtual_machine_scale_set.pmd.name
}

output "keyvault_uri" {
  description = "URI of the Key Vault storing the PMD cookie"
  value       = azurerm_key_vault.this.vault_uri
}

output "managed_identity_principal_id" {
  description = "Principal ID of the PMD managed identity"
  value       = azurerm_user_assigned_identity.pmd.principal_id
}

output "managed_identity_client_id" {
  description = "Client ID of the PMD managed identity"
  value       = azurerm_user_assigned_identity.pmd.client_id
}

output "vnet_name" {
  description = "Name of the virtual network"
  value       = azurerm_virtual_network.this.name
}

output "subnet_id" {
  description = "ID of the PMD subnet"
  value       = azurerm_subnet.pmd.id
}

output "lb_public_ip" {
  description = "Public IP of the Load Balancer (API endpoint)"
  value       = azurerm_public_ip.lb.ip_address
}

output "bastion_name" {
  description = "Name of the Azure Bastion host (use for SSH tunneling)"
  value       = azurerm_bastion_host.this.name
}
