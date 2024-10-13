// test.js
const youtubeSummarizer = require('./bot.js');

const testVideoUrl = 'https://www.youtube.com/watch?v=Y87hcMCYrBI'; // Replace with a valid YouTube video URL

// Create a mock response object
const mockRes = {
  status: (code) => {
    mockRes.statusCode = code; // Store the status code
    return mockRes; // Return the mockRes object for chaining
  },
  json: (data) => {
    mockRes.jsonData = data; // Store the JSON data
    return mockRes; // Return the mockRes object
  },
  statusCode: null, // Initialize statusCode
  jsonData: null, // Initialize jsonData
};

async function testSummarization() {
  try {
    await youtubeSummarizer({
      method: 'POST',
      body: {
        message: {
          text: testVideoUrl,
          chat: { id: 12345 } // Provide a valid chat ID here
        }
      }
    }, mockRes);

  } catch (error) {
    console.error('Error:', error);
  }
}

testSummarization();