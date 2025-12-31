# Route53 DNS record for Kafka TLS endpoint

data "aws_route53_zone" "main" {
  name = "vibedecoding.io"
}

resource "aws_route53_record" "kafka" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.kafka_domain
  type    = "A"
  ttl     = 60 # Low TTL for quick updates on destroy/recreate

  records = [aws_eip.kafka.public_ip]
}
