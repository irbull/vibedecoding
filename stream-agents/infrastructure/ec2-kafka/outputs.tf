output "public_ip" {
  description = "Public IP of the Kafka instance"
  value       = aws_eip.kafka.public_ip
}

output "kafka_connection_string" {
  description = "Kafka Connection String"
  value       = "${aws_eip.kafka.public_ip}:9092"
}

output "ssh_command" {
  description = "SSH Command"
  value       = "ssh ubuntu@${aws_eip.kafka.public_ip}"
}
