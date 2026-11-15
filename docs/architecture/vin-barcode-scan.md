# VIN barcode scan

## Purpose

Service advisors can enter a vehicle identification number (VIN) by typing it or by scanning a barcode with the device camera. Scanning is an optional shortcut; it does not identify the vehicle record, submit the intake, or confirm ownership.

## User flow

1. The advisor chooses **Scan VIN barcode**. VMMS requests camera access only after this action.
2. The camera preview uses the device's environment-facing camera where available. The browser barcode detector checks common vehicle-label formats: Code 39, Code 128, Data Matrix and QR.
3. A value is accepted only when it has exactly 17 permitted VIN characters. The value is uppercased and placed in the existing VIN field for the advisor to review.
4. The advisor still chooses the site-scoped vehicle lookup or continues entering a new vehicle. Scanning never saves or submits the visit on its own.
5. The camera stream stops after a result, when the advisor stops it, or when the component closes.

Manual entry remains available in every browser. If camera permission, media devices, barcode detection or a supported barcode format is unavailable, the page explains the issue and keeps manual entry available. The scanner does not perform OCR, save a photograph or send camera frames to the server. It validates VIN shape only; it does not validate a manufacturer-specific check digit or establish vehicle identity.

## Security and privacy

- Camera access begins only from an explicit button action and stays local to the browser.
- A decoded value is an untrusted input and follows the same field validation and site-scoped lookup as typed text.
- Invalid values do not replace the current VIN.
- No role, consent, custody, safety, repair or release authority is created by scanning.

## Verification limits

The local browser check supplies a synthetic camera stream and barcode detector. It verifies that the stream is attached to the video element, decoded values are handled safely, and tracks are stopped after a scan or after a delayed permission grant arrives once intake has closed. It does not prove physical camera focus, barcode quality, browser support or device behavior. Those checks remain part of the iPhone, iPad and Android device matrix in P-002; HarmonyOS remains separately tracked.
