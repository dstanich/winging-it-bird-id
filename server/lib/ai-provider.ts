import { GoogleGenAI } from "@google/genai";
import * as fs from 'fs';
import type { Storage } from './storage.ts';
import type { BirdIdentification, Clip } from './types.ts';

export interface GeneratedImage {
    data: Buffer;
    mimeType: string;
    ai_model_id: number | null;
    ai_prompt_id: number | null;
}

export const DEFAULT_PROMPT = "Identify the birds in the attached screenshot from a backyard bird feeder camera. Return one entry per bird species visible, with is_bird set to true, species set to its common name, gender set to male, female, or unknown, count set to the number of birds of that species, and confidence set to your confidence between 0 and 1. Only birds count: squirrels, other animals, people, and objects are never birds. If no bird is visible, return a single entry with is_bird set to false, species set to null, non_bird_species set to the most prominent non-bird animal or object (or null if there is none), and confidence set to your confidence between 0 and 1 in what you believe is in the image.";
/**
 * Earlier DEFAULT_PROMPT values, oldest first. On startup, a database whose active
 * ai_prompt is still one of these gets the current DEFAULT_PROMPT as a new active row.
 * Append the outgoing value here whenever DEFAULT_PROMPT changes.
 */
export const PREVIOUS_DEFAULT_PROMPTS: readonly string[] = [
    "Identify the bird or birds in the attached screenshot. Return a JSON array of objects with the following format: { \"is_bird\": true or false, \"species\": \"common species name in all lower case letters\", \"gender\": \"male or female or unknown\", \"count\": number of birds of this species in the screenshot, \"confidence\": confidence score between 0 and 1, \"non_bird_species\": \"non-bird species if any\" }.  Only return JSON, do not return any other data.  If the screenshot has no bird set is_bird to false and set non_bird_species to the most prominent non-bird object in the image, if any.  If there is no bird, still calculate the confidence score between 0 and 1 for what you believe is in the image.  Do not put the JSON in a codeblock, return only JSON.",
];
export const DEFAULT_MODEL = "gemini-2.5-flash";
export const DEFAULT_IMAGE_PROMPT = "Create a single cheerful cartoon-style illustration featuring each of these bird species: {species}. Draw every species exactly once, gathered together around a backyard bird feeder, with each bird's common name written in a small, clearly legible label beneath it. Use bright, friendly colors, bold outlines, and a simple background. Do not add any other text.";
export const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-lite-image";

/**
 * JSON Schema the identification response must match. Passed to Gemini as
 * `responseJsonSchema` with `responseMimeType: 'application/json'`, so the model
 * returns parseable JSON in this shape rather than free text.
 */
export const IDENTIFICATION_RESPONSE_SCHEMA = {
    type: 'array',
    description: 'One entry per bird species in the image, or a single is_bird=false entry when there is no bird.',
    minItems: 1,
    items: {
        type: 'object',
        properties: {
            is_bird: { type: 'boolean', description: 'True only when this entry is a bird species.' },
            species: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Common name of the bird species; null when is_bird is false.' },
            gender: { type: 'string', enum: ['male', 'female', 'unknown'] },
            count: { type: 'integer', minimum: 0, description: 'Number of birds of this species in the image.' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            non_bird_species: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Most prominent non-bird animal or object when is_bird is false; otherwise null.' },
        },
        required: ['is_bird', 'species', 'gender', 'count', 'confidence', 'non_bird_species'],
    },
} as const;

const blankToNull = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * Normalizes one AI result so is_bird is only true when a bird species was named:
 * a result flagged is_bird without a species (e.g. only a non-bird like a squirrel)
 * becomes a non-bird, and a species named on a non-bird result moves to non_bird_species.
 * Species names are lowercased.
 */
export function normalizeIdentification(raw: BirdIdentification): BirdIdentification {
    let species = blankToNull(raw.species)?.toLowerCase() ?? null;
    let nonBirdSpecies = blankToNull(raw.non_bird_species);
    const isBird = raw.is_bird === true && species !== null;
    if (!isBird && species !== null) {
        nonBirdSpecies ??= species;
        species = null;
    }
    return {
        ...raw,
        is_bird: isBird,
        species,
        non_bird_species: nonBirdSpecies,
    };
}

export class AIProvider {
    storage: Storage;
    genai: GoogleGenAI;

    constructor(storage: Storage) {
        this.storage = storage;
        this.genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    }

    async identifyBird(clipData: Clip, screenshotPath: string): Promise<BirdIdentification[]> {
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
                ],
                config: {
                    responseMimeType: 'application/json',
                    responseJsonSchema: IDENTIFICATION_RESPONSE_SCHEMA,
                },
            })

            const parsed = JSON.parse(response.text ?? '') as BirdIdentification | BirdIdentification[];
            // The schema requires an array; still accept a bare object defensively.
            const resultArray = (Array.isArray(parsed) ? parsed : [parsed]).map(result => ({
                ...normalizeIdentification(result),
                ai_model_id: modelSetting?.id ?? null,
                ai_prompt_id: promptSetting?.id ?? null,
            }));
            console.log(`Identified bird for clip ${clipData.id}: ${JSON.stringify(resultArray)}`);
            return resultArray;
        } catch(error) {
            console.error(`Error identifying bird for clip ${clipData.id}:`, error);
            throw error;
        }
    }

    /**
     * Generates an image from the active image prompt template, with {species} replaced by speciesList.
     * @param speciesList - Comma-separated species names to fill into the prompt.
     */
    async generateImage(speciesList: string): Promise<GeneratedImage> {
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
        if (!imagePart?.inlineData?.data) {
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
