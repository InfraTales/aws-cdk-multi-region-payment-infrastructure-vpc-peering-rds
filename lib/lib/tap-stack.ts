/**
 * ═══════════════════════════════════════════════════════════════════════════
 *                              INFRATALES™
 *              Production-Ready AWS Infrastructure Solutions
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @project     aws-cdk-multi-region-payment-infrastructure-vpc-peering-rds
 * @file        lib/tap-stack.ts
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
 * SIGNATURE: INFRATALES-67881E3435FE
 * ═══════════════════════════════════════════════════════════════════════════
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

interface TapStackProps extends cdk.StackProps {
  environmentSuffix?: string;
}

export class TapStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: TapStackProps) {
    super(scope, id, props);

    // Get environment suffix from props, context, or use 'dev' as default
    const environmentSuffix =
      props?.environmentSuffix ||
      this.node.tryGetContext('environmentSuffix') ||
      'dev';

    // Standard removal policy for LocalStack
    const removalPolicy = cdk.RemovalPolicy.DESTROY;

    // ===========================================
    // MULTI-REGION VPC INFRASTRUCTURE
    // ===========================================

    // VPC in eu-central-2 (Milan)
    const vpcEuCentral2 = new ec2.Vpc(this, 'VpcEuCentral2', {
      vpcName: `payment-vpc-eucentral2-${environmentSuffix}`,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 2,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // VPC in eu-west-1 (Ireland)
    const vpcEuWest1 = new ec2.Vpc(this, 'VpcEuWest1', {
      vpcName: `payment-vpc-euwest1-${environmentSuffix}`,
      ipAddresses: ec2.IpAddresses.cidr('10.1.0.0/16'),
      maxAzs: 2,
      natGateways: 2,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // VPC Peering Connection
    const vpcPeering = new ec2.CfnVPCPeeringConnection(this, 'VpcPeering', {
      vpcId: vpcEuCentral2.vpcId,
      peerVpcId: vpcEuWest1.vpcId,
      peerRegion: 'eu-west-1',
      tags: [
        {
          key: 'Name',
          value: `payment-peering-${environmentSuffix}`,
        },
      ],
    });

    // Add routes for VPC peering in eu-central-2
    vpcEuCentral2.privateSubnets.forEach((subnet, index) => {
      new ec2.CfnRoute(this, `PeeringRouteEuCentral2Private${index}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '10.1.0.0/16',
        vpcPeeringConnectionId: vpcPeering.ref,
      });
    });

    vpcEuCentral2.publicSubnets.forEach((subnet, index) => {
      new ec2.CfnRoute(this, `PeeringRouteEuCentral2Public${index}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '10.1.0.0/16',
        vpcPeeringConnectionId: vpcPeering.ref,
      });
    });

    // Add routes for VPC peering in eu-west-1
    vpcEuWest1.privateSubnets.forEach((subnet, index) => {
      new ec2.CfnRoute(this, `PeeringRouteEuWest1Private${index}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '10.0.0.0/16',
        vpcPeeringConnectionId: vpcPeering.ref,
      });
    });

    vpcEuWest1.publicSubnets.forEach((subnet, index) => {
      new ec2.CfnRoute(this, `PeeringRouteEuWest1Public${index}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '10.0.0.0/16',
        vpcPeeringConnectionId: vpcPeering.ref,
      });
    });

    // ===========================================
    // SECURITY GROUPS
    // ===========================================

    // Security group for Lambda
    const lambdaSecurityGroup = new ec2.SecurityGroup(
      this,
      'LambdaSecurityGroup',
      {
        vpc: vpcEuWest1,
        securityGroupName: `payment-lambda-sg-${environmentSuffix}`,
        description: 'Security group for payment processing Lambda',
        allowAllOutbound: true,
      }
    );

    // Security group for RDS
    const rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc: vpcEuWest1,
      securityGroupName: `payment-rds-sg-${environmentSuffix}`,
      description: 'Security group for RDS PostgreSQL',
      allowAllOutbound: false,
    });

    // Allow Lambda to connect to RDS on PostgreSQL port
    rdsSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Lambda to connect to RDS'
    );

    // ===========================================
    // KMS KEY FOR RDS ENCRYPTION
    // ===========================================

    const rdsKmsKey = new kms.Key(this, 'RdsKmsKey', {
      alias: `payment-rds-key-${environmentSuffix}`,
      description: 'KMS key for RDS encryption',
      enableKeyRotation: true,
      removalPolicy: removalPolicy,
    });

    // ===========================================
    // RDS POSTGRESQL DATABASE
    // ===========================================

    // DB Subnet Group
    const dbSubnetGroup = new rds.SubnetGroup(this, 'DbSubnetGroup', {
      subnetGroupName: `payment-db-subnet-${environmentSuffix}`,
      description: 'Subnet group for RDS PostgreSQL',
      vpc: vpcEuWest1,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      removalPolicy: removalPolicy,
    });

    // RDS PostgreSQL Instance
    const dbInstance = new rds.DatabaseInstance(this, 'RdsPostgres', {
      instanceIdentifier: `payment-db-${environmentSuffix}`,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_17_4,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      vpc: vpcEuWest1,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      subnetGroup: dbSubnetGroup,
      securityGroups: [rdsSecurityGroup],
      multiAz: true,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      storageEncryptionKey: rdsKmsKey,
      databaseName: 'paymentdb',
      credentials: rds.Credentials.fromGeneratedSecret('dbadmin'),
      backupRetention: cdk.Duration.days(7),
      deleteAutomatedBackups: true,
      removalPolicy: removalPolicy,
      deletionProtection: false,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
    });

    // ===========================================
    // DYNAMODB TABLE
    // ===========================================

    const transactionTable = new dynamodb.Table(this, 'TransactionTable', {
      tableName: `payment-transactions-${environmentSuffix}`,
      partitionKey: {
        name: 'transactionId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: removalPolicy,
    });

    // GSI for customer queries
    transactionTable.addGlobalSecondaryIndex({
      indexName: 'CustomerIndex',
      partitionKey: {
        name: 'customerId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI for status queries
    transactionTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // ===========================================
    // S3 BUCKETS WITH CROSS-REGION REPLICATION
    // ===========================================

    // IAM role for S3 replication
    const replicationRole = new iam.Role(this, 'S3ReplicationRole', {
      roleName: `payment-s3-replication-${environmentSuffix}`,
      assumedBy: new iam.ServicePrincipal('s3.amazonaws.com'),
      description: 'IAM role for S3 cross-region replication',
    });

    // Source S3 bucket in eu-central-2
    const sourceS3Bucket = new s3.Bucket(this, 'SourceS3Bucket', {
      bucketName: `payment-data-eucentral2-${environmentSuffix}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: removalPolicy,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Destination S3 bucket in eu-west-1
    const destinationS3Bucket = new s3.Bucket(this, 'DestinationS3Bucket', {
      bucketName: `payment-data-euwest1-${environmentSuffix}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: removalPolicy,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Grant replication role permissions
    sourceS3Bucket.grantRead(replicationRole);
    destinationS3Bucket.grantWrite(replicationRole);

    // Add replication policy to source bucket
    const cfnSourceBucket = sourceS3Bucket.node.defaultChild as s3.CfnBucket;
    cfnSourceBucket.replicationConfiguration = {
      role: replicationRole.roleArn,
      rules: [
        {
          id: 'ReplicateToEuWest1',
          status: 'Enabled',
          priority: 1,
          filter: {},
          destination: {
            bucket: destinationS3Bucket.bucketArn,
            replicationTime: {
              status: 'Enabled',
              time: {
                minutes: 15,
              },
            },
            metrics: {
              status: 'Enabled',
              eventThreshold: {
                minutes: 15,
              },
            },
          },
          deleteMarkerReplication: {
            status: 'Disabled',
          },
        },
      ],
    };

    // ===========================================
    // LAMBDA FUNCTION FOR PAYMENT PROCESSING
    // ===========================================

    // Lambda execution role
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      roleName: `payment-lambda-role-${environmentSuffix}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaVPCAccessExecutionRole'
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    // Grant Lambda permissions to DynamoDB
    transactionTable.grantReadWriteData(lambdaRole);

    // Grant Lambda permissions to read RDS secret
    dbInstance.secret?.grantRead(lambdaRole);

    // Explicit deny rules for destructive actions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: [
          'dynamodb:DeleteTable',
          'dynamodb:DeleteItem',
          's3:DeleteBucket',
          'rds:DeleteDBInstance',
        ],
        resources: ['*'],
      })
    );

    // Lambda function
    const paymentFunction = new lambda.Function(this, 'PaymentFunction', {
      functionName: `payment-processor-${environmentSuffix}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION,
  ...(process.env.AWS_ENDPOINT_URL && {
    endpoint: process.env.AWS_ENDPOINT_URL,
  }),
});

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION,
  ...(process.env.AWS_ENDPOINT_URL && {
    endpoint: process.env.AWS_ENDPOINT_URL,
  }),
});

exports.handler = async (event) => {
  console.log('Processing payment request:', JSON.stringify(event));

  const transactionId = \`txn-\${Date.now()}-\${Math.random().toString(36).substring(7)}\`;
  const timestamp = new Date().toISOString();

  try {
    // Get RDS credentials from Secrets Manager
    const secretArn = process.env.DB_SECRET_ARN;
    if (secretArn) {
      const secretCommand = new GetSecretValueCommand({ SecretId: secretArn });
      const secretData = await secretsClient.send(secretCommand);
      console.log('Retrieved database credentials');
    }

    // Store transaction in DynamoDB
    const item = {
      transactionId: { S: transactionId },
      timestamp: { S: timestamp },
      customerId: { S: event.customerId || 'unknown' },
      status: { S: 'pending' },
      amount: { N: String(event.amount || 0) },
      currency: { S: event.currency || 'EUR' },
    };

    const putCommand = new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: item,
    });

    await dynamoClient.send(putCommand);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Payment processed successfully',
        transactionId,
        timestamp,
      }),
    };
  } catch (error) {
    console.error('Error processing payment:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Payment processing failed',
        message: error.message,
      }),
    };
  }
};
      `),
      vpc: vpcEuWest1,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSecurityGroup],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      reservedConcurrentExecutions: 10,
      role: lambdaRole,
      environment: {
        TABLE_NAME: transactionTable.tableName,
        DB_ENDPOINT: dbInstance.dbInstanceEndpointAddress,
        DB_SECRET_ARN: dbInstance.secret?.secretArn || '',
        ENVIRONMENT_SUFFIX: environmentSuffix,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // ===========================================
    // API GATEWAY HTTP API
    // ===========================================

    const httpApi = new apigatewayv2.HttpApi(this, 'PaymentHttpApi', {
      apiName: `payment-api-${environmentSuffix}`,
      description: 'Payment processing HTTP API',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigatewayv2.CorsHttpMethod.POST],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Lambda integration
    const lambdaIntegration =
      new apigatewayv2Integrations.HttpLambdaIntegration(
        'PaymentIntegration',
        paymentFunction
      );

    // Add route
    httpApi.addRoutes({
      path: '/payment',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: lambdaIntegration,
    });

    // ===========================================
    // CLOUDWATCH DASHBOARD
    // ===========================================

    const dashboard = new cloudwatch.Dashboard(this, 'PaymentDashboard', {
      dashboardName: `payment-dashboard-${environmentSuffix}`,
    });

    // Lambda metrics
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: [paymentFunction.metricInvocations()],
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [paymentFunction.metricErrors()],
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration',
        left: [paymentFunction.metricDuration()],
      })
    );

    // RDS metrics
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'RDS CPU Utilization',
        left: [
          dbInstance.metricCPUUtilization({
            statistic: 'Average',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'RDS Database Connections',
        left: [
          dbInstance.metricDatabaseConnections({
            statistic: 'Sum',
          }),
        ],
      })
    );

    // DynamoDB metrics
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Read Capacity',
        left: [
          transactionTable.metricConsumedReadCapacityUnits({
            statistic: 'Sum',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Write Capacity',
        left: [
          transactionTable.metricConsumedWriteCapacityUnits({
            statistic: 'Sum',
          }),
        ],
      })
    );

    // ===========================================
    // CLOUDWATCH ALARMS
    // ===========================================

    // Lambda error alarm
    new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: `payment-lambda-errors-${environmentSuffix}`,
      alarmDescription: 'Alarm when Lambda errors exceed threshold',
      metric: paymentFunction.metricErrors({
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    // RDS CPU alarm
    new cloudwatch.Alarm(this, 'RdsCpuAlarm', {
      alarmName: `payment-rds-cpu-${environmentSuffix}`,
      alarmDescription: 'Alarm when RDS CPU exceeds 80%',
      metric: dbInstance.metricCPUUtilization({
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    // ===========================================
    // OUTPUTS
    // ===========================================

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: httpApi.url || 'N/A',
      description: 'API Gateway endpoint URL',
      exportName: `payment-api-endpoint-${environmentSuffix}`,
    });

    new cdk.CfnOutput(this, 'DynamoDbTableName', {
      value: transactionTable.tableName,
      description: 'DynamoDB table name',
      exportName: `payment-table-name-${environmentSuffix}`,
    });

    new cdk.CfnOutput(this, 'RdsEndpoint', {
      value: dbInstance.dbInstanceEndpointAddress,
      description: 'RDS PostgreSQL endpoint',
      exportName: `payment-db-endpoint-${environmentSuffix}`,
    });

    new cdk.CfnOutput(this, 'SourceBucketName', {
      value: sourceS3Bucket.bucketName,
      description: 'Source S3 bucket name (eu-central-2)',
      exportName: `payment-source-bucket-${environmentSuffix}`,
    });

    new cdk.CfnOutput(this, 'DestinationBucketName', {
      value: destinationS3Bucket.bucketName,
      description: 'Destination S3 bucket name (eu-west-1)',
      exportName: `payment-dest-bucket-${environmentSuffix}`,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: paymentFunction.functionName,
      description: 'Lambda function name',
      exportName: `payment-lambda-name-${environmentSuffix}`,
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbInstance.secret?.secretArn || 'N/A',
      description: 'RDS database secret ARN',
      exportName: `payment-db-secret-${environmentSuffix}`,
    });
  }
}
