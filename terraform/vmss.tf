locals {
  pmd_config = templatefile("${path.module}/../config/config.toml.tpl", {
    pmd_cluster_tag_value = var.pmd_cluster_tag_value
  })

  # Strip "v" prefix for cargo install fallback
  pmd_version_bare = trimprefix(var.pmd_version, "v")

  # App source files (read as raw strings, not template-processed)
  app_source       = file("${path.module}/../app/src/index.ts")
  app_package_json = file("${path.module}/../app/package.json")
  app_tsconfig     = file("${path.module}/../app/tsconfig.json")

  cloud_init = templatefile("${path.module}/../scripts/cloud-init.yaml", {
    pmd_config       = local.pmd_config
    keyvault_name    = azurerm_key_vault.this.name
    pmd_version      = var.pmd_version
    pmd_version_bare = local.pmd_version_bare
    app_source       = local.app_source
    app_package_json = local.app_package_json
    app_tsconfig     = local.app_tsconfig
  })
}

# Flexible orchestration VMSS — instances appear as real VMs in Resource Graph
# so portmapd-azure can discover them via tag query
resource "azurerm_orchestrated_virtual_machine_scale_set" "pmd" {
  name                        = "vmss-pmd-cluster"
  location                    = azurerm_resource_group.this.location
  resource_group_name         = azurerm_resource_group.this.name
  platform_fault_domain_count = 1
  instances                   = var.vmss_min_instances
  sku_name                    = var.vm_size

  os_profile {
    linux_configuration {
      admin_username                  = var.admin_username
      disable_password_authentication = true

      admin_ssh_key {
        username   = var.admin_username
        public_key = file(var.ssh_public_key_path)
      }
    }

    custom_data = base64encode(local.cloud_init)
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.pmd.id]
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
  }

  network_interface {
    name    = "nic-pmd"
    primary = true

    ip_configuration {
      name      = "ipconfig-pmd"
      primary   = true
      subnet_id = azurerm_subnet.pmd.id

      load_balancer_backend_address_pool_ids = [azurerm_lb_backend_address_pool.this.id]

      public_ip_address {
        name                    = "pip-pmd-instance"
        public_ip_prefix_id     = azurerm_public_ip_prefix.pmd_instances.id
        sku_name                = "Standard_Regional"
      }
    }
  }

  tags = merge(azurerm_resource_group.this.tags, {
    "pmd-cluster" = var.pmd_cluster_tag_value
  })

  depends_on = [
    azurerm_role_assignment.pmd_reader,
    azurerm_role_assignment.pmd_kv_secrets,
    azurerm_key_vault_secret.pmd_cookie,
    azurerm_subnet_network_security_group_association.pmd,
    azurerm_lb_rule.api,
  ]
}
