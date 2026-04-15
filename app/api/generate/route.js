import OpenAI, {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  BadRequestError,
  RateLimitError,
  toFile,
} from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png"]);
const VALID_TRANSFORM_MODES = new Set(["edit", "generate_from_reference"]);
const GPT_IMAGE_PREFIXES = ["gpt-image-1", "chatgpt-image-latest"];
const IMAGE_TRANSFORM_MODE = VALID_TRANSFORM_MODES.has(
  String(process.env.IMAGE_TRANSFORM_MODE || "edit")
    .trim()
    .toLowerCase()
)
  ? String(process.env.IMAGE_TRANSFORM_MODE || "edit")
      .trim()
      .toLowerCase()
  : "edit";
const DEFAULT_IMAGE_MODEL =
  String(process.env.OPENAI_IMAGES_EDIT_MODEL || "").trim() ||
  String(process.env.OPENAI_IMAGE_MODEL || "").trim() ||
  "gpt-image-1";
const FALLBACK_IMAGE_MODEL = String(
  process.env.OPENAI_IMAGES_EDIT_FALLBACK_MODEL || ""
).trim();
const DEFAULT_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || "1024x1024";
const DEFAULT_IMAGE_QUALITY = normalizeOptionalValue(
  process.env.OPENAI_IMAGE_QUALITY || "medium",
  ["auto", "standard", "low", "medium", "high"]
);
const DEFAULT_INPUT_FIDELITY = normalizeOptionalValue(
  process.env.OPENAI_IMAGE_INPUT_FIDELITY || "high",
  ["low", "high"]
);
const DEFAULT_IMAGE_BACKGROUND = normalizeOptionalValue(
  process.env.OPENAI_IMAGE_BACKGROUND || "auto",
  ["transparent", "opaque", "auto"]
);
const MAX_OPENAI_RETRIES = Math.max(
  1,
  Number.parseInt(
    process.env.OPENAI_MAX_RETRIES || process.env.EXTERNAL_MAX_RETRIES || "3",
    10
  ) || 3
);
const NO_ACCESS_RESULT = "NO_ACCESS";
const TRUE_VALUES = new Set(["1", "true", "yes", "y", "on"]);
const OPENAI_TIMEOUT_SECONDS = Math.max(
  1,
  Number.parseFloat(process.env.OPENAI_TIMEOUT_SECONDS || "120") || 120
);
const ALLOW_GENERATE_FALLBACK = TRUE_VALUES.has(
  String(process.env.OPENAI_ALLOW_GENERATE_FALLBACK || "")
    .trim()
    .toLowerCase()
);
const GENERATE_FALLBACK_MODEL = String(
  process.env.OPENAI_IMAGES_GENERATE_FALLBACK_MODEL || ""
).trim();
const IDENTITY_ANALYSIS_MODEL =
  String(process.env.IDENTITY_ANALYSIS_MODEL || "").trim() ||
  String(process.env.OPENAI_ANALYSIS_MODEL || "").trim() ||
  "gpt-4o-mini";
const IDENTITY_ANALYSIS_ENABLED = TRUE_VALUES.has(
  String(process.env.IDENTITY_ANALYSIS_ENABLED || "1")
    .trim()
    .toLowerCase()
);
const DEFAULT_ANALYSIS = {
  image_purpose: "Professional candidate photo",
  purpose_description:
    "The image appears to be intended for a professional profile or career-oriented use.",
  strengths: ["The image was successfully analyzed."],
  weaknesses: ["The analysis model did not return full structured feedback."],
  improvements: [
    "Retry the request to get more specific role-based improvement suggestions.",
  ],
};

function createErrorResponse(message, status = 400) {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    { status }
  );
}

function normalizeOptionalValue(value, validValues) {
  const normalizedValue = String(value || "")
    .trim()
    .toLowerCase();

  if (!normalizedValue || !validValues.includes(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "Missing OPENAI_API_KEY. Add it to .env or .env.local before starting the app."
    );
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: OPENAI_TIMEOUT_SECONDS * 1000,
  });
}

function createHandledError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function extractErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unexpected OpenAI API error.";
}

function isGptImageModel(model) {
  return GPT_IMAGE_PREFIXES.some((prefix) => String(model || "").startsWith(prefix));
}

function extractRequiredModel(errorMessage) {
  const match = errorMessage.match(/Value must be '([^']+)'/i);
  return match?.[1]?.trim() || "";
}

function isRetriableOpenAIError(error) {
  if (error instanceof RateLimitError) {
    return true;
  }

  if (
    error instanceof APIConnectionTimeoutError ||
    error instanceof APIConnectionError
  ) {
    return true;
  }

  if (error instanceof APIError) {
    return error.status >= 500 || error.status === 429;
  }

  return false;
}

function buildImageEditPayload(model, prompt) {
  const payload = {
    model,
    prompt,
    size: DEFAULT_IMAGE_SIZE,
    n: 1,
  };

  if (isGptImageModel(model)) {
    payload.output_format = "png";

    if (DEFAULT_IMAGE_QUALITY) {
      payload.quality = DEFAULT_IMAGE_QUALITY;
    }

    if (DEFAULT_IMAGE_BACKGROUND) {
      payload.background = DEFAULT_IMAGE_BACKGROUND;
    }

    if (DEFAULT_INPUT_FIDELITY && model !== "gpt-image-1-mini") {
      payload.input_fidelity = DEFAULT_INPUT_FIDELITY;
    }
  } else {
    payload.response_format = "b64_json";
  }

  return payload;
}

function buildImageGeneratePayload(model, prompt) {
  const payload = {
    model,
    prompt,
    size: DEFAULT_IMAGE_SIZE,
    n: 1,
  };

  if (isGptImageModel(model)) {
    payload.output_format = "png";

    if (DEFAULT_IMAGE_QUALITY) {
      payload.quality = DEFAULT_IMAGE_QUALITY;
    }

    if (DEFAULT_IMAGE_BACKGROUND) {
      payload.background = DEFAULT_IMAGE_BACKGROUND;
    }
  } else {
    payload.response_format = "b64_json";
  }

  return payload;
}

function alignPayloadToModel(payload) {
  if (isGptImageModel(payload.model)) {
    delete payload.response_format;

    if (!payload.output_format) {
      payload.output_format = "png";
    }

    return payload;
  }

  delete payload.background;
  delete payload.input_fidelity;
  delete payload.output_format;
  delete payload.quality;
  payload.response_format = "b64_json";

  if (!["256x256", "512x512", "1024x1024"].includes(payload.size)) {
    payload.size = "1024x1024";
  }

  return payload;
}

function maybeRelaxPayloadForRateLimit(payload, errorMessage) {
  const messageLower = errorMessage.toLowerCase();

  if (messageLower.includes("limit 0")) {
    return NO_ACCESS_RESULT;
  }

  if (
    typeof payload.quality === "string" &&
    payload.quality !== "low" &&
    payload.quality !== "standard"
  ) {
    payload.quality = "low";
    console.warn("Retrying image edit with lower quality to reduce token usage.");
    return true;
  }

  if (payload.input_fidelity === "high") {
    payload.input_fidelity = "low";
    console.warn("Retrying image edit with lower input fidelity to reduce token usage.");
    return true;
  }

  return false;
}

function mapImageEditError(error, model) {
  const message = extractErrorMessage(error);
  const messageLower = message.toLowerCase();

  if (
    (error instanceof RateLimitError || error?.status === 429) &&
    messageLower.includes("limit 0") &&
    messageLower.includes("gpt-image")
  ) {
    return createHandledError(
      `OpenAI image processing is unavailable for the current API key or organization on model "${model}". The API returned a 429 with "Limit 0", which usually means this org does not currently have GPT Image access or rate limit enabled. Add billing or use an organization with GPT Image access, then try again.`,
      429
    );
  }

  if (
    error instanceof BadRequestError &&
    messageLower.includes("uploaded image must be a png and less than 4 mb")
  ) {
    return createHandledError(
      "The fallback image model requires a square PNG smaller than 4 MB. Try a smaller PNG image or switch back to a GPT Image model with access.",
      400
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return createHandledError(message, error?.status || 500);
}

async function generateImageWithOpenAI({
  openai,
  prompt,
  requestedModel,
  mode = "generate_fallback",
}) {
  const payload = buildImageGeneratePayload(requestedModel, prompt);
  let attempt = 0;

  while (attempt < MAX_OPENAI_RETRIES) {
    attempt += 1;
    alignPayloadToModel(payload);

    try {
      const response = await openai.images.generate(payload);

      return {
        response,
        mode,
        model: payload.model,
      };
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      const errorMessageLower = errorMessage.toLowerCase();
      const relaxResult = maybeRelaxPayloadForRateLimit(payload, errorMessage);

      if (error instanceof BadRequestError) {
        if (
          payload.quality &&
          (errorMessageLower.includes("unknown parameter: 'quality'") ||
            errorMessageLower.includes("invalid value") &&
              errorMessageLower.includes("quality"))
        ) {
          console.warn("Retrying image generation fallback without quality.");
          delete payload.quality;
          continue;
        }

        if (
          payload.background &&
          (errorMessageLower.includes("unknown parameter: 'background'") ||
            errorMessageLower.includes("invalid value") &&
              errorMessageLower.includes("background"))
        ) {
          console.warn("Retrying image generation fallback without background.");
          delete payload.background;
          continue;
        }

        if (
          payload.output_format &&
          (errorMessageLower.includes("unknown parameter: 'output_format'") ||
            errorMessageLower.includes("invalid value") &&
              errorMessageLower.includes("output_format"))
        ) {
          console.warn(
            "Retrying image generation fallback without explicit output_format."
          );
          delete payload.output_format;
          continue;
        }

        if (
          errorMessage.includes("Value must be") &&
          errorMessageLower.includes("model")
        ) {
          const requiredModel = extractRequiredModel(errorMessage);

          if (requiredModel && payload.model !== requiredModel) {
            console.warn(
              `Retrying image generation fallback with model "${requiredModel}".`
            );
            payload.model = requiredModel;
            continue;
          }
        }
      }

      if (error instanceof RateLimitError || error?.status === 429) {
        if (relaxResult === true) {
          continue;
        }

        if (relaxResult === NO_ACCESS_RESULT) {
          throw mapImageEditError(error, payload.model);
        }
      }

      if (isRetriableOpenAIError(error) && attempt < MAX_OPENAI_RETRIES) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
        continue;
      }

      throw mapImageEditError(error, payload.model);
    }
  }

  throw createHandledError(
    "OpenAI image generation fallback failed after repeated retries.",
    502
  );
}

async function editImageWithOpenAI({
  imageBuffer,
  imageName,
  imageType,
  prompt,
  generatePrompt = prompt,
  requestedModel,
  openai,
  allowGenerateFallback = ALLOW_GENERATE_FALLBACK,
}) {
  const payload = buildImageEditPayload(requestedModel, prompt);
  let fallbackModelUsed = false;
  let attempt = 0;

  while (attempt < MAX_OPENAI_RETRIES) {
    attempt += 1;
    alignPayloadToModel(payload);

    try {
      const response = await openai.images.edit({
        ...payload,
        image: await toFile(imageBuffer, imageName || "upload.png", {
          type: imageType,
        }),
      });

      return {
        response,
        mode: fallbackModelUsed ? "edit_fallback" : "edit",
        model: payload.model,
      };
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      const errorMessageLower = errorMessage.toLowerCase();
      const relaxResult = maybeRelaxPayloadForRateLimit(payload, errorMessage);

      if (error instanceof BadRequestError) {
        if (
          payload.input_fidelity &&
          (errorMessageLower.includes("unknown parameter: 'input_fidelity'") ||
            errorMessageLower.includes("invalid_input_fidelity_model") ||
            errorMessageLower.includes("input_fidelity") &&
              (errorMessageLower.includes("invalid value") ||
                errorMessageLower.includes("not supported")))
        ) {
          console.warn("Retrying image edit without input_fidelity.");
          delete payload.input_fidelity;
          continue;
        }

        if (
          payload.quality &&
          (errorMessageLower.includes("unknown parameter: 'quality'") ||
            errorMessageLower.includes("invalid value") &&
              errorMessageLower.includes("quality"))
        ) {
          console.warn("Retrying image edit without quality.");
          delete payload.quality;
          continue;
        }

        if (
          payload.background &&
          (errorMessageLower.includes("unknown parameter: 'background'") ||
            errorMessageLower.includes("invalid value") &&
              errorMessageLower.includes("background"))
        ) {
          console.warn("Retrying image edit without background control.");
          delete payload.background;
          continue;
        }

        if (
          payload.output_format &&
          (errorMessageLower.includes("unknown parameter: 'output_format'") ||
            errorMessageLower.includes("invalid value") &&
              errorMessageLower.includes("output_format"))
        ) {
          console.warn("Retrying image edit without explicit output_format.");
          delete payload.output_format;
          continue;
        }

        if (errorMessage.includes("Value must be") && errorMessageLower.includes("model")) {
          const requiredModel = extractRequiredModel(errorMessage);

          if (requiredModel && payload.model !== requiredModel) {
            console.warn(`Retrying image edit with model "${requiredModel}".`);
            payload.model = requiredModel;
            continue;
          }
        }
      }

      if (error instanceof RateLimitError || error?.status === 429) {
        if (relaxResult === true) {
          continue;
        }

        if (relaxResult === NO_ACCESS_RESULT) {
          console.error(
            `Image model "${payload.model}" has no access for this account.`
          );

          if (
            !fallbackModelUsed &&
            FALLBACK_IMAGE_MODEL &&
            FALLBACK_IMAGE_MODEL !== payload.model
          ) {
            console.warn(
              `Retrying image edit with fallback model "${FALLBACK_IMAGE_MODEL}".`
            );
            payload.model = FALLBACK_IMAGE_MODEL;
            fallbackModelUsed = true;
            continue;
          }

          if (
            allowGenerateFallback &&
            GENERATE_FALLBACK_MODEL &&
            GENERATE_FALLBACK_MODEL !== payload.model
          ) {
            console.warn(
              `Falling back to image generation with model "${GENERATE_FALLBACK_MODEL}".`
            );

            return generateImageWithOpenAI({
              openai,
              prompt: generatePrompt,
              requestedModel: GENERATE_FALLBACK_MODEL,
              mode: "generate_fallback",
            });
          }

          throw mapImageEditError(error, payload.model);
        }
      }

      if (isRetriableOpenAIError(error) && attempt < MAX_OPENAI_RETRIES) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
        continue;
      }

      throw mapImageEditError(error, payload.model);
    }
  }

  throw createHandledError("OpenAI image editing failed after repeated retries.", 502);
}

function stripCodeFence(value) {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|;/)
      .map((item) => item.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }

  return [];
}

function parseAnalysisOutput(rawOutput) {
  if (!rawOutput?.trim()) {
    return DEFAULT_ANALYSIS;
  }

  try {
    const parsed = JSON.parse(stripCodeFence(rawOutput));
    const strengths = normalizeList(parsed.strengths);
    const weaknesses = normalizeList(parsed.weaknesses);
    const improvements = normalizeList(parsed.improvements);

    return {
      image_purpose:
        String(parsed.image_purpose || "").trim() ||
        DEFAULT_ANALYSIS.image_purpose,
      purpose_description:
        String(parsed.purpose_description || "").trim() ||
        DEFAULT_ANALYSIS.purpose_description,
      strengths: strengths.length ? strengths : DEFAULT_ANALYSIS.strengths,
      weaknesses: weaknesses.length ? weaknesses : DEFAULT_ANALYSIS.weaknesses,
      improvements: improvements.length
        ? improvements
        : DEFAULT_ANALYSIS.improvements,
    };
  } catch (error) {
    console.warn("Unable to parse structured analysis output:", error);
    return DEFAULT_ANALYSIS;
  }
}

function formatRemarks(analysis) {
  return [
    `Image Purpose: ${analysis.image_purpose}`,
    "",
    `Purpose Description: ${analysis.purpose_description}`,
    "",
    "Strengths:",
    ...analysis.strengths.map((item) => `- ${item}`),
    "",
    "Weaknesses:",
    ...analysis.weaknesses.map((item) => `- ${item}`),
    "",
    "Improvements:",
    ...analysis.improvements.map((item) => `- ${item}`),
  ].join("\n");
}

async function describeReferenceIdentity({ openai, imageDataUrl }) {
  if (!IDENTITY_ANALYSIS_ENABLED) {
    return "";
  }

  try {
    const response = await openai.responses.create({
      model: IDENTITY_ANALYSIS_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Analyze this portrait and return one compact identity fingerprint line.

Focus only on stable identity traits:
- face shape and jawline
- eye shape and spacing
- eyebrow shape
- nose structure
- lip shape
- facial hair if present
- hairline and hairstyle
- approximate skin tone
- natural expression and head angle

Do not mention background, clothing, lighting, or subjective beauty terms.
Return plain text only in one concise line.`,
            },
            {
              type: "input_image",
              image_url: imageDataUrl,
              detail: "high",
            },
          ],
        },
      ],
    });

    return response.output_text?.trim().slice(0, 600) || "";
  } catch (error) {
    console.warn("Identity analysis failed; continuing without it.", error);
    return "";
  }
}

function buildEditPrompt({ role, analysis }) {
  return `Improve this exact same person's image for a "${role}" role.

Current image purpose:
${analysis.image_purpose}

How the image reads now:
${analysis.purpose_description}

Role-specific strengths to preserve:
${analysis.strengths.map((item) => `- ${item}`).join("\n")}

Weaknesses to correct:
${analysis.weaknesses.map((item) => `- ${item}`).join("\n")}

Improvement priorities:
${analysis.improvements.map((item) => `- ${item}`).join("\n")}

Preserve the person's identity, facial structure, skin tone, hairstyle, and overall likeness.
Enhance lighting, clean up the background, improve posture, and make the image look more polished and professional.
Keep it realistic, high quality, and suitable for LinkedIn, resumes, or a career profile.
Do not add other people, do not stylize it into illustration, and do not noticeably change who the person is.`;
}

function buildGenerateFromReferencePrompt({
  role,
  analysis,
  identityDescription,
}) {
  return `Create a new improved professional portrait for a "${role}" role based on the previously analyzed source photo.

Reference identity details:
${identityDescription || "Use the uploaded source photo as the identity reference."}

Current image purpose:
${analysis.image_purpose}

How the image reads now:
${analysis.purpose_description}

Role-specific strengths to preserve:
${analysis.strengths.map((item) => `- ${item}`).join("\n")}

Weaknesses to correct:
${analysis.weaknesses.map((item) => `- ${item}`).join("\n")}

Improvement priorities:
${analysis.improvements.map((item) => `- ${item}`).join("\n")}

The output must remain the same person with the same identity, facial geometry, hairstyle, skin tone, and overall likeness.
Improve lighting, posture, professionalism, and background quality.
Keep the result realistic, polished, and suitable for LinkedIn, resumes, and career profiles.
Do not add other people and do not noticeably change who the person is.`;
}

function createDownloadFilename(role) {
  const safeRole = role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `refined-${safeRole || "career-photo"}.png`;
}

async function resolveImprovedImageSource(imageAsset) {
  if (imageAsset?.b64_json) {
    return `data:image/png;base64,${imageAsset.b64_json}`;
  }

  if (!imageAsset?.url) {
    return "";
  }

  try {
    const response = await fetch(imageAsset.url);

    if (!response.ok) {
      throw new Error(`Failed to download generated image: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const imageBuffer = Buffer.from(await response.arrayBuffer());

    return `data:${contentType};base64,${imageBuffer.toString("base64")}`;
  } catch (error) {
    console.warn("Falling back to remote improved image URL:", error);
    return imageAsset.url;
  }
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const roleValue = formData.get("role");
    const imageValue = formData.get("image");

    if (typeof roleValue !== "string" || !roleValue.trim()) {
      return createErrorResponse("A target job role is required.");
    }

    if (!(imageValue instanceof File)) {
      return createErrorResponse("An image file is required.");
    }

    if (!ACCEPTED_TYPES.has(imageValue.type)) {
      return createErrorResponse("Only JPG and PNG images are supported.");
    }

    const role = roleValue.trim();
    const imageBuffer = Buffer.from(await imageValue.arrayBuffer());

    if (!imageBuffer.length) {
      return createErrorResponse("The uploaded image is empty.");
    }

    const base64Image = imageBuffer.toString("base64");
    const imageDataUrl = `data:${imageValue.type};base64,${base64Image}`;

    const openai = getOpenAIClient();
    const analysisModel =
      process.env.OPENAI_ANALYSIS_MODEL || IDENTITY_ANALYSIS_MODEL;
    const imageEditModel = DEFAULT_IMAGE_MODEL;

    const analysisResponse = await openai.responses.create({
      model: analysisModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `You are reviewing an uploaded image for someone targeting a "${role}" role.

Analyze both:
1. What the image currently represents or is likely being used for.
2. How well it supports the user's target role.

Return ONLY valid JSON with this exact shape:
{
  "image_purpose": "short label describing the image's apparent role or purpose",
  "purpose_description": "1-2 sentence explanation of what the image represents or how it reads right now",
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "improvements": ["...", "..."]
}

Keep the feedback concise, practical, respectful, and specific to the target role. Do not wrap the JSON in markdown fences.`,
            },
            {
              type: "input_image",
              image_url: imageDataUrl,
              detail: "high",
            },
          ],
        },
      ],
    });

    const analysis = parseAnalysisOutput(analysisResponse.output_text);
    const remarks = formatRemarks(analysis);
    const identityDescription = await describeReferenceIdentity({
      openai,
      imageDataUrl,
    });
    const editPrompt = buildEditPrompt({
      role,
      analysis,
    });
    const generatePrompt = buildGenerateFromReferencePrompt({
      role,
      analysis,
      identityDescription,
    });

    const imageResult =
      IMAGE_TRANSFORM_MODE === "generate_from_reference"
        ? await generateImageWithOpenAI({
            openai,
            prompt: generatePrompt,
            requestedModel: imageEditModel,
            mode: "generate_from_reference",
          })
        : await editImageWithOpenAI({
            openai,
            requestedModel: imageEditModel,
            imageBuffer,
            imageName: imageValue.name || "upload.png",
            imageType: imageValue.type,
            prompt: editPrompt,
            generatePrompt,
          });

    const improvedImageAsset = imageResult.response.data?.[0];
    const improvedImage = await resolveImprovedImageSource(improvedImageAsset);

    if (!improvedImage) {
      return createErrorResponse(
        "OpenAI did not return an improved image for this request.",
        502
      );
    }

    return NextResponse.json({
      success: true,
      remarks,
      analysis,
      improved_image: improvedImage,
      download_filename: createDownloadFilename(role),
      image_strategy: imageResult.mode,
      image_model_used: imageResult.model,
      transform_mode: IMAGE_TRANSFORM_MODE,
    });
  } catch (error) {
    console.error("Failed to analyze or improve image:", error);

    const status = typeof error?.status === "number" ? error.status : 500;
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected error while processing the image.";

    return createErrorResponse(message, status);
  }
}
