# Architecture Notes

## Overview

The stack deploys two VPCs — 10.0.0.0/16 in eu-central-2 and 10.1.0.0/16 in eu-west-1 — peered for cross-region connectivity [from-code], each with public subnets hosting NAT Gateways and private subnets isolating compute and data [from-code]. In eu-west-1, an API Gateway HTTP API routes POST /payment calls to a Node.js 20.x Lambda running inside the VPC, which writes to both a KMS-encrypted RDS PostgreSQL 17.4 Multi-AZ instance and a DynamoDB table with pay-per-request billing and PITR enabled [from-code]. S3 buckets in both regions with versioning and cross-region replication handle payment data durability [from-code], while CloudWatch dashboards and alarms provide operational visibility across the full stack [from-code]. The non-obvious design choice is running Lambda inside the VPC — necessary for private RDS connectivity but adding cold start latency and consuming ENI capacity in the /24 private subnet that most engineers underestimate at scale [inferred].

## Key Decisions

- Lambda inside VPC adds 500ms–1s cold start penalty on first invocation [inferred] — for a payment API where p99 matters, this is a separate concern from Provisioned Concurrency cost (~$40–80/month per 10 units [editorial]); treat them as two distinct decisions: whether to accept cold starts, and whether to pay to eliminate them
- Two NAT Gateways (one per region) at ~$32/month each plus $0.045/GB data processing means cross-region Lambda egress through NAT is a quiet cost leak that only surfaces when transaction volume spikes [inferred]
- VPC peering with manual route table entries across two regions has no built-in failover — if the peering connection drops, there is no automatic reroute and the ops runbook must cover this explicitly [inferred]
- Pay-per-request DynamoDB billing is correct for unpredictable fintech traffic but provisioned capacity becomes cheaper at roughly 200+ sustained WCU — a threshold a growing payment startup can hit within months [editorial]
- RDS PostgreSQL Multi-AZ in eu-west-1 adds ~$150–200/month over single-AZ for the standby instance, but failover is automatic within 60–120 seconds — for PCI-DSS audit purposes under Requirement 12.3, this is non-negotiable [inferred]
- S3 cross-region replication copies objects asynchronously with no guaranteed lag ceiling under heavy write load — treating the eu-central-2 replica as a real-time DR target without monitoring replication lag metrics is an unacceptable operational risk [from-code]