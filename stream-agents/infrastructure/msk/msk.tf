resource "aws_security_group" "msk" {
  name_prefix = "${var.project_name}-msk-sg"
  vpc_id      = aws_vpc.main.id

  # Allow all inbound from VPC
  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }

  # Allow inbound IAM auth port (9198) from everywhere (Public Access)
  ingress {
    from_port   = 9198
    to_port     = 9198
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "MSK Public Access (IAM)"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-msk-sg"
  }
}

resource "aws_msk_cluster" "main" {
  cluster_name           = "${var.project_name}-cluster"
  kafka_version          = "3.5.1"
  number_of_broker_nodes = 2

  broker_node_group_info {
    instance_type   = "kafka.t3.small"
    client_subnets  = aws_subnet.public[*].id
    security_groups = [aws_security_group.msk.id]
    
    connectivity_info {
      public_access {
        type = var.public_access_type
      }
    }
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  client_authentication {
    sasl {
      iam   = true
      scram = false
    }
    unauthenticated = false
  }
  
  tags = {
    Name = "${var.project_name}-cluster"
  }
}
