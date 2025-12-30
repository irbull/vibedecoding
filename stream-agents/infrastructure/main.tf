terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  description = "AWS Region"
  type        = string
  default     = "us-west-2"
}

variable "project_name" {
  description = "Project name for tagging"
  type        = string
  default     = "stream-agents"
}

variable "public_access_type" {
  description = "Public access setting for MSK. Use DISABLED for creation, then SERVICE_PROVIDED_EIPS for update."
  type        = string
  default     = "DISABLED"
}
