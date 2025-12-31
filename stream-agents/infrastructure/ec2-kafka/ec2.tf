data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_security_group" "kafka" {
  name_prefix = "${var.project_name}-sg"
  vpc_id      = aws_vpc.main.id

  # Kafka TLS Access (via Caddy proxy)
  ingress {
    from_port   = 9093
    to_port     = 9093
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Kafka TLS Public Access"
  }

  # HTTP for Let's Encrypt ACME challenge
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP for ACME challenge"
  }

  # SSH Access (Optional, for debugging)
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-sg"
  }
}

resource "aws_instance" "kafka" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.small"
  subnet_id     = aws_subnet.public[0].id

  vpc_security_group_ids = [aws_security_group.kafka.id]
  associate_public_ip_address = true

  # Force instance replacement when user_data changes
  user_data_replace_on_change = true

  root_block_device {
    volume_size = 20 # GB
    volume_type = "gp3"
  }

  user_data = <<-EOF
#!/bin/bash
set -e

# Update and install Docker, nginx, certbot
apt-get update
apt-get install -y docker.io curl

# Install certbot and nginx with stream module
apt-get install -y certbot nginx libnginx-mod-stream

# Mount EBS volume for certs
# On Nitro instances (t3, etc), EBS volumes appear as /dev/nvme*
# Find the 1GB volume (our data volume) that isn't the root disk
EBS_DEVICE=""
for i in $(seq 1 60); do
  for dev in /dev/nvme1n1 /dev/nvme2n1; do
    if [ -b "$dev" ]; then
      SIZE=$(lsblk -b -d -n -o SIZE "$dev" 2>/dev/null || echo 0)
      if [ "$SIZE" -gt 500000000 ] && [ "$SIZE" -lt 2000000000 ]; then
        EBS_DEVICE="$dev"
        break 2
      fi
    fi
  done
  sleep 1
done

if [ -z "$EBS_DEVICE" ]; then
  echo "ERROR: Could not find EBS volume" >&2
  exit 1
fi

echo "Found EBS volume at $EBS_DEVICE"

# Format if needed (first boot only)
if ! blkid "$EBS_DEVICE"; then
  mkfs.ext4 "$EBS_DEVICE"
fi

mkdir -p /data
mount "$EBS_DEVICE" /data

# Ensure mount persists across reboots (use UUID for reliability)
EBS_UUID=$(blkid -s UUID -o value "$EBS_DEVICE")
if ! grep -q "$EBS_UUID" /etc/fstab; then
  echo "UUID=$EBS_UUID /data ext4 defaults,nofail 0 2" >> /etc/fstab
fi

# Create cert storage directory on EBS
mkdir -p /data/letsencrypt

# Stop nginx temporarily for certbot standalone mode
systemctl stop nginx

# Obtain Let's Encrypt certificate
certbot certonly --standalone \
  --non-interactive \
  --agree-tos \
  --email admin@${var.kafka_domain} \
  --domain ${var.kafka_domain} \
  --config-dir /data/letsencrypt \
  --work-dir /data/letsencrypt/work \
  --logs-dir /data/letsencrypt/logs

# Configure nginx as TCP/TLS proxy for Kafka
cat > /etc/nginx/nginx.conf <<'NGINXEOF'
load_module /usr/lib/nginx/modules/ngx_stream_module.so;

user www-data;
worker_processes auto;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

stream {
    upstream kafka_backend {
        server 127.0.0.1:9092;
    }

    server {
        listen 9093 ssl;

        ssl_certificate /data/letsencrypt/live/KAFKA_DOMAIN/fullchain.pem;
        ssl_certificate_key /data/letsencrypt/live/KAFKA_DOMAIN/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        proxy_pass kafka_backend;
        proxy_connect_timeout 10s;
    }
}
NGINXEOF

# Replace placeholder with actual domain
sed -i 's|KAFKA_DOMAIN|${var.kafka_domain}|g' /etc/nginx/nginx.conf

# Start nginx
systemctl start nginx
systemctl enable nginx

# Set up certbot auto-renewal cron
echo "0 3 * * * root certbot renew --config-dir /data/letsencrypt --work-dir /data/letsencrypt/work --logs-dir /data/letsencrypt/logs --post-hook 'systemctl reload nginx'" > /etc/cron.d/certbot-renew

# Start Kafka (KRaft mode)
docker rm -f kafka 2>/dev/null || true
docker run -d --name kafka \
  --restart always \
  -p 127.0.0.1:9092:9092 \
  -p 9094:9094 \
  -e KAFKA_NODE_ID=1 \
  -e KAFKA_PROCESS_ROLES=controller,broker \
  -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9094 \
  -e KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9094 \
  -e KAFKA_ADVERTISED_LISTENERS="PLAINTEXT://${var.kafka_domain}:9093" \
  -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:SASL_PLAINTEXT \
  -e KAFKA_SASL_ENABLED_MECHANISMS=PLAIN \
  -e KAFKA_LISTENER_NAME_PLAINTEXT_SASL_ENABLED_MECHANISMS=PLAIN \
  -e KAFKA_LISTENER_NAME_PLAINTEXT_PLAIN_SASL_JAAS_CONFIG="org.apache.kafka.common.security.plain.PlainLoginModule required username=\"${var.kafka_sasl_username}\" password=\"${var.kafka_sasl_password}\" user_${var.kafka_sasl_username}=\"${var.kafka_sasl_password}\";" \
  -e KAFKA_SASL_MECHANISM_INTER_BROKER_PROTOCOL=PLAIN \
  -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
  -e KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  -e KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0 \
  -e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 \
  -e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 \
  -e CLUSTER_ID=MkU3OEVBNTcwNTJENDM2Qk \
  confluentinc/cp-kafka:7.6.0
EOF

  tags = {
    Name = "${var.project_name}-instance"
  }
}

resource "aws_eip" "kafka" {
  domain = "vpc"

  tags = {
    Name = "${var.project_name}-eip"
  }
}

resource "aws_eip_association" "kafka" {
  instance_id   = aws_instance.kafka.id
  allocation_id = aws_eip.kafka.id
}

# EBS volume for Let's Encrypt certs (persists across instance recreations)
resource "aws_ebs_volume" "caddy_data" {
  availability_zone = aws_subnet.public[0].availability_zone
  size              = 1 # GB - plenty for certs
  type              = "gp3"

  tags = {
    Name = "${var.project_name}-caddy-data"
  }
}

resource "aws_volume_attachment" "caddy_data" {
  device_name = "/dev/xvdf"
  volume_id   = aws_ebs_volume.caddy_data.id
  instance_id = aws_instance.kafka.id
}
