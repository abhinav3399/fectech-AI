
import React, { useState, useRef } from 'react';
import { Mic, Square, Play } from 'lucide-react';

export default function AudioRecorder({ onRecordingComplete }) {
    const [isRecording, setIsRecording] = useState(false);
    const [audioBlob, setAudioBlob] = useState(null);
    const [audioUrl, setAudioUrl] = useState(null);
    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            chunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                setAudioBlob(blob);
                const url = URL.createObjectURL(blob);
                setAudioUrl(url);
                onRecordingComplete(blob);

                // Stop tracks
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorderRef.current.start();
            setIsRecording(true);
        } catch (err) {
            console.error("Mic access denied", err);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    return (
        <div className="audio-recorder">
            {!isRecording && !audioBlob && (
                <button type="button" onClick={startRecording} className="rec-btn start">
                    <Mic size={20} /> Record Voice
                </button>
            )}

            {isRecording && (
                <button type="button" onClick={stopRecording} className="rec-btn stop">
                    <Square size={20} /> Stop
                </button>
            )}

            {audioBlob && (
                <div className="audio-preview">
                    <audio src={audioUrl} controls className="audio-player" />
                    <button type="button" onClick={() => {
                        setAudioBlob(null);
                        setAudioUrl(null);
                        onRecordingComplete(null);
                    }} className="rec-btn reset">
                        Reset
                    </button>
                </div>
            )}

            <style>{`
                .audio-recorder {
                    margin-bottom: var(--s-4);
                }
                .rec-btn {
                    display: flex;
                    align-items: center;
                    gap: var(--s-2);
                    padding: var(--s-3) var(--s-4);
                    border-radius: var(--r-pill);
                    border: 1px solid transparent;
                    font-weight: 700;
                    font-size: var(--fs-sm);
                    font-family: inherit;
                    cursor: pointer;
                    width: 100%;
                    justify-content: center;
                    transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease), background var(--dur) var(--ease);
                }
                .rec-btn:active { transform: translateY(1px); }
                .start {
                    background: var(--grad-brand);
                    color: var(--text-on-brand);
                    box-shadow: var(--glow-brand);
                }
                .start:hover { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(124, 58, 237, 0.5); }
                .stop {
                    background: linear-gradient(135deg, #f43f5e, #e11d48);
                    color: #fff;
                    box-shadow: 0 10px 30px rgba(244, 63, 94, 0.4);
                    animation: pulse 1s infinite;
                }
                .reset {
                    background: var(--surface-2);
                    border-color: var(--border);
                    color: var(--text);
                    margin-top: var(--s-2);
                }
                .reset:hover { background: var(--surface-3); }
                .audio-preview {
                    background: var(--glass);
                    border: 1px solid var(--border);
                    border-radius: var(--r-md);
                    padding: var(--s-3);
                    backdrop-filter: blur(12px);
                }
                .audio-player {
                    width: 100%;
                    min-width: 0;
                    max-width: 100%;
                    height: 36px;
                    margin-bottom: var(--s-2);
                }
                @keyframes pulse {
                    0% { opacity: 1; }
                    50% { opacity: 0.7; }
                    100% { opacity: 1; }
                }
            `}</style>
        </div>
    );
}
