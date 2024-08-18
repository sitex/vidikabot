require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { extractVideoId, fetchVideoInfo, formatSubtitles, generateTakeaways } = require('./bot');

const token = process.env.TELEGRAM_BOT_TOKEN;

// Create a bot instance
const bot = new TelegramBot(token);

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

      try {
        if (messageText.startsWith('/start')) {
          await bot.sendMessage(chatId, 'Добро пожаловать! Отправьте мне ссылку на видео YouTube, чтобы получить его краткое содержание.');
        } else if (messageText.includes('youtube.com') || messageText.includes('youtu.be')) {
          await bot.sendMessage(chatId, 'Обрабатываю ваш запрос. Это может занять некоторое время...');

          const videoId = extractVideoId(messageText);
          if (!videoId) {
            throw new Error('Неверная ссылка на YouTube видео');
          }

          const { title, captions } = await fetchVideoInfo(videoId);

          if (!captions || captions.length === 0) {
            throw new Error('Для этого видео не найдены субтитры');
          }

          const formattedSubtitles = formatSubtitles(captions);

          const takeaways = await generateTakeaways(title, formattedSubtitles);

          await bot.sendMessage(chatId, `Краткое содержание видео "${title}":\n\n${takeaways}`);
        } else {
          await bot.sendMessage(chatId, 'Пожалуйста, отправьте корректную ссылку на видео YouTube.');
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
        await bot.sendMessage(chatId, errorMessage);
      }
    });
  } catch (error) {
    console.error('Ошибка при запуске бота:', error);
  }
}

startBot();