import { GoogleGenAI } from "@google/genai";
import { GeneratedQuestionRaw } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const calculateDateRange = (timeRange: string): string => {
  const now = new Date();
  const endDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let startDate: Date;

  if (timeRange === 'This Quarter') {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    startDate = new Date(now.getFullYear(), quarterStartMonth, 1);
  } else if (timeRange === 'Year to Date (YTD)') {
    startDate = new Date(now.getFullYear(), 0, 1); // January 1st of current year
  } else {
    // Rolling 12 Months (default fallthrough)
    startDate = new Date(now);
    startDate.setFullYear(now.getFullYear() - 1);
  }

  const startDateStr = startDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return `${startDateStr} to ${endDate}`;
};

// Helper for delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Generate a small batch of questions
const generateBatch = async (batchSize: number, dateRangeText: string): Promise<GeneratedQuestionRaw[]> => {
  const model = "gemini-2.5-flash";
  
  const prompt = `You are a strict fact-checker and trivia generator for Google Cloud experts.

Task: Generate exactly ${batchSize} multiple-choice trivia questions concerning Google Cloud product launches and new features released strictly between ${dateRangeText}.

Products to cover: Google Kubernetes Engine, Cloud Run, Cloud Build, Artifact Manager, Cloud Deploy, Gemini Code Assist, Google Antigravity, Cloud Logging, and Cloud Monitoring.

STRICT ACCURACY RULES:
1. Use the Google Search tool to verify every single question against real release notes or blog posts.
2. ONLY generate questions based on verifiable public releases (General Availability or Preview) that occurred strictly within the date range: ${dateRangeText}.
3. If "Google Antigravity" has no real cloud product updates in this timeframe, ignore it.
4. If you cannot find enough strictly matching facts, return fewer questions.
5. Ensure questions are diverse and not duplicates of common knowledge.

Output Format:
Return ONLY a valid JSON array. Do not wrap it in markdown code blocks (no \`\`\`json).
Structure:
[
  {
    "question": "Question text here",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 0,
    "explanation": "A short interesting fact explaining the answer (max 30 words).",
    "sourceUrl": "The specific URL where this fact was verified."
  }
]`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      }
    });

    let text = response.text;
    if (!text) return [];
    
    // Clean up potential markdown or extra text
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // Attempt to extract JSON array if there's surrounding text
    const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      text = jsonMatch[0];
    }

    try {
        const data = JSON.parse(text) as GeneratedQuestionRaw[];
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.warn("JSON Parse failed for batch:", text);
        return [];
    }
  } catch (error) {
    console.warn("Batch generation API error:", error);
    return [];
  }
};

export const generateQuestions = async (
  totalCount: number, 
  timeRange: string,
  onProgress?: (percent: number) => void
): Promise<GeneratedQuestionRaw[]> => {
  const BATCH_SIZE = 5;
  const dateRangeText = calculateDateRange(timeRange);
  
  // 1. Calculate chunks (e.g., 12 questions -> [5, 5, 2])
  const chunkSizes: number[] = [];
  let remaining = totalCount;
  while (remaining > 0) {
      chunkSizes.push(Math.min(BATCH_SIZE, remaining));
      remaining -= BATCH_SIZE;
  }
  
  let completedChunks = 0;
  if (onProgress) onProgress(0);

  // 2. Create Promises for parallel execution
  const promises = chunkSizes.map(async (size, index) => {
      // Stagger start times slightly to prevent burst limit issues (200ms apart)
      await delay(index * 200);

      let batchData: GeneratedQuestionRaw[] = [];
      let attempts = 0;
      const MAX_RETRIES = 3;
      
      // Retry logic per batch
      while (attempts < MAX_RETRIES && batchData.length === 0) {
          try {
              if (attempts > 0) {
                  // Exponential backoff with jitter
                  await delay(1000 * Math.pow(2, attempts) + Math.random() * 500);
              }
              batchData = await generateBatch(size, dateRangeText);
          } catch (e) {
              console.warn(`Batch ${index + 1} attempt ${attempts + 1} failed.`);
          }
          attempts++;
      }

      completedChunks++;
      if (onProgress) {
          onProgress(Math.round((completedChunks / chunkSizes.length) * 100));
      }
      
      if (batchData.length === 0) {
          console.error(`Batch ${index + 1} failed permanently after ${MAX_RETRIES} attempts.`);
      }

      return batchData;
  });

  // 3. Wait for all batches to finish
  const results = await Promise.all(promises);
  let allQuestions = results.flat();

  // 4. De-duplication (since parallel batches don't know about each other)
  const seen = new Set<string>();
  allQuestions = allQuestions.filter(q => {
      // Create a unique fingerprint for the question
      const fingerprint = (q.question + q.correctIndex).toLowerCase().trim();
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
  });

  // 5. Trim to requested count
  return allQuestions.slice(0, totalCount);
};