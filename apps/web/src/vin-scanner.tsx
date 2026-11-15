import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "./ui";

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
};
type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

function createDetector(formats: string[]): BarcodeDetectorLike | null {
  const Detector = window.BarcodeDetector;
  return typeof Detector === "function" ? new Detector({ formats }) : null;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

export function normalizeScannedVin(rawValue: string): string | null {
  const vin = rawValue.trim().toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}

export function VinScanner({ onScan, disabled = false }: { onScan: (vin: string) => void; disabled?: boolean }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestGeneration = useRef(0);
  const requestInFlight = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const detectorAvailable = typeof window !== "undefined" && typeof window.BarcodeDetector === "function";

  useEffect(() => () => {
    requestGeneration.current += 1;
    requestInFlight.current = false;
  }, []);

  useEffect(() => {
    if (!stream) return;
    let active = true;
    let timer = 0;
    let detector: BarcodeDetectorLike | null = null;
    const video = videoRef.current;
    if (video) video.srcObject = stream;
    async function detect() {
      if (!active || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        if (active) timer = window.setTimeout(detect, 160);
        return;
      }
      try {
        if (!detector) {
          const supported = await window.BarcodeDetector?.getSupportedFormats?.();
          if (!active) return;
          const formats = ["code_39", "code_128", "data_matrix", "qr_code"];
          const available = supported ? formats.filter((format) => supported.includes(format)) : formats;
          if (available.length === 0) {
            setMessage("This camera cannot read common vehicle barcode formats. Enter the VIN below.");
            setStream(null);
            return;
          }
          detector = createDetector(available);
          if (!detector) {
            setMessage("Camera barcode scanning is not available in this browser. Enter the VIN below.");
            setStream(null);
            return;
          }
        }
        const results = await detector.detect(video);
        if (!active) return;
        if (results.length > 0) {
          const vin = normalizeScannedVin(results[0]!.rawValue);
          if (vin) {
            setMessage("VIN scanned. Review it in the field before continuing.");
            onScanRef.current(vin);
            setStream(null);
            return;
          }
          setMessage("The code scanned was not a valid 17-character VIN. Enter the VIN below.");
          setStream(null);
          return;
        }
      } catch {
        setMessage("The camera could not read a barcode. Enter the VIN below or try again.");
        setStream(null);
        return;
      }
      if (active) timer = window.setTimeout(detect, 220);
    }

    void video?.play().then(detect).catch(() => {
      setMessage("Camera preview could not start. Check camera permission or enter the VIN below.");
      setStream(null);
    });

    return () => {
      active = false;
      window.clearTimeout(timer);
      if (video?.srcObject === stream) video.srcObject = null;
      stream.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  async function start() {
    setMessage(null);
    if (!detectorAvailable) {
      setMessage("Camera barcode scanning is not available in this browser. Enter the VIN below.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Camera access is not available here. Enter the VIN below.");
      return;
    }
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const requestId = ++requestGeneration.current;
    setStarting(true);
    setMessage("Requesting camera access…");
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (requestGeneration.current !== requestId) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      setStream(nextStream);
    } catch {
      if (requestGeneration.current === requestId) {
        setMessage("Camera permission was not granted. Enter the VIN below or allow camera access and try again.");
      }
    } finally {
      if (requestGeneration.current === requestId) {
        requestInFlight.current = false;
        setStarting(false);
      }
    }
  }

  return (
    <div className="space-y-2">
      {stream ? (
        <div className="space-y-2">
          <video ref={videoRef} className="max-h-64 w-full rounded-lg bg-zinc-950 object-contain" muted playsInline aria-label="Live camera preview for scanning a vehicle VIN barcode" />
          <Button type="button" variant="secondary" onClick={() => { setStream(null); setMessage("Camera stopped."); }}>
            <CameraOff className="size-4" aria-hidden="true" /> Stop camera
          </Button>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => void start()} disabled={disabled || starting}>
          <Camera className="size-4" aria-hidden="true" /> {starting ? "Requesting camera…" : "Scan VIN barcode"}
        </Button>
      )}
      {message && <p role="status" aria-live="polite" className="text-sm text-zinc-700">{message}</p>}
    </div>
  );
}
