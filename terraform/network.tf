resource "azurerm_virtual_network" "this" {
  name                = "vnet-pmd-cluster"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  address_space       = ["10.0.0.0/16"]

  tags = azurerm_resource_group.this.tags
}

# Public IP prefix (Standard SKU) for VMSS instance public IPs
resource "azurerm_public_ip_prefix" "pmd_instances" {
  name                = "pippfx-pmd-instances"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  prefix_length       = 28 # 16 IPs — enough for up to 10 instances
  sku                 = "Standard"

  tags = azurerm_resource_group.this.tags
}

resource "azurerm_subnet" "pmd" {
  name                            = "snet-pmd"
  resource_group_name             = azurerm_resource_group.this.name
  virtual_network_name            = azurerm_virtual_network.this.name
  address_prefixes                = ["10.0.1.0/24"]
  default_outbound_access_enabled = false
}

# NAT Gateway for explicit outbound connectivity
# (required for cloud-init: download pmd binary, access Key Vault, IMDS)
resource "azurerm_public_ip" "nat" {
  name                = "pip-nat-pmd"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  allocation_method   = "Static"
  sku                 = "Standard"

  tags = azurerm_resource_group.this.tags
}

resource "azurerm_nat_gateway" "this" {
  name                = "nat-pmd"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  sku_name            = "Standard"

  tags = azurerm_resource_group.this.tags
}

resource "azurerm_nat_gateway_public_ip_association" "this" {
  nat_gateway_id       = azurerm_nat_gateway.this.id
  public_ip_address_id = azurerm_public_ip.nat.id
}

resource "azurerm_subnet_nat_gateway_association" "pmd" {
  subnet_id      = azurerm_subnet.pmd.id
  nat_gateway_id = azurerm_nat_gateway.this.id
}

resource "azurerm_network_security_group" "pmd" {
  name                = "nsg-pmd"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name

  # PMD inter-node communication (port 4369)
  security_rule {
    name                       = "AllowPMD"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "4369"
    source_address_prefix      = "10.0.1.0/24"
    destination_address_prefix = "10.0.1.0/24"
  }

  # Prometheus metrics (port 9090) — internal only
  security_rule {
    name                       = "AllowPrometheus"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "9090"
    source_address_prefix      = "10.0.1.0/24"
    destination_address_prefix = "10.0.1.0/24"
  }

  # API service (port 8080) — from LB and subnet
  security_rule {
    name                       = "AllowAPI"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "8080"
    source_address_prefix      = "*"
    destination_address_prefix = "10.0.1.0/24"
  }

  # SSH access — restricted to admin CIDR
  security_rule {
    name                       = "AllowSSH"
    priority                   = 200
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = var.admin_ssh_cidr
    destination_address_prefix = "*"
  }

  tags = azurerm_resource_group.this.tags
}

resource "azurerm_subnet_network_security_group_association" "pmd" {
  subnet_id                 = azurerm_subnet.pmd.id
  network_security_group_id = azurerm_network_security_group.pmd.id
}
