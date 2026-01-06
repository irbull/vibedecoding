# Auto-reset Kafka state when infrastructure is recreated
#
# When the MSK cluster is destroyed and recreated, Kafka topic offsets reset to 0.
# Without clearing the DB's dedupe tables, the materializer will think offset 0 is
# a duplicate and skip all new events.
#
# This null_resource runs `kafka:reset` locally after the cluster is ready.

resource "null_resource" "kafka_reset" {
  # Re-run when the MSK cluster is recreated
  triggers = {
    cluster_arn = aws_msk_cluster.main.arn
  }

  provisioner "local-exec" {
    command = <<-EOT
      echo "Running kafka:reset..."
      cd ${path.module}/../.. && bun run kafka:reset
    EOT
  }

  depends_on = [aws_msk_cluster.main]
}
