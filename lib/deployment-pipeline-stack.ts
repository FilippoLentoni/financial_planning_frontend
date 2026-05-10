import {
  Stack,
  StackProps,
  aws_codepipeline as codepipeline,
  aws_iam as iam,
  pipelines,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { FinancialPlanningFrontendApplicationStage } from './application-stage';
import { STAGES } from './config';

const sourceRepo = process.env.SOURCE_REPO ?? 'FilippoLentoni/financial_planning_frontend';
const sourceBranch = process.env.SOURCE_BRANCH ?? 'main';
const sourceConnectionArn =
  process.env.CODESTAR_CONNECTION_ARN ??
  'arn:aws:codeconnections:us-east-2:111111111111:connection/replace-me';

const frontendStageEnv = [
  'BACKEND_API_URL',
  'RUNTIME_WS_URL',
  'RUNTIME_ENDPOINT',
  'RUNTIME_ARN',
  'WORKFLOW_WS_URL',
  'ALPHA_BACKEND_API_URL',
  'ALPHA_RUNTIME_WS_URL',
  'ALPHA_RUNTIME_ENDPOINT',
  'ALPHA_RUNTIME_ARN',
  'ALPHA_WORKFLOW_WS_URL',
  'GAMMA_BACKEND_API_URL',
  'GAMMA_RUNTIME_WS_URL',
  'GAMMA_RUNTIME_ENDPOINT',
  'GAMMA_RUNTIME_ARN',
  'GAMMA_WORKFLOW_WS_URL',
  'PROD_BACKEND_API_URL',
  'PROD_RUNTIME_WS_URL',
  'PROD_RUNTIME_ENDPOINT',
  'PROD_RUNTIME_ARN',
  'PROD_WORKFLOW_WS_URL',
] as const;

function configuredStageEnv(): Record<string, string> {
  return Object.fromEntries(
    frontendStageEnv.map((name) => [name, process.env[name] ?? '']),
  );
}

export class DeploymentPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'FinancialPlanningFrontendDeploymentPipeline',
      pipelineType: codepipeline.PipelineType.V2,
      crossAccountKeys: true,
      dockerEnabledForSynth: true,
      dockerEnabledForSelfMutation: true,
      codeBuildDefaults: {
        rolePolicy: [
          new iam.PolicyStatement({
            actions: ['ec2:DescribeAvailabilityZones'],
            resources: ['*'],
          }),
        ],
      },
      synth: new pipelines.ShellStep('Synth', {
        input: pipelines.CodePipelineSource.connection(sourceRepo, sourceBranch, {
          connectionArn: sourceConnectionArn,
        }),
        env: {
          SOURCE_REPO: sourceRepo,
          SOURCE_BRANCH: sourceBranch,
          CODESTAR_CONNECTION_ARN: sourceConnectionArn,
          CDK_DEFAULT_ACCOUNT: Stack.of(this).account,
          CDK_DEFAULT_REGION: Stack.of(this).region,
          ...configuredStageEnv(),
        },
        commands: ['npm ci', 'npm test', 'npm run synth'],
      }),
    });

    for (const stageConfig of STAGES.filter((stage) => stage.name !== 'personal')) {
      const appStage = new FinancialPlanningFrontendApplicationStage(this, stageConfig.stackSuffix, {
        env: {
          account: stageConfig.account,
          region: stageConfig.region,
        },
        stageConfig,
      });

      const requiresApproval = stageConfig.name === 'gamma' || stageConfig.name === 'prod';
      pipeline.addStage(appStage, {
        pre: requiresApproval
          ? [new pipelines.ManualApprovalStep(`Approve-${stageConfig.stackSuffix}`)]
          : undefined,
      });
    }
  }
}
