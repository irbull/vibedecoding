# Auto-reset Kafka state when infrastructure is recreated
#
# When the EC2 instance is destroyed and recreated, Kafka topic offsets reset to 0.
# Without clearing the DB's dedupe tables, the materializer will think offset 0 is
# a duplicate and skip all new events.
#
# This null_resource runs `kafka:reset` locally after the instance is ready.

resource "null_resource" "kafka_reset" {
  # Re-run when the EC2 instance is recreated
  triggers = {
    instance_id = aws_instance.kafka.id
  }

  # Wait for Kafka to be ready (user_data needs ~2-3 min to complete)
  provisioner "local-exec" {
    command = <<-EOT
      echo "Waiting for Kafka to be ready..."
      sleep 180
      echo "Running kafka:reset..."
      cd ${path.module}/../.. && bun run kafka:reset
    EOT
  }

  depends_on = [aws_instance.kafka, aws_route53_record.kafka]
}
