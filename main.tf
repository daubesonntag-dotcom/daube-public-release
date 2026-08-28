terraform {
  required_version = ">= 1.5.0, < 1.6.0"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "8.27.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.7.2"
    }
  }
}

provider "oci" {
  region = var.region
}

locals {
  target_compartment_id = coalesce(var.compartment_id, var.compartment_ocid, var.tenancy_ocid)
  common_tags = {
    "DAUBE"               = "Core-Cloud"
    "Environment"         = "production"
    "SpendPolicy"         = "ALWAYS_FREE_ONLY"
    "SovereignLocal"      = "false"
    "ProviderFamily"      = "oracle-cloud"
    "ProductionAuthority" = "bounded-origin-worker"
  }
}

resource "random_password" "worker_auth" {
  length  = 48
  special = false
}

resource "random_password" "worker_receipt" {
  length  = 64
  special = false
}

data "oci_identity_availability_domains" "available" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu" {
  compartment_id           = local.target_compartment_id
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_vcn" "daube" {
  compartment_id = local.target_compartment_id
  cidr_block      = "10.42.0.0/16"
  display_name    = "${var.display_name}-vcn"
  dns_label       = "daube"
  freeform_tags   = local.common_tags
}

resource "oci_core_internet_gateway" "daube" {
  compartment_id = local.target_compartment_id
  vcn_id         = oci_core_vcn.daube.id
  display_name   = "${var.display_name}-igw"
  enabled        = true
  freeform_tags  = local.common_tags
}

resource "oci_core_route_table" "public" {
  compartment_id = local.target_compartment_id
  vcn_id         = oci_core_vcn.daube.id
  display_name   = "${var.display_name}-public-rt"
  freeform_tags  = local.common_tags

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.daube.id
  }
}

resource "oci_core_security_list" "origin" {
  compartment_id = local.target_compartment_id
  vcn_id         = oci_core_vcn.daube.id
  display_name   = "${var.display_name}-origin-sl"
  freeform_tags  = local.common_tags

  ingress_security_rules {
    protocol    = "6"
    source      = var.admin_cidr
    description = "Restricted SSH administration"
    tcp_options {
      min = 22
      max = 22
    }
  }

  ingress_security_rules {
    protocol    = "6"
    source      = "0.0.0.0/0"
    description = "HTTP bootstrap health and ACME only; compute POST is blocked at Nginx"
    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    protocol    = "6"
    source      = "0.0.0.0/0"
    description = "HTTPS bounded origin and compute worker"
    tcp_options {
      min = 443
      max = 443
    }
  }

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}

resource "oci_core_subnet" "public" {
  compartment_id             = local.target_compartment_id
  vcn_id                     = oci_core_vcn.daube.id
  cidr_block                 = "10.42.10.0/24"
  display_name               = "${var.display_name}-public-subnet"
  dns_label                  = "origin"
  prohibit_public_ip_on_vnic = false
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.origin.id]
  freeform_tags              = local.common_tags
}

resource "oci_core_instance" "daube_free_host" {
  availability_domain = var.availability_domain_index < length(data.oci_identity_availability_domains.available.availability_domains) ? data.oci_identity_availability_domains.available.availability_domains[var.availability_domain_index].name : data.oci_identity_availability_domains.available.availability_domains[0].name
  compartment_id      = local.target_compartment_id
  display_name        = var.display_name
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_in_gbs
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    display_name     = "${var.display_name}-vnic"
    hostname_label   = "core01"
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_size_in_gbs
  }

  metadata = {
    ssh_authorized_keys = trimspace(var.ssh_authorized_key)
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
      public_release_repo   = var.public_release_repo
      public_release_branch = var.public_release_branch
      admin_cidr            = var.admin_cidr
      worker_script_b64     = base64encode(file("${path.module}/worker.py"))
      worker_auth_token     = random_password.worker_auth.result
      worker_receipt_secret = random_password.worker_receipt.result
      tls_bootstrap_b64     = base64encode(file("${path.module}/tls-bootstrap.sh"))
      tls_hostname          = var.tls_hostname
      tls_acme_email        = var.tls_acme_email
    }))
  }

  instance_options {
    are_legacy_imds_endpoints_disabled = true
  }

  freeform_tags = local.common_tags

  lifecycle {
    precondition {
      condition     = var.accept_oracle_always_free_capacity_risk
      error_message = "Set accept_oracle_always_free_capacity_risk=true only after acknowledging Always Free capacity/reclamation risk; this does not authorize paid fallback."
    }

    precondition {
      condition     = var.confirm_free_volume_headroom
      error_message = "Set confirm_free_volume_headroom=true only after confirming remaining tenancy Always Free block-volume headroom."
    }

    precondition {
      condition     = var.availability_domain_index < length(data.oci_identity_availability_domains.available.availability_domains)
      error_message = "availability_domain_index does not exist in the selected OCI region."
    }
  }
}

output "public_ip" {
  value = oci_core_instance.daube_free_host.public_ip
}

output "instance_id" {
  value = oci_core_instance.daube_free_host.id
}

output "availability_domain_candidates" {
  value       = [for ad in data.oci_identity_availability_domains.available.availability_domains : ad.name]
  description = "Availability Domains visible in the tenancy home region; useful for bounded A1 capacity failover."
}

output "selected_availability_domain" {
  value       = oci_core_instance.daube_free_host.availability_domain
  description = "Availability Domain selected for the A1 instance."
}

output "origin_url" {
  value = "http://${oci_core_instance.daube_free_host.public_ip}"
}

output "health_url" {
  value = "http://${oci_core_instance.daube_free_host.public_ip}/healthz"
}

output "worker_direct_url" {
  value       = "http://${oci_core_instance.daube_free_host.public_ip}"
  description = "Direct origin URL for non-secret health/capability canaries only. Compute POST is HTTPS-only."
}

output "tls_hostname_mode" {
  value       = var.tls_hostname
  description = "Configured TLS hostname or 'auto'. In auto mode runtime derives daube-<public-ip>.sslip.io without a DNS account."
}

output "worker_auth_token" {
  value       = random_password.worker_auth.result
  sensitive   = true
  description = "Bind to DAUBE_ORACLE_A1_WORKER_TOKEN. Store in a secret manager; do not commit."
}

output "worker_receipt_secret" {
  value       = random_password.worker_receipt.result
  sensitive   = true
  description = "Bind to DAUBE_ORACLE_A1_RECEIPT_SECRET. Store in a secret manager; do not commit."
}

output "resource_farm_classification" {
  value = {
    hosting               = "CANDIDATE_AFTER_RUNTIME_CANARY"
    compute               = "CANDIDATE_AFTER_RUNTIME_CANARY"
    provider_family       = "oracle-cloud"
    sovereign_local       = false
    paid_spend_authorized = false
    commercial_role       = "bounded-production-origin-worker"
    worker_contract       = "daube.compute.v1"
    tls_bootstrap         = var.tls_hostname == "auto" ? "public-ca-auto-dns" : "public-ca-branded-dns"
  }
}
