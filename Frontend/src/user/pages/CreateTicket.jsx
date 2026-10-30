import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Upload,
    X,
    ImageIcon,
    ArrowRight,
    Sparkles,
    BrainCircuit,
    AlertCircle,
    CheckCircle2,
    Clock,
    Mic,
    MicOff,
    Loader2,
    Volume2,
    Globe,
    ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from "../../components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { AttachmentDropzone } from "../../components/AttachmentDropzone";
import { Textarea } from "../../components/ui/textarea";
import Tesseract from 'tesseract.js';
import { translateText, SUPPORTED_LANGUAGES } from '../../services/translationService';

const CreateTicket = () => {
    const [issue, setIssue] = useState('');
    const [file, setFile] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [extractedOCR, setExtractedOCR] = useState('');
    const [isOcrLoading, setIsOcrLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const fileInputRef = useRef(null);
    const navigate = useNavigate();
    const MAX_CHARS = 1000;
    const supportsSpeech = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    const [selectedLanguage, setSelectedLanguage] = useState('en');
    const [isTranslating, setIsTranslating] = useState(false);
    const [isLangOpen, setIsLangOpen] = useState(false);
    const langRef = useRef(null);

    // Voice UI states
    const [showVoiceModal, setShowVoiceModal] = useState(false);
    const [voiceTranscript, setVoiceTranscript] = useState('');
    const [interimVoice, setInterimVoice] = useState('');

    // Voice Refs & Visualizer
    const recognitionRef = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const dataArrayRef = useRef(null);
    const animationFrameRef = useRef(null);
    const [visualizerData, setVisualizerData] = useState(new Array(16).fill(15));
    const streamRef = useRef(null);

    useEffect(() => {
        return () => {
            if (recognitionRef.current) recognitionRef.current.stop();
            if (audioContextRef.current) audioContextRef.current.close();
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, []);

    // Close language dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (langRef.current && !langRef.current.contains(event.target)) {
                setIsLangOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Clean up preview URL on unmount
    useEffect(() => {
        return () => {
            if (imagePreview) URL.revokeObjectURL(imagePreview);
        };
    }, [imagePreview]);

    const processOCR = async (imageFile) => {
        setIsOcrLoading(true);
        try {
            const { data: { text } } = await Tesseract.recognize(imageFile, 'eng');
            setExtractedOCR(text.trim());
        } catch (err) {
            console.error("OCR Failed:", err);
            // Non-fatal, just log it. Backend will still try if this fails.
        } finally {
            setIsOcrLoading(false);
        }
    };

    // Voice Audio Recording State for STT & Direct Dictation
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const [isTranscribing, setIsTranscribing] = useState(false);

    const toggleMic = () => {
        if (isListening) {
            stopListening();
            return;
        }
        startListening();
    };

    const startListening = async () => {
        setError('');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // 1. Setup Audio Visualizer
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioContextRef.current = new AudioContext();
            const source = audioContextRef.current.createMediaStreamSource(stream);
            const analyser = audioContextRef.current.createAnalyser();
            analyser.fftSize = 64;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyserRef.current = analyser;
            dataArrayRef.current = dataArray;
            source.connect(analyser);

            const updateVisualizer = () => {
                if (!analyserRef.current) return;
                analyserRef.current.getByteFrequencyData(dataArrayRef.current);
                const bars = [];
                for (let i = 0; i < 16; i++) {
                    const val = dataArrayRef.current[i] || 0;
                    const height = Math.max(6, (val / 255) * 45);
                    bars.push(height);
                }
                setVisualizerData(bars);
                animationFrameRef.current = requestAnimationFrame(updateVisualizer);
            };
            updateVisualizer();

            // 2. Setup MediaRecorder for open-source Whisper STT
            audioChunksRef.current = [];
            let recorder;
            try {
                recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            } catch (recErr) {
                recorder = new MediaRecorder(stream);
            }
            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };
            recorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                if (audioBlob.size > 1000) {
                    await processSTTFallback(audioBlob);
                }
            };
            mediaRecorderRef.current = recorder;
            recorder.start();

            // 3. Setup Native SpeechRecognition for instant live dictation
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                try {
                    const recognition = new SpeechRecognition();
                    recognition.continuous = true;
                    recognition.interimResults = true;
                    recognition.lang = selectedLanguage === 'te' ? 'te-IN' : (selectedLanguage === 'hi' ? 'hi-IN' : 'en-US');

                    recognition.onresult = (event) => {
                        let finalStr = '';
                        for (let i = event.resultIndex; i < event.results.length; ++i) {
                            if (event.results[i].isFinal) {
                                finalStr += event.results[i][0].transcript;
                            }
                        }
                        if (finalStr) {
                            setIssue(prev => {
                                const newText = (prev ? prev + ' ' : '') + finalStr.trim();
                                return newText.substring(0, MAX_CHARS);
                            });
                        }
                    };

                    recognition.onerror = (e) => {
                        console.warn("[Voice] Web Speech API note:", e.error);
                    };

                    recognitionRef.current = recognition;
                    recognition.start();
                } catch (recErr) {
                    console.warn("[Voice] Speech recognition init note:", recErr);
                }
            }

            setIsListening(true);
        } catch (err) {
            console.error("Microphone access denied:", err);
            setError("Could not access microphone. Please grant permission in browser settings.");
        }
    };

    const processSTTFallback = async (audioBlob) => {
        setIsTranscribing(true);
        try {
            // Priority 1: Groq Whisper Cloud (free / ultra fast)
            const groqKey = import.meta.env.VITE_GROQ_API_KEY_1 || import.meta.env.VITE_GROQ_API_KEY_2;
            if (groqKey) {
                const { transcribeWithGroq } = await import('../../services/sttService');
                const transcript = await transcribeWithGroq(audioBlob, groqKey);
                if (transcript && transcript.trim()) {
                    setIssue(prev => {
                        if (!prev.includes(transcript.trim())) {
                            return (prev ? prev + ' ' : '') + transcript.trim();
                        }
                        return prev;
                    });
                    return;
                }
            }

            // Priority 2: Hugging Face Whisper Inference
            const hfToken = import.meta.env.VITE_HF_TOKEN || '';
            if (hfToken) {
                const { transcribeWithHuggingFace } = await import('../../services/sttService');
                const transcript = await transcribeWithHuggingFace(audioBlob, hfToken);
                if (transcript && transcript.trim()) {
                    setIssue(prev => {
                        if (!prev.includes(transcript.trim())) {
                            return (prev ? prev + ' ' : '') + transcript.trim();
                        }
                        return prev;
                    });
                }
            }
        } catch (sttErr) {
            console.warn("[STT] Open-source STT note:", sttErr.message);
        } finally {
            setIsTranscribing(false);
        }
    };

    const stopListening = () => {
        setIsListening(false);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current = null;
        }
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch (e) {}
            recognitionRef.current = null;
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (audioContextRef.current) {
            try { audioContextRef.current.close(); } catch (e) {}
            audioContextRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    };

    const handleFileChange = (e) => {
        const selected = e.target.files?.[0];
        if (selected && (selected.type === 'image/png' || selected.type === 'image/jpeg')) {
            if (imagePreview) URL.revokeObjectURL(imagePreview);
            setFile(selected);
            setImagePreview(URL.createObjectURL(selected));
            setError('');
            processOCR(selected);
        } else if (selected) {
            setError('Please upload only PNG or JPG images.');
        }
    };

    const removeFile = () => {
        setFile(null);
        setExtractedOCR('');
        if (imagePreview) URL.revokeObjectURL(imagePreview);
        setImagePreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const droppedFile = e.dataTransfer.files?.[0];
        if (droppedFile && (droppedFile.type === 'image/png' || droppedFile.type === 'image/jpeg')) {
            if (imagePreview) URL.revokeObjectURL(imagePreview);
            setFile(droppedFile);
            setImagePreview(URL.createObjectURL(droppedFile));
            setError('');
            processOCR(droppedFile);
        }
    };

    const handleAnalyze = async (e) => {
        e.preventDefault();
        if (!issue.trim()) {
            setError('Please describe your issue first.');
            return;
        }

        if (file && !isOcrLoading && !extractedOCR.trim()) {
            setError('No text could be extracted from the image. Please upload a clear screenshot containing text, or remove the image to continue.');
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            let textToSubmit = issue;

            // Translate to English if a different language is selected
            if (selectedLanguage !== 'en') {
                setIsTranslating(true);
                textToSubmit = await translateText(issue, selectedLanguage, 'en');
                setIsTranslating(false);
            }

            let imageBase64 = "";
            let extractedOCRText = extractedOCR;
            if (file) {
                imageBase64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        resolve(reader.result);
                    };
                    reader.readAsDataURL(file);
                });
            }

            // Navigate to AI Processing workflow where the API will be called
            navigate('/ai-processing', {
                state: {
                    text: textToSubmit,
                    original_text: issue,
                    original_language: selectedLanguage,
                    image_base64: imageBase64,
                    image_text: extractedOCRText
                }
            });

        } catch (err) {
            console.error(err);
            setError('Failed to submit ticket. Please try again later.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#f6f8f7] pb-20">
            <main className="pt-32 px-6">
                <div className="w-full max-w-2xl mx-auto">

                    {/* Left Column: User Input */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="w-full"
                    >
                        <Card className="border-none shadow-sm hover:shadow-md transition-shadow duration-300 rounded-3xl bg-white overflow-hidden h-full flex flex-col">
                            <CardHeader className="p-8 pb-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg">
                                        <Sparkles size={18} className="fill-emerald-600" />
                                    </div>
                                    <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Workspace</span>
                                </div>
                                <CardTitle className="text-3xl font-bold text-gray-900 tracking-tight">Report a New Issue</CardTitle>
                                <CardDescription className="text-base text-gray-500">
                                    Describe the problem and our AI will analyze it instantly.
                                </CardDescription>
                            </CardHeader>

                            <CardContent className="p-8 pt-2 flex-grow flex flex-col">
                                <form onSubmit={handleAnalyze} className="space-y-6 flex-grow flex flex-col">
                                    {/* Description Textarea */}
                                    <div className="space-y-2 flex-grow flex flex-col relative">
                                        <div className="flex items-center justify-between">
                                            <label className="text-sm font-bold text-gray-700">Describe your issue</label>
                                            <span className={`text-xs font-semibold ${issue.length >= MAX_CHARS ? 'text-red-500' : 'text-gray-400'}`}>
                                                {issue.length} / {MAX_CHARS}
                                            </span>
                                        </div>

                                        {/* Premium Language Selector */}
                                        <div className="flex items-center gap-2">
                                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider shrink-0">Language:</label>
                                            <div className="relative flex-1" ref={langRef}>
                                                <button
                                                    type="button"
                                                    onClick={() => setIsLangOpen(!isLangOpen)}
                                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm font-bold text-gray-700 flex items-center justify-between hover:bg-white hover:border-emerald-200 transition-all shadow-sm group"
                                                >
                                                    <span className="flex items-center gap-2">
                                                        <Globe size={14} className="text-emerald-500" />
                                                        {SUPPORTED_LANGUAGES.find(l => l.code === selectedLanguage)?.label}
                                                    </span>
                                                    <motion.div
                                                        animate={{ rotate: isLangOpen ? 180 : 0 }}
                                                        className="text-gray-400 group-hover:text-emerald-500 transition-colors"
                                                    >
                                                        <ChevronDown size={16} />
                                                    </motion.div>
                                                </button>

                                                <AnimatePresence>
                                                    {isLangOpen && (
                                                        <motion.div
                                                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                                            animate={{ opacity: 1, y: 5, scale: 1 }}
                                                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                                            className="absolute z-50 top-full left-0 right-0 bg-white border border-gray-100 rounded-2xl shadow-2xl shadow-emerald-900/10 p-2 overflow-hidden"
                                                        >
                                                            <div className="max-h-[220px] overflow-y-auto custom-scrollbar space-y-1">
                                                                {SUPPORTED_LANGUAGES.map(lang => (
                                                                    <button
                                                                        key={lang.code}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setSelectedLanguage(lang.code);
                                                                            setIsLangOpen(false);
                                                                        }}
                                                                        className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-between
                                                                            ${selectedLanguage === lang.code
                                                                                ? 'bg-emerald-50 text-emerald-700'
                                                                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                                                            }`}
                                                                    >
                                                                        {lang.label}
                                                                        {selectedLanguage === lang.code && <CheckCircle2 size={14} className="text-emerald-500" />}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                            {selectedLanguage !== 'en' && (
                                                <motion.span
                                                    initial={{ opacity: 0, x: -10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    className="text-[10px] bg-emerald-500 text-white px-2.5 py-1 rounded-full font-black uppercase tracking-widest shadow-lg shadow-emerald-200"
                                                >
                                                    Translating
                                                </motion.span>
                                            )}
                                        </div>
                                        <div className="relative flex-grow flex flex-col">
                                            <Textarea
                                                value={issue}
                                                onChange={(e) => setIssue(e.target.value.substring(0, MAX_CHARS))}
                                                placeholder="Describe your problem. Example: VPN not connecting error 789"
                                                className="min-h-[160px] flex-grow rounded-2xl border-gray-100 bg-gray-50/50 focus:bg-white transition-all text-base p-4 resize-none"
                                                disabled={isLoading}
                                            />
                                        </div>
                                    </div>

                                    {/* Premium Voice Visualizer */}
                                    {supportsSpeech && (
                                        <div className="relative overflow-hidden rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-white p-6 shadow-sm">
                                            <div className="flex items-center justify-between mb-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={`p-2 rounded-xl transition-colors duration-500 ${isListening ? 'bg-red-500 text-white shadow-lg shadow-red-200' : 'bg-emerald-100 text-emerald-600'}`}>
                                                        <Mic size={20} className={isListening ? "animate-pulse" : ""} />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-bold text-gray-900">Voice Assistant</h4>
                                                        <p className="text-xs text-gray-500 font-medium">{isListening ? "Listening to your voice..." : "Tap to describe via voice"}</p>
                                                    </div>
                                                </div>
                                                <Button
                                                    type="button"
                                                    onClick={toggleMic}
                                                    className={`h-12 w-12 rounded-full flex items-center justify-center transition-all duration-500 border-none
                                                        ${isListening
                                                            ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-200 scale-110'
                                                            : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-200'}`}
                                                >
                                                    {isListening ? <Volume2 className="animate-bounce" size={24} /> : <Mic size={24} />}
                                                </Button>
                                            </div>

                                            {/* Siri-style Wave Animation */}
                                            <AnimatePresence>
                                                {isListening && (
                                                    <motion.div
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: 40 }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        className="flex items-center justify-center gap-1.5 mb-2 overflow-hidden"
                                                    >
                                                        {[...Array(12)].map((_, i) => (
                                                            <motion.div
                                                                key={i}
                                                                animate={{
                                                                    height: [10, 30, 10],
                                                                    backgroundColor: ['#10b981', '#3b82f6', '#10b981']
                                                                }}
                                                                transition={{
                                                                    duration: 0.8,
                                                                    repeat: Infinity,
                                                                    delay: i * 0.05,
                                                                    ease: "easeInOut"
                                                                }}
                                                                className="w-1 rounded-full bg-emerald-500"
                                                            />
                                                        ))}
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>

                                            {isListening && (
                                                <motion.div
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    className="bg-white/60 backdrop-blur-sm rounded-xl p-3 border border-emerald-50/50"
                                                >
                                                    <p className="text-sm text-emerald-800 font-medium italic">
                                                        "Speak clearly, our AI is transcribing..."
                                                    </p>
                                                </motion.div>
                                            )}
                                        </div>
                                    )}

                                    {/* Attachment & Screenshot Dropzone Component */}
                                    <AttachmentDropzone
                                        file={file}
                                        onFileSelect={(selectedFile) => {
                                            if (imagePreview) URL.revokeObjectURL(imagePreview);
                                            setFile(selectedFile);
                                            if (selectedFile.type?.startsWith('image/')) {
                                                setImagePreview(URL.createObjectURL(selectedFile));
                                                void processOCR(selectedFile);
                                            } else {
                                                setImagePreview(null);
                                                setExtractedOCR('');
                                            }
                                            setError('');
                                        }}
                                        onFileRemove={removeFile}
                                        onError={(err) => setError(err)}
                                        label="Attachment / Screenshot (Optional)"
                                    />

                                    {/* Error Message */}
                                    {error && (
                                        <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600 text-sm font-medium">
                                            <AlertCircle size={16} />
                                            {error}
                                        </div>
                                    )}

                                    {/* Primary Submit Button */}
                                    <Button
                                        type="submit"
                                        disabled={isLoading || isOcrLoading || isTranslating || !issue.trim()}
                                        className="w-full h-14 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-lg rounded-2xl flex items-center justify-center gap-2 transition-all border-none shadow-emerald-200/50 shadow-lg hover:shadow-xl active:scale-[0.98] disabled:opacity-50"
                                    >
                                        {(isLoading || isTranslating) ? (
                                            <>
                                                <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                                {isTranslating ? 'Translating...' : 'Submitting issue...'}
                                            </>
                                        ) : (
                                            <>
                                                Submit Ticket
                                                <ArrowRight size={20} />
                                            </>
                                        )}
                                    </Button>
                                    <div className="flex items-center justify-center gap-2 text-xs text-gray-400 font-medium">
                                        <BrainCircuit size={14} />
                                        Powered by HelpDesk.ai Routing
                                    </div>
                                </form>
                            </CardContent>
                        </Card>
                    </motion.div>

                </div>
            </main>
        </div>
    );
};

export default CreateTicket;
