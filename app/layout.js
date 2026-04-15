import "./globals.css";

export const metadata = {
  title: "AI Career Portrait Studio",
  description:
    "Upload an image, get job-role feedback, and generate an improved professional portrait using OpenAI APIs.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
