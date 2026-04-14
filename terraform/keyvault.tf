resource "azurerm_key_vault" "this" {
  name                       = "kv-pmd-${substr(md5(azurerm_resource_group.this.id), 0, 8)}"
  location                   = azurerm_resource_group.this.location
  resource_group_name        = azurerm_resource_group.this.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = false
  soft_delete_retention_days = 7

  tags = azurerm_resource_group.this.tags
}

# Grant the deployer access to manage secrets
resource "azurerm_role_assignment" "deployer_kv_admin" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

# Generate a random 32-byte cookie for PMD cluster authentication
resource "random_bytes" "pmd_cookie" {
  length = 32
}

resource "azurerm_key_vault_secret" "pmd_cookie" {
  name         = "pmd-cookie"
  value        = random_bytes.pmd_cookie.base64
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [azurerm_role_assignment.deployer_kv_admin]
}
