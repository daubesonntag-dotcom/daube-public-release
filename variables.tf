variable "region" {
  type        = string
  description = "OCI home region. Always Free compute must be created in the tenancy home region."
}

variable "tenancy_ocid" {
  type        = string
  description = "OCI tenancy OCID. Resource Manager prepopulates this for deploy-button stacks."
  sensitive   = true
}

variable "compartment_ocid" {
  type        = string
  default     = null
  nullable    = true
  description = "OCI Resource Manager-native compartment selection."
  sensitive   = true
}

variable "compartment_id" {
  type        = string
  default     = null
  nullable    = true
  description = "Optional local/CLI compartment override. Defaults to compartment_ocid, then tenancy root."
  sensitive   = true
}

variable "ssh_authorized_key" {
  type        = string
  description = "SSH public key only. Never place a private key in Terraform variables or GitHub."
  sensitive   = true

  validation {
    condition     = can(regex("^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256)\\s+", trimspace(var.ssh_authorized_key)))
    error_message = "ssh_authorized_key must contain a valid SSH public key."
  }
}

variable "admin_cidr" {
  type        = string
  description = "CIDR allowed to reach SSH/22. Use a trusted public IP /32; never use 0.0.0.0/0 for production."

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
  type        = number
  default     = 2
  description = "A1 OCPUs allocated to this node."
  validation {
    condition     = var.ocpus > 0 && var.ocpus <= 2
    error_message = "ocpus must stay within the configured Always Free A1 ceiling of 2."
  }
}

variable "memory_in_gbs" {
  type        = number
  default     = 12
  description = "A1 memory in GiB."
  validation {
    condition     = var.memory_in_gbs >= 1 && var.memory_in_gbs <= 12
    error_message = "memory_in_gbs must stay within the configured Always Free A1 ceiling of 12 GiB."
  }
}

variable "boot_volume_size_in_gbs" {
  type        = number
  default     = 150
  description = "Boot volume size; keep total tenancy storage inside the documented Always Free allowance."
  validation {
    condition     = var.boot_volume_size_in_gbs >= 50 && var.boot_volume_size_in_gbs <= 200
    error_message = "boot_volume_size_in_gbs must be between 50 and 200 GiB."
  }
}

variable "public_release_repo" {
  type        = string
  default     = "https://github.com/daubesonntag-dotcom/daube-public-release.git"
  description = "Public release projection cloned onto the host as a release mirror."
}

variable "public_release_branch" {
  type    = string
  default = "main"
}

variable "accept_oracle_always_free_capacity_risk" {
  type        = bool
  default     = false
  description = "Acknowledges Always Free capacity/reclamation risk. It does not authorize paid resources."
}

variable "confirm_free_volume_headroom" {
  type        = bool
  default     = false
  description = "Must be true only after confirming enough remaining Always Free block-volume allowance."
}
