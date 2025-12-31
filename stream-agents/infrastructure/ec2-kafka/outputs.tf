output "public_ip" {
  description = "Public IP of the Kafka instance"
  value       = aws_eip.kafka.public_ip
}

output "kafka_tls_endpoint" {
  description = "Kafka TLS endpoint (use this in clients)"
  value       = "${var.kafka_domain}:9093"
}

output "kafka_connection_string" {
  description = "Kafka Connection String (internal, no TLS)"
  value       = "${aws_eip.kafka.public_ip}:9092"
}

output "ssh_command" {
  description = "SSH Command"
  value       = "ssh ubuntu@${aws_eip.kafka.public_ip}"
}

output "dns_record" {
  description = "Route53 DNS record created"
  value       = "${aws_route53_record.kafka.name} -> ${aws_eip.kafka.public_ip} (TTL: ${aws_route53_record.kafka.ttl}s)"
}
