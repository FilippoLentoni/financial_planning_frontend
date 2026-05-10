# Financial Planning Frontend

Public AWS CDK template for the financial planning assistant web UI.

This package owns only the frontend:

- Static JavaScript/CSS/HTML application assets.
- A small Python static web container.
- Amazon ECS Fargate service behind a public Application Load Balancer.
- Amazon CloudFront HTTPS distribution.
- Amazon Cognito User Pool, app client, Hosted UI domain, and Identity Pool.
- AWS CDK Pipelines backed by CodePipeline and CodeBuild.
- Stage-specific configuration for the separately deployed backend.

The backend runtime, portfolio tools, gateway proxy, and model permissions are deployed by the separate `financial_planning_backend` package.

## UX Focus

The first screen is the usable assistant experience. The UI is tuned for:

- Portfolio planning chat.
- Gateway/tool discovery.
- 16-week buy/sell plan review.
- What-if and liquidity deviation analysis.
- Weekly plan reports.

Current portfolio data and optimizer output are synthetic placeholders until the dedicated financial-data and math-model pipelines are connected.

## Manual Setup For A Real Project

Before deploying this template as a project, create:

1. A GitHub repo for the frontend package.
2. An AWS CodeConnections connection to that repo.
3. `SOURCE_REPO`, `SOURCE_BRANCH`, and `CODESTAR_CONNECTION_ARN`.
4. Target account/region values for personal, alpha, gamma, and prod.
5. Backend stack outputs: `BACKEND_API_URL`, `RUNTIME_ENDPOINT`, and `RUNTIME_ARN`.

## Backend Configuration

Set these from the backend stack outputs before deploying a functional frontend:

```bash
export BACKEND_API_URL=<backend-rest-api-url>
export RUNTIME_ENDPOINT=<backend-runtime-invoke-url>
export RUNTIME_ARN=<agentcore-runtime-arn>
```

Each value can also be scoped by stage, for example `ALPHA_BACKEND_API_URL` or `PERSONAL_RUNTIME_ARN`.

## Local Validation

```bash
npm install
npm test
npm run synth -- FinancialPlanningFrontend-PersonalStack
```

## Personal Deploy

```bash
AWS_PROFILE=<profile> APP_REGION=us-east-2 npm run deploy:personal -- --require-approval never
```

Personal deploy is for pre-PR testing. Alpha/gamma/prod should flow through GitHub review and CDK Pipelines.

## Pipeline Deploy

```bash
export SOURCE_REPO=owner/repo
export SOURCE_BRANCH=main
export CODESTAR_CONNECTION_ARN=arn:aws:codeconnections:...

AWS_PROFILE=<profile> APP_REGION=us-east-2 npm run deploy:pipeline -- --require-approval never
```

The pipeline deploys alpha, then waits for manual approval before gamma and prod.
