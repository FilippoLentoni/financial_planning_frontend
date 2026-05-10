import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { FinancialPlanningFrontendStack } from './financial-planning-frontend-stack';
import { StageConfig } from './config';

export interface FinancialPlanningFrontendApplicationStageProps extends StageProps {
  readonly stageConfig: StageConfig;
}

export class FinancialPlanningFrontendApplicationStage extends Stage {
  constructor(scope: Construct, id: string, props: FinancialPlanningFrontendApplicationStageProps) {
    super(scope, id, props);

    new FinancialPlanningFrontendStack(this, 'Application', {
      env: props.env,
      stage: props.stageConfig,
    });
  }
}
