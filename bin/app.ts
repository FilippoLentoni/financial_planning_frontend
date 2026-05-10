import { App } from 'aws-cdk-lib';
import { FinancialPlanningFrontendStack } from '../lib/financial-planning-frontend-stack';
import { DeploymentPipelineStack } from '../lib/deployment-pipeline-stack';
import { STAGES } from '../lib/config';

const app = new App();

const pipelineRegion = process.env.PIPELINE_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'us-east-2';
const pipelineAccount = process.env.PIPELINE_ACCOUNT_ID ?? process.env.CDK_DEFAULT_ACCOUNT ?? '111111111111';

for (const stage of STAGES) {
  new FinancialPlanningFrontendStack(app, `FinancialPlanningFrontend-${stage.stackSuffix}Stack`, {
    env: {
      account: stage.account,
      region: stage.region,
    },
    stage,
  });
}

new DeploymentPipelineStack(app, 'FinancialPlanningFrontendPipelineStack', {
  env: {
    account: pipelineAccount,
    region: pipelineRegion,
  },
});
