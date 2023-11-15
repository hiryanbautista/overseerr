import { IssueType, IssueTypeName } from '@server/constants/issue';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type { NotificationAgentConfig } from '@server/lib/settings';
import { getSettings, NotificationAgentKey } from '@server/lib/settings';
import logger from '@server/logger';
import * as apn from 'apn';
import { Notification, shouldSendAdminNotification } from '..';
import type { NotificationAgent, NotificationPayload } from './agent';
import { BaseAgent } from './agent';

class iOSAgent
  extends BaseAgent<NotificationAgentConfig>
  implements NotificationAgent
{
  protected getSettings(): NotificationAgentConfig {
    if (this.settings) {
      return this.settings;
    }

    const settings = getSettings();

    return settings.notifications.agents.ios;
  }

  public shouldSend(): boolean {
    if (this.getSettings().enabled) {
      return true;
    }

    return false;
  }

  private getNotificationAlert(
    type: Notification,
    payload: NotificationPayload
  ): apn.NotificationAlertOptions {
    const mediaType = payload.media
      ? payload.media.mediaType === MediaType.MOVIE
        ? 'movie'
        : 'series'
      : undefined;
    const is4k = payload.request?.is4k;

    const issueType = payload.issue
      ? payload.issue.issueType !== IssueType.OTHER
        ? `${IssueTypeName[payload.issue.issueType].toLowerCase()} issue`
        : 'issue'
      : undefined;

    let message: string | undefined;
    switch (type) {
      case Notification.TEST_NOTIFICATION:
        message = payload.message;
        break;
      case Notification.MEDIA_AUTO_REQUESTED:
        message = `Automatically submitted a new ${
          is4k ? '4K ' : ''
        }${mediaType} request.`;
        break;
      case Notification.MEDIA_APPROVED:
        message = `Your ${
          is4k ? '4K ' : ''
        }${mediaType} request has been approved.`;
        break;
      case Notification.MEDIA_AUTO_APPROVED:
        message = `Automatically approved a new ${
          is4k ? '4K ' : ''
        }${mediaType} request from ${
          payload.request?.requestedBy.displayName
        }.`;
        break;
      case Notification.MEDIA_AVAILABLE:
        message = `Your ${
          is4k ? '4K ' : ''
        }${mediaType} request is now available!`;
        break;
      case Notification.MEDIA_DECLINED:
        message = `Your ${is4k ? '4K ' : ''}${mediaType} request was declined.`;
        break;
      case Notification.MEDIA_FAILED:
        message = `Failed to process ${is4k ? '4K ' : ''}${mediaType} request.`;
        break;
      case Notification.MEDIA_PENDING:
        message = `Approval required for a new ${
          is4k ? '4K ' : ''
        }${mediaType} request from ${
          payload.request?.requestedBy.displayName
        }.`;
        break;
      case Notification.ISSUE_CREATED:
        message = `A new ${issueType} was reported by ${payload.issue?.createdBy.displayName}.`;
        break;
      case Notification.ISSUE_COMMENT:
        message = `${payload.comment?.user.displayName} commented on the ${issueType}.`;
        break;
      case Notification.ISSUE_RESOLVED:
        message = `The ${issueType} was marked as resolved by ${payload.issue?.modifiedBy?.displayName}!`;
        break;
      case Notification.ISSUE_REOPENED:
        message = `The ${issueType} was reopened by ${payload.issue?.modifiedBy?.displayName}.`;
        break;
      default:
        return {
          title: Notification[type],
          body: 'Unknown',
        };
    }

    return {
      title: payload.subject,
      body: message === undefined ? '' : message,
    };
  }

  public async send(
    type: Notification,
    payload: NotificationPayload
  ): Promise<boolean> {
    const apns_key = process.env.APNS_KEY;
    if (apns_key == undefined) {
      return false;
    }

    const userRepository = getRepository(User);
    const mainUser = await userRepository.findOne({ where: { id: 1 } });

    const tokens: string[] = [];

    if (
      payload.notifyUser &&
      (payload.notifyUser.settings?.hasNotificationType(
        NotificationAgentKey.IOS,
        type
      ) ??
        true)
    ) {
      if (payload.notifyUser.settings?.iOSDeviceToken) {
        tokens.push(payload.notifyUser.settings.iOSDeviceToken);
      }
    }

    if (payload.notifyAdmin) {
      const users = await userRepository.find();

      const manageUsers = users.filter(
        (user) =>
          (user.settings?.hasNotificationType(NotificationAgentKey.IOS, type) ??
            true) &&
          shouldSendAdminNotification(type, user, payload)
      );

      const allTokens = manageUsers.flatMap((user) => {
        return user.settings?.iOSDeviceToken !== undefined
          ? [user.settings.iOSDeviceToken]
          : [];
      });

      tokens.push(...allTokens);
    }

    if (mainUser && tokens.length > 0) {
      logger.debug('Sending iOS push notification', {
        label: 'Notifications',
        type: Notification[type],
        subject: payload.subject,
      });

      try {
        const key =
          `-----BEGIN PRIVATE KEY-----\n${apns_key}\n-----END PRIVATE KEY-----`.replace(
            /\\n/g,
            '\n'
          );
        const options = {
          token: {
            key: key,
            keyId: 'XM2D77F47X',
            teamId: '3WQN577LHJ',
          },
          production: process.env.APNS_ENV == 'prod' ? true : false,
        };

        const apnProvider = new apn.Provider(options);
        const note = new apn.Notification();

        note.alert = this.getNotificationAlert(type, payload);
        note.payload = {
          type: Notification[type],
          mediaId: payload.media?.tmdbId,
          mediaType: payload.media?.mediaType,
        };

        note.badge = 0;
        note.topic = 'io.ryanbautista.Overseerr';

        await apnProvider.send(note, tokens);
        // Handle failed tokens
      } catch (e) {
        logger.error(
          'Error sending iOS notification; removing subscription',
          {}
        );

        // Delete token if failed
      }
    }

    return true;
  }
}

export default iOSAgent;
