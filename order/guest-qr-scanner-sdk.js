/**
 * MasterOrder Guest QR Scanner — BarcodeDetector + jsQR（遅延ロード用）。
 *
 * 依存: order-sdk（parseGuestQrText）、任意で jsQR
 * グローバル: MasterOrderGuestQrScannerSdk
 */
(function (global) {
    'use strict';

    function guestQrDecodeSupported() {
        return typeof BarcodeDetector !== 'undefined' || typeof global.jsQR === 'function';
    }

    function guestQrCameraSupported() {
        return !!(typeof navigator !== 'undefined'
            && navigator.mediaDevices
            && typeof navigator.mediaDevices.getUserMedia === 'function');
    }

    function parseGuestQrText(text) {
        var orderApi = global.MasterOrderOrderSdk || global.MasterOrderSdk;
        if (!orderApi || typeof orderApi.parseGuestQrText !== 'function') {
            throw new Error('MasterOrderOrderSdk.parseGuestQrText is required');
        }
        return orderApi.parseGuestQrText(text);
    }

    function decodeGuestQrImageData(imageData) {
        if (!imageData) {
            return '';
        }
        if (typeof global.jsQR === 'function') {
            var jsResult = global.jsQR(
                imageData.data,
                imageData.width,
                imageData.height,
                { inversionAttempts: 'attemptBoth' }
            );
            if (jsResult && jsResult.data) {
                return String(jsResult.data).trim();
            }
        }
        return '';
    }

    function getSharedGuestQrDetector() {
        if (typeof BarcodeDetector === 'undefined') {
            return null;
        }
        if (!global.__masterorderGuestQrDetector) {
            global.__masterorderGuestQrDetector = new BarcodeDetector({ formats: ['qr_code'] });
        }
        return global.__masterorderGuestQrDetector;
    }

    async function decodeGuestQrBitmap(bitmap) {
        var text = '';
        var detector = getSharedGuestQrDetector();
        if (detector) {
            try {
                var codes = await detector.detect(bitmap);
                if (codes && codes.length && codes[0].rawValue) {
                    text = String(codes[0].rawValue).trim();
                }
            } catch (_) { /* fallback to jsQR */ }
        }
        if (!text && typeof document !== 'undefined') {
            var canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            var ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(bitmap, 0, 0);
            text = decodeGuestQrImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
        }
        return text;
    }

    async function decodeGuestQrVideoFrame(videoEl, scratch) {
        if (!videoEl || videoEl.readyState < 2) {
            return '';
        }
        var text = '';
        if (typeof BarcodeDetector !== 'undefined') {
            scratch.detector = scratch.detector || getSharedGuestQrDetector();
            try {
                var codes = await scratch.detector.detect(videoEl);
                if (codes && codes.length && codes[0].rawValue) {
                    text = String(codes[0].rawValue).trim();
                }
            } catch (_) { /* jsQR fallback */ }
        }
        if (!text && typeof document !== 'undefined' && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
            scratch.canvas = scratch.canvas || document.createElement('canvas');
            scratch.ctx = scratch.ctx || scratch.canvas.getContext('2d', { willReadFrequently: true });
            scratch.canvas.width = videoEl.videoWidth;
            scratch.canvas.height = videoEl.videoHeight;
            scratch.ctx.drawImage(videoEl, 0, 0);
            text = decodeGuestQrImageData(
                scratch.ctx.getImageData(0, 0, scratch.canvas.width, scratch.canvas.height)
            );
        }
        return text;
    }

    /**
     * 来客 QR スキャナ（BarcodeDetector + jsQR、iOS Safari 対応）
     * @param {object} options
     * @param {HTMLVideoElement} options.videoEl
     * @param {function(string, object): void} [options.onScan]
     * @param {function(string, string): void} [options.onStatus]
     * @param {function(Error): void} [options.onError]
     */
    function createGuestQrScanner(options) {
        options = options || {};
        var videoEl = options.videoEl || null;
        var state = {
            running: false,
            stream: null,
            rafId: null,
            scratch: {},
            lastFrameAt: 0
        };

        function emitStatus(message, type) {
            if (typeof options.onStatus === 'function') {
                options.onStatus(message, type || '');
            }
        }

        function emitError(err) {
            if (typeof options.onError === 'function') {
                options.onError(err);
            }
        }

        function stop() {
            state.running = false;
            if (state.rafId != null) {
                cancelAnimationFrame(state.rafId);
                state.rafId = null;
            }
            if (state.stream) {
                state.stream.getTracks().forEach(function (track) {
                    track.stop();
                });
                state.stream = null;
            }
            if (videoEl) {
                try {
                    videoEl.pause();
                } catch (_) { /* ignore */ }
                videoEl.srcObject = null;
            }
        }

        async function handleDecodedText(text) {
            var trimmed = String(text || '').trim();
            if (!trimmed) {
                return false;
            }
            stop();
            emitStatus('QRを読み取りました。接続しています…', 'ok');
            var payload = parseGuestQrText(trimmed);
            if (typeof options.onScan === 'function') {
                await options.onScan(trimmed, payload);
            }
            return true;
        }

        async function scanFile(file) {
            if (!file) {
                throw new Error('画像ファイルがありません');
            }
            if (!guestQrDecodeSupported()) {
                throw new Error('このブラウザはQR画像読み取りに未対応です');
            }
            var bitmap = await createImageBitmap(file);
            try {
                var text = await decodeGuestQrBitmap(bitmap);
                if (!text) {
                    throw new Error('QRコードを検出できませんでした');
                }
                await handleDecodedText(text);
                return text;
            } finally {
                if (bitmap && typeof bitmap.close === 'function') {
                    bitmap.close();
                }
            }
        }

        async function start() {
            if (!videoEl) {
                throw new Error('video 要素が必要です');
            }
            if (!guestQrCameraSupported()) {
                throw new Error('カメラを利用できません');
            }
            if (!guestQrDecodeSupported()) {
                throw new Error('QR読み取りを開始できません（jsQR を読み込んでください）');
            }
            stop();
            videoEl.setAttribute('playsinline', 'true');
            videoEl.setAttribute('webkit-playsinline', 'true');
            videoEl.muted = true;
            state.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });
            videoEl.srcObject = state.stream;
            await videoEl.play();
            state.running = true;
            emitStatus('QRをカメラにかざしてください', 'ok');

            var loop = function () {
                if (!state.running) {
                    return;
                }
                var now = Date.now();
                if (now - state.lastFrameAt >= 120) {
                    state.lastFrameAt = now;
                    decodeGuestQrVideoFrame(videoEl, state.scratch).then(function (text) {
                        if (!state.running || !text) {
                            return;
                        }
                        handleDecodedText(text).catch(function (err) {
                            emitError(err);
                        });
                    }).catch(function () { /* retry next frame */ });
                }
                state.rafId = requestAnimationFrame(loop);
            };
            state.rafId = requestAnimationFrame(loop);
        }

        return {
            start: start,
            stop: stop,
            scanFile: scanFile,
            supportsCamera: guestQrCameraSupported,
            supportsDecode: guestQrDecodeSupported
        };
    }

    global.MasterOrderGuestQrScannerSdk = {
        createGuestQrScanner: createGuestQrScanner,
        guestQrCameraSupported: guestQrCameraSupported,
        guestQrDecodeSupported: guestQrDecodeSupported
    };
})(typeof window !== 'undefined' ? window : globalThis);
