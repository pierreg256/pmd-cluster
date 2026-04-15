resource "azurerm_virtual_network" "this" {
  name                = "vnet-pmd-cluster"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  address_space       = ["10.0.0.0/16"]

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

  lifecycle {
    ignore_changes = [ip_tags]
  }
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

  # SSH access — from Azure Bastion subnet only
  security_rule {
    name                       = "AllowSSHFromBastion"
    priority                   = 200
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "10.0.2.0/26"
    destination_address_prefix = "10.0.1.0/24"
  }

  tags = azurerm_resource_group.this.tags
}

resource "azurerm_subnet_network_security_group_association" "pmd" {
  subnet_id                 = azurerm_subnet.pmd.id
  network_security_group_id = azurerm_network_security_group.pmd.id
}

# --- Azure Bastion ---

resource "azurerm_subnet" "bastion" {
  name                 = "AzureBastionSubnet"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = ["10.0.2.0/26"]
}

resource "azurerm_public_ip" "bastion" {
  name                = "pip-bastion-pmd"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  allocation_method   = "Static"
  sku                 = "Standard"

  tags = azurerm_resource_group.this.tags
}

resource "azurerm_bastion_host" "this" {
  name                = "bastion-pmd-cluster"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "Standard"
  tunneling_enabled   = true

  ip_configuration {
    name                 = "bastion-ipconfig"
    subnet_id            = azurerm_subnet.bastion.id
    public_ip_address_id = azurerm_public_ip.bastion.id
  }

  tags = azurerm_resource_group.this.tags
}
