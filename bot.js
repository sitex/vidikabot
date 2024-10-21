require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const NodeCache = require('node-cache');
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
  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]+)/,
    /(?:https?:\/\/)?(?:m\.)?youtube\.com\/watch\?v=([^&]+)/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^/?]+)/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([^/?]+)/,
    /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^/?]+)/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([^/?]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
};

const fetchVideoInfo = async (videoId) => {
  const cachedInfo = cache.get(videoId);
  if (cachedInfo) return cachedInfo;

  try {
    // Fetch video info using ytdl-core
    const videoInfo = await ytdl.getInfo(videoId, { requestOptions: 
      { 
          headers: {
              Cookie: 'VISITOR_INFO1_LIVE=31GxtsADDlo; VISITOR_PRIVACY_METADATA=CgJJRBIEGgAgIA%3D%3D; PREF=tz=Asia.Aqtau&f4=4000000; SID=g.a000pQhK7tUEvcozhmqmBNCiq9eIbV9xyfhRh9xW_Ebg_gYiFUPoC_Oyw-SMg8wnmcnEsrQjAAACgYKAeISARQSFQHGX2MicITKnetTXAwGoOfG5A3Q0BoVAUF8yKo3njJpl24ZXVt6CbniCnqs0076; __Secure-1PSIDTS=sidts-CjEBQlrA-Hsjclb-YQs04jSpWdkc7hCEeslduJJvReil1EVLP_DGntMrG64W8JQKPHjfEAA; __Secure-3PSIDTS=sidts-CjEBQlrA-Hsjclb-YQs04jSpWdkc7hCEeslduJJvReil1EVLP_DGntMrG64W8JQKPHjfEAA; __Secure-1PSID=g.a000pQhK7tUEvcozhmqmBNCiq9eIbV9xyfhRh9xW_Ebg_gYiFUPolfaMcgU0UdUNmZLe-szdWQACgYKAWUSARQSFQHGX2MidrWUxpkCpxvadU2Z6A8fUBoVAUF8yKpb6SvA_pVeK-nJNkHDln-60076; __Secure-3PSID=g.a000pQhK7tUEvcozhmqmBNCiq9eIbV9xyfhRh9xW_Ebg_gYiFUPoVyqPQfMwKC_qPxJzvVzMzgACgYKAYsSARQSFQHGX2MigjdQOzGxCXM1ABKfNZAb-hoVAUF8yKrYdUxwcV1yY0YhQ4PowY_N0076; HSID=Aejm7gi4RyjJJGLw0; SSID=AQcis4OB8nd4DSr-5; APISID=lQfvoz66sbUPvkGV/AmMmzSDeCAtwR9yjP; SAPISID=imdmZfeGgAt40mhg/AKddgISnK2z6e4UW_; __Secure-1PAPISID=imdmZfeGgAt40mhg/AKddgISnK2z6e4UW_; __Secure-3PAPISID=imdmZfeGgAt40mhg/AKddgISnK2z6e4UW_; LOGIN_INFO=AFmmF2swRQIgArlcQ8Pr35gChlLN8Zf95IevLyYDI8xOnENB9Nz4VFgCIQCx6YPbF70U1WDh82zZMWZ2tdtJ7IbXHC-6WW594KFonQ:QUQ3MjNmeVBmUkhwNTNVZmVCRmE1dFBNT01tQl9ZRkFjdC1ZVkNmTWlHUHlnS3pmNGdHUmQtcnJLNjhoaWp0MVA0ZGpvZXhZUXY1Qzl4cW1CX3lBQjdwRDZBY3RYS1JnVVV6ZzNVMWRicUx1b3l1YUFPbjZnMGZvN2M3VXhFT0xfdDJCdnMzUFVTU2ltc2VhZ2pnXy1oOU8zbk94RWIxYUlR; SIDCC=AKEyXzUCFR56fqdIzvHK561cJm1gqY_6W2RlxbzwDmC2RsgYCIZStPFH6u8F9sjtLnNe9exVlME; __Secure-1PSIDCC=AKEyXzX8RJ2oHCQqnXomBmN-VwjPiSJOuiquQy4cj7tBO_5ekD9wJKUYASxEzLwwIG7NAMtB3fY; __Secure-3PSIDCC=AKEyXzWeYo3CWrzqSB9GVusgCXJ4QHZ6Mda97Zkli2FjmRoJ3y_d4jzI5GkEbFfCLt1bCXb5wg;'
          }
      }
    });

    const title = videoInfo.videoDetails.title;

    // Fetch captions using ytdl-core
    const captionTracks = videoInfo.player_response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      throw new Error('Субтитры не найдены для этого видео 1');
    }

    // Prefer Russian captions, fallback to English
    const captionTrack = captionTracks.find(track => track.languageCode === 'ru') ||
        captionTracks.find(track => track.languageCode === 'en');

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
    throw new Error(error.message);
  }
};

const parseCaptions = (xml) => {
  const parser = new (require('xmldom').DOMParser)();
  const doc = parser.parseFromString(xml, 'text/xml');
  const textNodes = doc.getElementsByTagName('text');

  return Array.from(textNodes).map(node => ({
    start: parseFloat(node.getAttribute('start')),
    dur: node.getAttribute('dur') ? parseFloat(node.getAttribute('dur')) : 0,
    text: node.textContent
  }));
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
const splitCaptionsIntoChunks = (captions, chunkDurationMinutes = 60) => {
  const chunks = [];
  let currentChunk = [];
  const chunkDurationSeconds = chunkDurationMinutes * 60;

  for (const caption of captions) {
    if (currentChunk.length === 0 ||
        caption.start - currentChunk[0].start < chunkDurationSeconds) {
      currentChunk.push(caption);
    } else {
      chunks.push(currentChunk);
      currentChunk = [caption];
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
};

const generateTakeaways = async (title, captions, fileHandle) => {
  const chunks = splitCaptionsIntoChunks(captions);
  let allTakeaways = '';

  console.log(chunks.length)

  for (let i = 0; i < chunks.length; i++) {
    const chunkSubtitles = formatSubtitles(chunks[i]);

    // Append each item to the file, followed by a newline
    await fileHandle.appendFile(`${chunkSubtitles}\n`);

    const prompt1 = `
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
      ${chunkSubtitles}

      Please respond in Russian, using a formal and informative tone. 
      Make sure the title is between 10 and 50 characters long. Do not include a title before the bullet point list.
      Ensure there is at least a 15-second gap between timestamps in your summary.
      Don't call the speaker.
      Make sure the title is between 10 and 50 characters long. Do not include a title before the bullet point list.
      Prioritize summarizing the key points and insights discussed every 3 to 5 minutes of the video. Every 3 to 5 minutes of the TRANSCRIPT.
      Ensure there is at least a 15-second gap between timestamps in your summary.
    `;

    let prompt2 = '';
    // if (allTakeaways !== '') {
    //   prompt2 = `
    //     Continue in the stile of previous takeaways
    //     [THE PREVIOUS TAKEAWAYS]:
    //     ${allTakeaways}
    //
    //     [KEY TAKEAWAYS LIST IN Russian]:
    //   `;
    // }
    const prompt3 = `
      [KEY TAKEAWAYS LIST IN Russian]:
    `;

//     const prompt = `
// Please analyze the following video captions and provide just the key points.
// Maximum takeaway length is 50 symbols.
// Don't call the speaker.
// Do not prepend your answer with a title.
// Structure your output as a bullet point list with timestamps for each key point.
// For each bullet point, select a single emoji that best represents the *main idea* of the discussed topic.
// Make sure that each emoji is used only once throughout the summary.
//
// Each key takeaway should be a list item, of the following format:
// - [Timestamp] [Takeaway emoji] [Short key takeaway in Russian]
// Timestamp in format HH:MM:SS
//
// Here are some examples of how to format your output:
//
// Example 1:
//
// - 00:00:05 🤖 Влияниение на общество
// - 00:02:18 🛡️ Потенциальные преимущества и риски
//
// Example 2:
//
// - 00:05:37 💼 Новая стратегию для развития
// - 00:07:56 📈 Текущий рынок продуктов
//
// Do not render brackets.
// [VIDEO TITLE]:
// ${title}
//
// [VIDEO TRANSCRIPT]:
// ${chunkSubtitles}
//
// Please respond in Russian, using a formal and informative tone.
// Make sure the title is between 10 and 50 characters long. Do not include a title before the bullet point list.
// Make sure the title is between 10 and 50 characters long. Do not include a title before the bullet point list.
// [KEY TAKEAWAYS LIST IN Russian]:
//
//     `;
    try {
      const result = await model.generateContent(prompt1 + prompt2 + prompt3);
      const response = await result.response;
      allTakeaways += response.text() + '\n\n';
    } catch (error) {
      console.error('Error generating takeaways for chunk:', error);
      throw new Error('Не удалось сгенерировать краткое содержание для части видео');
    }
  }

  return allTakeaways.trim();
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

          const takeaways = await generateTakeaways(title, captions);

          await sendMessage(chatId, `Краткое содержание видео "${title}":\n\n${takeaways}`);
        } else {
          await sendMessage(chatId, 'Пожалуйста, отправьте корректную ссылку на видео YouTube.');
        }
      } catch (error) {
        console.error('Ошибка обработки сообщения:', error);
        let errorMessage = 'Произошла ошибка при обработке вашего запроса. ';
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

        await sendMessage(chatId, errorMessage);
      }
    }
    res.status(200).json({ message: 'OK' });
  } else {
    res.status(405).json({ error: 'Метод не разрешен' });
  }
};

// Экспорт функций для тестирования
module.exports = {
  extractVideoId,
  fetchVideoInfo,
  formatSubtitles,
  generateTakeaways,
  splitCaptionsIntoChunks
};