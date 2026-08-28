variable "region" {
  type = string
}

variable "tenancy_ocid" {
  type      = string
  sensitive = true
}

variable "compartment_ocid" {
  type      = string
  default   = null
  nullable  = true
  sensitive = true
}

variable "compartment_id" {
  type      = string
  default   = null
  nullable  = true
  sensitive = true
}

variable "ssh_authorized_key" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256)\\s+", trimspace(var.ssh_authorized_key)))
    error_message = "ssh_authorized_key must contain a valid SSH public key."
  }
}

variable "admin_cidr" {
  type = string
  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && var.admin_cidr != "0.0.0.0/0"
    error_message = "admin_cidr must be a valid restricted CIDR and must not be 0.0.0.0/0."
  }
}

variable "display_name" {
  type    = string
  default = "ds-prod-core-01"
}

variable "ocpus" {
  type    = number
  default = 2
  validation {
    condition     = var.ocpus > 0 && var.ocpus <= 2
    error_message = "ocpus must stay within the Always Free A1 ceiling configured for this stack."
  }
}

variable "memory_in_gbs" {
  type    = number
  default = 12
  validation {
    condition     = var.memory_in_gbs >= 1 && var.memory_in_gbs <= 12
    error_message = "memory_in_gbs must stay within the Always Free A1 ceiling configured for this stack."
  }
}

variable "boot_volume_size_in_gbs" {
  type    = number
  default = 150
  validation {
    condition     = var.boot_volume_size_in_gbs >= 50 && var.boot_volume_size_in_gbs <= 200
    error_message = "boot_volume_size_in_gbs must be between 50 and 200 GiB."
  }
}

variable "public_release_repo" {
  type    = string
  default = "https://github.com/daubesonntag-dotcom/daube-public-release.git"
}

variable "public_release_branch" {
  type    = string
  default = "main"
}

variable "accept_oracle_always_free_capacity_risk" {
  type    = bool
  default = false
}

variable "confirm_free_volume_headroom" {
  type    = bool
  default = false
}
