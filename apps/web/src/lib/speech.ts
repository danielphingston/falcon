import { useEffect, useRef, useState } from "react";

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

const Ctor = (): RecognitionCtor | undefined =>
  (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

/** Dictation with the browser's speech recognition (Chrome, Edge, Safari). */
export function useSpeech(onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  const supported = !!Ctor();

  useEffect(() => () => rec.current?.stop(), []);

  const start = () => {
    const C = Ctor();
    if (!C) return;
    setError(null);
    const r = new C();
    r.lang = navigator.language || "en-IN";
    r.interimResults = true;
    r.continuous = false;
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      cb.current((finalText + interim).trim(), false);
    };
    r.onerror = (e) => setError(e.error === "not-allowed" ? "Microphone access was blocked" : e.error);
    r.onend = () => {
      setListening(false);
      if (finalText.trim()) cb.current(finalText.trim(), true);
    };
    rec.current = r;
    r.start();
    setListening(true);
  };

  const stop = () => rec.current?.stop();
  return { supported, listening, error, start, stop };
}
