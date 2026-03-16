import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Type, Modality, LiveServerMessage } from '@google/genai';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Play, Square, Loader2, Video } from 'lucide-react';

const SYSTEM_INSTRUCTION = `You are an expert math tutor. You can see the user's workspace through the camera, and hear them through the microphone.

### MULTIMODAL OUTPUT RULES
1. AUDIO (Voice): Use this for conversational guidance. Keep sentences short.
2. TEXT (Screen): Use the \`updateScreenText\` tool EXCLUSIVELY to display written mathematical steps. Format all math clearly using LaTeX or Markdown.

### THE TEACHING WORKFLOW
1. IDENTIFY: Look at the problem. Speak: Confirm what the problem is. Call \`updateScreenText\` to write out the initial equation.
2. PROMPT: Ask the user to attempt the first step.
3. WATCH & WAIT: Observe the live video feed.
4. EVALUATE: 
   - IF CORRECT: Say "Great, now let's go to the next step." Call \`updateScreenText\` to write the completed step.
   - IF INCORRECT: Point out the specific mistake and guide them to fix it.
   - IF STUCK: Give a small conceptual hint.

### STRICT GUARDRAILS
- NEVER give the final answer upfront. 
- NEVER solve more than one step at a time.
- Always wait for the user to physically write down the step before moving forward.`;

export default function LiveTutor() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [screenText, setScreenText] = useState<string>('Welcome to Live Math Tutor!\n\nShow a math problem to the camera and say hello to start.');
  const [error, setError] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<any>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextPlayTimeRef = useRef<number>(0);
  const frameIntervalRef = useRef<number | null>(null);

  const stopAudio = useCallback(() => {
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    activeSourcesRef.current.clear();
    if (audioCtxRef.current) {
      nextPlayTimeRef.current = audioCtxRef.current.currentTime;
    }
  }, []);

  const playAudio = useCallback((base64Audio: string) => {
    if (!audioCtxRef.current) return;
    const audioCtx = audioCtxRef.current;
    
    try {
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pcm16 = new Int16Array(bytes.buffer, 0, Math.floor(len / 2));
      if (pcm16.length === 0) return;
      
      const audioBuffer = audioCtx.createBuffer(1, pcm16.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < pcm16.length; i++) {
        channelData[i] = pcm16[i] / 32768.0;
      }
      
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      
      source.onended = () => {
        activeSourcesRef.current.delete(source);
      };
      activeSourcesRef.current.add(source);
      
      if (nextPlayTimeRef.current < audioCtx.currentTime) {
        nextPlayTimeRef.current = audioCtx.currentTime;
      }
      source.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += audioBuffer.duration;
    } catch (e) {
      console.error("Error playing audio:", e);
    }
  }, []);

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !sessionRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx || video.videoWidth === 0) return;
    
    const MAX_WIDTH = 640;
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const base64Data = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
    
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then((session) => {
        try {
          session.sendRealtimeInput({
            media: {
              mimeType: 'image/jpeg',
              data: base64Data
            }
          });
        } catch (e) {
          console.error("Error sending video frame:", e);
        }
      });
    }
  }, []);

  const handleStop = useCallback(() => {
    setIsConnected(false);
    setIsConnecting(false);
    
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    stopAudio();
    
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    
    if (sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch (e) {}
      sessionRef.current = null;
    }
  }, [stopAudio]);

  const startSession = async () => {
    try {
      setIsConnecting(true);
      setError(null);
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Your browser does not support camera and microphone access.");
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      audioCtxRef.current = audioCtx;
      nextPlayTimeRef.current = audioCtx.currentTime;
      
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      const dummyGain = audioCtx.createGain();
      dummyGain.gain.value = 0;
      
      source.connect(processor);
      processor.connect(dummyGain);
      dummyGain.connect(audioCtx.destination);

      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{
            functionDeclarations: [{
              name: "updateScreenText",
              description: "Updates the text displayed on the user's screen. Use this EXCLUSIVELY to display written mathematical steps, equations, and formulas. Format all math clearly using LaTeX or Markdown.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  text: {
                    type: Type.STRING,
                    description: "The math text to display on the screen.",
                  },
                },
                required: ["text"],
              }
            }]
          }]
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcm16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                let s = Math.max(-1, Math.min(1, inputData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              const buffer = new ArrayBuffer(pcm16.length * 2);
              const view = new DataView(buffer);
              for (let i = 0; i < pcm16.length; i++) {
                view.setInt16(i * 2, pcm16[i], true);
              }
              
              let binary = '';
              const bytes = new Uint8Array(buffer);
              const len = bytes.byteLength;
              for (let i = 0; i < len; i++) {
                  binary += String.fromCharCode(bytes[i]);
              }
              const base64 = btoa(binary);
              
              sessionPromise.then((session) => {
                try {
                  session.sendRealtimeInput({
                    media: {
                      mimeType: 'audio/pcm;rate=16000',
                      data: base64
                    }
                  });
                } catch (e) {
                  console.error("Error sending audio:", e);
                }
              });
            };

            frameIntervalRef.current = window.setInterval(captureFrame, 1000) as unknown as number;
          },
          onmessage: async (message: LiveServerMessage) => {
            try {
              const parts = message.serverContent?.modelTurn?.parts;
              if (parts) {
                for (const part of parts) {
                  if (part.inlineData && part.inlineData.data) {
                    playAudio(part.inlineData.data);
                  }
                }
              }
              
              if (message.serverContent?.interrupted) {
                stopAudio();
              }
              
              if (message.toolCall?.functionCalls) {
                const responses = [];
                for (const call of message.toolCall.functionCalls) {
                  if (call.name === 'updateScreenText') {
                    const args = call.args as { text?: string } | undefined;
                    if (args && args.text) {
                      setScreenText(args.text);
                    }
                    
                    if (call.id) {
                      responses.push({
                        id: call.id,
                        name: call.name,
                        response: { result: "success" }
                      });
                    }
                  }
                }
                
                if (responses.length > 0) {
                  sessionPromise.then((session) => {
                    try {
                      session.sendToolResponse({
                        functionResponses: responses
                      });
                    } catch (e) {
                      console.error("Error sending tool response:", e);
                    }
                  });
                }
              }
            } catch (err) {
              console.error("Error in onmessage handler:", err);
            }
          },
          onclose: () => {
            handleStop();
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection error occurred.");
            handleStop();
          }
        }
      });
      
      sessionPromiseRef.current = sessionPromise;
      
      sessionRef.current = await sessionPromise;
      
    } catch (err: any) {
      console.error("Failed to start session:", err);
      if (err.name === 'NotAllowedError' || err.message === 'Permission denied') {
        setError("Camera and microphone access was denied. Please allow access in your browser settings to use the Live Tutor.");
      } else {
        setError(err.message || "Failed to start session");
      }
      handleStop();
    }
  };

  useEffect(() => {
    return () => {
      handleStop();
    };
  }, [handleStop]);

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100 font-sans">
      <header className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center">
            <span className="font-bold text-white">AI</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Live Math Tutor</h1>
        </div>
        
        <div className="flex items-center gap-4">
          {error && <span className="text-red-400 text-sm">{error}</span>}
          
          {isConnected ? (
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium px-3 py-1.5 bg-emerald-400/10 rounded-full">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              Connected
            </div>
          ) : (
            <div className="text-neutral-500 text-sm font-medium px-3 py-1.5 bg-neutral-800 rounded-full">
              Disconnected
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 flex flex-col border-r border-neutral-800 bg-black relative">
          <div className="absolute top-4 left-4 z-10 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-lg text-xs font-medium tracking-wider text-neutral-300 uppercase border border-white/10">
            Your Workspace
          </div>
          
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className="w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />
          
          {!isConnected && !isConnecting && (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/80 backdrop-blur-sm">
              <div className="text-center max-w-sm px-6">
                <div className="w-16 h-16 bg-neutral-800 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Video className="w-8 h-8 text-neutral-400" />
                </div>
                <h3 className="text-lg font-medium text-white mb-2">Camera Access Required</h3>
                <p className="text-neutral-400 text-sm mb-6">
                  The tutor needs to see your paper to help you solve math problems step-by-step.
                </p>
                <div className="flex justify-center">
                  <button 
                    onClick={startSession}
                    className="py-3 px-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Play className="w-4 h-4" fill="currentColor" />
                    Start Session
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {isConnecting && (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                <p className="text-neutral-300 font-medium">Connecting to Tutor...</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col bg-[#1e1e1e] relative">
          <div className="absolute top-4 left-4 z-10 bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-lg text-xs font-medium tracking-wider text-neutral-300 uppercase border border-white/5">
            Tutor's Board
          </div>
          
          <div className="flex-1 p-8 overflow-y-auto mt-12">
            <div className="prose prose-invert prose-lg max-w-none prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10">
              <Markdown 
                remarkPlugins={[remarkMath]} 
                rehypePlugins={[rehypeKatex]}
              >
                {screenText}
              </Markdown>
            </div>
          </div>
        </div>
      </main>

      <footer className="h-20 border-t border-neutral-800 bg-neutral-900 flex items-center justify-center gap-4">
        {isConnected ? (
          <button 
            onClick={handleStop}
            className="flex items-center gap-2 px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-full font-medium transition-colors"
          >
            <Square className="w-4 h-4" fill="currentColor" />
            End Session
          </button>
        ) : (
          <button 
            onClick={startSession}
            disabled={isConnecting}
            className="flex items-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full font-medium transition-colors shadow-lg shadow-indigo-500/20"
          >
            {isConnecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" fill="currentColor" />
            )}
            {isConnecting ? 'Connecting...' : 'Start Session'}
          </button>
        )}
      </footer>
    </div>
  );
}
