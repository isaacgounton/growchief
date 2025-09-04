import {
  ActionList,
  BotAbstract,
  type ParamsValue,
  RequireField,
  type RunEnrichment,
  type SpecialEvents,
} from '@growchief/shared-backend/bots/bots.interface';
import type { Page } from 'patchright';
import { timer } from '@growchief/shared-both/utils/timer';
import { Tool } from '@growchief/shared-both/utils/tool.decorator';
import { extractMyProfile } from '@growchief/shared-backend/bots/providers/linkedin/extract.my.profile';
import { extractConnectionTarget } from '@growchief/shared-backend/bots/providers/linkedin/extra.person.profile';
import { compareTwoStrings } from 'string-similarity';
import { ProgressResponse } from '@growchief/shared-backend/temporal/progress.response';
import { shuffle, uniqBy } from 'lodash';
import { Plug } from '@growchief/shared-backend/plugs/plug.decorator';
import { generateComment } from '@growchief/shared-backend/plugs/ai/comment.ai';
import { expect } from 'patchright/test';

const list = [
  {
    type: 'weekly' as const,
    char: 'You’ve reached the weekly invitation limit',
    message: 'You’ve reached the weekly invitation limit',
  },
  {
    type: 'weekly' as const,
    char: 'Too Many Requests',
    message: 'Too Many Search Requests',
  },
  {
    type: 'weekly' as const,
    char: 'You’re out of invitations for now',
    message: 'You’re out of invitations for now',
  },
  {
    type: 'weekly' as const,
    char: 'Drive more leads and bigger deals with Sales Navigator',
    message: "User doesn't have Linkedin sales nav",
  },
  {
    type: 'weekly' as const,
    char: 'reached the weekly invitation limit',
    message: 'You’ve reached the weekly invitation limit',
  },
];

export class LinkedinProvider extends BotAbstract {
  identifier = 'linkedin';
  label = 'LinkedIn';
  initialPage = 'https://www.linkedin.com';
  disconnectedElement = `.login__form, a[href="https://www.linkedin.com/signup"]`;
  delay = 1800000;
  preventLoadingImages = false;
  headful = true;
  urlRegex = /https:\/\/www\.linkedin\.com\/in\/(.*)/;
  order = 1;
  isWWW = true;
  searchURL = {
    description:
      'LinkedIn Search: <a target="_blank" class="underline hover:font-bold" href="https://www.linkedin.com/search/results/people/?keywords=nevo&network=%5B%22S%22%5D&origin=FACETED_SEARCH&sid=d5!">example #1</a>',
    regex: [/https:\/\/www\.linkedin\.com\/search\/results\/people\/.*/],
  };

  override async leadList(
    params: ParamsValue,
  ): Promise<RequireField<ProgressResponse, 'leads'>> {
    const response = await params.cursor.page.waitForResponse(
      /5ba32757c00b31aea747c8bebb92855c/gm,
      {
        timeout: 0,
      },
    );

    const request = response.request();
    const listParams = {
      method: request.method(),
      headers: request.headers(),
      postData: request.postData(),
    };

    const url = request.url();
    const loadLeads: {
      picture: string;
      url: string;
      firstName: string;
      lastName: string;
      degree: number;
      pending: boolean;
    }[] = [];

    for (const num of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]) {
      const newUrl = url.replace(/start:\d*/gm, `start:${num}`);
      const list = await params.page.evaluate(
        async ({ url, params }) => {
          const data = await (await fetch(url, params)).json();
          return (
            (data?.included || [])
              ?.filter((f: any) => f?.navigationUrl)
              ?.map((f: any) => ({
                picture:
                  f?.image?.attributes?.[0]?.detailData.nonEntityProfilePicture
                    ?.vectorImage?.artifacts?.[0]
                    ?.fileIdentifyingUrlPathSegment || '',
                url: f?.navigationUrl?.split('?')?.[0]?.split('#')?.[0],
                firstName: f?.title?.text?.split(' ')?.[0] || '',
                degree: 0,
                pending: false,
                lastName:
                  f?.title?.text?.split(' ')?.slice(1)?.join(' ')?.trim() || '',
              })) || []
          );
        },
        { url: newUrl, params: listParams },
      );

      if (list.length === 0) {
        break;
      }

      loadLeads.push(...list);
      await timer(2000);
    }

    return {
      delay: 0,
      repeatJob: false,
      endWorkflow: false,
      leads: uniqBy(
        loadLeads.filter((f) => f.url),
        (p) => p.url,
      ),
    };
  }

  async accountLimited(
    params: ParamsValue,
  ): Promise<Omit<Required<ProgressResponse>, 'leads'> | false> {
    const body = await params.page.evaluate(
      () => document.querySelector('body')?.innerText || '',
    );

    const find = list.find((p) => body.indexOf(p.char) > -1);
    if (find) {
      return {
        endWorkflow: false,
        delay: 0,
        repeatJob: true,
        restriction: {
          type: find.type,
          message: find.message,
        },
      };
    }

    return false;
  }

  async processLead(params: ParamsValue) {
    const json = await (
      await params.cursor.page.waitForResponse(
        /a1a483e719b20537a256b6853cdca711/gm,
        {
          timeout: 0,
        },
      )
    ).json();

    const person = extractConnectionTarget(json);

    if (!person) {
      return false;
    }

    let picture = '';
    try {
      picture =
        (await params.cursor.page
          .locator('.pv-top-card-profile-picture__image--show')
          .first()
          .getAttribute('src')) || '';
    } catch (err) {}

    return { ...person, picture };
  }

  async login(params: {
    page: Page;
    cursor: SpecialEvents;
  }): Promise<{ picture: string; name: string; id: string } | false> {
    const { page, cursor } = params;
    try {
      await page.goto('https://www.linkedin.com');
      await page
        .locator("//a[contains(text(), 'Sign in with email')]")
        .waitFor();
      await timer(5000);
      await cursor.click("//a[contains(text(), 'Sign in with email')]");
      await timer(5000);

      await page.waitForSelector('#username');
      cursor.startMouse();

      return new Promise<{ picture: string; name: string; id: string } | false>(
        async (resolve) => {
          try {
            page.on('response', async (response) => {
              if (response.url().match(/34ead06db82a2cc9a778fac97f69ad6a/gm)) {
                const json = await response.json();
                return resolve(extractMyProfile(json));
              }
            });
          } catch (err) {
            resolve(false);
          }
        },
      );
    } catch (err) {
      console.log(err);
      return false;
    }
  }

  @Tool({
    priority: 1,
    title: 'Send Connection Request',
    identifier: 'linkedin-send-connection-request',
    allowedBeforeIdentifiers: [],
    notAllowedBeforeIdentifiers: [
      'linkedin-send-connection-request',
      'linkedin-send-message',
    ],
    description: 'Send a connection request',
    notAllowedBeforeIdentifier: [
      'linkedin-send-connection-request',
      'linkedin-send-message',
    ],
    maxChildren: 1,
    weeklyLimit: 100,
  })
  async connectionRequest(params: ParamsValue, lead: RunEnrichment) {
    if (lead.degree === 1) {
      return {
        delay: 0,
        repeatJob: false,
        endWorkflow: true,
      };
    }

    const header = params.page
      .locator('.top-card-background-hero-image + div .artdeco-button')
      .first();

    await header.waitFor();

    const getMenus = (
      await Promise.all(
        (
          await params.page
            .locator('.top-card-background-hero-image + div .artdeco-button')
            .all()
        ).map(async (p, index) => {
          return (await p.innerHTML()).toLowerCase().indexOf('connect') > -1
            ? index
            : false;
        }),
      )
    ).find((p) => p !== false);

    if (typeof getMenus !== 'undefined') {
      await params.cursor.click(
        params.page
          .locator('.top-card-background-hero-image + div .artdeco-button')
          .nth(getMenus),
      );
    } else {
      await params.cursor.click(
        '.top-card-background-hero-image + div .artdeco-dropdown',
      );

      const dropDown = params.page.locator(
        '.top-card-background-hero-image + div .artdeco-dropdown .artdeco-dropdown__content-inner',
      );

      await dropDown.waitFor({ state: 'visible' });

      const getAllItems = (
        await Promise.all(
          (await dropDown.locator('li').all()).map(async (p, index) => {
            return (await p.innerHTML()).toLowerCase().indexOf('connect') > -1
              ? index
              : false;
          }),
        )
      ).find((p) => p !== false);

      if (typeof getAllItems !== 'undefined') {
        await params.cursor.click(dropDown.locator('li').nth(getAllItems));
      } else {
        return {
          delay: 0,
          repeatJob: false,
          endWorkflow: true,
        };
      }
    }
    const data = await params.cursor.getData();

    await params.page
      .locator('.artdeco-modal__actionbar button:nth-child(2)')
      .waitFor({ state: 'visible' });

    await timer(5000);

    if (!data.message) {
      await params.cursor.click(
        '.artdeco-modal__actionbar button:nth-child(2)',
      );

      await timer(5000);
    } else {
      await params.cursor.click(
        '.artdeco-modal__actionbar button:nth-child(1)',
      );

      await timer(5000);

      const messageBox = params.page.locator(
        '.connect-button-send-invite__custom-message-box',
      );

      await messageBox.waitFor({ state: 'visible' });
      await timer(5000);

      await params.cursor.click(messageBox);
      await timer(5000);

      await params.cursor.type(data.message);
      await timer(2000);

      await params.cursor.click(
        '.artdeco-modal__actionbar button:nth-last-child(1)',
      );
    }

    await timer(10000);

    return {
      delay: 0,
      repeatJob: false,
      endWorkflow: false,
    };
  }

  @Tool({
    priority: 2,
    title: 'Send follow up Message',
    identifier: 'linkedin-send-followup-message',
    allowedBeforeIdentifiers: ['linkedin-send-message'],
    notAllowedBeforeIdentifiers: [],
    description: 'Send a message',
    notAllowedBeforeIdentifier: [
      'linkedin-send-message',
      'linkedin-send-followup-message',
    ],
    maxChildren: 1,
  })
  @Tool({
    priority: 3,
    title: 'Send Message',
    identifier: 'linkedin-send-message',
    allowedBeforeIdentifiers: [],
    notAllowedBeforeIdentifiers: [
      'linkedin-send-followup-message',
      'linkedin-send-message',
    ],
    description: 'Send a message',
    notAllowedBeforeIdentifier: [
      'linkedin-send-message',
      'linkedin-send-connection-request',
    ],
    maxChildren: 1,
  })
  async sendMessage(params: ParamsValue, lead: RunEnrichment) {
    if (lead.degree !== 1 || lead.pending) {
      return {
        delay: 0,
        repeatJob: false,
        endWorkflow: true,
      };
    }

    const data = await params.cursor.getData();

    const header = params.page
      .locator(
        '.top-card-background-hero-image + div .entry-point .artdeco-button',
      )
      .first();

    await header.waitFor();

    await params.cursor.click(header);

    const convo = params.page
      .locator('.msg-convo-wrapper', {
        hasText: `${lead.firstName} ${lead.lastName}`,
      })
      .first();

    await convo.waitFor({ state: 'visible' });

    let allMessagesContent: string[] = [];

    try {
      const getAllMessages = convo.locator('.msg-s-event-listitem__body');
      await getAllMessages.first().waitFor();

      allMessagesContent = (await getAllMessages.allInnerTexts()).map((p) =>
        p.trim(),
      );
    } catch (err) {}

    if (
      allMessagesContent.some((p) => compareTwoStrings(p, data.message) > 0.95)
    ) {
      return {
        delay: 0,
        repeatJob: false,
        endWorkflow: false,
      };
    }

    await timer(1000);
    const textArea = convo.locator('[contenteditable="true"]').first();

    await textArea.waitFor({ state: 'visible' });

    await params.cursor.click(textArea);

    await timer(1000);

    await params.cursor.type(data.message);

    const isSubmitButton = convo
      .locator('button[type="submit"]:not(:disabled)')
      .first();

    try {
      await isSubmitButton.waitFor({ state: 'visible', timeout: 5000 });
      await params.cursor.click(isSubmitButton);
    } catch (err) {
      await params.page.keyboard.press('Enter');
    }

    await convo
      .locator('button[type="submit"]:disabled')
      .waitFor({ state: 'visible' });

    return {
      delay: 0,
      repeatJob: false,
      endWorkflow: false,
    };
  }

  @Tool({
    priority: 0,
    title: 'Visit Profile',
    identifier: 'visit-linkedin',
    allowedBeforeIdentifiers: [],
    notAllowedBeforeIdentifiers: [],
    description: 'Visit the profile page',
    notAllowedBeforeIdentifier: ['visit-linkedin'],
    maxChildren: 1,
  })
  async visitProfile(params: ParamsValue) {
    await timer(10000);
    return {
      endWorkflow: false,
      delay: 0,
      repeatJob: false,
    };
  }

  @Tool({
    priority: 3,
    title: 'Like last post',
    identifier: 'like-linkedin',
    allowedBeforeIdentifiers: [],
    notAllowedBeforeIdentifiers: [],
    description: 'Like the last post on LinkedIn',
    notAllowedBeforeIdentifier: ['visit-linkedin'],
    maxChildren: 1,
    appendUrl: '/recent-activity/all/',
  })
  async likeTheLastPost(params: ParamsValue) {
    try {
      const likeButton = params.page.locator('.reactions-react-button').first();
      await likeButton.waitFor({ state: 'visible', timeout: 60000 });
      await timer(5000);
      await params.cursor.click(likeButton);
      await timer(10000);
    } catch (err) {}

    return {
      endWorkflow: false,
      delay: 0,
      repeatJob: false,
    };
  }

  @Tool({
    priority: 1,
    title: 'Delay',
    identifier: 'delay',
    allowedBeforeIdentifiers: [],
    notAllowedBeforeIdentifiers: [],
    description: 'Delay the account for a specified time',
    notAllowedBeforeIdentifier: ['delay'],
    maxChildren: 1,
  })
  async delayAccount(params: ParamsValue) {
    return {
      endWorkflow: false,
      delay: this.delay,
      repeatJob: false,
    };
  }

  @Plug({
    priority: 1,
    identifier: 'like-and-comment-on-main-feed',
    description:
      "Using a smart AI approach, we will give likes and craft a great message that don't look like AI",
    title: 'Random likes and comments with AI',
    randomSelectionChance: 1,
    variables: [
      {
        type: 'input',
        title: 'Positive',
        defaultValue: '',
        id: 'positive',
        regex: /.*/,
        placeholder: 'Things account should talk about',
      },
      {
        type: 'input',
        title: 'Negative',
        defaultValue: '',
        id: 'negative',
        regex: /.*/,
        placeholder: 'Things account should not talk about',
      },
      {
        type: 'select',
        title: 'Reply to connections',
        defaultValue: '',
        id: 'connection-type',
        regex: /.*/,
        placeholder: 'Connection type',
        options: [
          {
            value: 'all',
            label: 'All',
          },
          {
            value: 'my-connections',
            label: 'My Connections',
          },
          {
            value: 'not-connected',
            label: 'Not Connected',
          },
          {
            value: 'people-i-follow',
            label: 'People I follow',
          },
        ],
      },
      {
        type: 'textarea',
        title: 'System Prompt',
        defaultValue: generateComment(),
        regex: /.*/,
        id: 'system-prompt',
        placeholder: 'Enter the system prompt',
      },
    ],
  })
  async likeAndComment(params: ParamsValue) {
    const { page, cursor } = params;
    const content = [] as { id: string; text: string; profile: string }[];
    const pusher = [] as { id: string; text: string; profile: string }[];

    let totalRuns = 0;
    while (content.length === 0 && totalRuns < 5) {
      const list = await page.waitForResponse(/voyagerFeedDashMainFeed/);
      const included = (await list.json()).included;
      const connectionType = params.cursor.getData()['connection-type'];
      pusher.push(
        ...included
          .filter(
            (f: any) =>
              f.commentary && f.entityUrn.indexOf('(urn:li:activity:') > -1,
          )
          .map((p: any) => {
            const txt = p?.actor?.supplementaryActorInfo?.text || '';
            return {
              distance:
                txt.indexOf('Following') > -1
                  ? 4
                  : txt.indexOf('3') > -1
                    ? 3
                    : txt.indexOf('2') > -1
                      ? 2
                      : txt.indexOf('1') > -1
                        ? 1
                        : undefined,
              profile:
                p?.actor?.name?.attributesV2?.[0]?.detailData?.[
                  '*profileFullName'
                ],
              id: p.entityUrn.split('(')[1].split(',')[0],
              text: p.commentary.text?.text || p.commentary.text,
            };
          })
          .filter((f: any) => {
            return f.id.indexOf('activity') > -1 && f.profile;
          })
          .map((p: any) => ({
            ...p,
            profile: `https://www.linkedin.com/in/${included.find((a: any) => a?.entityUrn === p.profile)?.publicIdentifier}`,
          })),
      );
      content.push(
        ...included
          .filter(
            (f: any) =>
              f.commentary && f.entityUrn.indexOf('(urn:li:activity:') > -1,
          )
          .map((p: any) => {
            const txt = p?.actor?.supplementaryActorInfo?.text || '';
            return {
              distance:
                txt.indexOf('Following') > -1
                  ? 4
                  : txt.indexOf('3') > -1
                    ? 3
                    : txt.indexOf('2') > -1
                      ? 2
                      : txt.indexOf('1') > -1
                        ? 1
                        : undefined,
              profile:
                p?.actor?.name?.attributesV2?.[0]?.detailData?.[
                  '*profileFullName'
                ],
              id: p.entityUrn.split('(')[1].split(',')[0],
              text: p.commentary.text?.text || p.commentary.text,
            };
          })
          .filter((f: any) => {
            return f.id.indexOf('activity') > -1 && f.profile;
          })
          .filter((f: any) => {
            if (connectionType === 'all') {
              return true;
            }
            if (connectionType === 'my-connections') {
              return f.distance === 1;
            }
            if (connectionType === 'not-connected') {
              return f.distance === 2 || f.distance === 3;
            }
            if (connectionType === 'people-i-follow') {
              return f.distance === 4;
            }
            return false;
          })
          .map((p: any) => ({
            ...p,
            profile: `https://www.linkedin.com/in/${included.find((a: any) => a?.entityUrn === p.profile)?.publicIdentifier}`,
          })),
      );

      if (content.length === 0) {
        page.evaluate('window.scrollTo(0, document.body.scrollHeight);');
      }
      totalRuns++;
    }

    await page.evaluate('window.scrollTo(0, 0);');

    const used = await cursor.checkUsed(
      content.reduce(
        (all, p) => [
          ...all,
          ...[
            {
              userUrl: p.profile,
              type: 'upvote',
              id: p.id,
            },
            {
              userUrl: p.profile,
              type: 'comment',
              id: p.id,
            },
          ],
        ],
        [] as { id: string; type: string }[],
      ),
    );

    const notFound = used.filter((f) => !f.found);
    if (!notFound.length) {
      return {
        delay: 0,
        repeatJob: false,
        endWorkflow: false,
      };
    }

    const notUsedAndUnique = uniqBy(notFound, (p) => p.internalId);

    const checkForValidOnce = (
      await cursor.ai.getAllowedSubjects(
        notUsedAndUnique.map((p) => ({
          id: p.internalId,
          title: content?.find?.((a) => a?.id === p?.internalId)!.text,
        })),
        params.cursor.getData().positive,
        params.cursor.getData().negative,
      )
    ).filter((f) => f.allowed);

    const selected = shuffle(checkForValidOnce)[0];

    const getAllVisibleSelectors = await Promise.all(
      (
        await page
          .locator(`//div[contains(@data-id, "urn:li:activity:")]`)
          .all()
      ).map((p) => p.getAttribute('data-id')),
    );

    const mapUntilSelected = getAllVisibleSelectors.map((p) => {
      return {
        id: p,
        selected: p === selected?.id,
        text: content.find((c) => c.id === p)?.text,
      };
    });

    if (mapUntilSelected.filter((f) => f.selected).length === 0) {
      return {
        delay: 0,
        repeatJob: false,
        endWorkflow: false,
      };
    }

    while (!mapUntilSelected[0].selected) {
      const elm = mapUntilSelected.shift();
      await cursor.scrollToElement(`div[data-id="${elm?.id!}"]`);
    }

    const current = mapUntilSelected[0];
    await cursor.scrollToElement(`div[data-id="${current.id}"]`);

    await cursor.scrollUntilElementIsVisible(
      `div[data-id="${current.id}"] [href="#thumbs-up-outline-small"]`,
    );

    const options = used.filter((f) => !f.found && f.internalId === current.id);
    const actions = [] as ActionList[];
    for (const option of options) {
      if (option.type === 'upvote') {
        await giveLike({ ...params, data: { id: current.id! } });
        actions.push({
          type: 'upvote',
          id: current.id!,
          comment: '',
        });
      }

      if (option.type === 'comment') {
        const [output] =
          (await giveComment({
            ...params,
            data: { id: current.id!, text: current.text! },
          })) || [];

        actions.push({
          type: 'comment',
          id: current.id!,
          comment: output.comment,
        });
      }

      await timer(2000);
    }

    await timer(2000);

    await cursor.saveActions(actions);

    return {
      delay: 0,
      repeatJob: false,
      endWorkflow: false,
    };
  }
}

const giveLike = async (params: {
  page: Page;
  cursor: SpecialEvents;
  data: {
    id: string;
  };
}): Promise<false | ActionList[]> => {
  const { page, data, cursor } = params;

  await cursor.move(
    `div[data-id="${data.id}"] [href="#thumbs-up-outline-small"]`,
  );

  await expect(
    page
      .locator(
        `div[data-id="${data.id}"] img[alt="support"]:not(.social-detail-social-counts__count-icon)`,
      )
      .first(),
  ).toBeVisible();

  const option = shuffle([
    'like',
    'celebrate',
    'support',
    'love',
    'insightful',
  ])[0];

  await cursor.simpleMoveAndClick(
    `div[data-id="${data.id}"] img[alt="${option}"]:not(.social-detail-social-counts__count-icon)`,
  );

  return [];
};

const giveComment = async (params: {
  page: Page;
  cursor: SpecialEvents;
  data: {
    id: string;
    text: string;
  };
}): Promise<false | ActionList[]> => {
  const { data, cursor, page } = params;
  const systemPrompt = cursor.getData()['system-prompt'];

  await cursor.simpleMoveAndClick(
    `div[data-id="${data.id}"] [href="#comment-small"]`,
  );

  await page.locator('[data-artdeco-is-focused="true"]').waitFor();
  await timer(1000);

  const comment = (await cursor.ai.comment(systemPrompt, data.text))!;

  await cursor.type(comment);

  await page
    .locator(
      "//div[contains(@class, 'comments-comment-texteditor')]//button[contains(., 'Comment')]",
    )
    .waitFor();
  await timer(1000);
  await cursor.click(
    "//div[contains(@class, 'comments-comment-texteditor')]//button[contains(., 'Comment')]",
  );

  await timer(3000);

  return [
    {
      comment,
      type: '',
      id: '',
    },
  ];
};
