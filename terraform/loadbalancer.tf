resource "azurerm_public_ip" "lb" {
  name                = "pip-lb-pmd-api"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  allocation_method   = "Static"
  sku                 = "Standard"

  tags = azurerm_resource_group.this.tags
}

resource "azurerm_lb" "this" {
  name                = "lb-pmd-api"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "Standard"

  frontend_ip_configuration {
    name                 = "frontend"
    public_ip_address_id = azurerm_public_ip.lb.id
  }

  tags = azurerm_resource_group.this.tags
}

resource "azurerm_lb_backend_address_pool" "this" {
  name            = "backend-pmd-api"
  loadbalancer_id = azurerm_lb.this.id
}

resource "azurerm_lb_probe" "api" {
  name                = "probe-api"
  loadbalancer_id     = azurerm_lb.this.id
  protocol            = "Http"
  port                = 8080
  request_path        = "/status"
  interval_in_seconds = 15
}

resource "azurerm_lb_rule" "api" {
  name                           = "rule-api"
  loadbalancer_id                = azurerm_lb.this.id
  protocol                       = "Tcp"
  frontend_port                  = 80
  backend_port                   = 8080
  frontend_ip_configuration_name = "frontend"
  backend_address_pool_ids       = [azurerm_lb_backend_address_pool.this.id]
  probe_id                       = azurerm_lb_probe.api.id
}
