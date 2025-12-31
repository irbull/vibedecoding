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
  default     = "stream-agents-ec2"
}

variable "kafka_sasl_username" {
  description = "Kafka SASL/PLAIN username"
  type        = string
}

variable "kafka_sasl_password" {
  description = "Kafka SASL/PLAIN password"
  type        = string
  sensitive   = true
}
