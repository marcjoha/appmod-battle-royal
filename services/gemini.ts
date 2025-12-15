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

export const generateQuestions = async (count: number, timeRange: string): Promise<GeneratedQuestionRaw[]> => {
  // Use gemini-2.5-flash with Google Search for speed + accuracy
  const model = "gemini-2.5-flash";
  const dateRangeText = calculateDateRange(timeRange);
  
  const prompt = `You are a strict fact-checker and trivia generator for Google Cloud experts.

Task: Generate exactly ${count} multiple-choice trivia questions concerning Google Cloud product launches and new features released strictly between ${dateRangeText}.

Products to cover: Google Kubernetes Engine, Cloud Run, Cloud Build, Artifact Manager, Cloud Deploy, Gemini Code Assist, Google Antigravity, Cloud Logging, and Cloud Monitoring.

STRICT ACCURACY RULES:
1. Use the Google Search tool to verify every single question against real release notes or blog posts.
2. ONLY generate questions based on verifiable public releases (General Availability or Preview) that occurred strictly within the date range: ${dateRangeText}.
3. If "Google Antigravity" has no real cloud product updates in this timeframe, ignore it.
4. If you cannot find enough strictly matching facts, return fewer questions.

Output Format:
Return ONLY a valid JSON array. Do not wrap it in markdown code blocks (no \`\`\`json).
Structure:
[
  {
    "question": "Question text here",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 0
  }
]`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        // responseMimeType: "application/json" is NOT allowed with googleSearch
        // responseSchema is NOT allowed with googleSearch
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

    const data = JSON.parse(text) as GeneratedQuestionRaw[];
    return data;
  } catch (error) {
    console.error("Failed to generate questions:", error);
    throw error;
  }
};