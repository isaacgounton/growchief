import { Module } from '@nestjs/common';
import { SharedServerModule } from '@growchief/shared-backend/shared-server.module';
import { getTemporalModule } from '@growchief/shared-backend/temporal/temporal.module';
import { AccountsStepActivity } from '@growchief/orchestrator/activities/accounts.step.activity';
import { GetLeadsDetailsActivity } from '@growchief/orchestrator/activities/get.leads.details.activity';
import { WorkflowInformationActivity } from '@growchief/orchestrator/activities/workflow.information.activity';
import { DeactivateSubscriptionActivity } from '@growchief/orchestrator/activities/deactivate.subscription.activity';
import { EmailActivity } from '@growchief/orchestrator/activities/email.activity';
import { NotificationActivity } from '@growchief/orchestrator/activities/notification.activity';
import { PlugsActivity } from '@growchief/orchestrator/activities/plugs.activity';
import { EnrichmentActivity } from '@growchief/orchestrator/activities/enrichment.activity';
@Module({
  imports: [
    SharedServerModule,
    getTemporalModule(true, require.resolve('./workflows'), [
      AccountsStepActivity,
      GetLeadsDetailsActivity,
      WorkflowInformationActivity,
      DeactivateSubscriptionActivity,
      EmailActivity,
      NotificationActivity,
      PlugsActivity,
      EnrichmentActivity,
    ]),
  ],
  controllers: [],
  providers: [],
  get exports() {
    return [...this.providers, ...this.imports];
  },
})
export class AppModule {}
