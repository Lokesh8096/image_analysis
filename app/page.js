"use client";

import { useEffect, useState } from "react";

const ACCEPTED_TYPES = ["image/jpeg", "image/png"];

export default function HomePage() {
  const [file, setFile] = useState(null);
  const [role, setRole] = useState("");
  const [originalPreview, setOriginalPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    return () => {
      if (originalPreview) {
        URL.revokeObjectURL(originalPreview);
      }
    };
  }, [originalPreview]);

  function handleFileChange(event) {
    const nextFile = event.target.files?.[0];

    setError("");
    setResult(null);

    if (originalPreview) {
      URL.revokeObjectURL(originalPreview);
      setOriginalPreview("");
    }

    if (!nextFile) {
      setFile(null);
      return;
    }

    if (!ACCEPTED_TYPES.includes(nextFile.type)) {
      event.target.value = "";
      setFile(null);
      setError("Please upload a JPG or PNG image.");
      return;
    }

    setFile(nextFile);
    setOriginalPreview(URL.createObjectURL(nextFile));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedRole = role.trim();

    if (!file) {
      setError("Please choose an image first.");
      return;
    }

    if (!trimmedRole) {
      setError("Please enter a target job role.");
      return;
    }

    setLoading(true);
    setError("");
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
          <h1>Analyze a photo for a target role, then polish the same image.</h1>
          <p className="subtitle">
            Upload a JPG or PNG, tell us the role you are aiming for, and the app
            will generate role-specific remarks plus an improved professional
            image.
          </p>
        </div>

        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            Upload image
            <input
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              onChange={handleFileChange}
              disabled={loading}
            />
            <p className="input-hint">
              Supported formats: JPG and PNG. The image stays on the backend when
              talking to OpenAI.
            </p>
          </label>

          <label className="field">
            Target job role
            <input
              type="text"
              placeholder="Software Developer, HR, Manager..."
              value={role}
              onChange={(event) => setRole(event.target.value)}
              disabled={loading}
            />
          </label>

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
            Processing your image with OpenAI. This can take a short moment.
          </p>
        ) : null}

        {result?.image_strategy === "generate_fallback" ||
        result?.image_strategy === "generate_from_reference" ? (
          <p className="message warning-message">
            {result?.image_strategy === "generate_from_reference"
              ? "The app used reference-based generation mode, so the result is guided by the uploaded image and AI improvement points rather than a direct pixel edit."
              : "Image editing access was unavailable for the current key, so the app used image generation fallback. The result may be less exact than a true same-image edit."}
          </p>
        ) : null}

        {originalPreview || result?.improved_image ? (
          <div className="preview-grid">
            {originalPreview ? (
              <article className="panel">
                <h2>Original image</h2>
                <div className="image-frame">
                  <img src={originalPreview} alt="Original upload preview" />
                </div>
              </article>
            ) : null}

            {result?.improved_image ? (
              <article className="panel">
                <h2>Improved image</h2>
                <div className="image-frame">
                  <img
                    src={result.improved_image}
                    alt={`Improved professional portrait for a ${role} role`}
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

        {result?.analysis ? (
          <section className="analysis-grid">
            <article className="panel">
              <h2>Identified image purpose</h2>
              <p className="analysis-kicker">{result.analysis.image_purpose}</p>
              <p className="analysis-copy">
                {result.analysis.purpose_description}
              </p>
            </article>

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

            <article className="panel">
              <h2>Improvement points</h2>
              <ul className="detail-list">
                {result.analysis.improvements.map((item, index) => (
                  <li key={`improvement-${index}`}>{item}</li>
                ))}
              </ul>
            </article>
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
