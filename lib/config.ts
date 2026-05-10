export interface StageConfig {
  readonly name: 'personal' | 'alpha' | 'gamma' | 'prod';
  readonly stackSuffix: 'Personal' | 'Alpha' | 'Gamma' | 'Prod';
  readonly account: string;
  readonly region: string;
  readonly removalPolicy: 'destroy' | 'retain';
  readonly serviceName: string;
  readonly backendApiUrl: string;
  readonly runtimeWsUrl: string;
  readonly runtimeEndpoint: string;
  readonly runtimeArn: string;
  readonly workflowWsUrl: string;
  readonly cognitoIdentityPoolId: string;
  readonly cognitoBaseUrl: string;
  readonly cognitoClientId: string;
  readonly cognitoUserPoolId: string;
}

const defaultAccount = process.env.CDK_DEFAULT_ACCOUNT ?? '111111111111';
const defaultRegion = process.env.APP_REGION ?? 'us-east-2';

export const STAGES: StageConfig[] = [
  {
    name: 'personal',
    stackSuffix: 'Personal',
    account: process.env.PERSONAL_ACCOUNT_ID ?? defaultAccount,
    region: process.env.PERSONAL_REGION ?? defaultRegion,
    removalPolicy: 'destroy',
    serviceName: 'financial-planning-frontend-personal',
    backendApiUrl: process.env.PERSONAL_BACKEND_API_URL ?? process.env.BACKEND_API_URL ?? '',
    runtimeWsUrl: process.env.PERSONAL_RUNTIME_WS_URL ?? process.env.RUNTIME_WS_URL ?? '',
    runtimeEndpoint: process.env.PERSONAL_RUNTIME_ENDPOINT ?? process.env.RUNTIME_ENDPOINT ?? '',
    runtimeArn: process.env.PERSONAL_RUNTIME_ARN ?? process.env.RUNTIME_ARN ?? '',
    workflowWsUrl: process.env.PERSONAL_WORKFLOW_WS_URL ?? process.env.WORKFLOW_WS_URL ?? '',
    cognitoIdentityPoolId: process.env.PERSONAL_COGNITO_IDENTITY_POOL_ID ?? process.env.COGNITO_IDENTITY_POOL_ID ?? '',
    cognitoBaseUrl: process.env.PERSONAL_COGNITO_BASE_URL ?? process.env.COGNITO_BASE_URL ?? '',
    cognitoClientId: process.env.PERSONAL_COGNITO_CLIENT_ID ?? process.env.COGNITO_CLIENT_ID ?? '',
    cognitoUserPoolId: process.env.PERSONAL_COGNITO_USER_POOL_ID ?? process.env.COGNITO_USER_POOL_ID ?? '',
  },
  {
    name: 'alpha',
    stackSuffix: 'Alpha',
    account: process.env.ALPHA_ACCOUNT_ID ?? defaultAccount,
    region: process.env.ALPHA_REGION ?? defaultRegion,
    removalPolicy: 'retain',
    serviceName: 'financial-planning-frontend-alpha',
    backendApiUrl: process.env.ALPHA_BACKEND_API_URL ?? process.env.BACKEND_API_URL ?? '',
    runtimeWsUrl: process.env.ALPHA_RUNTIME_WS_URL ?? process.env.RUNTIME_WS_URL ?? '',
    runtimeEndpoint: process.env.ALPHA_RUNTIME_ENDPOINT ?? process.env.RUNTIME_ENDPOINT ?? '',
    runtimeArn: process.env.ALPHA_RUNTIME_ARN ?? process.env.RUNTIME_ARN ?? '',
    workflowWsUrl: process.env.ALPHA_WORKFLOW_WS_URL ?? process.env.WORKFLOW_WS_URL ?? '',
    cognitoIdentityPoolId: process.env.ALPHA_COGNITO_IDENTITY_POOL_ID ?? process.env.COGNITO_IDENTITY_POOL_ID ?? '',
    cognitoBaseUrl: process.env.ALPHA_COGNITO_BASE_URL ?? process.env.COGNITO_BASE_URL ?? '',
    cognitoClientId: process.env.ALPHA_COGNITO_CLIENT_ID ?? process.env.COGNITO_CLIENT_ID ?? '',
    cognitoUserPoolId: process.env.ALPHA_COGNITO_USER_POOL_ID ?? process.env.COGNITO_USER_POOL_ID ?? '',
  },
  {
    name: 'gamma',
    stackSuffix: 'Gamma',
    account: process.env.GAMMA_ACCOUNT_ID ?? defaultAccount,
    region: process.env.GAMMA_REGION ?? defaultRegion,
    removalPolicy: 'retain',
    serviceName: 'financial-planning-frontend-gamma',
    backendApiUrl: process.env.GAMMA_BACKEND_API_URL ?? process.env.BACKEND_API_URL ?? '',
    runtimeWsUrl: process.env.GAMMA_RUNTIME_WS_URL ?? process.env.RUNTIME_WS_URL ?? '',
    runtimeEndpoint: process.env.GAMMA_RUNTIME_ENDPOINT ?? process.env.RUNTIME_ENDPOINT ?? '',
    runtimeArn: process.env.GAMMA_RUNTIME_ARN ?? process.env.RUNTIME_ARN ?? '',
    workflowWsUrl: process.env.GAMMA_WORKFLOW_WS_URL ?? process.env.WORKFLOW_WS_URL ?? '',
    cognitoIdentityPoolId: process.env.GAMMA_COGNITO_IDENTITY_POOL_ID ?? process.env.COGNITO_IDENTITY_POOL_ID ?? '',
    cognitoBaseUrl: process.env.GAMMA_COGNITO_BASE_URL ?? process.env.COGNITO_BASE_URL ?? '',
    cognitoClientId: process.env.GAMMA_COGNITO_CLIENT_ID ?? process.env.COGNITO_CLIENT_ID ?? '',
    cognitoUserPoolId: process.env.GAMMA_COGNITO_USER_POOL_ID ?? process.env.COGNITO_USER_POOL_ID ?? '',
  },
  {
    name: 'prod',
    stackSuffix: 'Prod',
    account: process.env.PROD_ACCOUNT_ID ?? defaultAccount,
    region: process.env.PROD_REGION ?? defaultRegion,
    removalPolicy: 'retain',
    serviceName: 'financial-planning-frontend-prod',
    backendApiUrl: process.env.PROD_BACKEND_API_URL ?? process.env.BACKEND_API_URL ?? '',
    runtimeWsUrl: process.env.PROD_RUNTIME_WS_URL ?? process.env.RUNTIME_WS_URL ?? '',
    runtimeEndpoint: process.env.PROD_RUNTIME_ENDPOINT ?? process.env.RUNTIME_ENDPOINT ?? '',
    runtimeArn: process.env.PROD_RUNTIME_ARN ?? process.env.RUNTIME_ARN ?? '',
    workflowWsUrl: process.env.PROD_WORKFLOW_WS_URL ?? process.env.WORKFLOW_WS_URL ?? '',
    cognitoIdentityPoolId: process.env.PROD_COGNITO_IDENTITY_POOL_ID ?? process.env.COGNITO_IDENTITY_POOL_ID ?? '',
    cognitoBaseUrl: process.env.PROD_COGNITO_BASE_URL ?? process.env.COGNITO_BASE_URL ?? '',
    cognitoClientId: process.env.PROD_COGNITO_CLIENT_ID ?? process.env.COGNITO_CLIENT_ID ?? '',
    cognitoUserPoolId: process.env.PROD_COGNITO_USER_POOL_ID ?? process.env.COGNITO_USER_POOL_ID ?? '',
  },
];
