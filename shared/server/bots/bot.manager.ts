import { Injectable } from '@nestjs/common';
import { Browser } from 'patchright';
import { botList } from '@growchief/shared-backend/bots/bot.list';
import {
  ActionList,
  BotsRequestSetupDefault,
  ExactParams,
} from '@growchief/shared-backend/bots/bots.interface';
import {
  Subject,
  Observable,
  BehaviorSubject,
  finalize,
  fromEvent,
  switchMap,
  EMPTY,
  map,
} from 'rxjs';
import { BotsService } from '@growchief/shared-backend/database/bots/bots.service';
import { chromium } from 'patchright';
import { installMouseHelper } from 'ghost-cursor';
import { createCursor } from '@growchief/shared-backend/bots/bot.cursor';
import { BotTools } from '@growchief/shared-backend/bots/bot.tools';
import { BotEmitter } from '@growchief/shared-backend/bots/bot.emitter';
import { makeId } from '@growchief/shared-both/utils/make.id';
import { timer } from '@growchief/shared-both/utils/timer';
import { ProgressResponse } from '@growchief/shared-backend/temporal/progress.response';
import { LeadsService } from '@growchief/shared-backend/database/leads/leads.service';
import { heartbeat } from '@temporalio/activity';
import { proxyList } from '@growchief/shared-backend/proxies/proxy.list';

const MAXIMUM_RUNNING_TIME = 300000;
const MAXIMUM_PROCESS_TIME = 240000;
const MAXIMUM_NAVIGATION_TIME = 60000;

@Injectable()
export class BotManager extends BotTools {
  constructor(_botService: BotsService, _leadsService: LeadsService) {
    super(_botService, _leadsService);
  }

  static chrome: Browser;

  async launch(headful: boolean) {
    if (process.env.REMOTE_CHROME) {
      const launchArgs = JSON.stringify({
        ...(headful ? { headless: false } : {}),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--window-size=1280,1024',
        ],
      });

      return chromium.connect(
        process.env.REMOTE_CHROME +
          `${(process?.env?.REMOTE_CHROME || '').indexOf('?') > -1 ? '&' : '?'}launch=${launchArgs}`,
      );
    }

    if (BotManager.chrome && BotManager?.chrome?.isConnected()) {
      return BotManager.chrome;
    }

    try {
      BotManager.chrome = await chromium.launch({
        headless: false,
        timeout: 360000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      });
    } catch (err) {
      console.log(err);
    }

    return BotManager.chrome;
  }

  async getContext(
    launch: Browser,
    functionName: string,
    botInformation: any,
    proxy: false | { username: string; password: string; server: string },
  ) {
    return launch.newContext({
      viewport: { width: 1280, height: 1024 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      ...(botInformation.storage && functionName !== 'login'
        ? {
            storageState: JSON.parse(botInformation.storage),
          }
        : {}),
      ...(proxy && proxy?.username
        ? {
            proxy: {
              username: proxy.username,
              password: proxy.password,
              server: proxy.server,
            },
          }
        : {}),
    });
  }

  async heartBeat(
    isActivity: boolean,
    abortSignal?: AbortSignal,
  ): Promise<'kill'> {
    return new Promise<'kill'>(async (res, rej) => {
      try {
        abortSignal?.addEventListener('abort', () => {
          rej(new Error('aborted'));
        });

        if (!isActivity) {
          return new Promise<'kill'>((resInner) => {});
        }

        try {
          while (true) {
            heartbeat();
            await timer(10000);
          }
        } catch (err) {}

        return res('kill');
      } catch (err) {
        rej(new Error('aborted'));
      }
    });
  }

  private _checkAction(botId: string, platform: string) {
    return (check: { type: string; id: string; userUrl?: string }[]) => {
      return this._botService.checkActions(botId, platform, check);
    };
  }

  run(
    isActivity = false,
    params: {
      functionName: string;
      data?: any;
      isObservable?: boolean;
    } & BotsRequestSetupDefault,
  ): Promise<ProgressResponse> | Observable<any> {
    // Create a subject to emit screenshots - using BehaviorSubject to always have the latest value
    const screenshots$ = new BehaviorSubject<string | null>(null);
    // Create a subject to signal to kill everything
    const killEverything$ = new Subject<'kill'>();
    const abortController = new AbortController();

    // We might not be able to start the job, if the db is not working for example, so we need to kill it before
    // We don't want to take risks and have jobs stuck in the queue for ever, not letting the queue to progress
    const maximumRunTime = this._maximumJobTime(
      abortController.signal,
      params.deadline || MAXIMUM_RUNNING_TIME,
      'kill' as const,
    );

    const process = new Promise<ProgressResponse>(async (res) => {
      try {
        res(
          await this.runProcess(abortController, {
            ...params,
            screenshots$,
            killEverything$,
          }),
        );
      } catch (err) {
        res({
          delay: 0,
          repeatJob: false,
          endWorkflow: true,
        });
        console.log('errorim', err);
      }
    });

    // we have to trigger the race here 1st, even if it's just for login with observability
    const race = Promise.any([
      this.heartBeat(isActivity, abortController.signal),
      process,
      maximumRunTime,
    ]).then(async (p) => {
      abortController.abort();
      if (p === 'kill') {
        try {
          if (!params.isObservable) {
            // killed
          }
          killEverything$.next('kill');
        } catch (err) {}

        throw new Error('Retry job after timeout');
      }

      return p;
    });

    // if there is observability, let's send it to the client, we want to see screenshots of what's happening
    if (params.isObservable) {
      // Filter out the initial null value
      return screenshots$.asObservable().pipe(
        map((p) => {
          return { event: 'data', data: p };
        }),
        finalize(() => {
          try {
            // if the observable, disconnected (client left the page), in any case, kill everything
            killEverything$.next('kill');
          } catch (err) {}
        }),
      );
    } else {
      return race;
    }
  }

  async runProcess(
    abortController: AbortController,
    params: {
      functionName: string;
      isObservable?: boolean;
      data?: any;
      screenshots$: BehaviorSubject<string | null>;
      killEverything$: Subject<'kill'>;
    } & BotsRequestSetupDefault,
  ): Promise<ProgressResponse> {
    const {
      organizationId,
      functionName,
      bot,
      data,
      isObservable,
      screenshots$,
      killEverything$,
      platform,
      groupId,
      url,
      leadId,
      proxyId,
      appendUrl,
      ignoreLead,
      timezone,
    } = params;

    const botInformation = (await this._botService.getBot(bot)) || {
      status: 'ACTIVE',
      logged: true,
      platform,
      settings: '{}',
    };

    const proxy = !proxyId
      ? false
      : (await this._botService.getProxy(organizationId, proxyId)) || false;

    if (
      functionName !== 'login' &&
      (botInformation.status === 'PAUSED' || !botInformation.logged)
    ) {
      return {
        delay: 0,
        repeatJob: true,
        endWorkflow: false,
      };
    }

    // is provider exists?
    const findProvider = botList.find(
      (p) => p.identifier === botInformation.platform,
    );
    if (
      !findProvider ||
      !findProvider[functionName as keyof typeof findProvider]
    ) {
      abortController.abort();
      throw new Error('Invalid identifier');
    }

    const run = findProvider[functionName as keyof typeof findProvider];
    if (typeof run !== 'function') {
      abortController.abort();
      throw new Error('Not a function');
    }

    const saveLog$ = new Subject<{
      message: string;
      type: string;
      args: string[];
    }>();

    /**
     * Making a new page
     */
    // launch a chrome browser if not running
    const launch = await this.launch(findProvider.headful);

    // context is created per bot
    const browser = await this.getContext(
      launch,
      functionName,
      botInformation,
      proxy,
    );

    browser.setDefaultTimeout(MAXIMUM_NAVIGATION_TIME);

    try {
      await browser.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
      });
    } catch (err) {}

    // open a new page
    const page = await browser.newPage();

    /**
     * Allowing the user to click different parts on the page
     */
    const id = makeId(10);
    const screenClicking$ = new Subject<any>();

    const $clicks = screenClicking$.pipe<any>(
      switchMap((value) => {
        if (value === 'start') {
          screenshots$.next(JSON.stringify({ identifier: id }));
          return fromEvent(BotEmitter.emitter, `event-${id}`);
        } else if (value === 'stop') {
          screenshots$.next(JSON.stringify({ identifier: null }));
          BotEmitter.emitter.removeAllListeners(`event-${id}`);
        }

        return EMPTY;
      }),
    );

    /**
     * Creating special cursor events
     */
    // let's add the human superpower to our automation
    const cursor = createCursor({
      saveLog$,
      loadPage: page as any,
      screenShare: screenClicking$,
      check: this._checkAction(bot, botInformation.platform),
      saveActions: (textForComment: string, actions: ActionList[]) =>
        this._botService.saveActions(
          bot,
          organizationId,
          botInformation.platform,
          textForComment,
          actions,
        ),
      data,
    });

    const clickScreen$ = $clicks.subscribe({
      next: async (load: any) => {
        const data = JSON.parse(load);
        try {
          if (data.type === 'scroll') {
            await page.mouse.wheel(0, data.deltaY);
            return;
          }
          const viewPort = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
          }));

          const coords = this._scaleCoordinates(
            data.x,
            data.y,
            data.width,
            data.height,
            viewPort.width,
            viewPort.height,
          );

          const isMac = process.platform === 'darwin';

          if (data.type === 'click') {
            await page.mouse.click(coords.x, coords.y);
          } else if (data.type === 'type') {
            const [newKey, special] = data.key.split('-');

            if (special && special == 'shift') {
              await page.keyboard.down('Shift');
            } else if (special && special == 'ctrl') {
              await page.keyboard.down(isMac ? 'Meta' : 'Control');
            } else if (special && special == 'alt') {
              await page.keyboard.down('AltLeft');
            }

            await page.keyboard.press(newKey);

            if (special && special == 'shift') {
              await page.keyboard.up('Shift');
            } else if (special && special == 'ctrl') {
              await page.keyboard.up(isMac ? 'Meta' : 'Control');
            } else if (special && special == 'alt') {
              await page.keyboard.up('AltLeft');
            }
          }
        } catch (err) {}
      },
    });

    // even though it not secured, we still want to show the mouse at login for "wow effect"
    if (functionName === 'login') {
      // @ts-ignore
      page.evaluateOnNewDocument = page.addInitScript;

      // let's install the mouse helper, so we can see it
      await installMouseHelper(page as any);
    }

    /**
     * Sharing screen with the user
     */
    const client = isObservable
      ? await page.context().newCDPSession(page)
      : false;

    // some providers might require not to load images on the page
    if (
      findProvider.preventLoadingImages &&
      functionName !== 'login' &&
      functionName !== 'screenShare'
    ) {
      try {
        page
          .route('**/*', (p) => {
            try {
              const url = p.request().url();
              if (
                url.indexOf('/aero-v1/sc/') === -1 &&
                (p.request().resourceType() === 'image' ||
                  p.request().resourceType() === 'video')
              ) {
                return p.abort();
              }

              return p.continue();
            } catch (err) {}
          })
          .catch((err) => {});
      } catch (err) {}
    }

    // if it's observable, let's send screenshots to the client
    if (isObservable && typeof client === 'object') {
      try {
        client.on('Page.screencastFrame', async (frameObject) => {
          try {
            screenshots$.next(Buffer.from(frameObject.data, 'base64') as any);
            // Do what you want with frame, ex write to file on disk
            await client.send('Page.screencastFrameAck', {
              sessionId: frameObject.sessionId,
            });
          } catch (err) {}
        });
      } catch (err) {}

      try {
        await client.send('Page.startScreencast', {
          format: 'jpeg',
          quality: 100,
          maxWidth: 640,
          maxHeight: 512,
          everyNthFrame: 1,
        });
      } catch (err) {}

      /**
       * General page settings, like closing popups, or removing everything on page close, or kill everyhing function
       */
      page.on('popup', async (p) => {
        try {
          await p.close();
        } catch (err) {}
      });

      // When page is about to close, we need to clean up
      page.on('close', async () => {
        await this._unsubscribeAll(
          cursor,
          screenshots$,
          killEverything$,
          clickScreen$,
          saveLog$,
          client,
        );
      });
    }

    killEverything$.subscribe(async () => {
      await this._unsubscribeAll(
        cursor,
        screenshots$,
        killEverything$,
        clickScreen$,
        saveLog$,
        client,
      );
      try {
        await page.close();
      } catch (err) {}
    });

    // if we are not logged in, let's go to the page, but we don't have to wait for it to be fully loaded
    // This will lower the risk of getting stuck on the 1st step
    if (functionName !== 'login' && data) {
      // let's run a captcha solver in the background, if there is anything we need to solve, it will pause everything.
      // cursor.captchaSolver();
      page
        .goto(url + (appendUrl || ''), {
          timeout: 0,
        })
        .catch((err) => {});
    }

    const lead =
      functionName === 'login' || appendUrl || ignoreLead
        ? {}
        : await this.processLead(leadId, () => {
            return findProvider.processLead({
              page,
              cursor,
              data,
            } satisfies ExactParams);
          });

    if (!lead && functionName !== 'login' && functionName !== 'leadList') {
      return {
        delay: 0,
        repeatJob: false,
        endWorkflow: true,
      };
    }

    if (lead && 'firstName' in lead && 'lastName' in lead) {
      // @ts-ignore
      cursor.setDataVariables(lead);
    } else if (data?.url) {
      cursor.setDataVariables(data);
    }

    if (functionName === 'screenShare') {
      cursor.startMouse();
    }

    /**
     * Running the main function with the automation
     */
    let race:
      | ProgressResponse
      | 'logout'
      | false
      | 'proxy'
      | { picture: string; name: string }
      | { type: 'ui-error'; message: string; path: string } = {} as any;
    try {
      race = await Promise.race<
        | ProgressResponse
        | 'logout'
        | false
        | { picture: string; name: string }
        | { type: 'ui-error'; message: string; path: string }
        | 'proxy'
      >([
        // let's check that if we give user a free control, they don't run outside of the website
        functionName !== 'login'
          ? this._navigateOutSideOfScope(page, findProvider.initialPage)
          : new Promise((res) => {}),

        // Running the automation that was planned
        functionName === 'screenShare'
          ? new Promise<ProgressResponse>(async (res) => {
              await timer(300000);
              res({
                delay: 0,
                repeatJob: false,
                endWorkflow: true,
              });
            })
          : this._functionToRun(
              () =>
                run.bind(findProvider)(
                  {
                    page: cursor.page,
                    cursor,
                    data,
                  } satisfies ExactParams,
                  lead,
                ),
              functionName,
              cursor.page,
              saveLog$,
            ),

        // Are we logged out, we should check for it all the time
        this._checkForLoginElement(
          functionName !== 'login',
          cursor.page,
          findProvider.disconnectedElement,
        ),

        // We need to set a maximum time for the job, in case it's getting stuck
        this._maximumJobTime(abortController.signal, MAXIMUM_PROCESS_TIME, {
          delay: 0,
          repeatJob: true,
          endWorkflow: false,
        } as ProgressResponse),

        // Sometimes the proxy is unavailable, we need to kill everything and try again later
        this._isProxyUnavailable(page, findProvider.initialPage, proxy),

        // If the account is limited, we should stop everything
        this._findRestrictions(
          {
            page: cursor.page,
            cursor,
            data,
          } satisfies ExactParams,
          findProvider.accountLimited.bind(findProvider),
        ),
      ]);
    } catch (err) {}

    if (race === false && isObservable) {
      screenshots$.next('logout');
    }

    try {
      await browser.tracing.stop();
    } catch (err) {}

    /**
     * Close everything after we finished
     */
    // if we are streaming a picture, let's end it
    if (isObservable) {
      try {
        screenshots$.next('stop');
      } catch (err) {}
    }

    try {
      // close the page, it might got killed by the killEverything$, so let's add it in try and catch
      await page.close();
    } catch (err) {}

    // we need to unsubscribe from everything, because it will sit in the memory
    // If for some reason it's already been unsubscribed, let's not crash the job
    await this._unsubscribeAll(
      cursor,
      screenshots$,
      killEverything$,
      clickScreen$,
      saveLog$,
      client,
    );

    /**
     * Closing the browser and saving the state
     */
    // save the state so we can use it next time
    const state = await browser.storageState({
      // indexedDB: true,
    });

    // maybe for some reason the browser is already closed, let's just wrap it in try and catch
    try {
      await browser.close();
    } catch (err) {}

    if (functionName === 'screenShare') {
      return {
        delay: 0,
        endWorkflow: false,
        repeatJob: true,
      };
    }

    // The proxy is not working, better to try the same request again we don't want to save the new state
    if (race === 'proxy') {
      return {
        delay: 1_800_000,
        endWorkflow: false,
        repeatJob: true,
      };
    }

    // there is something wrong in the automation, we need to know about it.
    if (typeof race === 'object' && !Array.isArray(race) && 'type' in race) {
      // something went wrong in the automation
      return {
        delay: 0,
        endWorkflow: false,
        repeatJob: true,
      };
    }

    // saving the login
    await this._botService.saveStorageAndActions(
      functionName,
      organizationId,
      platform,
      typeof race === 'object' && !Array.isArray(race)
        ? (race as any)?.name
        : '',
      typeof race === 'object' && !Array.isArray(race)
        ? (race as any)?.picture
        : '',
      typeof race === 'object' && !Array.isArray(race) ? (race as any)?.id : '',
      groupId,
      bot,
      state,
      race !== 'logout' && race !== false,
      timezone || 0,
      proxyId,
    );

    // if we are logged out, and we shouldn't skip the queue, let's re-login
    if (race === 'logout') {
      await this._botService.loggedOut(bot);
      return {
        delay: 0,
        endWorkflow: false,
        repeatJob: true,
      };
    }

    if (!race) {
      return {
        delay: 0,
        endWorkflow: true,
        repeatJob: false,
      };
    }

    if (typeof race === 'object' && !Array.isArray(race) && 'delay' in race) {
      return race;
    }

    return {
      delay: 0,
      endWorkflow: true,
      repeatJob: false,
    };
  }
}
