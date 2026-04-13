/**
 * ═══════════════════════════════════════════════════════════════════════════
 *                              INFRATALES™
 *              Production-Ready AWS Infrastructure Solutions
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @project     aws-cdk-multi-region-payment-infrastructure-vpc-peering-rds
 * @file        test/tap-stack.unit.test.ts
 * @author      Rahul Ladumor <rahul.ladumor@infratales.com>
 * @copyright   Copyright (c) 2024-2026 Rahul Ladumor / InfraTales
 * @license     InfraTales Open Source License (see LICENSE file)
 *
 * @website     https://infratales.com
 * @github      https://github.com/InfraTales
 * @portfolio   https://www.rahulladumor.in
 *
 * ───────────────────────────────────────────────────────────────────────────
 * This file is part of InfraTales open-source infrastructure projects.
 * Unauthorized removal of this header violates the license terms.
 *
 * SIGNATURE: INFRATALES-6DCC1FF200CB
 * ═══════════════════════════════════════════════════════════════════════════
 */

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { TapStack } from '../lib/tap-stack';

const environmentSuffix = process.env.ENVIRONMENT_SUFFIX || 'dev';

describe('TapStack', () => {
  let app: cdk.App;
  let stack: TapStack;
  let template: Template;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    app = new cdk.App();
    stack = new TapStack(app, 'TestTapStack', { environmentSuffix });
    template = Template.fromStack(stack);
  });

  describe('TapStack Unit Tests', () => {
    test('should create the stack successfully', () => {
      expect(stack).toBeDefined();
      expect(template).toBeDefined();
    });

    test('should create VPC resources', () => {
      // Verify VPCs are created
      template.resourceCountIs('AWS::EC2::VPC', 2);
    });

    test('should create DynamoDB table', () => {
      // Verify DynamoDB table is created
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    test('should create Lambda function', () => {
      // Verify Lambda function is created
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
      });
    });

    test('should create RDS instance', () => {
      // Verify RDS instance is created
      template.resourceCountIs('AWS::RDS::DBInstance', 1);
    });

    test('should create S3 buckets', () => {
      // Verify S3 buckets are created (source and destination)
      template.resourceCountIs('AWS::S3::Bucket', 2);
    });

    test('should create CloudWatch alarms', () => {
      // Verify CloudWatch alarms are created
      template.resourceCountIs('AWS::CloudWatch::Alarm', 2);
    });

    test('should create API Gateway HTTP API', () => {
      // Verify API Gateway is created
      template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    });
  });
});
