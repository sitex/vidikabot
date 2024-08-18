require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const NodeCache = require('node-cache');
const { getSubtitles } = require('youtube-captions-scraper');

// Initialize cache
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

// Initialize the Generative AI API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Create a bot instance
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// YouTube video processing functions
const extractVideoId = (url) => {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
};

const fetchVideoInfo = async (videoId) => {
  const cachedInfo = cache.get(videoId);
  if (cachedInfo) return cachedInfo;

  try {
    // Fetch title using oEmbed API
    const oembedUrl = `https://www.youtube.com/oembed?url=http://www.youtube.com/watch?v=${videoId}&format=json`;
    const oembedResponse = await axios.get(oembedUrl);

    if (!oembedResponse.data || !oembedResponse.data.title) {
      throw new Error('Не удалось получить заголовок видео');
    }

    const title = oembedResponse.data.title;

    // Fetch captions using youtube-captions-scraper
    const captions = await getSubtitles({
      videoID: videoId,
      lang: 'ru' // Try Russian first
    }).catch(() => getSubtitles({
      videoID: videoId,
      lang: 'en' // Fallback to English if Russian is not available
    }));

    if (!captions || captions.length === 0) {
      throw new Error('Субтитры не найдены для этого видео');
    }

    const result = {
      title: title,
      captions: captions
    };
    cache.set(videoId, result);
    return result;
  } catch (error) {
    console.error('Error fetching video info:', error);
    throw new Error('Не удалось получить информацию о видео');
  }
};

const formatSubtitles = (captions) => {
  return captions.map(caption => {
    return `[${caption.start}] ${caption.text}`;
  }).join('\n');
};

const generateTakeaways = async (title, subtitles) => {
  const prompt = `
    I want you to only answer in Russian. 
    Your goal is to extract key takeaways from the following video transcript. 
    Takeaways must be concise, informative and easy to read & understand.
    Each key takeaway should be a list item, of the following format:
    - [Timestamp] [Takeaway emoji] [Short key takeaway in Russian]
    Timestamp in format HH:MM:SS
    Short key takeaway in three to six words in Russian.
    - 00:00:05 🤖 ...
    - 00:02:18 🛡️ ...
    - 00:05:37 💼 ...
    Keep emoji relevant and unique to each key takeaway item. 
    Do not use the same emoji for every takeaway. 
    Do not render brackets. Do not prepend takeaway with "Key takeaway".
    [VIDEO TITLE]:
    ${title}
    [VIDEO TRANSCRIPT]:
    ${subtitles}
    [KEY TAKEAWAYS LIST IN Russian]:
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Error generating takeaways:', error);
    throw new Error('Не удалось сгенерировать краткое содержание');
  }
};

// Helper function to send messages with error handling
const sendMessage = async (chatId, text) => {
  if (process.env.VERCEL_ENV !== 'production') {
    console.log(`Simulated message to chat ID ${chatId}:\n${text}`);
  } else {
    try {
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error);
      if (error.response && error.response.statusCode === 400 && error.response.body.description.includes('message is too long')) {
        const parts = text.match(/[\s\S]{1,4000}/g) || [];
        for (const part of parts) {
          await bot.sendMessage(chatId, part, { parse_mode: 'Markdown' });
        }
      }
    }
  }
};

// Vercel serverless function
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    const { body } = req;
    if (body.message && body.message.text) {
      const chatId = body.message.chat.id;
      const messageText = body.message.text;

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

          const formattedSubtitles = formatSubtitles(captions);

          const takeaways = await generateTakeaways(title, formattedSubtitles);

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
    }
    res.status(200).json({ message: 'OK' });
  } else {
    res.status(405).json({ error: 'Метод не разрешен' });
  }
};