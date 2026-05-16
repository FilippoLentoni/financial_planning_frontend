import * as path from 'path';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_ecs_patterns as ecsPatterns,
  aws_ecr_assets as ecrAssets,
  aws_logs as logs,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cognito as cognito,
  aws_iam as iam,
  custom_resources as cr,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StageConfig } from './config';

export interface FinancialPlanningFrontendStackProps extends StackProps {
  readonly stage: StageConfig;
}

export class FinancialPlanningFrontendStack extends Stack {
  constructor(scope: Construct, id: string, props: FinancialPlanningFrontendStackProps) {
    super(scope, id, props);

    const removalPolicy =
      props.stage.removalPolicy === 'destroy' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;

    const image = new ecrAssets.DockerImageAsset(this, 'AppImage', {
      directory: path.join(__dirname, '..', 'app'),
      platform: ecrAssets.Platform.LINUX_AMD64,
    });

    const logGroup = new logs.LogGroup(this, 'ServiceLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy,
    });

    const appName = `financial-planning-frontend-${props.stage.name}`;
    const cognitoDomainPrefix = `${appName}-${this.account.slice(-6)}`.toLowerCase();

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${appName}-users`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
      },
      removalPolicy,
    });

    userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix: cognitoDomainPrefix,
      },
    });

    const userPoolClient = userPool.addClient('FrontendClient', {
      userPoolClientName: `${appName}-client`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        callbackUrls: ['http://localhost:3000', 'http://localhost:3000/callback'],
        logoutUrls: ['http://localhost:3000', 'http://localhost:3000/logout'],
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.COGNITO_ADMIN],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: `financial_planning_frontend_${props.stage.name}`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });

    authenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:Invoke', 'bedrock-agentcore:InvokeRuntime'],
        resources: props.stage.runtimeArn
          ? [props.stage.runtimeArn]
          : [`arn:aws:bedrock-agentcore:*:${this.account}:runtime/*`],
      }),
    );
    authenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:Invoke'],
        resources: [
          `arn:aws:execute-api:*:${this.account}:*/*/POST/runtime/invoke`,
          `arn:aws:execute-api:*:${this.account}:*/*/GET/planning/runs`,
          `arn:aws:execute-api:*:${this.account}:*/*/POST/planning/runs`,
          `arn:aws:execute-api:*:${this.account}:*/*/GET/gateways/iam`,
          `arn:aws:execute-api:*:${this.account}:*/*/POST/mcp/proxy`,
        ],
      }),
    );
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    const vpc = new ec2.Vpc(this, 'Vpc', {
      availabilityZones: [`${props.stage.region}a`, `${props.stage.region}b`],
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });
    vpc.applyRemovalPolicy(removalPolicy);

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'WebService', {
      vpc,
      publicLoadBalancer: true,
      assignPublicIp: true,
      desiredCount: 1,
      minHealthyPercent: 100,
      cpu: 256,
      memoryLimitMiB: 512,
      serviceName: props.stage.serviceName,
      taskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(image),
        containerPort: 8080,
        logDriver: ecs.LogDrivers.awsLogs({
          logGroup,
          streamPrefix: props.stage.serviceName,
        }),
        environment: {
          APP_STAGE: props.stage.name,
          APP_REGION: props.stage.region,
          BACKEND_API_URL: props.stage.backendApiUrl,
          RUNTIME_WS_URL: props.stage.runtimeWsUrl,
          RUNTIME_ENDPOINT: props.stage.runtimeEndpoint,
          RUNTIME_ARN: props.stage.runtimeArn,
          WORKFLOW_WS_URL: props.stage.workflowWsUrl,
          COGNITO_IDENTITY_POOL_ID: identityPool.ref,
          COGNITO_BASE_URL: `${cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`,
          COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
          COGNITO_USER_POOL_ID: userPool.userPoolId,
        },
      },
    });
    service.targetGroup.configureHealthCheck({
      path: '/health',
      healthyHttpCodes: '200',
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });
    service.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '30');

    service.node.addDependency(logGroup);

    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(service.loadBalancer, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      },
      defaultRootObject: 'index.html',
    });

    const serviceUrl = `https://${distribution.distributionDomainName}`;
    const logoutUrl = `${serviceUrl}/logout`;

    const callbackUpdater = new cr.AwsCustomResource(this, 'CognitoCallbackUrls', {
      installLatestAwsSdk: false,
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPoolClient',
        parameters: {
          UserPoolId: userPool.userPoolId,
          ClientId: userPoolClient.userPoolClientId,
          CallbackURLs: ['http://localhost:3000', 'http://localhost:3000/callback', serviceUrl],
          LogoutURLs: ['http://localhost:3000', 'http://localhost:3000/logout', serviceUrl, logoutUrl],
          SupportedIdentityProviders: ['COGNITO'],
          AllowedOAuthFlows: ['code'],
          AllowedOAuthScopes: ['openid', 'email', 'aws.cognito.signin.user.admin'],
          AllowedOAuthFlowsUserPoolClient: true,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${id}-cognito-callbacks`),
      },
      onUpdate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPoolClient',
        parameters: {
          UserPoolId: userPool.userPoolId,
          ClientId: userPoolClient.userPoolClientId,
          CallbackURLs: ['http://localhost:3000', 'http://localhost:3000/callback', serviceUrl],
          LogoutURLs: ['http://localhost:3000', 'http://localhost:3000/logout', serviceUrl, logoutUrl],
          SupportedIdentityProviders: ['COGNITO'],
          AllowedOAuthFlows: ['code'],
          AllowedOAuthScopes: ['openid', 'email', 'aws.cognito.signin.user.admin'],
          AllowedOAuthFlowsUserPoolClient: true,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${id}-cognito-callbacks`),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [userPool.userPoolArn],
      }),
    });
    callbackUpdater.node.addDependency(distribution);

    new CfnOutput(this, 'ServiceUrl', { value: serviceUrl });
    new CfnOutput(this, 'LoadBalancerUrl', {
      value: `http://${service.loadBalancer.loadBalancerDnsName}`,
    });
    new CfnOutput(this, 'CognitoUserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'CognitoClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'CognitoIdentityPoolId', { value: identityPool.ref });
    new CfnOutput(this, 'CognitoHostedUiDomain', {
      value: `${cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`,
    });
    new CfnOutput(this, 'BackendApiUrl', { value: props.stage.backendApiUrl || 'not-configured' });
    new CfnOutput(this, 'RuntimeArn', { value: props.stage.runtimeArn || 'not-configured' });
    new CfnOutput(this, 'SmokeTestCommand', {
      value: `python tests/smoke_test.py --url ${serviceUrl}`,
    });
  }
}
