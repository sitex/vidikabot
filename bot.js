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
  const cookie = process.env.YOUTUBE_COOKIE || ''
  const idToken = 'QUFFLUhqa2FscERXcFlRSlIwcTd3TWdzalltSTd4TENyQXw';

  if (cachedInfo) return cachedInfo;

  try {
    const options = {
      requestOptions: {
        headers: {
          Cookie: cookie,
          'x-youtube-identity-token': idToken
        }
      }
    };

    // Get video info
    const videoInfo = await ytdl.getBasicInfo(videoId, options);
    const title = videoInfo.videoDetails.title;

    // Fetch captions
    const captionTracks = videoInfo.player_response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      throw new Error('Субтитры не найдены для этого видео');
    }

    // Prefer Russian captions, fallback to English
    const captionTrack = captionTracks.find(track => track.languageCode === 'ru') ||
                        captionTracks.find(track => track.languageCode === 'en');

    if (!captionTrack) {
      throw new Error('Субтитры на русском или английском не найдены');
    }

    const captionResponse = await fetch(captionTrack.baseUrl);
    if (!captionResponse.ok) {
      throw new Error(`Ошибка при получении субтитров: ${captionResponse.status}`);
    }

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
    if (error.message.includes('not exist')) {
      throw new Error('Видео не существует или недоступно');
    } else if (error.message.includes('private video')) {
      throw new Error('Это приватное видео');
    } else {
      throw new Error(`Ошибка при получении информации о видео: ${error.message}`);
    }
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

const splitCaptionsIntoChunks = (captions, chunkDurationMinutes = 15) => {  // Reduced from 60 to 15 minutes
  const chunks = [];
  let currentChunk = [];
  const chunkDurationSeconds = chunkDurationMinutes * 60;
  
  for (const caption of captions) {
    if (currentChunk.length === 0 ||
        caption.start - currentChunk[0].start < chunkDurationSeconds) {
      currentChunk.push(caption);
    } else {
      // Add overlap with previous chunk
      const overlapDuration = 60; // 1 minute overlap
      const overlapCaptions = currentChunk.filter(c => 
        c.start > currentChunk[currentChunk.length - 1].start - overlapDuration
      );
      chunks.push(currentChunk);
      currentChunk = [...overlapCaptions, caption];
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
};

const generateTakeaways = async (title, captions, fileHandle) => {
  const chunks = splitCaptionsIntoChunks(captions, 15); // 15 minute chunks
  console.log(`Processing ${chunks.length} chunks in parallel`);

  // Function to process a single chunk
  const processChunk = async (chunk, chunkIndex) => {
    const chunkSubtitles = formatSubtitles(chunk);
    
    if (fileHandle) {
      await fileHandle.writeFile(`Chunk ${chunkIndex + 1}:\n${chunkSubtitles}\n\n`);
    }

    const prompt = `
      I want you to only answer in Russian.
      Your goal is to extract key takeaways from the following video transcript chunk ${chunkIndex + 1} of ${chunks.length}.
      Takeaways must be concise, informative and easy to read & understand.
      Each key takeaway should be a list item, of the following format:
      - [Timestamp] [Takeaway emoji] [Short key takeaway in Russian]
      
      Important rules:
      1. Extract a takeaway roughly every 3-5 minutes of transcript
      2. Don't skip large portions of the transcript
      3. Ensure even coverage of the entire chunk
      4. Avoid clustering takeaways too close together
      5. Maximum 5-6 takeaways per 15-minute chunk
      
      Format requirements:
      - Timestamp in format HH:MM:SS
      - Short key takeaway in three to six words in Russian
      - Keep emoji relevant and unique to each key takeaway item
      - Do not use the same emoji twice
      - Do not render brackets
      - Do not prepend takeaway with "Key takeaway"
      
      [VIDEO TITLE]:
      ${title}
      
      [CHUNK TIME RANGE]:
      ${formatTimestamp(chunk[0].start)} - ${formatTimestamp(chunk[chunk.length-1].start)}
      
      [VIDEO TRANSCRIPT]:
      ${chunkSubtitles}

      Please respond in Russian, using a formal and informative tone.
      Make sure each takeaway adds new information and isn't redundant.
      Focus on the main ideas and key transitions in the content.
      
      [KEY TAKEAWAYS LIST IN Russian]:
    `;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return {
        index: chunkIndex,
        content: response.text().trim(),
        startTime: chunk[0].start
      };
    } catch (error) {
      console.error(`Error processing chunk ${chunkIndex}:`, error);
      throw new Error(`Не удалось обработать часть ${chunkIndex + 1} видео`);
    }
  };

  // Helper function to format timestamps
  function formatTimestamp(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  try {
    // Process all chunks in parallel
    const chunkPromises = chunks.map((chunk, index) => processChunk(chunk, index));
    const results = await Promise.all(chunkPromises);

    // Sort results by timestamp to maintain chronological order
    results.sort((a, b) => a.startTime - b.startTime);

    // Combine all takeaways
    return results.map(result => result.content).join('\n\n');
  } catch (error) {
    console.error('Error in parallel processing:', error);
    throw new Error('Произошла ошибка при обработке видео');
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