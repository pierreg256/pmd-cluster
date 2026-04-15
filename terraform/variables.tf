variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "westeurope"
}

variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
  default     = "rg-pmd-cluster"
}

variable "vm_size" {
  description = "VM size for VMSS instances"
  type        = string
  default     = "Standard_B2s"
}

variable "vmss_min_instances" {
  description = "Minimum number of VMSS instances"
  type        = number
  default     = 3
}

variable "vmss_max_instances" {
  description = "Maximum number of VMSS instances"
  type        = number
  default     = 10
}

variable "admin_username" {
  description = "Admin username for VMs"
  type        = string
  default     = "azureuser"
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key file"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "pmd_cluster_tag_value" {
  description = "Value for the pmd-cluster tag used for Azure tag-based discovery"
  type        = string
  default     = "prod"
}

variable "pmd_version" {
  description = "Version of portmapd to install (GitHub Release tag)"
  type        = string
  default     = "v0.5.0"
}

variable "tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}
