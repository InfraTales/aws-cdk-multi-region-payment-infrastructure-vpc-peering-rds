# Cost Model

## Overview

This is a reference cost model. Actual costs vary by usage, region, and configuration.

## Key Cost Drivers

- Lambda inside VPC adds 500ms–1s cold start penalty on first invocation [inferred] — for a payment API where p99 matters, this is a separate concern from Provisioned Concurrency cost (~$40–80/month per 10 units [editorial]); treat them as two distinct decisions: whether to accept cold starts, and whether to pay to eliminate them
- Two NAT Gateways (one per region) at ~$32/month each plus $0.045/GB data processing means cross-region Lambda egress through NAT is a quiet cost leak that only surfaces when transaction volume spikes [inferred]
- RDS PostgreSQL Multi-AZ in eu-west-1 adds ~$150–200/month over single-AZ for the standby instance, but failover is automatic within 60–120 seconds — for PCI-DSS audit purposes under Requirement 12.3, this is non-negotiable [inferred]

## Estimated Monthly Cost

| Component | Dev (₹) | Staging (₹) | Production (₹) |
|-----------|---------|-------------|-----------------|
| Compute   | ₹2,000–5,000 | ₹8,000–15,000 | ₹25,000–60,000 |
| Database  | ₹1,500–3,000 | ₹5,000–12,000 | ₹15,000–40,000 |
| Networking| ₹500–1,000   | ₹2,000–5,000  | ₹5,000–15,000  |
| Monitoring| ₹200–500     | ₹1,000–2,000  | ₹3,000–8,000   |
| **Total** | **₹4,200–9,500** | **₹16,000–34,000** | **₹48,000–1,23,000** |

> Estimates based on ap-south-1 (Mumbai) pricing. Actual costs depend on traffic, data volume, and reserved capacity.

## Cost Optimization Strategies

- Use Savings Plans or Reserved Instances for predictable workloads
- Enable auto-scaling with conservative scale-in policies
- Use DynamoDB on-demand for dev, provisioned for production
- Leverage S3 Intelligent-Tiering for infrequently accessed data
- Review Cost Explorer weekly for anomalies
