require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { extractVideoId, fetchVideoInfo, formatSubtitles, generateTakeaways } = require('./bot');
const fs = require('fs').promises;

const token = process.env.TELEGRAM_BOT_TOKEN;

// Create a bot instance
const bot = new TelegramBot(token);

async function sendLongMessage(chatId, text) {
    const maxLength = 4000; // Leave some room for formatting
    const parts = [];

    while (text.length > 0) {
        if (text.length > maxLength) {
            let part = text.substr(0, maxLength);
            let lastParagraph = part.lastIndexOf('\n\n');
            if (lastParagraph > 0) {
                part = part.substr(0, lastParagraph);
            } else {
                let lastSpace = part.lastIndexOf(' ');
                if (lastSpace > 0) {
                    part = part.substr(0, lastSpace);
                }
            }
            parts.push(part);
            text = text.substr(part.length);
        } else {
            parts.push(text);
            break;
        }
    }

    for (let i = 0; i < parts.length; i++) {
        await bot.sendMessage(chatId, parts[i], { parse_mode: 'Markdown' });
    }
}

// Helper function to send messages with error handling and message splitting
const sendMessage = async (chatId, text) => {
  const maxLength = 4000; // Maximum safe length for a Telegram message
  try {
    if (text.length <= maxLength) {
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } else {
      await sendLongMessage(chatId, text);
    }
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    // If markdown parsing fails, try sending without markdown
    if (error.response && error.response.description.includes('can\'t parse entities')) {
      await bot.sendMessage(chatId, text);
    }
  }
};

async function readCaptionsFromFile(videoId) {
  try {
    const data = await fs.readFile('captions.json', 'utf8');
    const captions = JSON.parse(data);
    return captions[videoId] || null;
  } catch (error) {
    console.error('Error reading captions file:', error);
    return null;
  }
}

async function startBot() {
  try {
    // Отключаем webhook
    await bot.deleteWebHook();
    console.log('Webhook отключен');

    // Запускаем бота в режиме long polling
    bot.startPolling();
    console.log('Бот запущен в режиме long polling');

    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const messageText = msg.text;

      var d = new Date();
      var n = d.toLocaleTimeString();

      console.log(n, messageText);

      try {
        if (messageText.startsWith('/start')) {
          await sendMessage(chatId, 'Добро пожаловать! Отправьте мне ссылку на видео YouTube, чтобы получить его краткое содержание.');
        } else if (messageText.includes('youtube.com') || messageText.includes('youtu.be')) {
          await sendMessage(chatId, 'Обрабатываю ваш запрос. Это может занять некоторое время...');

          const videoId = extractVideoId(messageText);
          if (!videoId) {
            throw new Error('Неверная ссылка на YouTube видео');
          }

          const { title, captions } = await fetchVideoInfo(videoId);

          if (!captions || captions.length === 0) {
            throw new Error('Для этого видео не найдены субтитры');
          }

          // console.log(captions);
          // const formattedSubtitles = formatSubtitles(captions);


            // Open the file for appending
          const filename = 'captions/' + videoId + '.txt';
          const fileHandle = await fs.open(filename, 'a');

          const takeaways = await generateTakeaways(title, captions, fileHandle);

          await fileHandle.close();

          await sendMessage(chatId, `Краткое содержание видео "${title}":\n\n${takeaways}`);
        } else {
          await sendMessage(chatId, 'Пожалуйста, отправьте корректную ссылку на видео YouTube.');
        }
      } catch (error) {
        console.error('Ошибка обработки сообщения:', error);
        let errorMessage = 'Произошла ошибка при обработке вашего запроса. ';
        if (error.message.includes('Неверная ссылка')) {
          errorMessage += 'Пожалуйста, проверьте ссылку и попробуйте еще раз.';
        } else if (error.message.includes('Субтитры не найдены')) {
          errorMessage += 'Для этого видео субтитры недоступны. Пожалуйста, попробуйте другое видео с доступными субтитрами.';
        } else if (error.message.includes('Не удалось сгенерировать краткое содержание')) {
          errorMessage += 'Не удалось создать краткое содержание. Пожалуйста, попробуйте еще раз или используйте другое видео.';
        } else {
          errorMessage += 'Пожалуйста, попробуйте еще раз позже или используйте другое видео.';
        }
        await sendMessage(chatId, errorMessage);



      }
    });
  } catch (error) {
    console.error('Ошибка при запуске бота:', error);
  }
}

startBot();