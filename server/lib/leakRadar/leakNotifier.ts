import axios from 'axios';
import logger from '@server/logger';
import { getSettings } from '@server/lib/settings';
import type { LeakAlert } from './leakRadarService';

export class LeakNotifier {
  public static async sendNotification(
    alert: LeakAlert,
    isTest = false
  ): Promise<{ discordSent: boolean; telegramSent: boolean }> {
    const settings = getSettings();
    const discordSettings = settings.notifications.agents.discord;
    const telegramSettings = settings.notifications.agents.telegram;

    let discordSent = false;
    let telegramSent = false;

    // 1. DISCORD DISPATCH
    if (discordSettings?.enabled && discordSettings?.options?.webhookUrl) {
      try {
        const gradeColor =
          alert.inspection?.qualityGrade === 'A'
            ? 0x22c55e
            : alert.inspection?.qualityGrade === 'B'
            ? 0x3b82f6
            : alert.inspection?.qualityGrade === 'C'
            ? 0xf59e0b
            : 0xef4444;

        const embed: any = {
          title: `${isTest ? '🧪 [PRUEBA] ' : '🚨 '}Filtración Detectada: ${alert.mediaTitle} (${alert.year || '2026'})`,
          description: alert.description || 'Se ha detectado una nueva filtración en la red.',
          color: gradeColor,
          timestamp: new Date().toISOString(),
          fields: [
            {
              name: 'Tipo de Copia',
              value: `\`${alert.leakType.toUpperCase()}\``,
              inline: true,
            },
            {
              name: 'Calificación',
              value: `**Grado ${alert.inspection?.qualityGrade || 'A'}**`,
              inline: true,
            },
            {
              name: 'Fuente',
              value: alert.sourcePlatform,
              inline: true,
            },
            {
              name: 'Audio',
              value: alert.inspection?.audioProfile.type || 'Digital',
              inline: true,
            },
            {
              name: 'Video / Marcas de Agua',
              value: alert.inspection?.cleanVideo
                ? '✅ Limpio (Sin 1XBET)'
                : '⚠️ Marcas de Agua Detectadas',
              inline: true,
            },
          ],
          footer: {
            text: 'Null-seerr Leak Radar',
          },
        };

        if (alert.matchedMedia?.posterPath) {
          embed.thumbnail = {
            url: `https://image.tmdb.org/t/p/w500${alert.matchedMedia.posterPath}`,
          };
        }

        if (alert.redditUrl) {
          embed.url = alert.redditUrl;
        }

        await axios.post(discordSettings.options.webhookUrl, {
          username: 'Null-seerr Leak Radar',
          avatar_url: 'https://raw.githubusercontent.com/Zorthon28/Null-seerr/develop/public/os_icon.png',
          embeds: [embed],
        });

        discordSent = true;
        logger.info(`[LeakNotifier] Discord notification sent for "${alert.mediaTitle}"`, { label: 'LeakNotifier' });
      } catch (err: any) {
        logger.warn(`[LeakNotifier] Failed to send Discord notification: ${err.message}`);
      }
    }

    // 2. TELEGRAM DISPATCH
    if (telegramSettings?.enabled && telegramSettings?.options?.botAPI && telegramSettings?.options?.chatId) {
      try {
        const text = `🚨 <b>¡Filtración Detectada!</b>${isTest ? ' (Prueba)' : ''}\n\n` +
          `🎬 <b>${alert.mediaTitle}</b> (${alert.year || '2026'})\n` +
          `📦 <b>Tipo:</b> ${alert.leakType.toUpperCase()} (Grado ${alert.inspection?.qualityGrade || 'A'})\n` +
          `📡 <b>Fuente:</b> ${alert.sourcePlatform}\n` +
          `🔊 <b>Audio:</b> ${alert.inspection?.audioProfile.type || 'Digital'}\n` +
          `🛡️ <b>Video:</b> ${alert.inspection?.cleanVideo ? '✅ Limpio' : '⚠️ ' + (alert.inspection?.flags.join(', ') || 'Marca de agua')}\n\n` +
          `🔗 <a href="${alert.redditUrl}">Ver Detalles de Fuente</a>`;

        await axios.post(
          `https://api.telegram.org/bot${telegramSettings.options.botAPI}/sendMessage`,
          {
            chat_id: telegramSettings.options.chatId,
            parse_mode: 'HTML',
            text,
            disable_web_page_preview: false,
          }
        );

        telegramSent = true;
        logger.info(`[LeakNotifier] Telegram notification sent for "${alert.mediaTitle}"`, { label: 'LeakNotifier' });
      } catch (err: any) {
        logger.warn(`[LeakNotifier] Failed to send Telegram notification: ${err.message}`);
      }
    }

    return { discordSent, telegramSent };
  }
}
