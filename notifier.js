/**
 * Sends a rich embed notification to a Discord webhook.
 * 
 * @param {object} item - The classified news item
 * @param {string} webhookUrl - The Discord webhook URL
 */
export async function sendDiscordNotification(item, webhookUrl) {
  if (!webhookUrl) return;

  try {
    const amountStr = item.investment_amount_usd > 0
      ? `$${(item.investment_amount_usd / 1e6).toFixed(1)} Million`
      : 'Undisclosed Amount';

    const bullets = Array.isArray(item.summary_bullets)
      ? item.summary_bullets.map(b => `• ${b}`).join('\n')
      : 'No summary available.';

    const recipients = Array.isArray(item.recipients)
      ? item.recipients.map(r => (r && typeof r === 'object') ? (r.is_public && r.ticker ? `${r.name} (${r.exchange || 'Public'}: ${r.ticker})` : r.name) : r).join(', ')
      : item.recipients || 'Unknown';

    // Select color based on sector or default
    let color = 5814783; // Blurple
    const sectorLower = (item.sector || '').toLowerCase();
    if (sectorLower.includes('quantum')) {
      color = 3447003; // Cyan/Blue
    } else if (sectorLower.includes('semi') || sectorLower.includes('chip')) {
      color = 10181046; // Purple
    } else if (sectorLower.includes('energy')) {
      color = 3066993; // Green
    } else if (sectorLower.includes('bio')) {
      color = 15105570; // Orange
    }

    const payload = {
      embeds: [
        {
          title: `📢 New Investment/Grant Detected!`,
          description: `**${item.title}**`,
          url: item.url,
          color: color,
          fields: [
            {
              name: '🏢 Recipient(s)',
              value: recipients,
              inline: true
            },
            {
              name: '💰 Amount',
              value: amountStr,
              inline: true
            },
            {
              name: '🏛️ Funder / Source',
              value: item.source_or_funder || 'Unknown',
              inline: true
            },
            {
              name: '🔬 Sector',
              value: item.sector || 'General',
              inline: true
            },
            {
              name: '📝 Key Highlights',
              value: bullets
            }
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: `InvestAlert • Source: ${item.source || 'Aggregator'}`
          }
        }
      ]
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Discord webhook failed with status ${response.status}:`, errText);
    } else {
      console.log(`Discord notification sent for: "${item.title}"`);
    }
  } catch (err) {
    console.error('Error sending Discord notification:', err.message);
  }
}

/**
 * Sends a text notification to a Telegram bot channel/chat.
 * 
 * @param {object} item - The classified news item
 * @param {string} botToken - The Telegram bot token
 * @param {string} chatId - The Telegram chat ID
 */
export async function sendTelegramNotification(item, botToken, chatId) {
  if (!botToken || !chatId) return;

  try {
    const amountStr = item.investment_amount_usd > 0
      ? `$${(item.investment_amount_usd / 1e6).toFixed(1)} Million`
      : 'Undisclosed Amount';

    const bullets = Array.isArray(item.summary_bullets)
      ? item.summary_bullets.map(b => `• ${b}`).join('\n')
      : 'No summary available.';

    const recipients = Array.isArray(item.recipients)
      ? item.recipients.map(r => (r && typeof r === 'object') ? (r.is_public && r.ticker ? `${r.name} (${r.exchange || 'Public'}: ${r.ticker})` : r.name) : r).join(', ')
      : item.recipients || 'Unknown';

    const message = `🚨 *New Investment Alert* 🚨\n\n` +
      `*Headline*: ${item.title}\n\n` +
      `*🏢 Recipient(s)*: ${recipients}\n` +
      `*💰 Amount*: ${amountStr}\n` +
      `*🏛️ Funder/Source*: ${item.source_or_funder || 'Unknown'}\n` +
      `*🔬 Sector*: ${item.sector || 'General'}\n\n` +
      `*Key Highlights*:\n${bullets}\n\n` +
      `🔗 [Read Full Article](${item.url})`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Telegram sendMessage failed with status ${response.status}:`, errText);
    } else {
      console.log(`Telegram notification sent for: "${item.title}"`);
    }
  } catch (err) {
    console.error('Error sending Telegram notification:', err.message);
  }
}
