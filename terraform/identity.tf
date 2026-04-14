resource "azurerm_user_assigned_identity" "pmd" {
  name                = "id-pmd-cluster"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name

  tags = azurerm_resource_group.this.tags
}

# Reader role on the resource group — required by portmapd-azure
# to query Azure Resource Graph for VM discovery
resource "azurerm_role_assignment" "pmd_reader" {
  scope                = azurerm_resource_group.this.id
  role_definition_name = "Reader"
  principal_id         = azurerm_user_assigned_identity.pmd.principal_id
}

# Key Vault Secrets User — to retrieve the PMD cookie at boot
resource "azurerm_role_assignment" "pmd_kv_secrets" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.pmd.principal_id
}
