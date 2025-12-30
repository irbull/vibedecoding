output "bootstrap_brokers_sasl_iam" {
  description = "Private TLS connection host:port pairs"
  value       = aws_msk_cluster.main.bootstrap_brokers_sasl_iam
}

output "bootstrap_brokers_public_sasl_iam" {
  description = "Public TLS connection host:port pairs (IAM)"
  value       = aws_msk_cluster.main.bootstrap_brokers_public_sasl_iam
}

output "zookeeper_connect_string" {
  value = aws_msk_cluster.main.zookeeper_connect_string
}
