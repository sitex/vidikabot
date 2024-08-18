require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const NodeCache = require('node-cache');

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

  // Fetch title using oEmbed API
  const oembedUrl = `https://www.youtube.com/oembed?url=http://www.youtube.com/watch?v=${videoId}&format=json`;
  const oembedResponse = await axios.get(oembedUrl);

  if (!oembedResponse.data || !oembedResponse.data.title) {
    throw new Error('Не удалось получить заголовок видео');
  }

  const title = oembedResponse.data.title;

  // Fetch captions using the original method
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const videoResponse = await axios.get(videoUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  });

  const html = videoResponse.data;
  const dom = new JSDOM(html);
  const scripts = dom.window.document.getElementsByTagName('script');
  let ytInitialPlayerResponse;

  for (const script of scripts) {
    const content = script.textContent;
    if (content.includes('ytInitialPlayerResponse')) {
      const match = content.match(/ytInitialPlayerResponse\s*=\s*({.*?});/);
      if (match) {
        ytInitialPlayerResponse = JSON.parse(match[1]);
        break;
      }
    }
  }

  if (!ytInitialPlayerResponse || !ytInitialPlayerResponse.captions) {
    throw new Error('Не удалось получить информацию о субтитрах');
  }

  const result = {
    title: title,
    captions: ytInitialPlayerResponse.captions
  };
  cache.set(videoId, result);
  return result;
};
const extractCaptionTracks = (captions) => {
  if (!captions || !captions.playerCaptionsTracklistRenderer) {
    throw new Error('Субтитры не найдены');
  }
  return captions.playerCaptionsTracklistRenderer.captionTracks;
};

const selectCaptionTrack = (tracks, lang) => {
  return tracks.find(track => track.languageCode === lang)
    || tracks.find(track => track.kind === 'asr')
    || tracks[0];
};

const fetchAndParseSubtitles = async (url) => {
  const cachedSubtitles = cache.get(url);
  if (cachedSubtitles) return cachedSubtitles;

  const response = await axios.get(url);
  const xml = response.data;
  const subtitles = parseSubtitlesXml(xml);
  cache.set(url, subtitles);
  return subtitles;
};

const parseSubtitlesXml = (xml) => {
  const dom = new JSDOM(xml);
  const textNodes = dom.window.document.getElementsByTagName('text');
  return Array.from(textNodes).map(node => ({
    start: parseFloat(node.getAttribute('start')),
    duration: parseFloat(node.getAttribute('dur')),
    text: decodeHtmlEntities(node.textContent)
  }));
};

const formatSubtitles = (subtitles) => {
  return subtitles.map(sub => {
    const formattedTime = formatTime(sub.start);
    return `${formattedTime} ${sub.text.trim()}`;
  }).join('\n');
};

const formatTime = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `[${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
};

const decodeHtmlEntities = (text) => {
  const entities = {
    '&#39;': "'",
    '&quot;': '"',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
  };
  return text.replace(/&#?\w+;/g, match => entities[match] || match).replace(/\n/g, ' ');
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
    ${captionText}
    [KEY TAKEAWAYS LIST IN Russian]:
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Error generating takeaways:', error);
    throw new Error('Failed to generate takeaways');
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

// Translate function
const translate = async (text, targetLang = 'ru') => {
  try {
    const result = await model.generateContent(`Translate the following text to ${targetLang}: "${text}"`);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Ошибка перевода:', error);
    return text; // Return original text if translation fails
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
          const captionTracks = extractCaptionTracks(captions);

          if (!captionTracks || captionTracks.length === 0) {
            throw new Error('Для этого видео не найдены субтитры');
          }

          const selectedTrack = selectCaptionTrack(captionTracks, 'en');
          if (!selectedTrack) {
            throw new Error('Не найдены подходящие субтитры для этого видео');
          }

          const subtitles = await fetchAndParseSubtitles(selectedTrack.baseUrl);
          const formattedSubtitles = formatSubtitles(subtitles);

          const takeaways = await generateTakeaways(title, formattedSubtitles);

          await sendMessage(chatId, `Краткое содержание видео "${title}":\n\n${takeaways}`);
        } else {
          const invalidUrlMessage = await translate('Please send a valid YouTube video URL.');
          await sendMessage(chatId, invalidUrlMessage);
        }
      } catch (error) {
        console.error('Ошибка обработки сообщения:', error);
        await sendMessage(chatId, `Ошибка: ${error.message}`);
      }
    }
    res.status(200).json({ message: 'OK' });
  } else {
    res.status(405).json({ error: 'Метод не разрешен' });
  }
};