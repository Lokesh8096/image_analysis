import OpenAI, {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  BadRequestError,
  RateLimitError,
  toFile,
} from "openai";
import { NextResponse } from "next/server";
import { resolveRoleProfile } from "../../lib/roleProfiles";

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
const FALSE_VALUES = new Set(["0", "false", "no", "n", "off"]);
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
const CATEGORY_KEYS = [
  "appearance",
  "grooming",
  "dress_code",
  "professionalism",
];
const VALID_SUITABILITY_STATUSES = new Set([
  "unsuitable",
  "improvable",
  "suitable",
]);
const VALID_CATEGORY_RATINGS = new Set(["poor", "fair", "good", "excellent"]);
const CATEGORY_LABELS = {
  appearance: "Appearance",
  grooming: "Grooming",
  dress_code: "Dress code",
  professionalism: "Professionalism",
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

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (TRUE_VALUES.has(normalizedValue)) {
      return true;
    }

    if (FALSE_VALUES.has(normalizedValue)) {
      return false;
    }
  }

  return fallback;
}

function createDefaultCategoryFeedback(roleProfile) {
  return {
    appearance: {
      rating: "fair",
      remark:
        "Appearance is workable for a professional portrait, but it needs a cleaner and more role-aligned presentation.",
    },
    grooming: {
      rating: "fair",
      remark:
        "Grooming looks usable, though sharper polish would strengthen the overall professional impression.",
    },
    dress_code: {
      rating: "fair",
      remark: `Clothing is serviceable, but it could be aligned more clearly with ${roleProfile.label} expectations.`,
    },
    professionalism: {
      rating: "fair",
      remark:
        "The image has professional potential, but it would benefit from more intentional framing, posture, or context.",
    },
  };
}

function getDefaultSuitabilitySummary(status, roleProfile) {
  switch (status) {
    case "unsuitable":
      return `This upload is not strong enough for a ${roleProfile.label} portrait and should be replaced with a more role-appropriate image.`;
    case "suitable":
      return `This upload already fits a ${roleProfile.label} portrait and mainly needs polish rather than major correction.`;
    case "improvable":
    default:
      return `This upload is usable for a ${roleProfile.label} portrait, but it needs targeted improvements to feel fully role-ready.`;
  }
}

function createDefaultAnalysis(roleProfile) {
  return {
    image_purpose: "Professional profile photo",
    purpose_description:
      "The image appears intended for a professional or career-oriented profile, but the structured analysis fallback was used.",
    suitability_status: "improvable",
    suitability_summary: getDefaultSuitabilitySummary("improvable", roleProfile),
    requires_reupload: false,
    category_feedback: createDefaultCategoryFeedback(roleProfile),
    strengths: [
      "The upload appears usable as a starting point for a professional portrait edit.",
    ],
    weaknesses: [
      "The analysis model did not return full structured suitability feedback.",
    ],
    improvements: [
      `Align the image more clearly with ${roleProfile.label} expectations for dress, presence, and setting.`,
      "Refine grooming, framing, and background professionalism where needed.",
    ],
  };
}

function normalizeCategoryFeedback(categoryKey, categoryFeedback, fallbackFeedback) {
  const normalizedRating = normalizeText(categoryFeedback?.rating).toLowerCase();
  const rating = VALID_CATEGORY_RATINGS.has(normalizedRating)
    ? normalizedRating
    : fallbackFeedback.rating;
  const remark = normalizeText(categoryFeedback?.remark) || fallbackFeedback.remark;

  return {
    rating,
    remark,
  };
}

function normalizeCategoryFeedbackMap(parsedFeedback, fallbackFeedback) {
  return CATEGORY_KEYS.reduce((result, categoryKey) => {
    result[categoryKey] = normalizeCategoryFeedback(
      categoryKey,
      parsedFeedback?.[categoryKey],
      fallbackFeedback[categoryKey]
    );

    return result;
  }, {});
}

function parseAnalysisOutput(rawOutput, roleProfile) {
  const fallbackAnalysis = createDefaultAnalysis(roleProfile);

  if (!rawOutput?.trim()) {
    return fallbackAnalysis;
  }

  try {
    const parsed = JSON.parse(stripCodeFence(rawOutput));
    const strengths = normalizeList(parsed.strengths);
    const weaknesses = normalizeList(parsed.weaknesses);
    const improvements = normalizeList(parsed.improvements);
    let suitabilityStatus = normalizeText(parsed.suitability_status).toLowerCase();

    if (!VALID_SUITABILITY_STATUSES.has(suitabilityStatus)) {
      suitabilityStatus = fallbackAnalysis.suitability_status;
    }

    let requiresReupload = normalizeBoolean(
      parsed.requires_reupload,
      suitabilityStatus === "unsuitable"
    );

    if (suitabilityStatus === "unsuitable" || requiresReupload) {
      suitabilityStatus = "unsuitable";
      requiresReupload = true;
    }

    return {
      image_purpose:
        normalizeText(parsed.image_purpose) || fallbackAnalysis.image_purpose,
      purpose_description:
        normalizeText(parsed.purpose_description) ||
        fallbackAnalysis.purpose_description,
      suitability_status: suitabilityStatus,
      suitability_summary:
        normalizeText(parsed.suitability_summary) ||
        getDefaultSuitabilitySummary(suitabilityStatus, roleProfile),
      requires_reupload: requiresReupload,
      category_feedback: normalizeCategoryFeedbackMap(
        parsed.category_feedback,
        fallbackAnalysis.category_feedback
      ),
      strengths: strengths.length ? strengths : fallbackAnalysis.strengths,
      weaknesses: weaknesses.length ? weaknesses : fallbackAnalysis.weaknesses,
      improvements: improvements.length
        ? improvements
        : fallbackAnalysis.improvements,
    };
  } catch (error) {
    console.warn("Unable to parse structured analysis output:", error);
    return fallbackAnalysis;
  }
}

function formatRoleProfileForPrompt(roleProfile) {
  return [
    `Role: ${roleProfile.label}`,
    `Expected dress tone: ${roleProfile.dressTone}`,
    `Expected demeanor or presence: ${roleProfile.demeanor}`,
    `Expected background or professional context: ${roleProfile.backgroundContext}`,
  ].join("\n");
}

function formatCategoryFeedbackForPrompt(categoryFeedback) {
  return CATEGORY_KEYS.map((categoryKey) => {
    const category = categoryFeedback[categoryKey];
    return `- ${CATEGORY_LABELS[categoryKey]} (${category.rating}): ${category.remark}`;
  }).join("\n");
}

function getSuitabilityDirective(analysis) {
  switch (analysis.suitability_status) {
    case "suitable":
      return "Apply light, polished improvements only. Keep the result close to the original while refining professionalism.";
    case "improvable":
      return "Apply targeted, role-specific improvements that strengthen the image without changing the person's identity.";
    case "unsuitable":
    default:
      return "Do not attempt to salvage an image that is fundamentally mismatched for the role.";
  }
}

function buildAnalysisPrompt(roleProfile) {
  return `You are reviewing an uploaded portrait for someone targeting the role below.

${formatRoleProfileForPrompt(roleProfile)}

First determine what the image currently represents or is likely being used for.
Then judge how suitable it is for this role profile.

Suitability rules:
- "unsuitable": the image is not recoverable for the role by editing alone. Examples include the wrong context, non-professional framing, poor face visibility, multiple people, irrelevant pose or background, or clearly mismatched clothing/context.
- "improvable": the image is relevant enough to keep, but it needs targeted fixes to presentation, professionalism, grooming, clothing, or setting.
- "suitable": the image already fits the role well and only needs polish.

Return ONLY valid JSON with this exact shape:
{
  "image_purpose": "string",
  "purpose_description": "string",
  "suitability_status": "improvable",
  "suitability_summary": "string",
  "requires_reupload": false,
  "category_feedback": {
    "appearance": { "rating": "fair", "remark": "string" },
    "grooming": { "rating": "fair", "remark": "string" },
    "dress_code": { "rating": "fair", "remark": "string" },
    "professionalism": { "rating": "fair", "remark": "string" }
  },
  "strengths": ["string"],
  "weaknesses": ["string"],
  "improvements": ["string"]
}

Rules for the JSON:
- "suitability_status" must be one of: "unsuitable", "improvable", or "suitable".
- Set "requires_reupload" to true only when the image is unsuitable and should be replaced instead of edited.
- Each category "rating" must be one of: "poor", "fair", "good", or "excellent".
- Keep remarks concise, respectful, practical, and specific to the role expectations above.
- If the image is unsuitable, make the weaknesses and improvements explain what should be corrected in the next upload.
- Use 1-3 short bullets in strengths, weaknesses, and improvements.
- Do not wrap the JSON in markdown fences.`;
}

function formatRemarks(analysis, roleProfile) {
  return [
    `Target Role: ${roleProfile.label}`,
    "",
    `Suitability: ${analysis.suitability_status}`,
    `Summary: ${analysis.suitability_summary}`,
    `Reupload Required: ${analysis.requires_reupload ? "Yes" : "No"}`,
    "",
    `Image Purpose: ${analysis.image_purpose}`,
    `Purpose Description: ${analysis.purpose_description}`,
    "",
    "Category Feedback:",
    ...CATEGORY_KEYS.map((categoryKey) => {
      const category = analysis.category_feedback[categoryKey];
      return `- ${CATEGORY_LABELS[categoryKey]} (${category.rating}): ${category.remark}`;
    }),
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

function buildPromptContext({ roleProfile, analysis }) {
  return `Role profile:
${formatRoleProfileForPrompt(roleProfile)}

Current image purpose:
- ${analysis.image_purpose}
- ${analysis.purpose_description}

Suitability verdict:
- Status: ${analysis.suitability_status}
- Summary: ${analysis.suitability_summary}
- Guidance: ${getSuitabilityDirective(analysis)}

Per-category professional readiness feedback:
${formatCategoryFeedbackForPrompt(analysis.category_feedback)}

Strengths to preserve:
${analysis.strengths.map((item) => `- ${item}`).join("\n")}

Weaknesses to correct:
${analysis.weaknesses.map((item) => `- ${item}`).join("\n")}

Improvement directives:
${analysis.improvements.map((item) => `- ${item}`).join("\n")}`;
}

function buildEditPrompt({ roleProfile, analysis }) {
  return `Improve this exact same person's image for the role profile below.

${buildPromptContext({ roleProfile, analysis })}

Keep clothing aligned with this dress expectation: ${roleProfile.dressTone}
Keep the person's expression, posture, and presence aligned with this expectation: ${roleProfile.demeanor}
Use or refine the setting so it matches this professional context: ${roleProfile.backgroundContext}

Preserve the person's identity, facial structure, skin tone, hairstyle, and overall likeness.
Enhance lighting, posture, wardrobe polish, grooming, and background professionalism only as needed to satisfy the role expectations.
Keep it realistic, high quality, and suitable for LinkedIn, resumes, or a career profile.
Do not add other people, do not stylize it into illustration, and do not noticeably change who the person is.`;
}

function buildGenerateFromReferencePrompt({
  roleProfile,
  analysis,
  identityDescription,
}) {
  return `Create a new improved professional portrait based on the previously analyzed source photo.

${buildPromptContext({ roleProfile, analysis })}

Reference identity details:
${identityDescription || "Use the uploaded source photo as the identity reference."}

Clothing should align with this dress expectation: ${roleProfile.dressTone}
Expression, posture, and overall presence should align with this expectation: ${roleProfile.demeanor}
The background and scene should align with this professional context: ${roleProfile.backgroundContext}

The output must remain the same person with the same identity, facial geometry, hairstyle, skin tone, and overall likeness.
Improve lighting, posture, professionalism, and background quality while following the role-specific guidance above.
Keep the result realistic, polished, and suitable for LinkedIn, resumes, and career profiles.
Do not add other people and do not noticeably change who the person is.`;
}

function createDownloadFilename(roleKey) {
  const safeRole = roleKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

    const roleInput = roleValue.trim();
    const roleProfile = resolveRoleProfile(roleInput);

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
              text: buildAnalysisPrompt(roleProfile),
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

    const analysis = parseAnalysisOutput(analysisResponse.output_text, roleProfile);
    const remarks = formatRemarks(analysis, roleProfile);

    if (analysis.requires_reupload) {
      return NextResponse.json({
        success: true,
        remarks,
        analysis,
        improved_image: null,
        download_filename: null,
        image_strategy: null,
        image_model_used: null,
        transform_mode: IMAGE_TRANSFORM_MODE,
      });
    }

    const needsReferenceIdentity =
      IMAGE_TRANSFORM_MODE === "generate_from_reference" ||
      (ALLOW_GENERATE_FALLBACK && Boolean(GENERATE_FALLBACK_MODEL));
    const identityDescription = needsReferenceIdentity
      ? await describeReferenceIdentity({
          openai,
          imageDataUrl,
        })
      : "";
    const editPrompt = buildEditPrompt({
      roleProfile,
      analysis,
    });
    const generatePrompt = buildGenerateFromReferencePrompt({
      roleProfile,
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
      download_filename: createDownloadFilename(roleProfile.key),
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
