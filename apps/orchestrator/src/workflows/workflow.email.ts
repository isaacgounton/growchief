import {
  condition,
  continueAsNew,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';
import { Mutex } from 'async-mutex';
import { emailSignal } from '@growchief/orchestrator/signals/email.signal';
import { EmailActivity } from '@growchief/orchestrator/activities/email.activity';

export interface SendEmailQueue {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  buffer?: Buffer;
}

const { sendEmailSync } = proxyActivities<EmailActivity>({
  startToCloseTimeout: '2 minute',
});

export async function workflowEmail() {
  const queue: SendEmailQueue[] = [];
  const mutex = new Mutex();
  setHandler(emailSignal, async (param: SendEmailQueue) => {
    mutex.runExclusive(() => {
      queue.push(param);
    });
  });

  while (true) {
    await condition(() => queue.length > 0);
    const currentQueue = queue.shift()!;
    await sendEmailSync(currentQueue);
    await sleep(2000);

    if (queue.length === 0) {
      return continueAsNew();
    }
  }
}
