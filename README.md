# Live Math Tutor - Gemini Live Agent Challenge

## Overview
Live Math Tutor is a real-time, multimodal AI teaching assistant built for the **Gemini Live Agent Challenge**. It moves beyond the traditional text box by utilizing the Gemini Live API to "see" a student's handwritten math problems via their webcam and "speak" to them using real-time audio. 

Instead of just giving the answer, the tutor acts as a true educator: it observes the student's work, provides spoken guidance, and uses tool calling to write out the mathematical steps on a digital blackboard using LaTeX.

## Features
* **Real-time Vision:** Streams video frames (1 fps) to the Gemini Live API so the AI can see the user's physical workspace.
* **Real-time Voice:** Uses the Gemini Live API's native audio capabilities for low-latency, conversational voice interactions.
* **Interactive Blackboard:** The AI uses a specific `updateScreenText` tool to output LaTeX/Markdown, which is rendered in real-time on the UI.
* **Pedagogical Guardrails:** Prompted specifically to guide students step-by-step rather than just providing the final answer.

## Technologies Used
* **Frontend:** React 18, Vite, Tailwind CSS, Lucide React
* **AI/ML:** Google GenAI SDK (`@google/genai`), Gemini Live API (`gemini-2.5-flash-native-audio-preview-09-2025`)
* **Math Rendering:** `react-markdown`, `remark-math`, `rehype-katex`
* **Cloud/Hosting:** Google Cloud Run (via Google AI Studio Build)

## Spin-up Instructions (How to run locally)

To run this project locally and reproduce the environment for judging, follow these steps:

### Prerequisites
* Node.js (v18 or higher)
* npm or yarn
* A Gemini API Key from [Google AI Studio](https://aistudio.google.com/)

### Installation

1. **Clone the repository:**
   ```bash
   git clone <YOUR_REPO_URL>
   cd live-math-tutor
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up Environment Variables:**
   Create a `.env` file in the root directory and add your Gemini API key:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```

5. **Open the app:**
   Navigate to `http://localhost:3000` in your browser. *Note: You must grant camera and microphone permissions when prompted for the app to function.*

## Architecture
1. **Input:** The React frontend captures audio via `AudioContext` and video frames via a hidden `<canvas>` element.
2. **Processing:** Audio (PCM base64) and Video (JPEG base64) are streamed via WebSockets to the Gemini Live API.
3. **Output:** The model streams back PCM audio (played via Web Audio API) and triggers the `updateScreenText` function call to update the React state for the blackboard.

## Google Cloud Deployment
This application was developed and deployed using Google AI Studio Build, which automatically containerizes the application and hosts it on **Google Cloud Run**.
