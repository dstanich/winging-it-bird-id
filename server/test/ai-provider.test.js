import * as fs from 'fs';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTempDirs } from './helpers.js';

const { generateContent, GoogleGenAI } = vi.hoisted(() => {
  const generateContent = vi.fn();
  const GoogleGenAI = vi.fn(function GoogleGenAI() {
    this.models = { generateContent };
  });
  return { generateContent, GoogleGenAI };
});

vi.mock('@google/genai', () => ({ GoogleGenAI }));

const { AIProvider, DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_PROMPT, DEFAULT_MODEL, DEFAULT_PROMPT } = await import('../lib/ai-provider.js');

const makeTempDir = useTempDirs();

const IMAGE_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03]);

const fakeStorage = (settings = {}) => ({
  getSettingWithId: vi.fn(name => settings[name] ?? null),
});

describe('AIProvider', () => {
  let thumbnailPath;
  const clip = { id: 1751652000 };

  beforeEach(() => {
    generateContent.mockReset();
    GoogleGenAI.mockClear();
    thumbnailPath = path.join(makeTempDir(), 'thumb.jpg');
    fs.writeFileSync(thumbnailPath, IMAGE_BYTES);
  });

  it('creates the Gemini client with GOOGLE_API_KEY', () => {
    vi.stubEnv('GOOGLE_API_KEY', 'test-key');
    new AIProvider(fakeStorage());
    expect(GoogleGenAI).toHaveBeenCalledExactlyOnceWith({ apiKey: 'test-key' });
  });

  it('sends the base64 thumbnail and the active prompt to the active model', async () => {
    const storage = fakeStorage({
      ai_prompt: { id: 11, value: 'custom prompt' },
      ai_model: { id: 22, value: 'gemini-custom' },
    });
    generateContent.mockResolvedValue({ text: '[]' });

    await new AIProvider(storage).identifyBird(clip, thumbnailPath);

    expect(storage.getSettingWithId).toHaveBeenCalledWith('ai_prompt');
    expect(storage.getSettingWithId).toHaveBeenCalledWith('ai_model');
    expect(generateContent).toHaveBeenCalledExactlyOnceWith({
      model: 'gemini-custom',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: IMAGE_BYTES.toString('base64') } },
          { text: 'custom prompt' },
        ],
      }],
    });
  });

  it('falls back to the default model and prompt when no settings are active', async () => {
    generateContent.mockResolvedValue({ text: '[{"is_bird": false}]' });

    const result = await new AIProvider(fakeStorage()).identifyBird(clip, thumbnailPath);

    const [{ model, contents }] = generateContent.mock.calls[0];
    expect(model).toBe(DEFAULT_MODEL);
    expect(contents[0].parts[1].text).toBe(DEFAULT_PROMPT);
    expect(result).toEqual([{ is_bird: false, ai_model_id: null, ai_prompt_id: null }]);
  });

  it('tags every result in an array response with the settings ids used', async () => {
    const storage = fakeStorage({
      ai_prompt: { id: 11, value: 'p' },
      ai_model: { id: 22, value: 'm' },
    });
    generateContent.mockResolvedValue({
      text: JSON.stringify([
        { is_bird: true, species: 'house finch', gender: 'male', count: 2, confidence: 0.9 },
        { is_bird: true, species: 'house sparrow', gender: 'female', count: 1, confidence: 0.7 },
      ]),
    });

    const result = await new AIProvider(storage).identifyBird(clip, thumbnailPath);

    expect(result).toEqual([
      { is_bird: true, species: 'house finch', gender: 'male', count: 2, confidence: 0.9, ai_model_id: 22, ai_prompt_id: 11 },
      { is_bird: true, species: 'house sparrow', gender: 'female', count: 1, confidence: 0.7, ai_model_id: 22, ai_prompt_id: 11 },
    ]);
  });

  it('returns a single tagged object when the model returns a bare object', async () => {
    const storage = fakeStorage({
      ai_prompt: { id: 11, value: 'p' },
      ai_model: { id: 22, value: 'm' },
    });
    generateContent.mockResolvedValue({ text: '{"is_bird": false, "non_bird_species": "squirrel", "confidence": 0.8}' });

    const result = await new AIProvider(storage).identifyBird(clip, thumbnailPath);

    expect(result).toEqual({ is_bird: false, non_bird_species: 'squirrel', confidence: 0.8, ai_model_id: 22, ai_prompt_id: 11 });
  });

  it('throws and logs when the response is not valid JSON', async () => {
    generateContent.mockResolvedValue({ text: '```json\n[]\n```' });

    await expect(new AIProvider(fakeStorage()).identifyBird(clip, thumbnailPath)).rejects.toThrow(SyntaxError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`clip ${clip.id}`), expect.any(SyntaxError));
  });

  it('rethrows API errors', async () => {
    const apiError = new Error('429 rate limited');
    generateContent.mockRejectedValue(apiError);

    await expect(new AIProvider(fakeStorage()).identifyBird(clip, thumbnailPath)).rejects.toBe(apiError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`clip ${clip.id}`), apiError);
  });

  it('throws without calling the API when the thumbnail is missing', async () => {
    await expect(new AIProvider(fakeStorage()).identifyBird(clip, path.join(makeTempDir(), 'missing.jpg')))
      .rejects.toThrow(/ENOENT/);
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe('AIProvider.generateImage', () => {
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const imageResponse = (mimeType = 'image/png') => ({
    candidates: [{ content: { parts: [{ text: 'here you go' }, { inlineData: { mimeType, data: PNG_BYTES.toString('base64') } }] } }],
  });

  beforeEach(() => {
    generateContent.mockReset();
  });

  it('fills {species} into the active image prompt and requests a square image from the active image model', async () => {
    const storage = fakeStorage({
      ai_image_prompt: { id: 31, value: 'draw {species} as cartoons ({species})' },
      ai_image_model: { id: 32, value: 'gemini-image-custom' },
    });
    generateContent.mockResolvedValue(imageResponse());

    const result = await new AIProvider(storage).generateImage('Blue Jay, House Finch');

    expect(generateContent).toHaveBeenCalledExactlyOnceWith({
      model: 'gemini-image-custom',
      contents: [{ role: 'user', parts: [{ text: 'draw Blue Jay, House Finch as cartoons (Blue Jay, House Finch)' }] }],
      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
    });
    expect(result).toEqual({ data: PNG_BYTES, mimeType: 'image/png', ai_model_id: 32, ai_prompt_id: 31 });
  });

  it('falls back to the default image model and prompt when no settings are active', async () => {
    generateContent.mockResolvedValue(imageResponse('image/jpeg'));

    const result = await new AIProvider(fakeStorage()).generateImage('Blue Jay');

    const [{ model, contents }] = generateContent.mock.calls[0];
    expect(model).toBe(DEFAULT_IMAGE_MODEL);
    expect(contents[0].parts[0].text).toBe(DEFAULT_IMAGE_PROMPT.replaceAll('{species}', 'Blue Jay'));
    expect(result).toMatchObject({ mimeType: 'image/jpeg', ai_model_id: null, ai_prompt_id: null });
  });

  it('throws with the finish reason when no image part is returned', async () => {
    generateContent.mockResolvedValue({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [{ text: 'sorry' }] } }] });

    await expect(new AIProvider(fakeStorage()).generateImage('Blue Jay')).rejects.toThrow('Image generation returned no image (IMAGE_SAFETY)');
  });

  it('throws when the prompt is blocked and there are no candidates', async () => {
    generateContent.mockResolvedValue({ promptFeedback: { blockReason: 'SAFETY' } });

    await expect(new AIProvider(fakeStorage()).generateImage('Blue Jay')).rejects.toThrow('(SAFETY)');
  });

  it('rethrows API errors', async () => {
    const apiError = new Error('429 rate limited');
    generateContent.mockRejectedValue(apiError);

    await expect(new AIProvider(fakeStorage()).generateImage('Blue Jay')).rejects.toBe(apiError);
  });
});
