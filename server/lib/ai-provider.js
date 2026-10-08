import { GoogleGenAI } from "@google/genai";
import * as fs from 'fs';

export const DEFAULT_PROMPT = "Identify the bird or birds in the attached screenshot. Return a JSON array of objects with the following format: { \"is_bird\": true or false, \"species\": \"common species name in all lower case letters\", \"gender\": \"male or female or unknown\", \"count\": number of birds of this species in the screenshot, \"confidence\": confidence score between 0 and 1, \"non_bird_species\": \"non-bird species if any\" }.  Only return JSON, do not return any other data.  If the screenshot has no bird set is_bird to false and set non_bird_species to the most prominent non-bird object in the image, if any.  If there is no bird, still calculate the confidence score between 0 and 1 for what you believe is in the image.  Do not put the JSON in a codeblock, return only JSON.";
export const DEFAULT_MODEL = "gemini-2.5-flash";
export const DEFAULT_IMAGE_PROMPT = "Create a single cheerful cartoon-style illustration featuring each of these bird species: {species}. Draw every species exactly once, gathered together around a backyard bird feeder, with each bird's common name written in a small, clearly legible label beneath it. Use bright, friendly colors, bold outlines, and a simple background. Do not add any other text.";
export const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-lite-image";

export class AIProvider {
    constructor(storage) {
        this.storage = storage;
        this.genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    }

    async identifyBird(clipData, screenshotPath) {
        try {
            const promptSetting = this.storage.getSettingWithId('ai_prompt');
            const modelSetting = this.storage.getSettingWithId('ai_model');
            const prompt = promptSetting?.value || DEFAULT_PROMPT;
            const model = modelSetting?.value || DEFAULT_MODEL;

            // Read the image file and convert to base64
            const imageData = fs.readFileSync(screenshotPath);
            const base64Image = imageData.toString('base64');

            const response = await this.genai.models.generateContent({
                model,
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                inlineData: {
                                    mimeType: "image/jpeg",
                                    data: base64Image,
                                }
                            },
                            {
                                text: prompt,
                            }
                        ]
                    }
                ]
            })

            const resultJson = JSON.parse(response.text);
            const resultArray = Array.isArray(resultJson) ? resultJson : [resultJson]; // supposed to be an array but it isn't always
            for (const result of resultArray) {
                result.ai_model_id = modelSetting?.id ?? null;
                result.ai_prompt_id = promptSetting?.id ?? null;
            }
            console.log(`Identified bird for clip ${clipData.id}: ${JSON.stringify(resultArray)}`);
            return Array.isArray(resultJson) ? resultArray : resultArray[0];
        } catch(error) {
            console.error(`Error identifying bird for clip ${clipData.id}:`, error);
            throw error;
        }
    }

    /**
     * Generates an image from the active image prompt template, with {species} replaced by speciesList.
     * @param {string} speciesList - Comma-separated species names to fill into the prompt.
     * @returns {Promise<{ data: Buffer, mimeType: string, ai_model_id: number|null, ai_prompt_id: number|null }>}
     */
    async generateImage(speciesList) {
        const promptSetting = this.storage.getSettingWithId('ai_image_prompt');
        const modelSetting = this.storage.getSettingWithId('ai_image_model');
        const prompt = (promptSetting?.value || DEFAULT_IMAGE_PROMPT).replaceAll('{species}', speciesList);
        const model = modelSetting?.value || DEFAULT_IMAGE_MODEL;

        const response = await this.genai.models.generateContent({
            model,
            contents: [
                {
                    role: 'user',
                    parts: [{ text: prompt }],
                }
            ],
            config: {
                responseModalities: ['IMAGE'],
                imageConfig: { aspectRatio: '1:1' },
            },
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const imagePart = parts.find(part => part.inlineData?.data);
        if (!imagePart) {
            const reason = response.candidates?.[0]?.finishReason ?? response.promptFeedback?.blockReason ?? 'no image returned';
            throw new Error(`Image generation returned no image (${reason})`);
        }

        return {
            data: Buffer.from(imagePart.inlineData.data, 'base64'),
            mimeType: imagePart.inlineData.mimeType || 'image/png',
            ai_model_id: modelSetting?.id ?? null,
            ai_prompt_id: promptSetting?.id ?? null,
        };
    }
}
