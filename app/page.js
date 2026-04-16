"use client";

import { useEffect, useRef, useState } from "react";
import { ROLE_OPTIONS } from "./lib/roleProfiles";

const ACCEPTED_TYPES = ["image/jpeg", "image/png"];
const CATEGORY_LABELS = {
  appearance: "Appearance",
  grooming: "Grooming",
  dress_code: "Dress code",
  professionalism: "Professionalism",
};
const SUITABILITY_META = {
  unsuitable: {
    badge: "Reupload required",
    title: "This image should be replaced before we generate anything.",
    className: "verdict-banner verdict-unsuitable",
  },
  improvable: {
    badge: "Needs improvement",
    title: "This image can be improved with targeted fixes.",
    className: "verdict-banner verdict-improvable",
  },
  suitable: {
    badge: "Ready to polish",
    title: "This image is already role-relevant and only needs polish.",
    className: "verdict-banner verdict-suitable",
  },
};

function toTitleCase(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getVerdictMeta(status) {
  return SUITABILITY_META[status] || SUITABILITY_META.improvable;
}

function getDisplayRoleLabel(value) {
  const trimmedValue = String(value || "").trim();

  if (!trimmedValue) {
    return "";
  }

  const normalizedValue = trimmedValue.toLowerCase();
  const presetRole = ROLE_OPTIONS.find(
    (option) =>
      option.key === normalizedValue || option.label.toLowerCase() === normalizedValue
  );

  return presetRole?.label || trimmedValue;
}

function isSuggestedRoleSelected(role, option) {
  const normalizedRole = String(role || "").trim().toLowerCase();

  return (
    normalizedRole === option.key || normalizedRole === option.label.toLowerCase()
  );
}

export default function HomePage() {
  const [file, setFile] = useState(null);
  const [role, setRole] = useState("");
  const [originalPreview, setOriginalPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraAvailable, setCameraAvailable] = useState(null);
  const [cameraError, setCameraError] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const selectedRoleLabel = getDisplayRoleLabel(role) || "target role";
  const verdictMeta = result?.analysis
    ? getVerdictMeta(result.analysis.suitability_status)
    : null;
  const hasGeneratedImage = Boolean(result?.improved_image);
  const cameraSupported = cameraAvailable === true;

  useEffect(() => {
    return () => {
      if (originalPreview) {
        URL.revokeObjectURL(originalPreview);
      }
    };
  }, [originalPreview]);

  useEffect(() => {
    setCameraAvailable(Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) {
      return;
    }

    const videoElement = videoRef.current;
    videoElement.srcObject = streamRef.current;
    videoElement.play().catch(() => {});
  }, [cameraOpen]);

  useEffect(() => {
    return () => {
      stopCamera({ resetState: false });
    };
  }, []);

  function clearMessagesAndResult() {
    setError("");
    setCameraError("");
    setResult(null);
  }

  function stopCamera({ resetState = true } = {}) {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause?.();
      videoRef.current.srcObject = null;
    }

    if (resetState) {
      setCameraOpen(false);
      setCameraLoading(false);
    }
  }

  function updateSelectedImage(nextFile) {
    clearMessagesAndResult();

    if (originalPreview) {
      URL.revokeObjectURL(originalPreview);
      setOriginalPreview("");
    }

    if (!nextFile) {
      setFile(null);
      return;
    }

    if (!ACCEPTED_TYPES.includes(nextFile.type)) {
      setFile(null);
      setError("Please upload or capture a JPG or PNG image.");
      return;
    }

    setFile(nextFile);
    setOriginalPreview(URL.createObjectURL(nextFile));
  }

  function handleFileChange(event) {
    stopCamera();
    updateSelectedImage(event.target.files?.[0] || null);

    if (
      event.target.files?.[0] &&
      !ACCEPTED_TYPES.includes(event.target.files[0].type)
    ) {
      event.target.value = "";
    }
  }

  function handleRoleChange(event) {
    setRole(event.target.value);
    clearMessagesAndResult();
  }

  function handleSuggestedRoleClick(roleLabel) {
    setRole(roleLabel);
    clearMessagesAndResult();
  }

  async function handleStartCamera() {
    clearMessagesAndResult();

    if (!cameraSupported) {
      setCameraError("Camera access is not available in this browser.");
      return;
    }

    try {
      setCameraLoading(true);
      stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraOpen(true);
    } catch (cameraRequestError) {
      setCameraError(
        cameraRequestError instanceof Error
          ? cameraRequestError.message
          : "Unable to access the camera."
      );
    } finally {
      setCameraLoading(false);
    }
  }

  async function handleCapturePhoto() {
    const videoElement = videoRef.current;
    const canvasElement = canvasRef.current;

    if (!videoElement || !canvasElement) {
      setCameraError("Camera preview is not ready yet.");
      return;
    }

    try {
      setCameraError("");

      const width = videoElement.videoWidth;
      const height = videoElement.videoHeight;

      if (!width || !height) {
        throw new Error("Camera preview is not ready yet.");
      }

      canvasElement.width = width;
      canvasElement.height = height;

      const context = canvasElement.getContext("2d");

      if (!context) {
        throw new Error("Unable to capture a photo from the camera.");
      }

      context.drawImage(videoElement, 0, 0, width, height);

      const imageBlob = await new Promise((resolve) => {
        canvasElement.toBlob(resolve, "image/jpeg", 0.92);
      });

      if (!imageBlob) {
        throw new Error("Unable to create an image from the camera capture.");
      }

      const capturedFile = new File(
        [imageBlob],
        `camera-capture-${Date.now()}.jpg`,
        { type: "image/jpeg" }
      );

      updateSelectedImage(capturedFile);
      stopCamera();
    } catch (captureError) {
      setCameraError(
        captureError instanceof Error
          ? captureError.message
          : "Unable to capture a photo."
      );
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedRole = role.trim();

    if (!file) {
      setError("Please choose or capture an image first.");
      return;
    }

    if (!trimmedRole) {
      setError("Please enter a target role or choose one of the suggestions.");
      return;
    }

    setLoading(true);
    setError("");
    setCameraError("");
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("role", trimmedRole);

      const response = await fetch("/api/generate", {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || "Something went wrong while processing the image."
        );
      }

      setResult(data);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "An unexpected error occurred."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    if (!result?.improved_image) {
      return;
    }

    setDownloading(true);
    setError("");

    try {
      const response = await fetch(result.improved_image);

      if (!response.ok) {
        throw new Error("Unable to download the refined image.");
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = downloadUrl;
      anchor.download = result.download_filename || "refined-image.png";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Unable to download the refined image."
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="app-card">
        <div className="hero-copy">
          <p className="eyebrow">AI Career Portrait Studio</p>
          <h1>Upload a photo or take one live, then analyze it for any role you want.</h1>
          <p className="subtitle">
            Use an existing JPG or PNG, or open the camera and capture a new
            portrait. You can type any target role, and the suggested options are
            still available for quick selection.
          </p>
        </div>

        <form className="form-grid" onSubmit={handleSubmit}>
          <div className="capture-grid">
            <label className="field">
              Upload image
              <input
                type="file"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                onChange={handleFileChange}
                disabled={loading}
              />
              <p className="input-hint">
                Supported formats: JPG and PNG. The image stays on the backend
                when talking to OpenAI.
              </p>
            </label>

            <section className="camera-panel">
              <div className="camera-copy">
                <h2>Camera option</h2>
                <p>
                  Open your camera, take a picture directly here, and use it like
                  a normal upload.
                </p>
              </div>

              <div className="camera-actions">
                {!cameraOpen ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handleStartCamera}
                    disabled={loading || cameraLoading || cameraAvailable === false}
                  >
                    {cameraLoading ? "Opening camera..." : "Open camera"}
                  </button>
                ) : (
                  <>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={handleCapturePhoto}
                      disabled={loading}
                    >
                      Capture photo
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => stopCamera()}
                      disabled={loading}
                    >
                      Close camera
                    </button>
                  </>
                )}
              </div>

              {cameraAvailable === false ? (
                <p className="camera-hint">
                  Your browser does not expose direct camera access here, so use
                  the regular upload option instead.
                </p>
              ) : null}

              {cameraError ? (
                <p className="camera-error">{cameraError}</p>
              ) : null}

              {cameraOpen ? (
                <div className="camera-stage">
                  <video
                    ref={videoRef}
                    className="camera-feed"
                    autoPlay
                    muted
                    playsInline
                  />
                </div>
              ) : null}

              <canvas ref={canvasRef} className="camera-canvas" />
            </section>
          </div>

          <div className="field role-field">
            <label htmlFor="role-input">Target role</label>
            <input
              id="role-input"
              type="text"
              list="role-suggestions"
              placeholder="Type any role or choose a suggestion"
              value={role}
              onChange={handleRoleChange}
              disabled={loading}
            />
            <datalist id="role-suggestions">
              {ROLE_OPTIONS.map((option) => (
                <option key={option.key} value={option.label} />
              ))}
            </datalist>
            <p className="input-hint">
              You can type any role you want, or pick one of the common options
              below.
            </p>
            <div className="role-chip-row">
              {ROLE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  className={`role-chip${
                    isSuggestedRoleSelected(role, option) ? " role-chip-active" : ""
                  }`}
                  type="button"
                  onClick={() => handleSuggestedRoleClick(option.label)}
                  disabled={loading}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <button
            className="submit-button"
            type="submit"
            disabled={loading || !file || !role.trim()}
          >
            {loading ? "Processing..." : "Analyze & Improve"}
          </button>
        </form>

        {error ? <p className="message error-message">{error}</p> : null}

        {loading ? (
          <p className="message status-message">
            Analyzing your image for role suitability and professional readiness.
          </p>
        ) : null}

        {hasGeneratedImage &&
        (result?.image_strategy === "generate_fallback" ||
          result?.image_strategy === "generate_from_reference") ? (
          <p className="message warning-message">
            {result.image_strategy === "generate_from_reference"
              ? "The app used reference-based generation mode, so the result is guided by the uploaded image and role-based improvement notes rather than a direct pixel edit."
              : "Image editing access was unavailable for the current key, so the app used image generation fallback. The result may be less exact than a true same-image edit."}
          </p>
        ) : null}

        {result?.analysis && verdictMeta ? (
          <section className={verdictMeta.className}>
            <div className="verdict-header">
              <span className="suitability-badge">{verdictMeta.badge}</span>
              <h2>{verdictMeta.title}</h2>
            </div>
            <p>{result.analysis.suitability_summary}</p>
            {result.analysis.requires_reupload ? (
              <p className="verdict-note">
                Reupload a clearer, more role-appropriate photo for the{" "}
                {selectedRoleLabel} track to continue.
              </p>
            ) : null}
          </section>
        ) : null}

        {originalPreview || hasGeneratedImage ? (
          <div className="preview-grid">
            {originalPreview ? (
              <article className="panel">
                <h2>Original image</h2>
                <div className="image-frame">
                  <img src={originalPreview} alt="Original upload preview" />
                </div>
              </article>
            ) : null}

            {hasGeneratedImage ? (
              <article className="panel">
                <h2>Improved image</h2>
                <div className="image-frame">
                  <img
                    src={result.improved_image}
                    alt={`Improved professional portrait for a ${selectedRoleLabel} role`}
                  />
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                >
                  {downloading ? "Preparing download..." : "Download refined image"}
                </button>
              </article>
            ) : null}
          </div>
        ) : null}

        {result?.analysis?.requires_reupload ? (
          <article className="panel blocked-panel">
            <h2>Reupload guidance</h2>
            <p className="analysis-copy">{result.analysis.suitability_summary}</p>
            <ul className="detail-list">
              {result.analysis.improvements.map((item, index) => (
                <li key={`reupload-${index}`}>{item}</li>
              ))}
            </ul>
          </article>
        ) : null}

        {result?.analysis ? (
          <section className="analysis-stack">
            <div className="analysis-grid">
              <article className="panel">
                <h2>Identified image purpose</h2>
                <p className="analysis-kicker">{result.analysis.image_purpose}</p>
                <p className="analysis-copy">
                  {result.analysis.purpose_description}
                </p>
              </article>

              <article className="panel">
                <h2>Improvement points</h2>
                <ul className="detail-list">
                  {result.analysis.improvements.map((item, index) => (
                    <li key={`improvement-${index}`}>{item}</li>
                  ))}
                </ul>
              </article>
            </div>

            <div className="category-grid">
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                const category = result.analysis.category_feedback?.[key];

                if (!category) {
                  return null;
                }

                return (
                  <article className="panel category-card" key={key}>
                    <div className="category-card-header">
                      <h2>{label}</h2>
                      <span
                        className={`rating-chip rating-${category.rating || "fair"}`}
                      >
                        {toTitleCase(category.rating)}
                      </span>
                    </div>
                    <p className="analysis-copy">{category.remark}</p>
                  </article>
                );
              })}
            </div>

            <div className="analysis-grid">
              <article className="panel">
                <h2>Strengths</h2>
                <ul className="detail-list">
                  {result.analysis.strengths.map((item, index) => (
                    <li key={`strength-${index}`}>{item}</li>
                  ))}
                </ul>
              </article>

              <article className="panel">
                <h2>Weaknesses</h2>
                <ul className="detail-list">
                  {result.analysis.weaknesses.map((item, index) => (
                    <li key={`weakness-${index}`}>{item}</li>
                  ))}
                </ul>
              </article>
            </div>
          </section>
        ) : null}

        {result?.remarks ? (
          <article className="panel remarks-panel">
            <h2>Analysis summary</h2>
            <pre className="remarks-text">{result.remarks}</pre>
          </article>
        ) : null}
      </section>
    </main>
  );
}
