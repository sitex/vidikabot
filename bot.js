require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const NodeCache = require('node-cache');
const { getSubtitles } = require('youtube-captions-scraper');
const ytdl = require('ytdl-core');

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
    // Fetch video info using ytdl-core
    const videoInfo = await ytdl.getInfo(videoId);
    const title = videoInfo.videoDetails.title;
<<<<<<< HEAD

    // Fetch captions using ytdl-core
    const captionTracks = videoInfo.player_response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      throw new Error('Субтитры не найдены для этого видео 1');
    }

    // Prefer Russian captions, fallback to English
    const captionTrack = captionTracks.find(track => track.languageCode === 'ru') ||
        captionTracks.find(track => track.languageCode === 'en');
=======
>>>>>>> 4fd8bc7 (use ytdl for title)

    if (!captionTrack) {
      throw new Error('Субтитры на русском или английском не найдены');
    }

    const captionResponse = await fetch(captionTrack.baseUrl);
    const captionXml = await captionResponse.text();
    const captions = parseCaptions(captionXml);

    const result = {
      title: title,
      captions: captions
    };
    cache.set(videoId, result);
    return result;
  } catch (error) {
    console.error('Error fetching video info:', error);
<<<<<<< HEAD
    throw new Error(error.message);
=======
    throw new Error('Субтитры не найдены для этого видео');
>>>>>>> 4fd8bc7 (use ytdl for title)
  }
};

const formatSubtitles = (captions) => {
  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `[${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
  };

  return captions.map(caption => {
    const timeFormatted = formatTime(caption.start);
    return `${timeFormatted} ${caption.text}`;
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
      // Split the message into chunks of 4000 characters
      const messageParts = text.match(/[\s\S]{1,4000}/g) || [];

      for (const part of messageParts) {
        await bot.sendMessage(chatId, part, { parse_mode: 'Markdown' });
        // Add a small delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error);
      // If there's still an error, log it but don't throw, to prevent the whole process from crashing
      // You might want to send a fallback message to the user here
      await bot.sendMessage(chatId, 'Произошла ошибка при отправке сообщения. Пожалуйста, попробуйте еще раз позже.');
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
<<<<<<< HEAD
        errorMessage += error.message;
        // if (error.message.includes('Неверная ссылка')) {
        //   errorMessage += 'Пожалуйста, проверьте ссылку и попробуйте еще раз.';
        // } else if (error.message.includes('Субтитры не найдены')) {
        //   errorMessage += 'Для этого видео субтитры недоступны. Пожалуйста, попробуйте другое видео с доступными субтитрами.';
        // } else if (error.message.includes('Не удалось сгенерировать краткое содержание')) {
        //   errorMessage += 'Не удалось создать краткое содержание. Пожалуйста, попробуйте еще раз или используйте другое видео.';
        // } else {
        //   errorMessage += 'Пожалуйста, попробуйте еще раз позже или используйте другое видео.';
        // }
=======
        if (error.message.includes('Неверная ссылка')) {
          errorMessage += 'Пожалуйста, проверьте ссылку и попробуйте еще раз.';
        } else if (error.message.includes('не найдены субтитры')) {
          errorMessage += 'Для этого видео субтитры недоступны. Пожалуйста, попробуйте другое видео с доступными субтитрами.';
        } else if (error.message.includes('Не удалось сгенерировать краткое содержание')) {
          errorMessage += 'Не удалось создать краткое содержание. Пожалуйста, попробуйте еще раз или используйте другое видео.';
        } else {
          errorMessage += 'Пожалуйста, попробуйте еще раз позже или используйте другое видео.';
        }
>>>>>>> 4fd8bc7 (use ytdl for title)
        await sendMessage(chatId, errorMessage);
      }
    }
    res.status(200).json({ message: 'OK' });
  } else {
    res.status(405).json({ error: 'Метод не разрешен' });
  }
};

// В конце файла bot.js добавьте:
module.exports = {
  extractVideoId,
  fetchVideoInfo,
  formatSubtitles,
  generateTakeaways
};