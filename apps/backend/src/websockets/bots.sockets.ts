import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { BotManager } from '@growchief/shared-backend/bots/bot.manager';
import { BotEmitter } from '@growchief/shared-backend/bots/bot.emitter';
import { UseGuards } from '@nestjs/common';
import { WebsocketsGuard } from '@growchief/backend/services/auth/websockets.guard';

@WebSocketGateway(3002, {
  cors: {
    credentials: true,
    exposedHeaders: ['reload', 'onboarding', 'logged', 'activate'],
    origin: [process.env.FRONTEND_URL!],
  },
  transports: ['websocket'],
  path: '/socket.io',
  secure: false,
})
export class BotsSockets {
  constructor(private _botManager: BotManager) {}
  @WebSocketServer()
  server: Server;

  @UseGuards(WebsocketsGuard)
  @SubscribeMessage('start')
  async handleEvent(
    @ConnectedSocket() socket: Socket,
    @MessageBody('source') source: 'login' | 'screenShare',
    @MessageBody('bot') bot: string,
    @MessageBody('groupId') groupId: string,
    @MessageBody('timezone') timezone: number,
    @MessageBody('platform') platform: string,
    @MessageBody('proxyId') proxyId?: string,
  ) {
    if (!source || !groupId || !platform) {
      throw new Error(
        'Missing required parameters: source, groupId, name, or platform',
      );
    }

    return this._botManager.run(false, {
      groupId,
      organizationId: socket.data.organization.id,
      platform,
      functionName: source,
      bot: bot,
      isObservable: true,
      url: '',
      leadId: '',
      proxyId,
      timezone,
    });
  }

  @SubscribeMessage('load')
  event(@MessageBody('id') id: string, @MessageBody('body') body: any) {
    BotEmitter.emitter.emit(`event-${id}`, body);
    return {};
  }
}
