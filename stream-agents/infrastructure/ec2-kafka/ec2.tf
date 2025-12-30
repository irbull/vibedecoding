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

  # Kafka Client Access
  ingress {
    from_port   = 9092
    to_port     = 9092
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Kafka Public Access"
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

  root_block_device {
    volume_size = 20 # GB
    volume_type = "gp3"
  }

  user_data = <<-EOF
              #!/bin/bash
              # Update and install Docker
              apt-get update
              apt-get install -y docker.io curl

              # Get Public IP
              TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
              PUBLIC_IP=$(curl -H "X-aws-ec2-metadata-token: \$TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)

              # Start Kafka (KRaft mode)
              # Public Access via Port 9092 advertising the EC2 Public IP
              docker run -d --name kafka \
                --restart always \
                -p 9092:9092 \
                -e KAFKA_ENABLE_KRAFT=yes \
                -e KAFKA_CFG_NODE_ID=1 \
                -e KAFKA_CFG_PROCESS_ROLES=controller,broker \
                -e KAFKA_CFG_CONTROLLER_QUORUM_VOTERS=1@127.0.0.1:9093 \
                -e KAFKA_CFG_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093 \
                -e KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT \
                -e KAFKA_CFG_ADVERTISED_LISTENERS=PLAINTEXT://\$PUBLIC_IP:9092 \
                -e KAFKA_CFG_CONTROLLER_LISTENER_NAMES=CONTROLLER \
                -e KAFKA_CFG_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
                bitnami/kafka:latest
              EOF

  tags = {
    Name = "${var.project_name}-instance"
  }
}

resource "aws_eip" "kafka" {
  instance = aws_instance.kafka.id
  domain   = "vpc"

  tags = {
    Name = "${var.project_name}-eip"
  }
}
